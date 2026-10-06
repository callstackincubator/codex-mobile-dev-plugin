/** Both discovery and prepared capture use the presentation runtime's state,
 * provider, portal, native lifecycle and rollback implementation. */
export function createCaptureDriver(runtime, source) {
  let base, branch = [], lastReady, routeReady;
  const check = signal => { if (signal?.aborted) throw new Error('Capture stopped.'); };
  const call = (command, signal) => new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const interrupted = message => Object.assign(new Error(message), {fatal:true, interrupted:true});
    const abort = () => finish(interrupted('Capture stopped.'));
    // The app may cancel a timer when its root remounts without closing CDP.
    // Bound each command, including native cleanup, rather than the whole run.
    const timeout = command.type === 'presentation-rollback' ? 10000
      : command.type === 'open' ? Math.max(command.timeoutMs || 0, command.loadingTimeoutMs || 0) + 1500
      : (command.waitMs || 0) + 2000;
    const timer = setTimeout(() => finish(interrupted('The capture step stopped responding.')), timeout);
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) { abort(); return; }
    try { runtime.invoke(command, result => {
      if (result?.appFailed) finish(Object.assign(new Error('The app reported a fatal JavaScript error.'), {fatal:true}));
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
      const resolved = await source({operation: 'view'});
      if (resolved?.portalBindings?.length || resolved?.effectBindings?.length) return {...resolved, ready:false,
        error:'The presentation needs a portal or UI effect that could not be proven from source.'};
      return {...resolved, ready:!!resolved?.ready && resolved.routeMatches !== false};
    }
    return {...value, ready:!!value?.ready && value.routeMatches !== false && (!job.entryKey || value.key===job.entryKey)};
  }
  async function settled(job, signal) {
    const deadline = Date.now() + (job.attempt===undefined?8000:[6000,10000,20000][Math.min(job.attempt,2)]);
    do {
      check(signal);
      const value = await read(job, Math.min(1000, Math.max(0, deadline - Date.now())), signal);
      check(signal);
      if (value?.ready || value?.error || value?.status==='timed-out') return value;
      if (Date.now() >= deadline) return value;
      await new Promise(resolve => setTimeout(resolve, 40));
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
          const opened = await call({type: 'open', ...route(job), timeoutMs:4000, loadingTimeoutMs:(job.attempt===undefined?8000:[6000,10000,20000][Math.min(job.attempt,2)])}, signal);
          check(signal);
          if (opened?.error || opened?.redirected) return {ready: false, status: 'blocked', reason: opened.error || 'This route redirects to another screen.', evidence:opened};
          if (!opened?.ready) return {ready: false, status: 'timed-out', reason: opened?.reason, evidence:opened};
          routeReady = navigationEvidence = opened;
        }
        base = nextBase;
      }
      for (const action of job.actions.slice(depth)) {
        check(signal);
        // Source approval stays on the server. This uses the same opener as
        // discovery, including shared consumers and previews in native sheets.
        const opened = await source({operation: 'open', actionId: action.id});
        check(signal);
        if (opened?.error) return {ready: false, status: opened.status || 'needs-data', reason: opened.error, failure:opened.failure};
        if (opened?.closed) for (const frame of branch) frame.closed = true;
        if (job.projections?.includes(action.id)) {
          const projected = await source({operation: 'project', actionId: action.id});
          check(signal);
          if (projected?.error) return {ready: false, status: 'blocked', reason: projected.error};
        }
        const view = opened.view?.ready && !job.projections?.includes(action.id) ? opened.view : await settled(job, signal);
        if (!view?.ready) return {ready: false, status: view?.status || (view?.error ? 'blocked' : 'timed-out'), failure:view?.failure, reason: view?.error || view?.reason || 'The presentation did not settle.'};
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
    same,
    async restore() {
      await rollback(0);
      branch = []; base = routeReady = undefined;
    },
  };
}
