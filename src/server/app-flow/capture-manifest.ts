import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {missingFlowParams, type FlowGraph, type FlowNode, type FlowPresentationAction, type FlowStateSite} from '../../shared/app-flow.ts';

export type CaptureJob = {
  id: string;
  path: string[];
  params?: Record<string, unknown>;
  expo?: boolean;
  actions: FlowPresentationAction[];
  sourceViews: string[];
  projections?: string[];
  blocked?: string;
  discoverOnly?: boolean;
  entryKey?: string;
  attempt?: number;
  /** Caller site of a shared shell step, keyed by action ID. */
  instances?: Record<string, string>;
};
export type CaptureManifest = {version: 1; sourceHash?: string; jobs: CaptureJob[]; total: number};
export type CaptureRecipe = {baseNodeId?: string; actions: string[]};

/** A planner may join scanned opening steps, but cannot supply executable code,
 * state values, controller methods, or component names of its own. */
export function captureRecipeNodes(graph: FlowGraph, known: FlowNode[], recipes: CaptureRecipe[] = []) {
  const catalog=new Map([...(graph.presentations?.actions??[]),...(graph.presentations?.previews??[])].map(action=>[action.id,action]));
  const nodes=new Map<string,FlowNode>();
  for(const recipe of recipes){
    if(!recipe.actions.length || recipe.actions.some(id=>!catalog.has(id)))throw new Error('A capture recipe must contain current source-proven actions.');
    const base=recipe.baseNodeId ? known.find(node=>node.id===recipe.baseNodeId) : undefined;
    if(recipe.baseNodeId && !base)throw new Error('The capture recipe base is not in the prepared map.');
    const leaf=catalog.get(recipe.actions.at(-1)!)!;
    const id=`recipe-${createHash('sha256').update(JSON.stringify([recipe.baseNodeId??null,recipe.actions])).digest('hex').slice(0,24)}`;
    nodes.set(id,{id,name:leaf.name,kind:'screen',file:leaf.file,line:leaf.line,path:[],required:base?.required??[],params:base?.params,paramVariants:base?.paramVariants,status:'pending',sourceViews:leaf.views??[],
      presentation:{actions:[...(base?.presentation?.actions??[]),...recipe.actions],basePath:base?.presentation?.basePath??base?.path??[],baseParams:base?.presentation?.baseParams??base?.params,expo:base?.presentation?.expo??base?.component==='expo-router',preview:true,projections:base?.presentation?.projections?.slice(),...(base?.presentation?.instances?{instances:{...base.presentation.instances}}:{})}} satisfies FlowNode);
  }
  return [...nodes.values()];
}
export type InstrumentationManifest = {
  version: 1;
  sourceHash?: string;
  mounts: {source: string; file: string; export: string}[];
  files: Record<string, {hash: string; states: FlowStateSite[]; data?: string[]; hosts?: string[]; mounts?: string[]; controls: {id: string; owner: string; prop: string; outerOwner?: boolean; locals?:string[]; source: NonNullable<FlowPresentationAction['source']>}[]}>;
};

/** Build approved jobs for a fixed selection or the live discovery planner. */
export function captureManifest(graph: FlowGraph, nodes: FlowNode[] = graph.nodes, include?: string[]): CaptureManifest {
  const catalog = new Map([...(graph.presentations?.actions ?? []), ...(graph.presentations?.previews ?? [])].map(action => [action.id, action]));
  const selected = include && new Set(include);
  if(selected)for(const id of selected)if(!nodes.some(node=>node.id===id||node.sourceViews?.includes(id)))throw new Error(`The prepared capture selection does not contain ${id}.`);
  const jobs: CaptureJob[] = [];
  for (const node of nodes) {
    if (node.kind !== 'screen' || selected && !selected.has(node.id) && !node.sourceViews?.some(id => selected.has(id))) continue;
    const actions = (node.presentation?.actions ?? []).flatMap(id => catalog.get(id) ? [catalog.get(id)!] : []);
    const missing = missingFlowParams(node);
    let blocked = missing.length ? `Real data is required for: ${missing.join(', ')}.` : undefined;
    if (actions.length !== (node.presentation?.actions.length ?? 0)) blocked = 'The source recipe changed. Prepare the map again.';
    jobs.push({id: node.id, path: node.presentation?.basePath ?? node.path, params: node.presentation?.baseParams ?? node.params, expo: node.presentation?.expo ?? node.component==='expo-router', actions, sourceViews: node.sourceViews ?? [], projections: node.presentation?.projections, entryKey:node.presentation?.entryKey, ...(node.presentation?.instances?{instances:node.presentation.instances}:{}), blocked});
  }
  // Parent paths and shared opening steps remain adjacent, retaining providers
  // and real query caches. IDs break ties so repeated preparation is stable.
  jobs.sort((a,b)=>{
    const base=JSON.stringify([a.path,a.params??{}]).localeCompare(JSON.stringify([b.path,b.params??{}]));if(base)return base;
    for(let index=0;index<Math.min(a.actions.length,b.actions.length);index++){const step=a.actions[index].id.localeCompare(b.actions[index].id);if(step)return step;}
    return a.actions.length-b.actions.length || a.id.localeCompare(b.id);
  });
  return {version: 1, sourceHash: graph.sourceHash, jobs, total: jobs.length};
}

export async function instrumentationManifest(projectRoot: string, graph: FlowGraph): Promise<InstrumentationManifest> {
  const root = await realpath(projectRoot);
  const files: InstrumentationManifest['files'] = {};
  const catalog = graph.presentations;
  const mounts: InstrumentationManifest['mounts'] = [];
  const states = new Map([...(catalog?.states ?? []), ...(catalog?.previewStates ?? [])].map(site => [site.id, site]));
  const marker=(file:string,owner:string,source:NonNullable<FlowPresentationAction['source']>,outerOwner=false,locals:string[]=[])=>{
    const unit=files[file]??={hash:'',states:[],controls:[]},id=`${file}:${source.line}:${source.column}:entry`;
    const previous=unit.controls.find(control=>control.id===id);
    if(previous){if(outerOwner)previous.outerOwner=true;if(locals.length)previous.locals=[...new Set([...(previous.locals??[]),...locals])];}else unit.controls.push({id,owner,prop:'',source,...(outerOwner?{outerOwner:true}:{}),...(locals.length?{locals}:{})});
  };
  for (const site of states.values()) {
    (files[site.file] ??= {hash: '', states: [], controls: []}).states.push(site);
    for(const entry of site.ownerEntries??[])marker(entry.file,entry.owner,entry.source);
    for(const selection of site.selections??[])marker(selection.file,selection.owner,selection.source,true,selection.locals);
    for(const value of site.data??[]){const unit=files[value.file]??={hash:'',states:[],controls:[]};if(!unit.data?.includes(value.name))(unit.data??=[]).push(value.name);}
  }
  for (const action of [...(catalog?.actions ?? []), ...(catalog?.previews ?? [])]) {
    if(action.effect.kind!=='mount'&&action.source)marker(action.file,action.owner,action.source,false,action.input?.locals);
    for(const entry of action.consumer?.entries??[])marker(entry.file,entry.owner,entry.source);
    for(const target of action.handoffs??[]) {
      const unit=files[target.file]??={hash:'',states:[],controls:[]};
      const id=`${target.file}:${target.source.line}:${target.source.column}:handoff`;
      if(!unit.controls.some(control=>control.id===id))unit.controls.push({id,owner:target.owner,prop:'',source:target.source});
    }
    if(action.expected) {
      const target=action.expected, unit=files[target.file]??={hash:'',states:[],controls:[]};
      const id=`${target.file}:${target.source.line}:${target.source.column}:entry`;
      if(!unit.controls.some(control=>control.id===id))unit.controls.push({id,owner:target.owner,prop:'',source:target.source});
    }
    const effect = action.effect;
    if (effect.kind === 'mount') {
      mounts.push({source:`${effect.file}#${effect.export}`,file:effect.file,export:effect.export});
      const unit=files[effect.file]??={hash:'',states:[],controls:[]};
      (unit.mounts??=[]).push(action.owner);
    }
    if (effect.kind !== 'control' || !effect.target) continue;
    const target = effect.target;
    const id = `${target.file}:${target.source.line}:${target.source.column}:${effect.prop}`;
    const unit = files[target.file] ??= {hash: '', states: [], controls: []};
    if (!unit.controls.some(control => control.id === id)) unit.controls.push({id, owner: target.owner, prop: effect.prop, source: target.source});
  }
  // A capture records the source sites that pass its opened controller. Mark
  // every controller site, so a shared prompt or sheet shell names its caller.
  for (const view of catalog?.views ?? []) {
    if (view.kind !== 'control' || files[view.file]?.controls.some(control => control.source.line === view.source.line && control.source.column === view.source.column)) continue;
    marker(view.file, view.owner, view.source);
  }
  for (const node of graph.nodes) if(node.kind==='navigator' && node.path.length===0 && node.file) {
    const unit=files[node.file]??={hash:'',states:[],controls:[]};
    (unit.hosts??=[]).push(node.definition?.split('#').at(-1) ?? node.component ?? node.name);
  }
  await Promise.all(Object.entries(files).map(async ([file, unit]) => {
    const absolute = await realpath(resolve(root, file)), local = relative(root, absolute);
    if (local.startsWith('..') || isAbsolute(local)) throw new Error('Capture source must be inside the project.');
    unit.hash = createHash('sha256').update(await readFile(absolute)).digest('hex');
  }));
  return {version: 1, sourceHash: graph.sourceHash, files, mounts};
}
