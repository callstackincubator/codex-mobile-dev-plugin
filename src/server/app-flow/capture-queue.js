/** Runs in the app. One frame may be awaiting acknowledgement at a time. */
export function createCaptureQueue(driver, emit) {
  let run, restoreError, restoreTask, serial = 0;
  function restore() {
    if (restoreTask) return restoreTask;
    restoreTask = Promise.resolve().then(() => driver.restore()).then(
      () => { restoreError = undefined; },
      error => { restoreError = error; throw error; },
    ).finally(() => { restoreTask = undefined; });
    return restoreTask;
  }
  const send = event => { if (run && !run.cancelled) emit({...event, batch: run.id}); };
  async function execute(current) {
    try {
      for (const job of current.jobs) {
        if (current.cancelled) break;
        const started = Date.now();
        send({type: 'opening', id: job.id});
        try {
        const opened = await driver.open(job, current.signal);
        if (current.cancelled) break;
        if (!opened?.ready) {
          await restore();
          send({type: 'result', id: job.id, status: opened?.status || 'blocked', reason: opened?.reason || 'The capture recipe is not available.', ms: Date.now() - started});
          continue;
        }
        // Readiness and screenshot verification use the same driver. A changed
        // frame is retried here, without repeating navigation or opening a sheet.
        let accepted = false;
        const deadline = Date.now() + (job.captureTimeoutMs || 4000);
        while (!current.cancelled && Date.now() < deadline) {
          const before = await driver.ready(job, current.signal);
          if (!before?.ready) {
            send({type: 'result', id: job.id, status: 'timed-out', reason: before?.reason || 'The view did not settle.', ms: Date.now() - started});
            break;
          }
          const ticket = ++serial;
          const captured = await new Promise(resolve => {
            const timer = setTimeout(() => { if (current.pending?.ticket === ticket) { current.pending = undefined; resolve({ok: false, terminal: true}); } }, 8000);
            current.pending = {ticket, resolve: value => { clearTimeout(timer); current.pending = undefined; resolve(value); }};
            send({type: 'frame', id: job.id, ticket, readinessMs: Date.now() - started});
          });
          if (current.cancelled) break;
          if (captured.terminal) throw Object.assign(new Error('The screenshot connection stopped responding.'),{fatal:true});
          const after = await driver.verify(job);
          if (captured.ok && driver.same(before, after)) {
            accepted = true;
            send({type: 'result', id: job.id, ticket, status: 'captured', ms: Date.now() - started});
            break;
          }
          send({type: 'discard', id: job.id, ticket});
          if (!captured.ok && captured.reason) break;
        }
        if (!accepted && !current.cancelled) send({type: 'uncaptured', id: job.id, ms: Date.now() - started});
        } catch(error) {
          if(current.cancelled)break;
          if(error?.fatal)throw error;
          send({type:'result',id:job.id,status:'blocked',reason:String(error?.message||error).slice(0,300),ms:Date.now()-started});
          await restore();
        }
      }
    } catch (error) {
      send({type: 'error', reason: String(error?.message || error).slice(0, 300)});
    } finally {
      try { await restore(); }
      catch { send({type: 'error', reason: 'Capture state could not be restored.'}); }
      if (run === current) {
        current.pending?.resolve({ok: false, terminal: true});
        send({type: 'done'});
        run = undefined;
      }
    }
  }
  return {
    start(id, jobs) {
      if (run || restoreError || restoreTask) throw new Error('Finish capture cleanup before starting another batch.');
      if (!Array.isArray(jobs) || jobs.length > 1000 || new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error('Invalid capture manifest.');
      const controller = new AbortController();
      const current = run = {id, jobs, cancelled: false, signal: controller.signal, controller};
      current.done = execute(current);
      return {started: true, total: jobs.length};
    },
    ack(batch, ticket, value) {
      if (run?.id !== batch || run.pending?.ticket !== ticket) return {accepted: false};
      run.pending.resolve(value);
      return {accepted: true};
    },
    async stop() {
      const current = run;
      if (current) {
        current.cancelled = true;
        current.controller.abort();
        current.pending?.resolve({ok: false, terminal: true});
        await current.done;
      }
      // A finished queue can still own a native sheet. Keep its driver and
      // propagate failure so the runtime cannot reset navigation beneath it.
      if (restoreError || restoreTask) await restore();
    },
    get active() { return !!run || !!restoreError || !!restoreTask; },
  };
}
