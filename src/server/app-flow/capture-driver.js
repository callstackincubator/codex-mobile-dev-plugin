/** Both discovery and prepared capture use the presentation runtime's state,
 * provider, portal, native lifecycle and rollback implementation. */
export function createCaptureDriver(runtime, source) {
  let base, branch = [], lastReady, routeReady;
  const check = signal => { if (signal?.aborted) throw new Error('Capture stopped.'); };
  const call = command => new Promise((resolve, reject) => runtime.invoke(command, result => {
    if (result?.appFailed) reject(Object.assign(new Error('The app reported an error.'), {fatal: true}));
    else resolve(result);
  }));
  const same = (a, b) => a?.ready && b?.ready && a.key === b.key && a.signature === b.signature && a.motion === b.motion;
  const route = job => ({path: job.path, params: job.params, expo: job.expo});
  async function read(job, waitMs = 0) {
    if (!job.actions.length && job.path.length) {
      const view = await call({type:'verify', ...route(job), name:routeReady?.name ?? job.path.at(-1)});
      return {...view, key:JSON.stringify(view.active), ready:!!routeReady && view.routeMatches !== false
        && JSON.stringify(view.active) === JSON.stringify(routeReady.active) && view.found && view.content > 0
        && !view.loading && !view.transitioning && view.signature === routeReady.signature && view.motion === routeReady.motion};
    }
    const value = await call({type: 'presentation-view', ...route(job), waitMs});
    if (value?.portalBindings?.length || value?.effectBindings?.length) {
      const resolved = await source({operation: 'view'});
      if (resolved?.portalBindings?.length || resolved?.effectBindings?.length) return {...resolved, ready:false,
        error:'The presentation needs a portal or UI effect that could not be proven from source.'};
      return {...resolved, ready:!!resolved?.ready && resolved.routeMatches !== false};
    }
    return {...value, ready:!!value?.ready && value.routeMatches !== false};
  }
  async function settled(job, signal) {
    const deadline = Date.now() + 8000;
    do {
      check(signal);
      const value = await read(job, Math.min(1000, Math.max(0, deadline - Date.now())));
      check(signal);
      if (value?.ready || value?.error) return value;
      if (Date.now() >= deadline) return value;
      await new Promise(resolve => setTimeout(resolve, 40));
    } while (true);
  }
  async function rollback(level) {
    const result = await call({type: 'presentation-rollback', level});
    if (result?.error) throw new Error('Capture state could not be restored.');
    lastReady = undefined;
  }
  async function restoreTo(depth) {
    if (branch.length > depth) await rollback(depth ? branch[depth - 1].level : 0);
    branch = branch.slice(0, depth);
  }
  return {
    async open(job, signal) {
      check(signal);
      if (job.blocked) return {ready: false, status: 'needs-data', reason: job.blocked};
      const nextBase = JSON.stringify([job.path, job.params ?? {}, !!job.expo]);
      let depth = 0;
      if (base === nextBase) {
        const current = await read(job);
        const checkpoint = await call({type: 'presentation-checkpoint'});
        if (current?.routeMatches !== false && current?.ready && checkpoint?.level === (branch.at(-1)?.level ?? 0)) {
          while (depth < branch.length && branch[depth].id === job.actions[depth]?.id && !branch[depth].closed
            && branch[depth].projected === !!job.projections?.includes(branch[depth].id)) depth++;
        } else base = undefined;
      }
      await restoreTo(depth);
      check(signal);
      if (base !== nextBase) {
        // The runtime owns all presentation checkpoints, including failed opens.
        await rollback(0);
        if (job.path.length) {
          const opened = await call({type: 'open', ...route(job), timeoutMs: 4000, loadingTimeoutMs: 8000});
          check(signal);
          if (opened?.error || opened?.redirected) return {ready: false, status: 'blocked', reason: opened.error || 'This route redirects to another screen.'};
          if (!opened?.ready) return {ready: false, status: 'timed-out', reason: opened?.reason};
          routeReady = opened;
        }
        base = nextBase;
      }
      for (const action of job.actions.slice(depth)) {
        check(signal);
        // Source approval stays on the server. This uses the same opener as
        // discovery, including shared consumers and previews in native sheets.
        const opened = await source({operation: 'open', actionId: action.id});
        check(signal);
        if (opened?.error) return {ready: false, status: opened.status || 'needs-data', reason: opened.error};
        if (opened?.closed) for (const frame of branch) frame.closed = true;
        if (job.projections?.includes(action.id)) {
          const projected = await source({operation: 'project', actionId: action.id});
          check(signal);
          if (projected?.error) return {ready: false, status: 'blocked', reason: projected.error};
        }
        const view = opened.view?.ready && !job.projections?.includes(action.id) ? opened.view : await settled(job, signal);
        if (!view?.ready) return {ready: false, status: view?.error ? 'blocked' : 'timed-out', reason: view?.error || view?.reason || 'The presentation did not settle.'};
        const checkpoint = await call({type: 'presentation-checkpoint'});
        if (!Number.isInteger(checkpoint?.level)) throw new Error('The presentation checkpoint is unavailable.');
        branch.push({id: action.id, level: checkpoint.level, projected: !!job.projections?.includes(action.id)});
        lastReady = {id: job.id, view};
      }
      return {ready: true};
    },
    async ready(job, signal) {
      check(signal);
      const current = await read(job);
      check(signal);
      if (same(lastReady?.view, current) || current?.ready) return current;
      if (!job.actions.length && job.path.length) {
        const opened = await call({type:'open', ...route(job), timeoutMs:4000, loadingTimeoutMs:8000});
        check(signal);
        if (!opened?.ready) return opened;
        routeReady = opened;
        return read(job);
      }
      return settled(job, signal);
    },
    verify(job) { return read(job); },
    same,
    async restore() {
      await rollback(0);
      branch = []; base = routeReady = undefined;
    },
  };
}
