import type {FlowBackend} from './runs.ts';
import type {CaptureJob} from './capture-manifest.ts';
import type {FlowPresentations} from '../../shared/app-flow.ts';

/** The app can request binding for a prepared job, never supply executable
 * commands, catalog entries, source paths, state values or controller methods. */
export async function captureSource(options: {
  backend: FlowBackend; job: CaptureJob; operation: unknown; actionId?: unknown;
  catalog: FlowPresentations; projectRoot: string; sourceHash?: string; signal: AbortSignal;
}) {
  const {backend, job, catalog, projectRoot, sourceHash, signal} = options;
  const invoke = async (command: Record<string, unknown>, timeout: number) => {
    signal.throwIfAborted();
    const value = await backend.runtime.invoke(command, timeout);
    signal.throwIfAborted();
    return value;
  };
  const route = {path: job.path, params: job.params, expo: job.expo};
  if (options.operation === 'view') return invoke({type: 'presentation-view', ...route}, 2000);
  const action = job.actions.find(action => action.id === options.actionId);
  if (!action || !['open', 'project'].includes(String(options.operation))) throw new Error('The source request is outside the prepared capture recipe.');
  if (options.operation === 'project') {
    if (action.effect.kind !== 'state' || !job.projections?.includes(action.id)) throw new Error('The recipe has no approved projection.');
    return invoke({type:'presentation-project'}, 2000);
  }
  await invoke({type:'presentation-setup', catalog, projectRoot, sourceHash}, 5000);
  const available = await invoke({type:'presentations'}, 2000);
  if (!Array.isArray(available) || !available.some(value => value.id === action.id || value.aliases?.includes(action.id))) {
    return {error:'The source-proven entry has no live owner, control, or real context in this app state.', status:'needs-data'};
  }
  let closed = false;
  if (action.handoffs?.length) {
    const result = await invoke({type:'presentation-handoff', id:action.id}, 5000);
    if (result?.error) return {error:result.error, status:'needs-data'};
    closed = !!result.closed;
  }
  const view = await invoke({type:'presentation-open', id:action.id}, 2000);
  if (view?.error) return {error:view.error, status:'needs-data'};
  return {closed, view};
}
