import { createHash } from 'node:crypto';
import type { FlowNode, FlowPresentationAction, FlowPresentations, FlowRun } from '../../shared/app-flow.ts';
import type { FlowBackend } from './runs.ts';
import { MeasurementWindow } from '../../shared/telemetry.ts';
import { FlowRuntimeFailure } from './runtime-metrics.ts';

type Action = { id: string; canonicalId?: string; aliases?:string[]; views?:string[]; name: string; file: string; line: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

/** Discover live presentation entries, then capture them through the shared queue. */
export class FlowPresentationDiscovery {
  readonly bindingTimings = new MeasurementWindow();
  readonly discoveryTimings = new MeasurementWindow();
  private visited = new Set<string>();
  readonly failures = new Map<string,{nodeId:string;operation:string;message:string;detail?:string}>();
  private baseKey(node: FlowNode) {
    const plan=node.presentation!;
    return JSON.stringify([plan.basePath,plan.baseParams??{},!!plan.expo]);
  }
  private catalog: FlowPresentations;
  private run: FlowRun; private root: string; private directory: string; private signal: AbortSignal; private changed: () => Promise<void>;
  constructor(run: FlowRun, root: string, directory: string, signal: AbortSignal, changed: () => Promise<void>) {
    this.run=run; this.root=root; this.directory=directory; this.signal=signal; this.changed=changed;
    const catalog=run.presentations;
    this.catalog = {states: [...new Map([...(catalog?.states??[]),...(catalog?.previewStates??[])].map(site=>[site.id,site])).values()], actions: [...(catalog?.actions??[]),...(catalog?.previews??[])]};
    for(const failure of run.discoveryFailures??[])if(run.nodes.some(node=>node.id===failure.nodeId))this.failures.set(failure.nodeId,failure);
  }
  get enabled() { return this.catalog.actions.length > 0; }
  async setup(backend: FlowBackend) {
    if (!this.enabled) return;
    this.signal.throwIfAborted();
    const start = performance.now();
    const result = await backend.runtime.invoke({type: 'presentation-setup', catalog: this.catalog, projectRoot: this.root, sourceHash:this.run.sourceHash}, 5000);
    if (result?.error) throw new Error('Presentation source binding is unavailable.');
    this.bindingTimings.record(performance.now() - start);
  }
  private edge(parent: FlowNode, node: FlowNode) {
    if (parent.id !== node.id && !this.run.edges.some(e => e.from === parent.id && e.to === node.id)) {
      this.run.edges.push({from: parent.id, to: node.id, kind: 'navigation'}); this.run.revision++;
    }
  }
  private capturedStateAncestor(base: FlowNode, action: FlowPresentationAction) {
    const effect=action.effect,plan=base.presentation;
    if(effect.kind!=='state'||!action.views?.length||!plan)return;
    const sameSelector=(id:string)=>{
      const step=this.catalog.actions.find(item=>item.id===id)?.effect;
      return step?.kind==='state'&&step.site===effect.site&&JSON.stringify(step.path)===JSON.stringify(effect.path);
    };
    return this.run.nodes.find(candidate=>{
      const previous=candidate.presentation;
      if(candidate.status!=='captured'||!candidate.image||!previous||candidate.groupId!==base.groupId||this.baseKey(candidate)!==this.baseKey(base))return false;
      if(!action.views!.every(view=>candidate.sourceViews?.includes(view)))return false;
      if(previous.actions.length>=plan.actions.length||!previous.actions.every((id,index)=>plan.actions[index]===id))return false;
      // A proven return along one finite UI selector can reuse its captured
      // ancestor. Other state changes, controls or real-data contexts can make
      // the same source body a different view, so retain those destinations.
      return plan.actions.slice(previous.actions.length).every(sameSelector);
    });
  }
  async explore(backend: FlowBackend, base: FlowNode) {
    if (!this.enabled || this.visited.has(base.id)) return;
    const started = performance.now();
    try {
      // Newly mounted forms can introduce hooks absent from the initial tree.
      await this.setup(backend);
      const available: Action[] = await backend.runtime.invoke({type: 'presentations'}, 2000);
      if(this.catalog.actions.some(action=>action.views?.length)){
        const active=await backend.runtime.invoke({type:'presentation-active'},2000);
        if(Array.isArray(active)&&active.length){base.sourceViews=[...new Set([...(base.sourceViews??[]),...active])];this.run.revision++;}
      }
      for (const action of available) {
        const source = this.catalog.actions.find(item => item.id === action.id);
        if (!source) continue;
        const ancestor=this.capturedStateAncestor(base,source);
        if(ancestor){this.edge(base,ancestor);continue;}
        const canonical=this.catalog.actions.find(item=>item.id===action.canonicalId)??source;
        const effect = canonical.effect;
        const destination = effect.kind === 'state' ? [effect.site, effect.path, effect.value] : [canonical.file, canonical.owner, effect];
        const id = `presentation-${hash(destination)}`;
        // Controller-only entries can remain available while already open.
        // Discover their children without putting this captured parent back
        // into its own queue or resetting its attempts.
        if(id===base.id)continue;
        let node = this.run.nodes.find(item => item.id === id);
        if (!node) {
          node = {id, name: source.name, kind: 'screen', path: [], required: [], status: 'pending', file: source.file, line: source.line,
            sourceViews:[...new Set([...(source.views??[]),...(action.views??[])])],presentation: {actions: [...(base.presentation?.actions ?? []), action.id], preview:source.preview||base.presentation?.preview, projections: base.presentation?.projections?.slice(), basePath: base.presentation?.basePath ?? base.path, baseParams: base.presentation?.baseParams ?? base.params, expo: base.presentation?.expo ?? base.component === 'expo-router'}};
          this.run.nodes.push(node); this.run.revision++;
        }
        node.sourceViews=[...new Set([...(node.sourceViews??[]),...(source.views??[]),...(action.views??[])])];
        this.edge(base, node);
      }
      this.visited.add(base.id);
      await this.changed();
      this.failures.delete(base.id);
    } catch (error) {
      this.visited.delete(base.id);
      this.failures.set(base.id,{nodeId:base.id,operation:error instanceof FlowRuntimeFailure?error.operation:'other',message:error instanceof FlowRuntimeFailure?error.message:'App Flow presentation discovery failed.',detail:error instanceof FlowRuntimeFailure?error.detail:undefined});
      throw error;
    }
    finally { this.run.discoveryFailures=[...this.failures.values()];this.run.revision++;this.discoveryTimings.record(performance.now() - started); }
  }
  hasVisited(id: string) { return this.visited.has(id); }
  async entry(backend: FlowBackend) {
    const view = await backend.runtime.invoke({type:'presentation-view',waitMs:1000},2500);
    if (!view.found) throw new Error('The current app view is unavailable.');
    const id = `presentation-${hash(['entry', view.key])}`;
    if (!this.run.nodes.some(node=>node.id===id)) {
      this.run.nodes.push({id,name:view.title||'App entry',kind:'screen',path:[],required:[],status:'pending',entry:true,
        presentation:{actions:[],basePath:[],entryKey:view.key}});
      this.run.revision++;
    }
  }
}
