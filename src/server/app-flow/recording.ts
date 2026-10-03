import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as Sentry from '@sentry/node';
import type { FlowRun } from '../../shared/app-flow.ts';
import { MeasurementWindow } from '../../shared/telemetry.ts';
import { captureServerError } from '../telemetry.ts';
import { blankFlowFrame } from './frame.ts';
import type { FlowBackend, FlowDependencies, FlowStart, FlowTargetIdentity } from './runs.ts';

type View = { key: string; ready: boolean; signature: string; active: string[]; title?: string; loading?: boolean };
type Options = {
  run: FlowRun; input: FlowStart; signal: AbortSignal; directory: string;
  connect: FlowDependencies['connect']; target?: FlowTargetIdentity;
  save(): Promise<void>;
  controls(): Promise<{ label?: string }[]>;
  connected(target?: FlowTargetIdentity): void;
};

/** Record observed UI changes, including local forms with no navigator route. */
export async function recordFlow({ run, input, signal, directory, connect, target, save, controls, connected }: Options) {
  const recording = run.recording!, group = run.groups!.find(group => group.id === recording.groupId)!;
  const started = Date.now(), timings = new MeasurementWindow();
  const seen = new Map<string, string>();
  const edges = new Set(run.edges.map(edge => `${edge.from}:${edge.to}`));
  let backend: FlowBackend | undefined, previous: string | undefined, previousKey: string | undefined, previousFrame: Buffer | undefined;
  let connectedOnce = false;
  let pending: { label?: string } | undefined, captures = 0, reportedSaveError = false, finalPhase: FlowRun['phase'] = 'complete';
  const message = (value: string) => { if (recording.message !== value) { recording.message = value; run.revision++; } };
  const attach = (id: string, key: string) => {
    if (previous && previous !== id && !edges.has(`${previous}:${id}`)) {
      edges.add(`${previous}:${id}`); run.edges.push({ from: previous, to: id, kind: 'navigation' }); run.revision++;
    }
    previous = id; previousKey = key;
  };
  const reconnect = async () => {
    await backend?.runtime.close().catch(() => {});
    backend = undefined;
    for (let attempt = 0; !signal.aborted; attempt++) {
      if (attempt) {
        run.phase = 'reconnecting'; run.revision++;
        message('Waiting for the app to reconnect…'); await save();
        await delay(Math.min(500 * 2 ** Math.min(attempt - 1, 3), 4000), undefined, { signal });
        const requests = await controls();
        if (requests.length) pending = requests.at(-1);
      }
      try {
        const next = await connect(input, signal, { sessionId: `${run.id}-${group.id}`, target });
        // Arm read-only cleanup before even inspecting the current navigator.
        try {
          const view = await next.runtime.invoke({ type: 'observe' }, 2000);
          if (view?.error || typeof view?.key !== 'string') throw new Error('The app could not be observed.');
          if (target?.appId && next.target?.appId && target.appId !== next.target.appId) throw new Error('The selected app does not match this map.');
          signal.throwIfAborted(); backend = next; target = next.target ?? target;
          connectedOnce = true;
          connected(target);
          run.phase = 'recording'; run.revision++;
          message('Move through the flow in the app. Screens save automatically.');
          return;
        } catch (error) { await next.runtime.close().catch(() => {}); throw error; }
      } catch (error) {
        if (!connectedOnce || signal.aborted || error instanceof Error && error.message === 'The selected app does not match this map.') throw error;
      }
    }
    signal.throwIfAborted();
  };
  try {
    run.captureStartedAt = started;
    await mkdir(join(directory, run.id), { recursive: true, mode: 0o700 });
    await reconnect();
    while (!signal.aborted) {
      const requests = await controls();
      if (requests.length) pending = requests.at(-1);
      signal.throwIfAborted();
      await save();
      let view: View;
      try {
        view = await backend!.runtime.invoke({ type: 'observe' }, 1500);
        if (!view || typeof view.key !== 'string') throw new Error('Observation unavailable.');
      } catch {
        signal.throwIfAborted(); await reconnect(); continue;
      }
      if (!view.ready) message(view.loading ? 'Waiting for this screen to finish loading…' : 'Waiting for the screen to settle…');
      else if (!pending && seen.has(view.key)) {
        if (previousKey !== view.key) attach(seen.get(view.key)!, view.key);
        message('Move to the next screen, or capture a step to save another state.');
      } else {
        const captureStarted = performance.now();
        try {
          const bytes = await backend!.screenshot(AbortSignal.any([signal, AbortSignal.timeout(2500)]));
          if (blankFlowFrame(bytes) || previousFrame?.equals(bytes) && !pending) throw new Error('Frame has not changed.');
          const verified: View = await backend!.runtime.invoke({ type: 'observe' }, 1500);
          if (!verified.ready || verified.key !== view.key || verified.signature !== view.signature) throw new Error('Screen changed during capture.');
          signal.throwIfAborted();
          const id = createHash('sha256').update(`${group.id}:${view.key}:${pending ? randomUUID() : ''}`).digest('hex').slice(0, 20);
          try { await writeFile(join(directory, run.id, `${id}.png`), bytes, { mode: 0o600 }); }
          catch (error) { if (!reportedSaveError) { reportedSaveError = true; captureServerError(new Error('App Flow recording screenshot could not be saved.'), 'app_flow.recording_save'); } throw error; }
          run.nodes.push({ id, name: pending?.label?.trim() || view.title || `${group.name} ${captures + 1}`, groupId: group.id, capture: 'observed', kind: 'screen', path: view.active, required: [], status: 'captured', image: `mobile-flow://${run.id}/${id}`, entry: captures === 0, captureMs: performance.now() - captureStarted, reason: 'Captured from the screen shown by the user.' });
          if (!seen.has(view.key)) seen.set(view.key, id);
          attach(id, view.key); previousFrame = bytes;
          captures++; pending = undefined; run.revision++;
          message('Screen saved. Continue in the app or finish recording.');
        } catch (error) {
          if (signal.aborted) throw error;
          message('Waiting for a complete screenshot. Capture will retry.');
        } finally { timings.record(performance.now() - captureStarted); }
      }
      await delay(250, undefined, { signal });
    }
  } catch (error) {
    if (!signal.aborted) {
      finalPhase = 'failed'; run.error = error instanceof Error ? error.message : 'Flow recording failed.';
      captureServerError(new Error('App Flow recording failed.'), 'app_flow.recording');
    }
  } finally {
    run.phase = 'finishing'; run.revision++;
    await backend?.runtime.close().catch(() => {});
    previousFrame = undefined;
    run.finishedAt = Date.now(); run.elapsedMs = (run.elapsedMs ?? 0) + run.finishedAt - started;
    run.captureStartedAt = undefined; run.recording = undefined; run.phase = finalPhase; run.revision++;
    await save();
    if (process.env.MOBILE_DEV_TELEMETRY !== 'off') {
      const attributes = { surface: 'app-flow', device_platform: input.platform };
      Sentry.metrics.distribution('app_flow.recording', run.finishedAt - started, { unit: 'millisecond', attributes });
      Sentry.metrics.gauge('app_flow.recorded_screens', captures, { attributes });
      const values = timings.take();
      if (values) for (const statistic of ['mean', 'p95', 'max'] as const) Sentry.metrics.gauge(`app_flow.record_frame.${statistic}`, values[statistic], { unit: 'millisecond', attributes });
    }
  }
}
