/** Both discovery and prepared capture use the presentation runtime's state,
 * provider, portal, native lifecycle and rollback implementation. */
export function createCaptureDriver(runtime, source, measure = () => {}, timing = {}) {
  // A view stops waiting before its deadline when it cannot change: still
  // blocked after `idleAfterMs`, while the app had no React commit, HTTP
  // request or fetching query for `idleQuietMs`. Images and query hooks report
  // their own loading. A loader still receiving data keeps waiting until the
  // longest deadline.
  const {deadlines, idleAfterMs, idleQuietMs} = {deadlines: [6000, 10000], idleAfterMs: 2000, idleQuietMs: 1500, ...timing};
  const idleLoaders = new Set(['skeleton', 'busy', 'suspense']);
  const idleReasons = {
    target: 'The expected content did not render, and the app had no rendering or network activity.',
    missing: 'The presentation did not appear, and the app had no rendering or network activity.',
    empty: 'The presentation stayed empty, and the app had no rendering or network activity.',
  };
  const loadingText = view => `${view.loadingReason}${view.loadingComponent ? ` in ${view.loadingComponent}` : ''}`;
  // The runtime's original timers; the app's own timers count as activity.
  const {setTimeout: setTimer = setTimeout, clearTimeout: clearTimer = clearTimeout} = runtime?.timers ?? {};
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  // Diagnostics must not turn a successful opening into a stalled capture.
  const record = (phase, ms) => { try { measure(phase, ms); } catch {} };
  const bind = async (request, signal) => {
    const started = clock();
    try {
      if(request.operation==='open') {
        const local=await call({type:'presentation-capture-open',id:request.actionId,...(request.instance?{instance:request.instance}:{})},signal,false);
        if(local?.local){record('source-local',clock()-started);return local;}
      }
      const hostStarted=clock();
      // The host reads a shared shell's caller from its own prepared job.
      try{const {instance,...hostRequest}=request;const result=await source(hostRequest);if(result?.nativeFailure)throw Object.assign(new Error(result.error),{fatal:true,native:true});return result;}
      finally{record('source-host',clock()-hostStarted);}
    }
    finally { record('source', clock() - started); }
  };
  let base, branch = [], lastReady, routeReady, waits = {};
  // Attribute each readiness read to the reason it still reported.
  const waited = (value, ms) => {
    if (value?.ready || !Number.isFinite(ms)) return;
    const reason = value?.reason ?? (value?.found === false ? 'missing' : value?.content === 0 ? 'empty' : value?.loading ? 'loading'
      : value?.transitioning ? 'transition' : value?.routeMatches === false ? 'route' : 'changed');
    if (/^[a-z-]{1,20}$/.test(reason)) waits[reason] = (waits[reason] ?? 0) + ms;
  };
  const check = signal => { if (signal?.aborted) throw new Error('Capture stopped.'); };
  const call = (command, signal, measured = true) => new Promise((resolve, reject) => {
    const started = clock();
    const phase = command.type === 'open' ? 'navigation' : command.type === 'presentation-rollback' ? 'rollback'
      : command.type === 'presentation-checkpoint' ? 'checkpoint' : command.waitMs > 0 ? 'readiness' : 'probe';
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimer(timer); signal?.removeEventListener('abort', abort);
      if(measured)record(phase, clock() - started);
      if (error) reject(error); else resolve(value);
    };
    const interrupted = message => Object.assign(new Error(message), {fatal:true, interrupted:true});
    const abort = () => finish(interrupted('Capture stopped.'));
    // The app may cancel a timer when its root remounts without closing CDP.
    // Bound each command, including native cleanup, rather than the whole run.
    const timeout = command.type === 'presentation-capture-open' ? 8000 : command.type === 'presentation-rollback' ? 10000
      : command.type === 'open' ? Math.max(command.timeoutMs || 0, command.loadingTimeoutMs || 0) + 1500
      : (command.waitMs || 0) + 2000;
    const timer = setTimer(() => finish(interrupted('The capture step stopped responding.')), timeout);
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) { abort(); return; }
    try { runtime.invoke(command, result => {
      if (result?.appFailed) finish(Object.assign(new Error('The app reported a fatal JavaScript error.'), {fatal:true, app:true, ...(typeof result.detail==='string'?{detail:result.detail.slice(0,300)}:{})}));
      else if (result?.nativeFailure) finish(Object.assign(new Error(result.error || 'Native presentation dismissal is unconfirmed.'), {fatal:true, native:true}));
      else if (result?.cancelled || result?.runtimeUnavailable || result?.stopped) finish(interrupted('The app runtime changed during capture.'));
      else finish(undefined, result);
    }); } catch (error) { finish(error); }
  });
  const same = (a, b) => a?.ready && b?.ready && a.key === b.key && a.signature === b.signature && a.motion === b.motion;
  const route = job => ({path: job.path, params: job.params, expo: job.expo});
  async function read(job, waitMs = 0, signal) {
    if (!job.actions.length && job.path.length) {
      const view = await call({type:'verify', ...route(job), name:routeReady?.name ?? job.path.at(-1)}, signal);
      return {...view, links:[...(routeReady?.links??[]),...(view.links??[])],components:[...new Set([...(routeReady?.components??[]),...(view.components??[])])], key:JSON.stringify(view.active), ready:!!routeReady && view.routeMatches !== false
        && JSON.stringify(view.active) === JSON.stringify(routeReady.active) && view.found && view.content > 0
        && !view.loading && !view.transitioning && view.signature === routeReady.signature && view.motion === routeReady.motion};
    }
    const value = await call({type: 'presentation-view', ...route(job), waitMs}, signal);
    if (value?.portalBindings?.length || value?.effectBindings?.length) {
      const resolved = await bind({operation: 'view'});
      if (resolved?.portalBindings?.length || resolved?.effectBindings?.length) return {...resolved, ready:false,
        error:'The presentation needs a portal or UI effect that could not be proven from source.'};
      return {...resolved, ready:!!resolved?.ready && resolved.routeMatches !== false};
    }
    return {...value, ready:!!value?.ready && value.routeMatches !== false && (!job.entryKey || value.key===job.entryKey)};
  }
  const deadline = job => job.attempt === undefined ? 8000 : deadlines[Math.min(job.attempt, 1)];
  const idle = view => view?.idleMs >= idleQuietMs && (idleReasons[view.reason] || view.reason === 'loading' && idleLoaders.has(view.loadingReason));
  async function settled(job, signal) {
    const started = Date.now();
    let until = started + deadline(job);
    do {
      check(signal);
      const readStarted = clock();
      const value = await read(job, Math.min(500, Math.max(0, until - Date.now())), signal);
      waited(value, clock() - readStarted);
      check(signal);
      if (value?.ready || value?.error || value?.status==='timed-out') return value;
      if (Date.now() - started >= idleAfterMs && idle(value)) return {...value, status: 'timed-out', idle: true,
        reason: value.reason === 'loading' ? `A loader (${loadingText(value)}) stayed on screen, and the app had no rendering or network activity.` : idleReasons[value.reason]};
      if (Date.now() >= until) {
        // Native image loads have no JavaScript activity to observe.
        const receiving = value?.reason === 'loading' && (value.loadingReason === 'image' || value.idleMs < idleQuietMs);
        if (receiving && until < started + deadlines[1]) { until = started + deadlines[1]; continue; }
        return value;
      }
      await new Promise(resolve => setTimer(resolve, 40));
    } while (true);
  }
  async function rollback(level, signal) {
    let result = await call({type:'presentation-rollback',level},signal);
    // Keep the native controller and its dismissal listeners for one bounded
    // continuation before reconnecting. Never navigate beneath a closing sheet.
    if(result?.error)result=await call({type:'presentation-rollback',level},signal);
    if(result?.error)throw Object.assign(new Error('Capture state could not be restored.'),{fatal:true,interrupted:true});
    lastReady = undefined;
  }
  async function restoreTo(depth, signal) {
    if (branch.length > depth) await rollback(depth ? branch[depth - 1].level : 0, signal);
    branch = branch.slice(0, depth);
  }
  return {
    async open(job, signal) {
      waits = {};
      check(signal);
      if (job.blocked) return {ready: false, status: 'needs-data', reason: job.blocked};
      let navigationEvidence;
      const nextBase = JSON.stringify([job.path, job.params ?? {}, !!job.expo]);
      let depth = 0;
      if (base === nextBase) {
        const current = await read(job, 0, signal);
        const checkpoint = await call({type: 'presentation-checkpoint'}, signal);
        if (current?.routeMatches !== false && current?.ready && checkpoint?.level === (branch.at(-1)?.level ?? 0)) {
          while (depth < branch.length && branch[depth].id === job.actions[depth]?.id && !branch[depth].closed
            && branch[depth].projected === !!job.projections?.includes(branch[depth].id)) depth++;
        } else base = undefined;
      }
      await restoreTo(depth, signal);
      check(signal);
      if (base !== nextBase) {
        // The runtime owns all presentation checkpoints, including failed opens.
        await rollback(0, signal);
        if (job.path.length) {
          const opened = await call({type: 'open', ...route(job), timeoutMs:4000, loadingTimeoutMs:deadline(job)}, signal);
          check(signal);
          if (opened?.error || opened?.redirected) return {ready: false, status: 'blocked', reason: opened.error || 'This route redirects to another screen.', evidence:opened};
          if (!opened?.ready) return {ready: false, status: 'timed-out', reason: opened?.reason, evidence:opened};
          routeReady = navigationEvidence = opened;
        }
        base = nextBase;
      }
      for (const action of job.actions.slice(depth)) {
        check(signal);
        // The host approved this recipe. Live registered bindings run the same
        // opener as discovery; unresolved entries retain host source resolution.
        const opened = await bind({operation: 'open', actionId: action.id, ...(typeof action.instance === 'string' ? {instance: action.instance} : {})},signal);
        check(signal);
        if (opened?.error) return {ready: false, status: opened.status || 'needs-data', reason: opened.error, failure:opened.failure};
        if (opened?.closed) for (const frame of branch) frame.closed = true;
        if (job.projections?.includes(action.id)) {
          const projected = await bind({operation: 'project', actionId: action.id});
          check(signal);
          if (projected?.error) return {ready: false, status: 'blocked', reason: projected.error};
        }
        const view = opened.view?.ready && !job.projections?.includes(action.id) ? opened.view : await settled(job, signal);
        if (!view?.ready) return {ready: false, status: view?.status || (view?.error ? 'blocked' : 'timed-out'), failure:view?.failure, reason: view?.error || (view?.reason === 'loading' && view.loadingReason ? `loading (${loadingText(view)})` : view?.reason) || 'The presentation did not settle.'};
        const checkpoint = await call({type: 'presentation-checkpoint'}, signal);
        if (!Number.isInteger(checkpoint?.level)) throw new Error('The presentation checkpoint is unavailable.');
        branch.push({id: action.id, level: checkpoint.level, projected: !!job.projections?.includes(action.id)});
        lastReady = {id: job.id, view};
      }
      return {ready:true,evidence:navigationEvidence};
    },
    async ready(job, signal) {
      check(signal);
      const current = await read(job, 0, signal);
      check(signal);
      if (same(lastReady?.view, current) || current?.ready) return current;
      if (!job.actions.length && job.path.length) {
        const opened = await call({type:'open', ...route(job), settleOnly:true, timeoutMs:4000, loadingTimeoutMs:8000}, signal);
        check(signal);
        if (!opened?.ready) return opened;
        routeReady = opened;
        return read(job, 0, signal);
      }
      return settled(job, signal);
    },
    verify(job, signal) { return read(job, 0, signal); },
    // App health, read once per job: CPU contention from the same fixed work,
    // and the size of the tree each readiness probe walks.
    async cpu(signal) {
      try {
        const value = await call({type:'cpu'}, signal, false);
        return Number.isFinite(value?.ms) ? {ms: value.ms, ...(Number.isInteger(value.fibers) ? {fibers: value.fibers} : {})} : undefined;
      } catch (error) { if (error?.fatal && !error?.interrupted) throw error; }
    },
    waits() { return Object.fromEntries(Object.entries(waits).map(([reason, ms]) => [reason, Math.round(ms)])); },
    // Compiled source sites passing the opened controller. A shared shell's
    // capture names the caller that rendered it, not every possible caller.
    async sites(job, signal) {
      if (!job.actions.length) return;
      const sites = await call({type:'presentation-sites'}, signal);
      return Array.isArray(sites) ? sites : undefined;
    },
    same,
    timers: {setTimeout: setTimer, clearTimeout: clearTimer},
    async restore() {
      await rollback(0);
      branch = []; base = routeReady = undefined;
    },
  };
}
