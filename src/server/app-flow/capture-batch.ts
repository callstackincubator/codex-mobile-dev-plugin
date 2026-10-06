import {randomUUID} from 'node:crypto';
import {writeFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {FlowBackend} from './runs.ts';
import type {FlowRun} from '../../shared/app-flow.ts';
import type {CaptureManifest} from './capture-manifest.ts';
import {blankFlowFrame} from './frame.ts';
import {captureSource} from './capture-source.ts';

export class CaptureConnectionError extends Error { constructor() { super('The capture connection was interrupted.'); } }

/** The server binds approved source recipes, captures native frames and saves results. */
export async function captureBatch(options: {backend: FlowBackend; manifest: CaptureManifest; run: FlowRun; directory: string; projectRoot?: string; signal: AbortSignal; save(): Promise<void>; timing?(operation: string, ms: number): void}) {
  const {backend, manifest, run, directory, signal, save} = options;
  if (!backend.runtime.onCapture) throw new Error('This connection does not support in-app capture batches.');
  const batch = randomUUID(), byId = new Map(run.nodes.map(node => [node.id, node]));
  const jobs = new Map(manifest.jobs.map(job => [job.id, job]));
  const presentations = run.presentations;
  const catalog = {states:[...new Map([...(presentations?.states??[]),...(presentations?.previewStates??[])].map(site=>[site.id,site])).values()], actions:[...(presentations?.actions??[]),...(presentations?.previews??[])]};
  const frames = new Map<number, {path: string; id: string}>();
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
      if (event.type === 'opening' && node) { node.status = 'capturing'; node.captureAttempts = (node.captureAttempts ?? 0) + 1; run.revision++; }
      else if (event.type === 'source') {
        const job = jobs.get(event.id);
        if (!job || !node || node.status !== 'capturing' || !options.projectRoot) throw new Error('Capture source request has no active prepared job.');
        const value = await captureSource({backend, job, catalog, projectRoot:options.projectRoot, sourceHash:run.sourceHash,
          operation:event.operation, actionId:event.actionId, signal});
        const reply = await backend.runtime.invoke({type:'capture-source', batch, ticket:event.ticket, value}, 2000);
        if (!reply?.accepted) throw new Error('The app rejected a stale source binding acknowledgement.');
      }
      else if (event.type === 'frame' && node) {
        const started = performance.now();
        const bytes = await backend.screenshot(AbortSignal.any([signal, AbortSignal.timeout(5000)]));
        const ok = !blankFlowFrame(bytes);
        if (ok) {
          const path = join(directory, run.id, `${node.id}.${event.ticket}.pending`);
          await writeFile(path, bytes, {mode: 0o600}); frames.set(event.ticket, {path, id: node.id});
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
          node.image = `mobile-flow://${run.id}/${node.id}`; node.imageSourceHash = run.sourceHash;
        }
        node.status = event.status; node.reason = event.reason; node.captureMs = event.ms;
        options.timing?.('capture', event.ms); run.revision++; await save();
      } else if (event.type === 'uncaptured' && node?.status === 'capturing') {
        node.status = 'timed-out'; node.reason = 'The screenshot did not settle.'; run.revision++; await save();
      } else if (event.type === 'error') throw new Error(event.reason);
      else if (event.type === 'done') done();
    }).catch(error => { stopped = true; fail(error); });
  });
  try {
    signal.throwIfAborted();
    const started = await backend.runtime.invoke({type:'capture-start', batch, jobs: manifest.jobs}, 3000);
    if (!started?.started) throw new Error(started?.error || 'The capture batch could not start.');
    await completed; await chain;
  } finally {
    stopped = true; off(); signal.removeEventListener('abort', abort);
    await backend.runtime.invoke({type:'capture-stop'}, 10000).catch(() => {});
    await chain;
    await Promise.all([...frames.values()].map(frame => rm(frame.path, {force:true})));
  }
}
