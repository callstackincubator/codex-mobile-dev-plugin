import {randomUUID} from 'node:crypto';
import {writeFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {FlowBackend} from './runs.ts';
import type {FlowRun, FlowNode} from '../../shared/app-flow.ts';
import type {CaptureManifest, CaptureJob} from './capture-manifest.ts';
import {blankFlowFrame} from './frame.ts';
import {FlowAppFailure, FlowRuntimeFailure} from './runtime-metrics.ts';
import {captureServerError} from '../telemetry.ts';
import {captureSource} from './capture-source.ts';

// Source code and action definitions stay on the server. The app only needs
// identities to request approved bindings and the selected route's real data.
const wireJobs=(jobs:CaptureJob[])=>jobs.map(({sourceViews,actions,...job})=>({...job,actions:actions.map(action=>({id:action.id}))}));

export class CaptureConnectionError extends Error { constructor() { super('The capture connection was interrupted.'); } }

/** The server binds approved source recipes, captures native frames and saves results. */
export async function captureBatch(options: {backend: FlowBackend; manifest: CaptureManifest; run: FlowRun; directory: string; projectRoot?: string; signal: AbortSignal; save(): Promise<void>; plan?(node: FlowNode, result: {ready?:boolean; evidence?:any}): Promise<CaptureManifest>; timing?(operation: string, ms: number): void}) {
  const {backend, manifest, run, directory, signal, save} = options;
  if (!backend.runtime.onCapture) throw new Error('This connection does not support in-app capture batches.');
  const batch = randomUUID(), byId = new Map(run.nodes.map(node => [node.id, node]));
  const jobs = new Map(manifest.jobs.map(job => [job.id, job]));
  const presentations = run.presentations;
  const catalog = {states:[...new Map([...(presentations?.states??[]),...(presentations?.previewStates??[])].map(site=>[site.id,site])).values()], actions:[...(presentations?.actions??[]),...(presentations?.previews??[])]};
  const frames = new Map<number, {path: string; id: string; bytes:Buffer; identity:string}>();
  let previous: {bytes:Buffer; identity:string} | undefined;
  let reportedPresentationError=false;
  let chain = Promise.resolve(), done: () => void, fail: (error: Error) => void, stopped = false;
  const completed = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
  // Attach the rejection handler before starting native work or accepting events.
  void completed.catch(() => {});
  const abort = () => { stopped = true; fail(signal.reason ?? new Error('Capture stopped.')); };
  signal.addEventListener('abort', abort, {once: true});
  const off = backend.runtime.onCapture(event => {
    if (event.type === 'connection-error' && !stopped) { stopped = true; fail(new CaptureConnectionError()); return; }
    if (event.batch !== batch || stopped) return;
    chain = chain.then(async () => {
      signal.throwIfAborted();
      const node = byId.get(event.id);
      if (event.type === 'opening' && node && !jobs.get(node.id)?.discoverOnly) { run.retrying=(node.captureAttempts??0)>0; if(run.retrying)options.timing?.('retry',1); node.status = 'capturing'; node.reason=undefined;node.failure=undefined;node.captureAttempts = (node.captureAttempts ?? 0) + 1; run.revision++; }
      else if (event.type === 'timing' && ['restoration','readiness','loading'].includes(event.operation) && Number.isFinite(event.ms) && event.ms>=0) options.timing?.(event.operation,event.ms);
      else if (event.type === 'plan') {
        if (!node || !options.plan) throw new Error('The capture batch has no discovery planner.');
        const started = performance.now();
        const next = await options.plan(node, {ready:event.ready, evidence:event.evidence});
        options.timing?.('planning', performance.now()-started);
        signal.throwIfAborted();
        byId.clear(); for (const item of run.nodes) byId.set(item.id, item);
        const selected=next.jobs.slice(0,1);
        jobs.clear(); for (const job of selected) jobs.set(job.id, job);
        const reply = await backend.runtime.invoke({type:'capture-source', batch, ticket:event.ticket, value:{jobs:wireJobs(selected)}}, 2000);
        if (!reply?.accepted) throw new Error('The app rejected a stale capture plan.');
      }
      else if (event.type === 'source') {
        const job = jobs.get(event.id);
        if (!job || !node || node.status !== 'capturing' && !job.discoverOnly || !options.projectRoot) throw new Error('Capture source request has no active prepared job.');
        let value;
        try {value=await captureSource({backend,job,catalog,projectRoot:options.projectRoot,sourceHash:run.sourceHash,operation:event.operation,actionId:event.actionId,signal});}
        catch(error){
          if(signal.aborted || error instanceof FlowAppFailure || !(error instanceof FlowRuntimeFailure))throw error;
          value={ready:false,status:'timed-out',error:event.operation==='open'?error.message:undefined,reason:error.message,failure:{operation:error.operation,detail:error.detail}};
        }
        const reply = await backend.runtime.invoke({type:'capture-source', batch, ticket:event.ticket, value}, 2000);
        if (!reply?.accepted) throw new Error('The app rejected a stale source binding acknowledgement.');
      }
      else if (event.type === 'frame' && node) {
        const started = performance.now();
        let bytes:Buffer;
        try {bytes=await backend.screenshot(AbortSignal.any([signal,AbortSignal.timeout(5000)]));}
        catch(error){
          signal.throwIfAborted();
          options.timing?.('screenshot',performance.now()-started);
          const reason=error instanceof FlowRuntimeFailure?error.message:'The device screenshot failed.';
          const failure={operation:'screenshot',detail:error instanceof FlowRuntimeFailure?error.detail:undefined};
          const ack=await backend.runtime.invoke({type:'capture-ack',batch,ticket:event.ticket,value:{ok:false,reason,failure}},2000);
          if(!ack?.accepted)throw new CaptureConnectionError();
          return;
        }
        const identity = JSON.stringify([event.key,event.signature]);
        const ok = !blankFlowFrame(bytes) && !(previous && previous.identity !== identity && previous.bytes.equals(bytes));
        if (ok) {
          const path = join(directory, run.id, `${node.id}.${event.ticket}.pending`);
          await writeFile(path, bytes, {mode: 0o600}); frames.set(event.ticket, {path, id: node.id, bytes, identity});
        }
        options.timing?.('screenshot', performance.now() - started);
        const ack = await backend.runtime.invoke({type: 'capture-ack', batch, ticket: event.ticket, value: {ok}}, 2000);
        if (!ack?.accepted) throw new Error('The app rejected a stale screenshot acknowledgement.');
      } else if (event.type === 'discard') {
        const frame = frames.get(event.ticket); if (frame) await rm(frame.path, {force: true}); frames.delete(event.ticket);
      } else if (event.type === 'result' && node) {
        if (event.status === 'captured') {
          const frame = frames.get(event.ticket);
          if (!frame || frame.id !== node.id) throw new Error('Capture acknowledgement has no matching screenshot.');
          await rename(frame.path, join(directory, run.id, `${node.id}.png`)); frames.delete(event.ticket);
          previous = {bytes:frame.bytes, identity:frame.identity};
          node.image = `mobile-flow://${run.id}/${node.id}`; node.imageSourceHash = run.sourceHash;
        }
        if (jobs.get(node.id)?.discoverOnly) return;
        if(node.presentation && event.status==='blocked' && !reportedPresentationError){reportedPresentationError=true;captureServerError(new Error('App Flow presentation capture failed.'),'app_flow.presentation');}
        node.status = event.status; node.reason = event.reason; node.failure=event.failure; node.captureMs = event.ms;
        options.timing?.('capture', event.ms); if(node.presentation)options.timing?.('presentation',event.ms); run.revision++; await save();
      } else if (event.type === 'uncaptured' && node?.status === 'capturing') {
        node.status = 'timed-out'; node.reason = 'The screenshot did not settle.'; node.captureMs=event.ms; options.timing?.('capture',event.ms); if(node.presentation)options.timing?.('presentation',event.ms); run.revision++; await save();
      } else if (event.type === 'error') throw event.interrupted ? new CaptureConnectionError() : new Error(event.reason);
      else if (event.type === 'done') done();
    }).catch(error => { stopped = true; fail(error); });
  });
  try {
    signal.throwIfAborted();
    const started = await backend.runtime.invoke({type:'capture-start', batch, jobs:wireJobs(options.plan?manifest.jobs.slice(0,1):manifest.jobs), planning:!!options.plan}, 3000);
    if (!started?.started) throw new Error(started?.error || 'The capture batch could not start.');
    await completed; await chain;
  } finally {
    stopped = true; off(); signal.removeEventListener('abort', abort);
    await backend.runtime.invoke({type:'capture-stop'}, 10000).catch(() => {});
    await chain;
    await Promise.all([...frames.values()].map(frame => rm(frame.path, {force:true})));
  }
}
