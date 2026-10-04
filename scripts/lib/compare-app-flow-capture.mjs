import {presentationDestination} from './compare-app-flow-views.mjs';

/** Count actual saved automatic screenshots, never source matches or queued
 * plans. The caller verifies the source hash and files before supplying ids. */
export function compareFlowCapture(graph,comparison,run,verifiedImages) {
  if(!graph.sourceHash||run.sourceHash!==graph.sourceHash)throw new Error('Capture source differs from this scan. Run a fresh map before comparing screenshots.');
  const actions=new Map([...(graph.presentations?.actions??[]),...(graph.presentations?.previews??[])].map(a=>[a.id,a]));
  const views=new Map((graph.presentations?.views??[]).map(v=>[v.id,v]));
  const nodes=run.nodes.filter(n=>n.kind==='screen'&&n.capture!=='observed').map(node=>{
    // Earlier actions only replay the entry chain. A child's image does not
    // prove that its parents have their own screenshots.
    const last=node.presentation?.actions?.at(-1);
    const keys=new Set(last&&actions.has(last)?[presentationDestination(actions.get(last))]:[]);
    for(const id of node.sourceViews??[]){const view=views.get(id);if(!view)continue;keys.add(view.state?presentationDestination({effect:{kind:'state',...view.state}}):`source:${id}`);}
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
