import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FlowNode, FlowPresentations, FlowRun } from '../../shared/app-flow.ts';
import type { FlowBackend } from './runs.ts';
import { blankFlowFrame } from './frame.ts';
import { MeasurementWindow } from '../../shared/telemetry.ts';
import { captureServerError } from '../telemetry.ts';

type View = { key: string; ready: boolean; found: boolean; signature: string; motion?: string; title?: string; active: string[]; loading?: boolean; transitioning?: boolean; error?: string };
type Action = { id: string; name: string; file: string; line: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

/** Discover live presentation entries, then capture them through the shared queue. */
export class FlowPresentationCapture {
  readonly timings = new MeasurementWindow();
  readonly bindingTimings = new MeasurementWindow();
  readonly discoveryTimings = new MeasurementWindow();
  private visited = new Set<string>();
  private previous?: {key:string;bytes:Buffer};
  rememberFrame(bytes:Buffer) { this.previous={key:"",bytes}; }
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
  }
  private async settled(backend: FlowBackend, timeout: number): Promise<View> {
    const started = performance.now();
    let view: View;
    do {
      this.signal.throwIfAborted();
      view = await backend.runtime.invoke({type: 'presentation-view'}, 2000);
      if (view.error) {
        const error = new Error('Presentation inspection is unavailable.');
        captureServerError(error, 'app_flow.presentation');
        throw error;
      }
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
    const started = performance.now();
    try {
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
        if (!node) {
          node = {id, name: source.name, kind: 'screen', path: [], required: [], status: 'pending', file: source.file, line: source.line,
            presentation: {actions: [...(base.presentation?.actions ?? []), action.id], projections: base.presentation?.projections?.slice(), basePath: base.presentation?.basePath ?? base.path, baseParams: base.presentation?.baseParams ?? base.params, expo: base.presentation?.expo ?? base.component === 'expo-router'}};
          this.run.nodes.push(node); this.run.revision++;
        } else if (node.status === 'captured' && !this.visited.has(id)) {
          // Reopen kept previews once to discover children after a reconnect.
          node.status = 'pending'; node.captureAttempts = 0; this.run.revision++;
        }
        this.edge(base, node);
      }
      this.visited.add(base.id);
      await this.changed();
    } catch (error) { this.visited.delete(base.id); throw error; }
    finally { this.discoveryTimings.record(performance.now() - started); }
  }
  async retry(backend: FlowBackend, node: FlowNode) {
    const plan = node.presentation!;
    const attempt = Math.min(node.captureAttempts ?? 0, 2);
    const timeout = [6000, 10000, 20000][attempt];
    const started = performance.now();
    node.captureAttempts = attempt + 1; node.status = 'capturing'; node.reason = undefined; this.run.revision++;
    await this.changed();
    try {
      this.signal.throwIfAborted();
      await backend.runtime.invoke({type: 'presentation-rollback', level: 0}, 10000);
      if (plan.basePath.length) {
        const base = await backend.runtime.invoke({type: 'open', path: plan.basePath, params: plan.baseParams, expo: plan.expo, timeoutMs: 2000, loadingTimeoutMs: 10000}, 10500);
        if (!base.ready) { node.status = 'pending'; node.reason = 'The presentation entry route has not settled.'; return; }
      }
      if (plan.actions.length) this.rememberFrame(await backend.screenshot(AbortSignal.any([this.signal, AbortSignal.timeout(2000)])));
      let view: View | undefined;
      for (const id of plan.actions) {
        await this.setup(backend);
        const available: Action[] = await backend.runtime.invoke({type: 'presentations'}, 2000);
        if (!available.some(action => action.id === id)) { node.status = 'blocked'; node.reason = 'The presentation entry is no longer available in this app state.'; return; }
        const before: View = await backend.runtime.invoke({type: 'presentation-view'}, 2000);
        const opened = await backend.runtime.invoke({type: 'presentation-open', id}, 2000);
        if (opened.error) { node.status = 'blocked'; node.reason = 'The presentation entry could not be opened.'; return; }
        if (plan.projections?.includes(id)) {
          const projected = await backend.runtime.invoke({type: 'presentation-project'}, 2000);
          if (projected.error) { node.status = 'blocked'; node.reason = 'The saved presentation preview is no longer available.'; return; }
        }
        view = await this.settled(backend, timeout);
        if (view.key === before.key) { node.status = 'blocked'; node.reason = 'The entry did not open a new presentation.'; return; }
        if (!view.ready) { node.status = 'pending'; node.reason = 'The presentation did not finish rendering.'; return; }
      }
      view ??= await this.settled(backend, timeout);
      if (plan.entryKey && view.key !== plan.entryKey) { node.status = 'blocked'; node.reason = 'The app entry state has changed. Start a fresh map.'; return; }
      if (node.image || await this.capture(backend, node, view, attempt, plan.actions.at(-1))) {
        node.status = 'captured';
        this.visited.delete(node.id);
        await this.explore(backend, node);
      } else { node.status = 'pending'; node.reason ??= 'The presentation did not finish rendering.'; }
    } finally {
      if (node.status === 'pending' && node.captureAttempts >= 3) node.status = 'timed-out';
      try { await backend.runtime.invoke({type: 'presentation-rollback', level: 0}, 10000); }
      finally {
        node.captureMs = performance.now() - started; this.timings.record(node.captureMs); this.run.revision++;
        await this.changed();
      }
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
