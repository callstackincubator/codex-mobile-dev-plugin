import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FlowNode, FlowPresentations, FlowRun } from '../../shared/app-flow.ts';
import type { FlowBackend } from './runs.ts';
import { blankFlowFrame } from './frame.ts';
import { MeasurementWindow } from '../../shared/telemetry.ts';

type View = { key: string; ready: boolean; found: boolean; signature: string; motion?: string; title?: string; active: string[]; loading?: boolean; transitioning?: boolean; error?: string };
type Action = { id: string; name: string; file: string; line: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

/** Explore presentation branches in place. Navigation stays under the route runner. */
export class FlowPresentationCapture {
  readonly timings = new MeasurementWindow();
  readonly bindingTimings = new MeasurementWindow();
  private attempted = new Set<string>();
  private visited = new Set<string>();
  private previous?: {key:string;bytes:Buffer};
  rememberFrame(bytes:Buffer) { this.previous={key:"",bytes}; }
  private configured = new WeakSet<object>();
  private catalog: FlowPresentations;
  private run: FlowRun; private root: string; private directory: string; private signal: AbortSignal; private changed: () => Promise<void>;
  constructor(run: FlowRun, root: string, directory: string, signal: AbortSignal, changed: () => Promise<void>) {
    this.run=run; this.root=root; this.directory=directory; this.signal=signal; this.changed=changed;
    this.catalog = run.presentations ?? {states: [], actions: []};
  }
  get enabled() { return this.catalog.actions.length > 0; }
  async setup(backend: FlowBackend) {
    if (!this.enabled) return;
    this.signal.throwIfAborted();
    const start = performance.now();
    const result = await backend.runtime.invoke({type: 'presentation-setup', catalog: this.catalog, projectRoot: this.root}, 5000);
    if (result?.error) throw new Error('Presentation source binding is unavailable.');
    this.bindingTimings.record(performance.now() - start);
    this.configured.add(backend.runtime);
  }
  private async settled(backend: FlowBackend, timeout: number): Promise<View> {
    const started = performance.now();
    let view: View;
    do {
      this.signal.throwIfAborted();
      view = await backend.runtime.invoke({type: 'presentation-view'}, 2000);
      if (view.error) throw new Error('Presentation inspection is unavailable.');
      if (view.ready) return view;
      await delay(40, undefined, {signal: this.signal});
    } while (performance.now() - started < timeout);
    return view;
  }
  private async preview(backend: FlowBackend, node: FlowNode, view: View, attempt: number) {
    const captureSignal = AbortSignal.any([this.signal, AbortSignal.timeout([1600, 2500, 3500][attempt])]);
    let bytes = await backend.screenshot(captureSignal);
    if (blankFlowFrame(bytes) || this.previous && this.previous.key!==view.key && bytes.equals(this.previous.bytes)) {
      await delay(100, undefined, {signal: captureSignal});
      bytes = await backend.screenshot(captureSignal);
    }
    let verified: View = await backend.runtime.invoke({type: 'presentation-view'}, 2000);
    let motion = view.motion;
    const same = () => verified.key === view.key && verified.ready && verified.found && !verified.loading && !verified.transitioning;
    while (same() && verified.motion !== motion) {
      motion = verified.motion;
      await delay(40, undefined, {signal: captureSignal});
      bytes = await backend.screenshot(captureSignal);
      verified = await backend.runtime.invoke({type: 'presentation-view'}, 2000);
    }
    captureSignal.throwIfAborted();
    if (!same() || blankFlowFrame(bytes) || this.previous && this.previous.key!==view.key && bytes.equals(this.previous.bytes)){node.reason=!same()?'The presentation changed during capture.':blankFlowFrame(bytes)?'The native presentation is blank.':'The native frame still shows the previous view.';return false;}
    await writeFile(join(this.directory, this.run.id, `${node.id}.png`), bytes, {mode: 0o600});
    this.previous={key:view.key,bytes};
    node.image = `mobile-flow://${this.run.id}/${node.id}`;
    node.status = 'captured'; node.reason = 'Presentation captured; content completeness is not verified.';
    this.run.revision++;
    return true;
  }
  private edge(parent: FlowNode, node: FlowNode) {
    if (parent.id !== node.id && !this.run.edges.some(e => e.from === parent.id && e.to === node.id)) {
      this.run.edges.push({from: parent.id, to: node.id, kind: 'navigation'}); this.run.revision++;
    }
  }
  private async capture(backend: FlowBackend, node: FlowNode, view: View, attempt: number, action?: string) {
    if (!view.ready) return false;
    if (await this.preview(backend, node, view, attempt)) return true;
    const source = this.catalog.actions.find(item => item.id === action);
    if (source?.effect.kind !== 'state' || node.reason !== 'The native frame still shows the previous view.') return false;
    // A native screen container can retain its old controller after a local
    // guard replaces its navigator. Preview the proven view with live context.
    const projected = await backend.runtime.invoke({type: 'presentation-project'}, 2000);
    if (projected.error) return false;
    const visible = await this.settled(backend, 6000);
    if (!visible.ready || !await this.preview(backend, node, visible, attempt)) return false;
    if (node.presentation && action && !node.presentation.projections?.includes(action)) {
      node.presentation.projections = [...(node.presentation.projections ?? []), action];
      this.run.revision++;
    }
    return true;
  }
  async explore(backend: FlowBackend, base: FlowNode) {
    if (!this.enabled || this.visited.has(base.id)) return;
    if (!this.configured.has(backend.runtime)) await this.setup(backend);
    const visit = async (parent: FlowNode, chain: string[]) => {
      this.signal.throwIfAborted();
      // Newly mounted forms can introduce hooks absent from the initial tree.
      await this.setup(backend);
      const available: Action[] = await backend.runtime.invoke({type: 'presentations'}, 2000);
      for (const action of available) {
        const source = this.catalog.actions.find(item => item.id === action.id);
        if (!source) continue;
        const effect = source.effect;
        const destination = effect.kind === 'state' ? [effect.site, effect.path, effect.value] : [source.file, source.owner, effect];
        const id = `presentation-${hash(destination)}`;
        let node = this.run.nodes.find(item => item.id === id);
        if (node) this.edge(parent, node);
        if (this.attempted.has(id) || this.visited.has(id)) continue;
        this.attempted.add(id);
        const {level} = await backend.runtime.invoke({type: 'presentation-checkpoint'});
        const start = performance.now();
        try {
          for (let attempt = 0; attempt < 3; attempt++) {
            this.signal.throwIfAborted();
            if (attempt) await backend.runtime.invoke({type: 'presentation-rollback', level}, 5000);
            const before: View = await backend.runtime.invoke({type: 'presentation-view'}, 2000);
            const opened = await backend.runtime.invoke({type: 'presentation-open', id: action.id}, 2000);
            if (opened.error) break;
            let view = await this.settled(backend, [6000, 10000, 20000][attempt]);
            if(node?.presentation?.projections?.includes(action.id)){
              const projected=await backend.runtime.invoke({type:'presentation-project'},2000);
              if(projected.error)break;
              view=await this.settled(backend,6000);
            }
            // An unchanged tree is not a new screen. Never add phantom cards.
            if (view.key === before.key) break;
            if (!node) {
              node = {id, name: source.name, kind: 'screen', path: [], required: [], status: 'pending', file: source.file, line: source.line,
                presentation: {actions: [...chain, action.id], projections: parent.presentation?.projections?.slice(), basePath: base.presentation?.basePath??base.path, baseParams: base.presentation?.baseParams??base.params, expo: base.component === 'expo-router'}};
              this.run.nodes.push(node); this.edge(parent, node);
            }
            node.captureAttempts = attempt + 1; if (node.status !== 'captured') node.status = 'capturing'; this.run.revision++;
            await this.changed();
            const captured=node.status==='captured'||await this.capture(backend,node,view,attempt,action.id);
            if (!captured) {
              node.status = 'timed-out'; node.reason ??= 'The presentation did not finish rendering.'; this.run.revision++;
              continue;
            }
            await visit(node, [...chain, action.id]); this.visited.add(id);
            break;
          }
        } finally {
          if (node) { node.captureMs = performance.now() - start; this.timings.record(node.captureMs); }
          await backend.runtime.invoke({type: 'presentation-rollback', level}, 5000);
          await this.changed();
        }
      }
    };
    try { await visit(base, base.presentation?.actions??[]); this.visited.add(base.id); }
    catch (error) {
      // A disconnect keeps completed cards. On reconnect, enumerate the same
      // branch again; completed destinations deduplicate and failures retry.
      this.attempted.clear(); this.configured.delete(backend.runtime); throw error;
    }
  }
  async retry(backend: FlowBackend, node: FlowNode) {
    const plan=node.presentation!;
    const started=performance.now();
    try {
      for(let attempt=0;attempt<3;attempt++){
        this.signal.throwIfAborted();
        await backend.runtime.invoke({type:'presentation-rollback',level:0},10000);
        if(plan.basePath.length){
          const base=await backend.runtime.invoke({type:'open',path:plan.basePath,params:plan.baseParams,expo:plan.expo,timeoutMs:2000,loadingTimeoutMs:10000},10500);
          if(!base.ready){node.status='blocked';node.reason='The presentation entry route is no longer available.';return;}
        }
        if(plan.actions.length)this.rememberFrame(await backend.screenshot(AbortSignal.any([this.signal,AbortSignal.timeout(2000)])));
        for(const id of plan.actions){
          await this.setup(backend);
          const available:Action[]=await backend.runtime.invoke({type:'presentations'},2000);
          if(!available.some(action=>action.id===id)){node.status='blocked';node.reason='The presentation entry is no longer available in this app state.';return;}
          const opened=await backend.runtime.invoke({type:'presentation-open',id},2000);
          if(opened.error){node.status='blocked';node.reason='The presentation entry could not be opened.';return;}
          await this.settled(backend,6000);
          if(plan.projections?.includes(id)){
            const projected=await backend.runtime.invoke({type:'presentation-project'},2000);
            if(projected.error){node.status='blocked';node.reason='The saved presentation preview is no longer available.';return;}
            await this.settled(backend,6000);
          }
        }
        const view=await this.settled(backend,[6000,10000,20000][attempt]);
        node.captureAttempts=(node.captureAttempts??0)+1;node.status='capturing';this.run.revision++;
        if(plan.entryKey&&view.key!==plan.entryKey){node.status='blocked';node.reason='The app entry state has changed. Start a fresh map.';return;}
        if(await this.capture(backend,node,view,attempt,plan.actions.at(-1))){this.visited.delete(node.id);await this.explore(backend,node);return;}
        node.status='timed-out';node.reason='The presentation did not finish rendering.';
      }
    } finally {
      node.captureMs=performance.now()-started;this.timings.record(node.captureMs);this.run.revision++;
      await backend.runtime.invoke({type:'presentation-rollback',level:0},10000);
      await this.changed();
    }
  }
  async baseline(backend: FlowBackend) {
    let view = await this.settled(backend, 6000);
    if (!view.found) throw new Error('The current app view is unavailable.');
    const id = `presentation-${hash(['entry', view.key])}`;
    let node = this.run.nodes.find(item => item.id === id);
    if (!node) {
      node = {id, name: view.title || 'App entry', kind: 'screen', path: [], required: [], status: 'pending', entry: true, presentation: {actions: [], basePath: [], entryKey:view.key}};
      this.run.nodes.push(node); this.run.revision++;
    }
    if (node.status !== 'captured') {
      for(let attempt=0;attempt<3;attempt++){
        if(attempt)view=await this.settled(backend,[6000,10000,20000][attempt]);
        node.captureAttempts=(node.captureAttempts??0)+1;
        node.status='capturing';this.run.revision++;
        if(view.ready&&await this.preview(backend,node,view,attempt))break;
        node.status='timed-out';node.reason='The current app view did not finish rendering.';
      }
      await this.changed();
    }
    if(node.status==='captured')await this.explore(backend, node);
  }
}
