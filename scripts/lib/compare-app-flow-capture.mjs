import {presentationDestination} from './compare-app-flow-views.mjs';

/** A finished capture belongs to the same installed build as its audit. */
export function assertCaptureProvenance(run,pluginVersion) {
  if(run.pluginVersion!==pluginVersion)throw new Error('Capture plugin version differs from this audit. Run a fresh map with the installed build.');
  if(!['complete','partial','stopped','failed'].includes(run.phase)||!Number.isFinite(run.finishedAt)||run.finishedAt<run.startedAt)throw new Error('Capture is still running. Wait for restoration to finish before comparing screenshots.');
}

/** Count actual saved automatic screenshots, never source matches or queued
 * plans. The caller verifies the source hash and files before supplying ids. */
export function compareFlowCapture(graph,comparison,run,verifiedImages) {
  if(!graph.sourceHash||run.sourceHash!==graph.sourceHash)throw new Error('Capture source differs from this scan. Run a fresh map before comparing screenshots.');
  const actions=new Map([...(graph.presentations?.actions??[]),...(graph.presentations?.previews??[])].map(a=>[a.id,a]));
  const views=new Map((graph.presentations?.views??[]).map(v=>[v.id,v]));
  const controlsAt=new Map();
  for(const view of views.values())if(view.kind==='control'){const site=`${view.file}:${view.source.line}:${view.source.column}`;controlsAt.set(site,[...(controlsAt.get(site)??[]),view]);}
  // A site may end with the prop that passed the controller. One element can
  // pass several controllers; only that prop's view opened.
  const sitedViews=entry=>{
    const match=/^(.+:\d+:\d+):([A-Za-z_$][\w$]*)$/.exec(entry),site=match?match[1]:entry;
    return (controlsAt.get(site)??[]).filter(view=>!match||view.control?.prop===match[2]).map(view=>view.id);
  };
  const nodes=run.nodes.filter(n=>n.kind==='screen'&&n.capture!=='observed').map(node=>{
    // Earlier actions only replay the entry chain. A child's image does not
    // prove that its parents have their own screenshots.
    const chain=node.presentation?.actions??[],last=chain.at(-1),earlier=chain.slice(0,-1).flatMap(id=>actions.has(id)?[actions.get(id)]:[]);
    const keys=new Set(last&&actions.has(last)?[presentationDestination(actions.get(last))]:[]);
    // Active views include ancestors still mounted around the final body.
    // Credit only views that no earlier chain step opened.
    const ancestorViews=new Set(earlier.flatMap(action=>action.views??[])),ancestorKeys=new Set(earlier.map(presentationDestination));
    // A shared prompt or sheet shell collects the controller views of every
    // caller it opened from. A capture's own sites name the caller it shows.
    const sited=Array.isArray(node.capturedSites);
    const viewIds=[...(node.sourceViews??[]).filter(id=>!sited||views.get(id)?.kind!=='control'),...(sited?node.capturedSites.flatMap(sitedViews):[])];
    for(const id of new Set(viewIds)){
      const view=views.get(id);if(!view||ancestorViews.has(id))continue;
      const key=view.state?presentationDestination({effect:{kind:'state',...view.state}}):`source:${id}`;
      if(!ancestorKeys.has(key))keys.add(key);
    }
    return {node,keys,valid:node.status==='captured'&&node.imageSourceHash===graph.sourceHash&&verifiedImages.has(node.id)};
  });
  const rows=comparison.rows.map(row=>{
    const matches=nodes.filter(({node,keys})=>!node.presentation&&row.selectors.some(s=>s.route===node.name)||row.candidates.some(c=>c.result==='exact'&&keys.has(c.key)));
    const saved=matches.filter(m=>m.valid).sort((a,b)=>Number(!!a.node.presentation?.preview)-Number(!!b.node.presentation?.preview));
    const captured=saved[0]?.node;
    return {id:row.id,label:row.label,category:row.category,capture:captured?(captured.presentation?.preview?'preview':'live'):'not-captured',nodeId:captured?.id,
      attempts:matches.map(({node,valid})=>({nodeId:node.id,status:node.status,reason:node.reason,imageVerified:valid}))};
  });
  return {runId:run.id,startedAt:run.startedAt,finishedAt:run.finishedAt,phase:run.phase,automaticCapturedViews:rows.filter(r=>r.capture!=='not-captured').length,
    liveCapturedViews:rows.filter(r=>r.capture==='live').length,previewCapturedViews:rows.filter(r=>r.capture==='preview').length,
    notCapturedViews:rows.filter(r=>r.capture==='not-captured').length,rows};
}
