/** Runs in the app. One frame or planner reply may be awaiting acknowledgement. */
export function createCaptureQueue(driver, emit) {
  let run, restoreError, restoreTask, serial = 0, elapsedMs = 0;
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  const work = new Map();
  // App-local work is separate from debugger round trips. Retain fixed numeric
  // totals only, with no command arguments, route IDs or per-probe events.
  const phases = new Set(['navigation','source','source-local','source-host','readiness','probe','checkpoint','rollback','screenshot-wait','planning',
    'self-visual','self-layout','self-focus','self-visible','self-motion','self-commit','self-structure','self-bind-entries']);
  function measure(phase, ms) {
    if (!phases.has(phase) || !Number.isFinite(ms) || ms < 0) return;
    const value = work.get(phase) ?? {phase, count:0, totalMs:0, maxMs:0};
    value.count++; value.totalMs += ms; value.maxMs = Math.max(value.maxMs, ms); work.set(phase, value);
  }
  function restore() {
    if (restoreTask) return restoreTask;
    const started = Date.now();
    restoreTask = Promise.resolve().then(() => driver.restore()).then(
      () => { restoreError = undefined; },
      error => { restoreError = error; throw error; },
    ).finally(() => { restoreTask = undefined; send({type:'timing',operation:'restoration',ms:Date.now()-started}); });
    return restoreTask;
  }
  const send = event => { if (run && !run.cancelled) emit({...event, batch: run.id}); };
  const validJobs = jobs => Array.isArray(jobs) && jobs.length <= 1000 && jobs.every(job => typeof job?.id === 'string') && new Set(jobs.map(job => job.id)).size === jobs.length;
  function request(request) {
    const current = run;
    if (!current || current.cancelled || !current.job || current.source) return Promise.reject(new Error('Capture source request is unavailable.'));
    const ticket = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (current.source?.ticket !== ticket) return;
        current.source = undefined;
        reject(Object.assign(new Error('Capture source binding stopped responding.'), {fatal:true, interrupted:true}));
      }, 12000);
      const pending={ticket,timer,actionId:request.operation==='open'&&typeof request.actionId==='string'?request.actionId:undefined,
        resolve:value=>{clearTimeout(timer);current.source=undefined;resolve(value);},
        reject:error=>{clearTimeout(timer);clearTimeout(pending.deliveryTimer);if(current.delivery===pending)current.delivery=undefined;current.source=undefined;reject(error);}};
      current.source=pending;
      send({type:'source', ...request, id:current.job.id, ticket});
    });
  }
  async function capture(current, job) {
    const started = Date.now();
    send({type:'opening', id:job.id});
    try {
      const opened = await driver.open(job, current.signal);
      if (current.cancelled) return;
      for(const [operation,ms] of [['readiness',opened?.evidence?.readinessMs],['loading',opened?.evidence?.loadingMs]])if(Number.isFinite(ms))send({type:'timing',operation,ms});
      if (!opened?.ready) {
        await restore();
        send({type:'result', id:job.id, status:opened?.status || 'blocked', failure:opened?.failure, reason:opened?.reason || 'The capture recipe is not available.', ms:Date.now()-started});
        return {evidence:opened?.evidence};
      }
      // Discovery of a saved view uses the same navigation and readiness checks,
      // while keeping its already verified image and capture attempt count.
      if (job.discoverOnly) {
        const view = await driver.ready(job, current.signal);
        return {ready:!!view?.ready, evidence:view, ms:Date.now()-started};
      }
      const deadline = Date.now() + (job.captureTimeoutMs || 4000);
      while (!current.cancelled && Date.now() < deadline) {
        const before = await driver.ready(job, current.signal);
        if (!before?.ready) {
          send({type:'result', id:job.id, status:before?.status || (before?.error ? 'blocked' : 'timed-out'), failure:before?.failure, reason:before?.error || before?.reason || 'The view did not settle.', ms:Date.now()-started});
          return {evidence:before};
        }
        const ticket = ++serial;
        const frameStarted = clock();
        const captured = await new Promise(resolve => {
          const timer = setTimeout(() => { if (current.pending?.ticket === ticket) { current.pending = undefined; resolve({ok:false, terminal:true}); } }, 8000);
          current.pending = {ticket, resolve:value => { clearTimeout(timer); current.pending = undefined; resolve(value); }};
          send({type:'frame', id:job.id, ticket, key:before.key, signature:before.signature, readinessMs:Date.now()-started});
        });
        measure('screenshot-wait', clock() - frameStarted);
        if (current.cancelled) return;
        if (captured.terminal) throw Object.assign(new Error('The screenshot connection stopped responding.'), {fatal:true, interrupted:true});
        if(captured.reason){send({type:'result',id:job.id,status:'timed-out',reason:captured.reason,failure:captured.failure,ms:Date.now()-started});return;}
        const after = await driver.verify(job, current.signal);
        if (captured.ok && driver.same(before, after)) {
          send({type:'result', id:job.id, ticket, status:'captured', ms:Date.now()-started});
          return {ready:true, evidence:after};
        }
        send({type:'discard', id:job.id, ticket});
        // Yield before a new native frame even when an in-process test or
        // screenshot cache replies synchronously. Stop remains responsive.
        await new Promise(resolve=>setTimeout(resolve,32));
      }
      if (!current.cancelled) send({type:'uncaptured', id:job.id, ms:Date.now()-started});
    } catch (error) {
      if (current.cancelled) return;
      if (error?.fatal) throw error;
      send({type:'result', id:job.id, status:'blocked', reason:String(error?.message||error).slice(0,300), ms:Date.now()-started});
      await restore();
    }
  }
  async function execute(current) {
    try {
      while (!current.cancelled && current.jobs.length) {
        current.job = current.jobs.shift();
        const result = await capture(current, current.job);
        if (current.cancelled) break;
        if (current.planning) {
          // The server can discover children while their parent is still open.
          // It returns approved jobs; the app retains the same driver/checkpoints.
          const planStarted = clock();
          let planned;
          try { planned = await request({type:'plan', ...result}); }
          finally { measure('planning', clock() - planStarted); }
          if (!validJobs(planned?.jobs)) throw new Error('Invalid capture plan.');
          current.jobs = planned.jobs.slice();
        }
      }
    } catch (error) {
      send({type:'error', interrupted:!!error?.interrupted, reason:String(error?.message||error).slice(0,300)});
    } finally {
      try { await restore(); }
      catch(error) { send({type:'error',interrupted:!!error?.interrupted,reason:'Capture state could not be restored.'}); }
      if (run === current) {
        current.pending?.resolve({ok:false, terminal:true});
        send({type:'done'});
        elapsedMs = clock() - current.started;
        run = undefined;
      }
    }
  }
  return {
    request, measure,
    source(batch, ticket, value) {
      if (run?.id !== batch || run.source?.ticket !== ticket || run.cancelled) return {accepted:false};
      const current=run,pending=current.source;
      clearTimeout(pending.timer);current.source=undefined;current.delivery=pending;
      // Return the debugger acknowledgement before starting the next opening.
      // Promise continuations can otherwise drain inside Runtime.evaluate and
      // make a valid reply time out while React is already rendering that view.
      pending.deliveryTimer=setTimeout(()=>{
        if(current.delivery!==pending)return;
        current.delivery=undefined;pending.resolve(value);
      },0);
      return {accepted:true};
    },
    start(id, jobs, planning = false) {
      if (run || restoreError || restoreTask) throw new Error('Finish capture cleanup before starting another batch.');
      if (!validJobs(jobs)) throw new Error('Invalid capture manifest.');
      const controller = new AbortController();
      work.clear(); elapsedMs = 0;
      const current = run = {id, jobs:jobs.slice(), planning, cancelled:false, signal:controller.signal, controller, started:clock()};
      current.done = execute(current);
      return {started:true, total:jobs.length};
    },
    ack(batch, ticket, value) {
      if (run?.id !== batch || run.pending?.ticket !== ticket) return {accepted:false};
      run.pending.resolve(value);
      return {accepted:true};
    },
    async stop() {
      const current = run;
      if (current) {
        current.cancelled = true;
        current.controller.abort();
        current.pending?.resolve({ok:false, terminal:true});
        current.source?.reject(new Error('Capture stopped.'));
        current.delivery?.reject(new Error('Capture stopped.'));
        await current.done;
      }
      if (restoreError || restoreTask) await restore();
    },
    get work() { return {elapsedMs:run ? clock() - run.started : elapsedMs, phases:[...work.values()].map(value=>({...value}))}; },
    get preparingAction() { return run?.source?.actionId; },
    get active() { return !!run || !!restoreError || !!restoreTask; },
  };
}
