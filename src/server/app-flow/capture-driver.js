/** Driver for source-instrumented controls and the existing navigation runtime. */
export function createCaptureDriver(runtime, registry, probe) {
  let branch = [], base, currentOwner, currentTarget, lastReady;
  const call = command => new Promise((resolve, reject) => runtime.invoke(command, result => {
    if (result?.error || result?.appFailed) reject(Object.assign(new Error(result.error || 'The app reported an error.'),{fatal:!!result?.appFailed}));
    else resolve(result);
  }));
  const own = (value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const controlKey = effect => effect.target && `${effect.target.file}:${effect.target.source.line}:${effect.target.source.column}:${effect.prop}`;
  function controlUndo(owner, target, control, close) {
    return async (waitForCallback=false) => {
      if (!owner.mounted) return;
      const closeMethod = own(control, close);
      // Controllers with a completion callback must acknowledge their
      // native dismissal before a sibling sheet opens.
      if (waitForCallback) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The sheet did not acknowledge dismissal.')), 4000);
        closeMethod.call(control, () => { clearTimeout(timer); resolve(); });
      });
      else {
        const dismissal=await probe({owner:owner.id,target,nativeClose:true,control,close});
        if(dismissal?.handled&&dismissal.observed&&dismissal.closed)return;
        if(!dismissal?.handled)closeMethod.call(control);
        await waitUntil(() => {
          const result = probe({owner: owner.id, target});
          // The source marker stays mounted when a sheet's body closes.
          // Wait for the body and native transition, not the marker.
          return {...result, ready: (!result.found || result.hosts===0) && !result.nativePending && !result.transitioning};
        }, undefined).then(result=>{
          if (!result?.ready) throw new Error('The sheet did not finish dismissing.');
        });
      }
    };
  }
  function stateUndo(owner, setter, before) {
    return async () => { if (owner.mounted) setter(before); };
  }
  function aliasUndo(parent) {
    return async handoff => {
      if (handoff && !parent.closed) { await parent.undo(true); parent.closed=true; }
    };
  }
  async function restoreTo(level) {
    lastReady=undefined;
    while (branch.length > level) {
      const item = branch[branch.length - 1];
      if(!item.closed)await item.undo();
      branch.pop();
      if(!item.alias)probe({nativeStop:true});
    }
    currentOwner = branch.at(-1)?.owner;
    currentTarget = branch.at(-1)?.target;
  }
  function update(value, path, next) {
    if (!path.length) return next;
    const [key, ...rest] = path;
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('The UI selector is not a plain state value.');
    return {...value, [key]: update(own(value, key), rest, next)};
  }
  function waitUntil(read, signal, timeout = 4000) {
    return new Promise((resolve, reject) => {
      let timer, deadline, off, paint, wake, stopped = false, previous, since = Date.now(), frames = 0, reason;
      const finish = (value, error) => {
        if (stopped) return; stopped = true;
        clearTimeout(timer); clearTimeout(deadline); clearTimeout(wake); off?.();
        if (paint !== undefined) (globalThis.cancelAnimationFrame || clearTimeout)(paint);
        signal?.removeEventListener('abort', aborted);
        if (error) reject(error); else if (!value) reject(new Error('Readiness completed without a view.')); else resolve(value);
      };
      const aborted = () => finish(undefined, new Error('Capture stopped.'));
      const check = () => {
        if (stopped) return;
        clearTimeout(timer);
        try {
          const view = read();
          reason=view.reason || (view.loading?'data or loader':view.transitioning?'navigation transition':view.nativePending?'native presentation':!view.found?'missing visible body':!view.content?'empty body':'motion or paint');
          const key = JSON.stringify([view.key, view.signature, view.motion, view.loading, view.transitioning]);
          if (!view.ready || key !== previous) { previous = key; since = Date.now(); frames = 0; }
          if (view.ready && Date.now() - since >= 160 && frames >= 2) { finish(view); return; }
          // Native animation can change without a React commit. Retain a local
          // motion probe; source commits wake it immediately, no CDP polling.
          timer = setTimeout(check, view.loading ? 100 : 40);
          if (paint === undefined && view.ready) {
            const frame = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 16));
            paint = frame(() => { paint = undefined; frames++; });
          }
        } catch (error) { finish(undefined, error); }
      };
      // Many instrumented owners commit in the same React pass. Inspect the
      // completed commit once, rather than measuring the tree in every layout
      // effect. Native motion still gets the regular local polling check.
      off = registry.subscribe(() => {
        if (stopped || wake !== undefined) return;
        wake = setTimeout(() => { wake = undefined; check(); }, 0);
      });
      deadline = setTimeout(() => finish({ready: false, reason: `The view did not settle: ${reason || 'readiness unavailable'}.`}), timeout);
      signal?.addEventListener('abort', aborted, {once: true});
      if (signal?.aborted) aborted(); else check();
    });
  }
  const view = job => {
    if(registry.projection?.error)throw new Error(registry.projection.error);
    let owner=currentOwner,target=currentTarget;
    if(target?.endsWith(':entry')) {
      owner=registry.find(target)?.owner;
      if(!owner)return {ready:false,found:false,reason:'The exact source view has not mounted.'};
    }
    return probe({owner:owner?.id,target,component:branch.at(-1)?.component,path:job.path,params:job.params,expo:job.expo});
  };
  const same=(before,after)=>before?.ready && after?.ready && before.key===after.key && before.signature===after.signature && before.motion===after.motion;
  async function closePreview() {
    registry.unproject();
    const closed=await waitUntil(()=>({ready:!probe({owner:'flow-preview'}).found,key:'restored',signature:''}));
    if(!closed?.ready)throw new Error('The isolated view did not unmount.');
  }
  return {
    async open(job, signal) {
      if (job.blocked) return {ready: false, status: 'needs-data', reason: job.blocked};
      const nextBase = JSON.stringify([job.path, job.params ?? {}, !!job.expo]);
      let depth = 0;
      if (base === nextBase) while (depth < branch.length && !branch[depth].closed && branch[depth].id === job.actions[depth]?.id) depth++;
      await restoreTo(depth);
      probe({nativeStart:true});
      if (base !== nextBase) {
        if (job.path.length) {
          const opened = await call({type: 'open', path: job.path, params: job.params, expo: job.expo, timeoutMs: 4000, loadingTimeoutMs: 8000});
          if (!opened?.ready) return {ready: false, status: 'timed-out', reason: opened?.reason};
          if (!job.actions.length && typeof opened.signature === 'string') {
            // Navigation already waited for loading, motion and two paint
            // frames. Reuse that proof only while a fresh probe still matches.
            const current=view(job);
            if (same({...opened,key:current.key},current)) lastReady={id:job.id,view:current};
          }
        }
        base = nextBase;
      }
      for (const action of job.actions.slice(depth)) {
        if(signal.aborted)throw new Error('Capture stopped.');
        const effect = action.effect;
        if (action.consumer) return {ready: false, status: 'needs-data', reason: 'This recipe needs its real shared render context.'};
        if(effect.kind==='mount') {
          probe({nativeStart:true});
          await registry.project({source:`${effect.file}#${effect.export}`});
          currentOwner={id:'flow-preview'};currentTarget=undefined;
          branch.push({id:action.id,owner:currentOwner,undo:closePreview});
          const opened=await waitUntil(()=>view(job),signal);
          if(!opened.ready)return {ready:false,status:'timed-out',reason:opened.reason};
          lastReady={id:job.id,view:opened};
          continue;
        }
        const binding = effect.kind === 'state' ? effect.site : controlKey(effect);
        const match = registry.find(binding);
        if (!match) return {ready: false, status: 'needs-data', reason: 'The source owner is unmounted or has several instances. Prepare its real context first.'};
        const {owner, value} = match;
        for(const handoff of action.handoffs??[]) {
          const id=`${handoff.file}:${handoff.source.line}:${handoff.source.column}:handoff`;
          const entry=registry.find(id);
          const parent=entry && [...branch].reverse().find(frame=>!frame.closed && frame.target && probe({owner:entry.owner.id,target:id,within:`${frame.owner.id}:${frame.target}`}).contained);
          if(!parent)return {ready:false,status:'needs-data',reason:'The source-proven parent sheet is not open in this context.'};
          await parent.undo(true);parent.closed=true;
          if(signal.aborted)throw new Error('Capture stopped.');
          if(!owner.mounted)return {ready:false,status:'needs-data',reason:'The target owner unmounted when its parent closed.'};
        }
        if (effect.kind === 'state') {
          probe({nativeStart:true});
          if (value.kind !== 'state' || typeof value.tuple?.[1] !== 'function') return {ready: false, reason: 'The UI setter is unavailable.'};
          const before=value.tuple[0],setter=value.hook==='useReducer'?value.previewSetter:value.tuple[1];
          const next = update(before, effect.path, effect.value);
          if(action.preview && !owner.preview) {
            if(branch.some(frame=>frame.control&&!frame.closed))return {ready:false,status:'needs-data',reason:'This state preview needs a capture host inside its native presentation.'};
            if(!owner.type)return {ready:false,status:'needs-data',reason:'This shared state needs its real consumer context.'};
            await registry.project({source:owner.source,owner,site:effect.site,value:next});
            currentOwner={id:'flow-preview'};
            branch.push({id:action.id,owner:currentOwner,undo:closePreview});
          }else {
            if(typeof setter!=='function')return {ready:false,status:'needs-data',reason:'A reducer selector requires an isolated preview.'};
            branch.push({id: action.id, owner, undo: stateUndo(owner, setter, before)});
            setter(next);
          }
          if(action.expected)branch.at(-1).target=`${action.expected.file}:${action.expected.source.line}:${action.expected.source.column}:entry`;
          else branch.at(-1).component=action.name;
        } else {
          let control = value.control;
          control = own(control, 'current') ?? control;
          // Wrapper and inner JSX sites can expose the same native controller.
          // Reuse that presentation; opening it twice can detach its native body.
          const existing = control && branch.find(frame => !frame.closed && frame.controlRef === control);
          if (existing) {
            branch.push({id:action.id,owner:existing.owner,target:existing.target,control:true,alias:true,undo:aliasUndo(existing)});
            currentOwner=existing.owner;currentTarget=existing.target;
            continue;
          }
          const names = effect.method === 'auto' ? ['open', 'present', 'show', 'expand'] : [effect.method];
          const open = names.find(name => typeof own(control, name) === 'function' && own(control, name).length === 0);
          const close = (Array.isArray(effect.close) ? effect.close : [effect.close]).find(name => typeof own(control, name) === 'function');
          if (!open || !close) return {ready: false, reason: 'The source control has no reversible open/close pair.'};
          const target = binding;
          const undo = controlUndo(owner, target, control, close);
          branch.push({id: action.id, owner, target, control:true, controlRef:control, undo});
          probe({owner:owner.id,target,nativeStart:true});
          own(control, open).call(control);
        }
        currentOwner = branch.at(-1).owner; currentTarget = branch.at(-1).target;
        const opened = await waitUntil(() => view(job), signal);
        if (!opened.ready) return {ready: false, status: 'timed-out', reason: opened.reason};
        lastReady={id:job.id,view:opened};
      }
      return {ready: true};
    },
    ready(job, signal) {
      const current=view(job);
      if(lastReady?.id===job.id && same(lastReady.view,current))return Promise.resolve(current);
      return waitUntil(() => view(job), signal);
    },
    verify(job) { return view(job); },
    same,
    async restore() { await restoreTo(0); base = undefined; },
  };
}
