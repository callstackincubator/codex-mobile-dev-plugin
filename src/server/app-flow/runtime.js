// Injected into a development runtime through one CDP connection. No app-specific code.
export function installFlowRuntime(key, leaseMs, presentationFactory, captureQueueFactory, captureDriverFactory, transitionFactory, execution = 'debugger') {
  if (globalThis[key]) return;
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  // Expo's native developer menu can cover every captured screen while JS keeps running.
  try { globalThis.expo?.modules?.ExpoDevMenu?.hideMenu?.()?.catch?.(() => {}); } catch {}
  let root, original, observation, observing = false, stopped = false, generation = 0, safeBudget = 2000;
  let captureQueue;
  const transitionMode = transitionFactory?.();
  // Preserve RN's error handler. A live navigator behind LogBox is not a
  // capturable screen, even when its React tree has finished rendering.
  let appFailed = false, appFailure, errorUtils, originalErrorHandler, errorHandler;
  // Local evidence for the run's relaunch log: the error's type and the first
  // stack frames' function names. Code identifiers only; a message can carry
  // app data, so it is never kept. Never sent to telemetry.
  const describeError = error => {
    const type = typeof error?.name === 'string' && /^[A-Z][\w$]{0,40}$/.test(error.name) ? error.name : 'Error';
    const frames = String(error?.stack ?? '').split('\n').slice(1).map(line => /at ([A-Za-z_$][\w$.<>]{0,60})/.exec(line)?.[1]).filter(Boolean).slice(0, 4);
    return frames.length ? `${type} in ${frames.join(' < ')}` : type;
  };
  try {
    errorUtils = globalThis.ErrorUtils;
    if (typeof errorUtils?.getGlobalHandler === 'function' && typeof errorUtils?.setGlobalHandler === 'function') {
      originalErrorHandler = errorUtils.getGlobalHandler();
      if (typeof originalErrorHandler === 'function') {
        errorHandler = function(error, fatal) {
          if (fatal) { appFailed = true; appFailure ??= describeError(error); }
          return originalErrorHandler.apply(this, arguments);
        };
        errorUtils.setGlobalHandler(errorHandler);
      }
    }
  } catch { /* Not every development runtime exposes RN ErrorUtils. */ }
  let logBoxSubscription, logBoxVisible = false, logBoxRestore;
  function observeLogBox() {
    if(logBoxSubscription)return;
    // Read only RN's initialized framework store. Do not initialize an app
    // module, suppress errors, or send log content through the capture bridge.
    for(const module of globalThis.__r?.getModules?.()?.values?.()??[]){
      if(!module.isInitialized||typeof module.verboseName!=='string'||!/(?:^|\/)react-native\/Libraries\/LogBox\/Data\/LogBoxData\.js$/.test(module.verboseName.replaceAll('\\','/')))continue;
      const exports=module.publicModule?.exports,own=name=>{const descriptor=exports&&Object.getOwnPropertyDescriptor(exports,name);return typeof descriptor?.value==='function'?descriptor.value:undefined;};
      const observe=own('observe'),setDisabled=own('setDisabled'),isDisabled=own('isDisabled');
      if(!observe)continue;
      let initial,inspector=false;
      try{logBoxSubscription=observe(state=>{
        const logs=state?.logs instanceof Set||Array.isArray(state?.logs)?[...state.logs]:[];
        initial??=new Set(logs);
        inspector=state?.isDisabled!==true&&Number.isInteger(state?.selectedLogIndex)&&state.selectedLogIndex>=0;
        // A hidden LogBox still records logs. A new fatal or syntax error fails
        // the capture as the visible inspector would.
        logBoxVisible=inspector||logs.some(log=>!initial.has(log)&&(log?.level==='fatal'||log?.level==='syntax'));
      });}catch{}
      // Dev notifications can cover any screen. Hide LogBox while capture runs
      // and restore it on cleanup; an inspector already open still blocks.
      try{if(logBoxSubscription&&setDisabled&&isDisabled&&!inspector&&!isDisabled()){setDisabled(true);logBoxRestore=()=>{try{if(isDisabled())setDisabled(false);}catch{}};}}catch{}
      break;
    }
  }
  observeLogBox();
  const observed = new Map();
  const transitions = new Map();
  const waitTimers = new Set(), paintFrames = new Set();
  const cancelledWaits = new Map();
  // The runtime's own timers use the app's original timer functions, so the
  // activity check below counts only timers the app schedules.
  const ownTimer = value => typeof value?.__mobileDevOriginal === 'function' ? value.__mobileDevOriginal : value;
  const setTimer = ownTimer(globalThis.setTimeout), clearTimer = ownTimer(globalThis.clearTimeout);
  const later = (callback, ms, onCancel) => {
    const timer = setTimer(() => { waitTimers.delete(timer); cancelledWaits.delete(timer); callback(); }, ms);
    if(onCancel)cancelledWaits.set(timer,onCancel);
    waitTimers.add(timer); return timer;
  };
  const frame = callback => {
    if (typeof globalThis.requestAnimationFrame !== 'function') return later(callback, 16);
    const id = globalThis.requestAnimationFrame(() => { paintFrames.delete(id); callback(); });
    paintFrames.add(id); return id;
  };
  const cancelWaits = () => {
    for (const timer of waitTimers) clearTimer(timer);
    for (const id of paintFrames) globalThis.cancelAnimationFrame?.(id);
    waitTimers.clear(); paintFrames.clear();
    const cancelled=[...cancelledWaits.values()];cancelledWaits.clear();
    for(const resolve of cancelled)resolve();
  };
  let transitionAt = 0;
  const sensitive = /token|password|secret|authorization|cookie|^(__proto__|constructor|prototype)$/i;
  function safe(value, depth = 0) {
    if (depth > 8 || --safeBudget < 0) return undefined;
    if (typeof value === 'string') return value.length <= 256 && !/^(Bearer |eyJ[A-Za-z0-9_-]+\.)/.test(value) ? value : undefined;
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value;
    if (Array.isArray(value)) return Array.from({length: Math.min(value.length, 12)}, (_, i) => safe(ownValue(value, String(i)), depth + 1));
    if (!value || typeof value !== 'object') return undefined;
    const result = {};
    for (const name of Object.keys(value).slice(0, 24)) {
      if (sensitive.test(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !('value' in descriptor)) continue;
      const item = safe(descriptor.value, depth + 1);
      if (item !== undefined) result[name] = item;
    }
    return result;
  }
  function ownValue(value, name) {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  }
  function readClientData(props, clients, data) {
    const client = ownValue(props, 'client');
    if (!client || typeof client.getQueryCache !== 'function' || clients.has(client) || data.length >= 40) return;
    clients.add(client);
    try {
      for (const query of client.getQueryCache().getAll().slice(0, 40)) {
        if (data.length >= 40) break;
        const value = safe(ownValue(ownValue(query, 'state'), 'data'));
        if (value) data.push({query: safe(ownValue(query, 'queryKey')), value});
      }
    } catch { /* Optional query caches may be unavailable. */ }
  }
  // Whether a waiting view can still change: HTTP requests in flight, the last
  // request start or end, pending short app timers and fetching queries, with
  // the presentation runtime's last React commit. Counts and times only; no
  // URL, header, body, callback or query key is read. Requests and timers run
  // unchanged, and the wrappers are removed on restore.
  const network = {open: 0, at: 0, undo: undefined, timers: new Set()};
  let queryClients;
  function watchActivity() {
    if (network.undo) return;
    const undo = network.undo = [];
    network.at = Date.now();
    const started = () => {
      let open = true;
      network.open++; network.at = Date.now();
      return () => { if (!open) return; open = false; network.open = Math.max(0, network.open - 1); network.at = Date.now(); };
    };
    const request = globalThis.XMLHttpRequest?.prototype, send = request && Object.getOwnPropertyDescriptor(request, 'send')?.value;
    if (typeof send === 'function') {
      const tracked = function() {
        const end = started();
        try { this.addEventListener('loadend', end); } catch { end(); }
        try { return send.apply(this, arguments); } catch (error) { end(); throw error; }
      };
      try { request.send = tracked; undo.push(() => { if (request.send === tracked) request.send = send; }); } catch {}
    }
    // A retry delay or deferred step can change a view without a commit or
    // request. App timeouts from 50 ms to 5 s count while pending.
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout, timers = network.timers;
    if (typeof set === 'function' && typeof clear === 'function') {
      const tracked = Object.assign(function(callback, ms) {
        const delay = Number(ms);
        if (typeof callback !== 'function' || !(delay >= 50 && delay <= 5000)) return set.apply(this, arguments);
        const rest = Array.prototype.slice.call(arguments, 2);
        const id = set.call(this, function() { timers.delete(id); return callback.apply(this, arguments); }, ms, ...rest);
        timers.add(id);
        return id;
      }, {__mobileDevOriginal: ownTimer(set)});
      const cleared = Object.assign(function(id) { timers.delete(id); return clear.apply(this, arguments); }, {__mobileDevOriginal: ownTimer(clear)});
      try {
        globalThis.setTimeout = tracked; globalThis.clearTimeout = cleared;
        undo.push(() => { if (globalThis.setTimeout === tracked) globalThis.setTimeout = set; if (globalThis.clearTimeout === cleared) globalThis.clearTimeout = clear; timers.clear(); });
      } catch {}
    }
    // React Native's fetch uses XMLHttpRequest; another fetch implementation
    // is counted here. A derived promise keeps the app's unhandled rejections.
    const fetch = globalThis.fetch;
    if (typeof fetch === 'function') {
      const tracked = Object.assign(function() {
        const end = started();
        let result;
        try { result = fetch.apply(this, arguments); } catch (error) { end(); throw error; }
        if (typeof result?.then !== 'function') { end(); return result; }
        return result.then(value => { end(); return value; }, error => { end(); throw error; });
      }, fetch);
      try { globalThis.fetch = tracked; undo.push(() => { if (globalThis.fetch === tracked) globalThis.fetch = fetch; }); } catch {}
    }
  }
  function unwatchActivity() {
    for (const step of (network.undo ?? []).reverse()) { try { step(); } catch {} }
    network.undo = queryClients = undefined; network.open = 0;
  }
  function fetchingQueries() {
    if (!queryClients) {
      queryClients = new Set();
      fibers(fiber => {
        const client = ownValue(fiber.memoizedProps, 'client');
        if (typeof client?.isFetching === 'function' && typeof client.getQueryCache === 'function') { queryClients.add(client); return stopWalk; }
      });
    }
    for (const client of queryClients) { try { if (client.isFetching() > 0) return true; } catch {} }
    return false;
  }
  // Milliseconds without a commit, request, pending app timer or fetching
  // query. Unknown without the commit observer or the wrappers.
  function idleMs() {
    const commit = presentations?.lastCommit?.();
    if (!network.undo || !Number.isFinite(commit)) return undefined;
    if (network.open > 0 || network.timers.size > 0 || fetchingQueries()) return 0;
    return Math.max(0, Date.now() - Math.max(commit, network.at));
  }
  // A fixed amount of JavaScript work. Its duration follows CPU contention in
  // the app process whichever view is open, unlike a capture's duration.
  function cpuProbe() {
    const clock = () => globalThis.performance?.now?.() ?? Date.now(), started = clock();
    let value = 0;
    for (let index = 0; index < 20000; index++) value = (value * 31 + index) % 1000003;
    return value < 0 ? 0 : Math.round((clock() - started) * 100) / 100;
  }
  function contextData() {
    safeBudget = 2000;
    const data = [], clients = new Set();
    // Reading current cache records must not rebind navigation, run app hooks,
    // refetch queries, or change the temporary presentation being captured.
    fibers(fiber => readClientData(fiber.memoizedProps, clients, data));
    return {data, candidates: [...observed.values()]};
  }
  function remember(name, params) {
    if (typeof name !== 'string' || !params || typeof params !== 'object' || observed.size >= 200) return;
    const value = safe(params);
    if (!Object.keys(value || {}).length) return;
    observed.set(JSON.stringify([name, value]), { name, params: value });
  }
  const stopWalk = Symbol('stopWalk');
  function fibers(callback, subtree) {
    if (!hook?.renderers || typeof hook.getFiberRoots !== 'function') return;
    const stack = [];
    if (subtree) stack.push(subtree);
    else for (const [id, renderer] of hook.renderers) {
      if (renderer.rendererPackageName !== 'react-native-renderer') continue;
      for (const item of hook.getFiberRoots(id)) stack.push(item.current);
    }
    // A busy feed can exceed 16,000 fibers before a root-level portal outlet.
    // Walk the complete mounted tree; guard cycles without dropping its tail.
    const seen = new Set();
    while (stack.length) {
      const fiber = stack.pop(); if (!fiber) continue;
      if (seen.has(fiber)) continue;
      seen.add(fiber);
      if (fiber !== subtree && fiber.sibling) stack.push(fiber.sibling);
      const result = callback(fiber);
      if (result === stopWalk) return;
      if (result !== false && fiber.child) stack.push(fiber.child);
    }
  }
  const measure = (phase, ms) => { if(captureQueue?.active)captureQueue.measure?.(phase, ms); };
  // A prepared recipe names a shared shell's caller by its compiled JSX site.
  const callerSite = value => typeof value === 'string' && value.length <= 500 && /^[^\n]+:\d+:\d+$/.test(value) ? value : undefined;
  const presentations = presentationFactory?.({ hook, fibers, hidden: props => hidden(props), later, measure });
  let presentationFocus, presentationObservation, presentationExpected, lastProbe, lastPresentationProbe, lastOpenProbe;
  const presentationFrames = [];
  function navigation(value) {
    if (!value || typeof value !== 'object' || typeof value.getState !== 'function' || typeof value.dispatch !== 'function') return;
    try {
      let nav = value;
      const visited = new Set();
      while (typeof nav.getParent === 'function' && !visited.has(nav)) {
        visited.add(nav);
        const parent = nav.getParent(); if (!parent) break; nav = parent;
      }
      if (nav.getState()?.routeNames?.length && !root) { root = nav; original ??= nav.getRootState?.() ?? nav.getState(); }
    } catch { /* Detached navigation objects are ignored. */ }
  }
  function refreshNavigation() {
    // A detached helper can still read current container state while dispatching
    // through its old navigator. Bind again from the committed, visible tree.
    root=undefined;
    fibers(fiber=>{
      const props=fiber.memoizedProps;if(hidden(props))return false;
      navigation(props?.navigation);navigation(props?.value);
    });
  }
  function navigationFor(key) {
    let result;
    fibers(fiber=>{
      const props=fiber.memoizedProps;if(hidden(props))return false;
      const nav=props?.navigation;
      try{if(nav?.getState?.()?.key===key&&typeof nav.dispatch==='function')result=nav;}catch{}
    });
    return result;
  }
  function navigatorState() {
    try { return root?.getRootState?.() ?? root?.getState?.(); }
    catch { /* Local forms can unmount and later replace the navigator. */ }
  }
  function navigationCounts() {
    const stack=[navigatorState()],seen=new Set();let navigationRoutes=0,navigationStacks=0,largestStack=0,truncated=false;
    while(stack.length&&seen.size<1000){
      const state=stack.pop();if(!state||typeof state!=='object'||seen.has(state))continue;seen.add(state);
      if(!Array.isArray(state.routes))continue;navigationRoutes+=state.routes.length;
      if(state.type==='stack'){navigationStacks++;largestStack=Math.max(largestStack,state.routes.length);}
      if(state.routes.length>1000)truncated=true;
      for(const route of state.routes.slice(0,1000))if(route?.state){
        if(stack.length+seen.size>=1000){truncated=true;break;}stack.push(route.state);
      }
    }
    return {navigationRoutes,navigationStacks,largestStack,navigationTruncated:truncated||stack.length>0};
  }
  const hidden = props => props?.hidden === true || props?.mode === 'hidden' || props?.activityState === 0 || props?.route && props.navigation?.isFocused && !props.navigation.isFocused();
  let visibleMetadata;
  function visible() {
    const structure=presentations?.structure?.();
    if(structure&&visibleMetadata?.structure===structure)return {...visibleMetadata.value,transitioning:[...transitions.values()].some(record=>record.busy)};
    const links = [], components = new Set(), destinations = new Set(), live = new Set();
    safeBudget = 2000;
    const visit = fiber => {
      const props = fiber.memoizedProps;
      if (hidden(props)) return false;
      const type = fiber.type?.render ?? fiber.type?.type ?? fiber.type;
      const name = type?.displayName ?? type?.name;
      if (name && components.size < 1000) components.add(name);
      const href = props?.href ?? props?.to;
      if (href && links.length < 300) {
        safeBudget = 120;
        const value = safe(href);
        const key = JSON.stringify(value);
        if (value && !destinations.has(key)) { links.push(value); destinations.add(key); }
      }
      const nav = props?.navigation;
      if (nav?.addListener) live.add(nav);
      if (nav?.addListener && !transitions.has(nav)) {
        const record = { busy: false, off: [] };
        record.off.push(nav.addListener('transitionStart', () => { record.busy = true; transitionAt = Date.now(); }));
        record.off.push(nav.addListener('transitionEnd', () => { record.busy = false; transitionAt = Date.now(); }));
        transitions.set(nav, record);
      }
    };
    if(structure)for(const fiber of structure.all)visit(fiber);else fibers(visit);
    for (const [nav, record] of transitions) if (!live.has(nav)) {
      for (const off of record.off) { try { off(); } catch {} }
      transitions.delete(nav);
    }
    const value={links,components:[...components]};
    if(structure)visibleMetadata={structure,value};
    return {...value,transitioning:[...transitions.values()].some(record=>record.busy)};
  }
  function inspect() {
    observeLogBox();
    if (!navigatorState()?.routeNames?.length) root = undefined;
    safeBudget = 2000;
    const mounted = [], registrations = [], entries = [], data = [], seen = new Set(), clients = new Set();
    fibers(fiber => {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== 'object') return;
      navigation(props.navigation); navigation(props.value);
      readClientData(props, clients, data);
      if (props.route?.name) {
        remember(props.route.name, props.route.params);
        if (props.navigation?.isFocused?.() && !mounted.includes(props.route.name)) mounted.push(props.route.name);
      }
      // Link destinations are useful even before a user presses them.
      const href = props.href ?? props.to;
      if (href && typeof href === 'object') remember(href.screen ?? href.pathname, href.params);
    });
    function walk(state, path = []) {
      if (!state || path.length > 12) return;
      for (const name of state.routeNames ?? []) {
        const next = [...path, name], id = next.join('/');
        if (!seen.has(id)) { registrations.push({ name, path: next }); seen.add(id); }
      }
      for (const route of state.routes ?? []) {
        const next = [...path, route.name];
        remember(route.name, route.params);
        if (route.state) walk(route.state, next);
        else if (state.type === 'tab' || state.type === 'drawer' || route === state.routes[0]) entries.push(next);
      }
    }
    const state = root?.getRootState?.() ?? root?.getState?.();
    walk(state);
    return { available: !!root, registrations, candidates: [...observed.values()], data, active: active(state), mounted, entries, ...visible() };
  }
  function active(state) {
    const path = [];
    for (let i = 0; state?.routes?.length && i < 16; i++) {
      const route = state.routes[state.index ?? 0]; if (!route) break;
      path.push(route.name); state = route.state;
    }
    return path;
  }
  function expoRouter() {
    // Only inspect modules Metro has already initialized. Never eagerly execute modules.
    const modules = globalThis.__r?.getModules?.();
    if (!modules?.values) return;
    for (const module of modules.values()) {
      if (!module.isInitialized) continue;
      const exports = module.publicModule?.exports;
      const descriptor = exports && Object.getOwnPropertyDescriptor(exports, 'router');
      const router = descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (router && typeof router.push === 'function' && typeof router.replace === 'function' && typeof router.canGoBack === 'function') return router;
    }
  }
  function visualSignature(name, wholeApp = false, focus, geometry) {
    let hosts = 0, content = 0, screen = focus, loadingReason, loadingComponent, bounds, title;
    const started=Date.now(),probe={fibers:0,layoutReads:0,layoutMs:0,opacityReads:0,totalMs:0};
    const signature = [], motion = [], motionSources = new Set(), motionStyles = new Set(), components = new Set();
    if (!wholeApp) fibers(fiber => {
      const props = fiber.memoizedProps;
      if (hidden(props)) return false;
      if (name !== undefined && props?.route?.name === name && props.navigation?.isFocused?.()) { screen = fiber; return stopWalk; }
    });
    const pagerPage = fiber => {
      // Only interpret an `active` flag at a page boundary. Buttons and media
      // inside a visible page can be inactive while still showing a loader.
      let child = fiber;
      for (let count = 0; child?.return && count < 24; count++) {
        const parent = child.return, props = parent.memoizedProps;
        if (parent.tag === 5 && typeof props?.onPageSelected === 'function' && (typeof props.onPageScroll === 'function' || Number.isInteger(props.initialPage))) return true;
        if (parent.child !== child || child.sibling) return false;
        child = parent;
      }
      return false;
    };
    const inactive = (fiber, includeTransparent = false) => {
      const props = fiber.memoizedProps;
      if (hidden(props)) return true;
      // Native pagers can keep inactive pages at the same Yoga coordinates.
      // Honor common focus props in addition to React Navigation's focus state.
      if (props) for (const key of Object.keys(props)) {
        if (props[key] !== false) continue;
        if (/^(?:is)?(?:screen|page|tab)?focused$/i.test(key) || /^(?:is)?(?:screen|page|tab)?active$/i.test(key) && pagerPage(fiber)) return true;
      }
      const styles = [props?.style];
      for (let index = 0; index < styles.length && index < 40; index++) {
        const style = styles[index];
        if (Array.isArray(style)) styles.push(...style);
        else if (style?.display === 'none' || style?.opacity === 0 && !includeTransparent) return true;
      }
      return false;
    };
    const rects = new WeakMap();
    const nativeRect = fiber => {
      if (rects.has(fiber)) return rects.get(fiber);
      let result;
      try {
        const native = fiber.stateNode?.canonical?.publicInstance ?? fiber.stateNode;
        let value;
        // Fabric creates public instances lazily. The UI manager measures the
        // same shadow node when a host has none yet.
        const node=fiber.stateNode?.node,manager=globalThis.nativeFabricUIManager;
        if(typeof native?.getBoundingClientRect==='function'||node&&typeof manager?.getBoundingClientRect==='function'){
          probe.layoutReads++;const before=Date.now();
          try{
            if(typeof native?.getBoundingClientRect==='function')value=native.getBoundingClientRect();
            else{const rect=manager.getBoundingClientRect(node,true);if(Array.isArray(rect)&&rect.length===4){const [x,y,width,height]=rect;value={x,y,width,height,left:x,top:y,right:x+width,bottom:y+height};}}
          }finally{probe.layoutMs+=Date.now()-before;}
        }
        geometry?.set(fiber,value);
        if (value && value.width > 0 && value.height > 0) result = value;
      } catch { /* Older renderers do not expose native bounds. */ }
      rects.set(fiber,result); return result;
    };
    const rect = (fiber, includeTransparent = false) => {
      let result, host = false;
      fibers(child => {
        if (inactive(child, includeTransparent)) return false;
        if (child.tag !== 5) return;
        host = true; result = nativeRect(child);
        if (result) return stopWalk;
      }, fiber);
      return { box: result, host };
    };
    if (wholeApp && !focus) fibers(fiber => {
      const props = fiber.memoizedProps;
      if (inactive(fiber)) return false;
      const type = fiber.type?.render ?? fiber.type?.type ?? fiber.type;
      const name = typeof type === 'string' ? type : type?.displayName ?? type?.name;
      if (props?.visible !== false && (props?.accessibilityViewIsModal === true || props?.['aria-modal'] === true || name === 'Modal' && props?.visible === true)) screen = fiber;
    });
    if (screen) {
      // A portal's logical parent can sit far outside its native sheet. Its
      // mounted content supplies the viewport for presentation inspection.
      if (wholeApp && focus) bounds = rect(screen).box;
      // A descendant may be a small icon in a flattened native tree. Prefer the
      // enclosing native screen when deciding whether a loader is offscreen.
      let parent = screen.return, count = 0;
      while (parent && !bounds && count++ < 80) { if (parent.tag === 5) bounds = nativeRect(parent); parent = parent.return; }
      bounds ??= rect(screen).box;
    }
    if (wholeApp && !screen) fibers(fiber => {
      if (inactive(fiber)) return false;
      if (fiber.tag === 5) { bounds = nativeRect(fiber); if (bounds) return stopWalk; }
    });
    const visibleLoader = (fiber, includeTransparent = false) => {
      let { box, host } = rect(fiber, includeTransparent);
      if (!host) return false;
      if (!bounds) return true;
      // Fabric can omit bounds for clipped or flattened loader hosts. Use the
      // nearest measured native parent, as the content probe does below. An
      // offscreen parent proves invisibility; unknown bounds still block.
      if (!box) for (let parent=fiber.return,count=0;parent&&count++<80&&!box;parent=parent.return) if (parent.tag===5) box=nativeRect(parent);
      // Offscreen list footers and preloaded tabs must not delay this preview.
      return !box || box.x < bounds.x + bounds.width && box.x + box.width > bounds.x && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y;
    };
    const pendingData = value => {
      if (!value || typeof value !== 'object') return false;
      try {
        // Query observers belong to the component's hooks, so background queries
        // elsewhere in the app do not block the focused screen.
        if (typeof value.getCurrentResult === 'function' && typeof value.getCurrentQuery === 'function') value = value.getCurrentResult();
        // Placeholder data stands in for a result that is still on its way. A
        // disabled query can keep placeholders forever; that cannot block.
        if (value.isPlaceholderData === true && !value.error && (value.isFetching === true || value.fetchStatus === 'fetching')) return true;
        return value.data === undefined && !value.error && (value.isLoading === true || value.loading === true || (value.isPending === true || value.status === 'pending' || value.status === 'loading') && value.fetchStatus === 'fetching');
      } catch { return false; }
    };
    const animatedOpacity = fiber => {
      const styles = [fiber.memoizedProps?.style];
      for (let index = 0; index < styles.length && index < 40; index++) {
        const style = styles[index];
        if (Array.isArray(style)) { styles.push(...style); continue; }
        // Reanimated updates these values on the UI thread without a React
        // commit. Read inputs only; never execute an app's style updater.
        if (!style?.viewDescriptors || motionStyles.has(style) || typeof style.initial?.value?.opacity !== 'number') continue;
        const closure = style.initial.updater?.__closure;
        const sources = [];
        // Worklets can expose captured values through framework getters.
        for (const name of Object.keys(closure ?? {}).slice(0, 24)) {
          try { const value = closure[name]; if (value?._isReanimatedSharedValue && !motionSources.has(value)) sources.push(value); } catch {}
        }
        if (!sources.length || !visibleLoader(fiber, true)) continue;
        motionStyles.add(style);
        for (const source of sources) {
          if (motionSources.has(source) || motionSources.size >= 32) continue;
          motionSources.add(source);
          try {
            probe.opacityReads++;
            const value = typeof source.getSync === 'function' ? source.getSync() : source.value;
            if (typeof value === 'number' && Number.isFinite(value)) motion.push(value);
          } catch { /* A detached animated view may no longer expose its value. */ }
        }
      }
    };
    if (screen || wholeApp) fibers(fiber => {
      probe.fibers++;
      const props = fiber.memoizedProps;
      if (inactive(fiber)) return false;
      if (props?.style) animatedOpacity(fiber);
      if (wholeApp && components.size < 1000) {
        const type = fiber.type?.render ?? fiber.type?.type ?? fiber.type;
        const name = type?.displayName ?? type?.name;
        if (name) components.add(name);
      }
      if (!loadingReason && props) {
        const type = fiber.type?.render ?? fiber.type?.type ?? fiber.type;
        const component = typeof type === 'string' ? type : type?.displayName ?? type?.name ?? '';
        const disabled = props.loading === false || props.isLoading === false || props.visible === false || props.enabled === false || props.animating === false;
        let reason;
        if (presentations?.imagePending?.(fiber)) reason = 'image';
        else if (!disabled && /Skeleton|Shimmer|LoadingPlaceholder|LoadingIndicator|LoadingSpinner|LoadingView|LoadingScreen|ActivityIndicator|Spinner|^Loader$/.test(component)) reason = 'skeleton';
        else if (props.accessibilityState?.busy === true || props['aria-busy'] === true || props.isLoading === true || props.loading === true || props.animating === true || (props.accessibilityRole === 'progressbar' || props.role === 'progressbar') && !disabled) reason = 'busy';
        else if (fiber.tag === 13 && fiber.memoizedState !== null && fiber.memoizedState !== undefined) reason = 'suspense';
        else {
          let hook = fiber.memoizedState, count = 0;
          while (hook && count++ < 40) {
            if (pendingData(hook.memoizedState)) { reason = 'data'; break; }
            hook = hook.next;
          }
        }
        // The component name stays in the local reason for diagnosis only.
        if (reason && visibleLoader(fiber)) { loadingReason = reason; loadingComponent = component.slice(0, 60) || undefined; }
      }
      if (fiber.tag !== 5 || !props) return;
      // After the signature is full and visible content is proven, another
      // plain host cannot change readiness. Keep scanning loaders, query hooks,
      // opacity and headings above/below this point, without crossing Fabric
      // for every offscreen row. Host/content counts describe sampled hosts.
      const heading = props.accessibilityRole === 'header' || props.role === 'heading';
      if (signature.length >= 250 && content > 0 && (title || !heading)) return;
      // Virtualized lists can keep mounting rows below the viewport for many
      // seconds. Those rows cannot change this screenshot or its readiness.
      let box = bounds && nativeRect(fiber);
      if (bounds && !box) for (let parent=fiber.return,count=0;parent&&count++<80&&!box;parent=parent.return) if (parent.tag===5) box=nativeRect(parent);
      if (box && !(box.x < bounds.x + bounds.width && box.x + box.width > bounds.x && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y)) return;
      hosts++;
      const text = typeof props.children === 'string' ? props.children.slice(0, 100) : '';
      if (!title && heading) title = text || props.accessibilityLabel;
      if (text || props.source || props.src || props.accessibilityLabel) content++;
      if (signature.length < 250) signature.push([typeof fiber.type === 'string' ? fiber.type : '', text, !!props.source]);
    }, screen);
    probe.totalMs=Date.now()-started;lastProbe=probe;
    measure('self-visual',probe.totalMs);measure('self-layout',probe.layoutMs);
    if (motion.length) signature.push(['opacity', motion]);
    return { found: wholeApp ? hosts > 0 : !!screen, loading: !!loadingReason, loadingReason, loadingComponent, hosts, content, bounds, motion: motion.length ? JSON.stringify(motion) : undefined, title: typeof title === 'string' ? title.slice(0, 80) : undefined, components: wholeApp ? [...components] : undefined, signature: JSON.stringify(signature) };
  }
  function observe() {
    // Recording only watches the app. Even watchdog cleanup must never reset
    // navigation after the user logs in, signs out, or finishes onboarding.
    observing = true;
    root = undefined;
    fibers(fiber => { const props = fiber.memoizedProps; if (hidden(props)) return false; navigation(props?.navigation); navigation(props?.value); if (root) return stopWalk; });
    const path = active(root?.getRootState?.() ?? root?.getState?.());
    const live = visible(), visual = visualSignature(undefined, true);
    const key = JSON.stringify([path, visual.components.sort(), visual.title]);
    const now = Date.now();
    if (!observation || observation.key !== key || observation.signature !== visual.signature || visual.loading || live.transitioning) {
      cancelWaits();
      const next = observation = { key, signature: visual.signature, since: now, painted: false };
      frame(() => frame(() => { if (observation === next) next.painted = true; }));
    }
    const ready = visual.found && visual.content > 0 && !visual.loading && !live.transitioning && observation.painted && now - observation.since >= 160 && now - transitionAt >= 32;
    const component = visual.components.find(name => /(?:Screen|Page|Form)$/.test(name) && !/^(?:Native|RN|Animated|Screen$)/.test(name));
    return { key, ready, active: path, title: visual.title ?? component, signature: visual.signature, loading: visual.loading };
  }
  // Links rendered inside an opened presentation, such as a feed's liked-by
  // link in its info sheet. The screen beneath keeps its own link evidence.
  function bodyLinks(focus) {
    const links=[],destinations=new Set();
    if(!focus)return links;
    safeBudget=2000;
    fibers(fiber=>{
      const props=fiber.memoizedProps;
      if(hidden(props))return false;
      const href=props?.href??props?.to;
      if(href&&links.length<100){
        safeBudget=120;const value=safe(href),key=JSON.stringify(value);
        if(value&&!destinations.has(key)){links.push(value);destinations.add(key);}
      }
    },focus);
    return links;
  }
  function presentationView(expectedRoute) {
    const start=Date.now(),probe=lastPresentationProbe={stage:'focus',focusMs:0,expectedMs:0,visualMs:0,visibleMs:0,motionMs:0,totalMs:0};
    let presentationProbe;
    if(presentations?.probeFocus){presentationProbe=presentations.probeFocus(presentationFocus,presentationExpected);presentationFocus=presentationProbe.focus;}
    else if(presentationFocus){let current;fibers(fiber=>{if(fiber===presentationFocus||fiber===presentationFocus.alternate)current=fiber;});presentationFocus=current;}
    const visualFocus=presentationProbe?.visualFocus??presentations?.visualFocus(presentationFocus)??presentationFocus;
    probe.focusMs=Date.now()-start;probe.stage='expected';let before=Date.now();
    // A portal's visual body can live outside its logical owner. Check the
    // expected component in the owner's connected roots, then inspect pixels
    // in the native body. A detached or missing body still cannot be ready.
    const expectedReady=presentationProbe?.expectedReady??(!presentationExpected||!!presentations?.focusFor(presentationExpected,presentationFocus));
    probe.expectedMs=Date.now()-before;probe.stage='visual';before=Date.now();
    // Share raw native bounds only within this synchronous readiness probe.
    // The next probe reads native geometry again, including UI-thread motion.
    const geometry = new WeakMap();
    const visual = visualSignature(undefined, true, visualFocus, geometry);
    probe.visualMs=Date.now()-before;probe.stage='visible';before=Date.now();
    const live = visible();
    probe.visibleMs=Date.now()-before;probe.stage='motion';before=Date.now();
    const componentTree = visual.components;
    const nativeMotion=presentationProbe?.motion(visual.bounds,geometry)??presentations?.motion(presentationFocus,visual.bounds,geometry);
    probe.motionMs=Date.now()-before;
    for(const [phase,ms]of [['self-focus',probe.focusMs],['self-visible',probe.visibleMs],['self-motion',probe.motionMs]])measure(phase,ms);
    if(nativeMotion){visual.signature+=nativeMotion.signature;visual.motion=JSON.stringify([visual.motion,nativeMotion.signature]);}
    const key = JSON.stringify([active(root?.getRootState?.() ?? root?.getState?.()), visual.components?.sort(), visual.title]),now=Date.now();
    const keyChanged=presentationObservation?.key!==key,signatureChanged=presentationObservation?.signature!==visual.signature;
    if (!presentationObservation || keyChanged || signatureChanged || visual.loading || live.transitioning || nativeMotion?.pending || !expectedReady) {
      const next = presentationObservation = { key, signature: visual.signature, since: now, painted: false };
      frame(() => frame(() => { if (presentationObservation === next) next.painted = true; }));
    }
    const missingInput=visual.found?presentations?.missingInputs?.():undefined;
    const reason=missingInput?'inputs':!expectedReady?'target':nativeMotion?.error?'preview-error':!visual.found?'missing':!visual.content?'empty':visual.loading?'loading':live.transitioning?'transition':nativeMotion?.pending?'native':!presentationObservation.painted?'paint':now-presentationObservation.since<160?'settling':undefined;
    Object.assign(probe,{stage:'done',totalMs:Date.now()-start,expectedReady,found:visual.found,hosts:visual.hosts,content:visual.content,loading:visual.loading,transitioning:live.transitioning,nativePending:!!nativeMotion?.pending,painted:presentationObservation.painted,quietMs:now-presentationObservation.since,keyChanged,signatureChanged,reason});
    const state=root?.getRootState?.()??root?.getState?.();
    const idle=reason?idleMs():undefined;
    return { ...visual, key, active: active(state), routeMatches:expectedRoute?.path?.length?matchesRoute(state,expectedRoute):undefined, ready: !reason, reason, ...live, ...(!reason&&presentationFocus?{bodyLinks:bodyLinks(visualFocus)}:{}), nativePending:nativeMotion?.pending, error:missingInput??nativeMotion?.error, ...(missingInput?{status:'needs-data'}:{}), ...(Number.isFinite(idle)?{idleMs:idle}:{}), components:componentTree };
  }
  function sameRouteParams(before,next,depth=0,budget={left:200}) {
    if(Object.is(before,next))return true;
    if(!before||!next||typeof before!=='object'||typeof next!=='object'||depth>6||--budget.left<0)return false;
    const array=Array.isArray(before);
    if(array!==Array.isArray(next)||!array&&(Object.getPrototypeOf(before)!==Object.prototype||Object.getPrototypeOf(next)!==Object.prototype))return false;
    const a=Object.getOwnPropertyDescriptors(before),b=Object.getOwnPropertyDescriptors(next),keys=Object.keys(a);
    if(keys.length>200||keys.length!==Object.keys(b).length)return false;
    return keys.every(key=>a[key]&&b[key]&&'value'in a[key]&&'value'in b[key]&&sameRouteParams(a[key].value,b[key].value,depth+1,budget));
  }
  function matchesRoute(state, target) {
    const path=active(state),normalize=value=>value.split('/').filter(part=>part&&part!=='index'&&!/^\(.+\)$/.test(part)).join('/');
    if(target.path?.length && !(target.expo?normalize(path.join('/'))===normalize(target.path[0]):JSON.stringify(path)===JSON.stringify(target.path)))return false;
    let leaf=state;while(leaf?.routes?.length){const next=leaf.routes[leaf.index??0];if(!next)return false;leaf=next.state??next;}
    return Object.entries(target.params??{}).every(([key,value])=>sameRouteParams(leaf?.params?.[key],value));
  }
  async function restore() {
    if (stopped) return;
    if (captureQueue) await captureQueue.stop();
    stopped = true; generation++; clearTimer(watchdog); cancelWaits();
    // Native sheets must dismiss before their parent modal unmounts. Dropping
    // both at once can leave UIKit showing a detached, blank presentation.
    try { if(presentations?.checkpoint())await presentations.rollback(0,true); }
    catch(error){stopped=false;renewLease();throw error;}
    try { if (errorHandler && errorUtils.getGlobalHandler() === errorHandler) errorUtils.setGlobalHandler(originalErrorHandler); } catch {}
    try{logBoxSubscription?.unsubscribe?.();}catch{}logBoxSubscription=undefined;logBoxVisible=false;logBoxRestore?.();logBoxRestore=undefined;
    presentations?.cleanup(); transitionMode?.restore(); unwatchActivity(); presentationFrames.length=0; presentationFocus=presentationObservation=presentationExpected=undefined;
    cancelWaits();
    try { if (!observing && root && original) root.dispatch({ type: 'RESET', payload: original }); } catch {}
    for (const record of transitions.values()) for (const off of record.off) { try { off(); } catch {} }
    transitions.clear();
    observed.clear(); visibleMetadata=undefined; root = original = observation = undefined;
    delete globalThis[key];
  }
  let watchdog;
  function renewLease() { clearTimer(watchdog); watchdog = setTimer(() => { void restore().catch(() => {}); }, Math.max(1, leaseMs)); }
  renewLease();
  globalThis[key] = {
      timers: {setTimeout: setTimer, clearTimeout: clearTimer},
      invoke(command, reply) {
      let replied = false;
      const callback = reply;
      const originalReply = value => { if (!replied) { replied = true; callback(value); } };
      const cleanup = ['restore', 'heartbeat', 'presentation-rollback', 'capture-stop'].includes(command.type);
      const failed = () => {
        if(cleanup||command.type==='diagnostics')return false;
        if(appFailed||logBoxVisible){originalReply({appFailed:true,...(appFailure?{detail:appFailure}:{})});return true;}
        const error=presentations?.nativeFailure?.();
        if(error){originalReply({nativeFailure:true,error});return true;}
        return false;
      };
      reply = value => { if (!failed()) originalReply(value); };
      try {
        if (command.type === 'restore') { void restore().then(() => reply({restored:true}),()=>reply({error:'App Flow restoration failed.'})); return; }
        if (stopped) { reply({ stopped:true, error: 'Capture stopped.' }); return; }
        renewLease();
        if (failed()) return;
        if (['open','capture-start','presentation-open'].includes(command.type) && !observing) { transitionMode?.enable(); watchActivity(); }
        if (command.type === 'heartbeat') { reply({ alive: true }); return; }
        if (command.type === 'cpu') { const fibers = presentations?.treeSize?.(); reply({ ms: cpuProbe(), ...(Number.isInteger(fibers) ? { fibers } : {}) }); return; }
        if (command.type === 'capture-inventory') { reply(globalThis.__MOBILE_DEV_FLOW_REGISTRY__?.inventory?.() ?? {unavailable:true}); return; }
        if (command.type === 'capture-start') {
          if(observing){reply({error:'Stop recording before starting a capture batch.'});return;}
          if (!captureQueueFactory || !captureDriverFactory) { reply({error:'Prepare the instrumented development build before starting a capture batch.'}); return; }
          if (captureQueue?.active) { reply({error:'A capture batch is already running.'}); return; }
          let queue;
          queue = captureQueueFactory(captureDriverFactory(globalThis[key], request => queue.request(request), (phase, ms) => queue.measure?.(phase, ms)), event => {
            // One bounded local summary per batch. No app content, identities or
            // per-frame logs; it survives inspector teardown for diagnosis.
            if(event.type==='done')try{console.info('[mobile-dev] App Flow capture work',JSON.stringify({execution,...queue.work,nativeFailure:presentations?.diagnostics?.().nativeFailure}));}catch{}
            const binding = globalThis[command.binding];
            if (typeof binding === 'function') binding(JSON.stringify({capture:event}));
          });
          captureQueue = queue;
          reply(captureQueue.start(command.batch, command.jobs, command.planning)); return;
        }
        if (command.type === 'capture-source') { reply(captureQueue?.source(command.batch, command.ticket, command.value) ?? {accepted:false}); return; }
        if (command.type === 'capture-ack') { reply(captureQueue?.ack(command.batch, command.ticket, command.value) ?? {accepted:false}); return; }
        if (command.type === 'capture-stop') { void captureQueue?.stop().then(() => reply({stopped:true}), () => reply({error:'Capture state could not be restored.'})); if(!captureQueue)reply({stopped:true}); return; }
        if (command.type === 'diagnostics') {
          let mountedFibers=0,mountedHosts=0;fibers(fiber=>{mountedFibers++;if(fiber.tag===5)mountedHosts++;});
          reply({execution,captureWork:captureQueue?.work,mountedFibers,mountedHosts,...navigationCounts(),...transitionMode?.diagnostics(),transitions:transitions.size,transitionsPending:[...transitions.values()].filter(record=>record.busy).length,waitTimers:waitTimers.size,paintFrames:paintFrames.size,lastProbe,lastOpenProbe,lastPresentationProbe,presentations:presentations?.diagnostics?.()});return;
        }
        if (command.type === 'context-data') { reply(contextData()); return; }
        if (command.type === 'observe') { reply(observe()); return; }
        if (observing) { reply({ error: 'Recording observes screens; navigation commands are disabled.' }); return; }
        if (command.type === 'presentation-collect') { if (!presentations) { reply({bindings:[]}); return; } void presentations.collect(command.states,command.actions,command.projectRoot,command.sourceHash,command.actionId??captureQueue?.preparingAction).then(reply, error => reply({error:'Presentation bindings could not be read.',detail:String(error?.message??error).slice(0,1000)})); return; }
        if (command.type === 'presentation-bindings') { reply(presentations?.records(command.offset ?? 0) ?? {bindings:[]}); return; }
        if (command.type === 'presentation-configure') { presentations?.configure(command.catalog, command.matches ?? [], command.checked ?? []); reply({}); return; }
        if (command.type === 'presentation-prepare') { reply(presentations?.prepare(command.id,presentationFocus,callerSite(command.instance)) ?? {error:'Presentation capture is unavailable.'}); return; }
        if (command.type === 'presentation-capture-open') {
          const prepared=presentations?.prepareCapture?.(command.id,presentationFocus,callerSite(command.instance));
          // Fallback happens before any opening. Once the operation starts,
          // return its result and let the normal view path resolve portals.
          if(!prepared?.available){reply({local:false});return;}
          const ticket=generation;
          const open=closed=>{
            if(stopped||ticket!==generation){reply({local:true,cancelled:true});return;}
            globalThis[key].invoke({type:'presentation-open',id:command.id,instance:callerSite(command.instance)},view=>reply({local:true,closed,view,
              ...(view?.error?{error:view.error,status:view.status==='needs-data'?'needs-data':'timed-out',...(typeof view.detail==='string'?{failure:{operation:'presentation-open',detail:view.detail.slice(0,300)}}:{})}:{})}));
          };
          if(prepared.handoff)globalThis[key].invoke({type:'presentation-handoff',id:command.id},result=>{
            if(result?.error)reply({local:true,error:result.error,status:'needs-data'});else open(!!result?.closed);
          });
          else open(false);
          return;
        }
        if (command.type === 'presentations') { reply(presentations?.list(presentationFocus) ?? []); return; }
        if (command.type === 'presentation-active') { reply(presentations?.activeViews(presentationFocus) ?? []); return; }
        if (command.type === 'presentation-sites') { reply(presentations?.openedSites() ?? []); return; }
        if (command.type === 'presentation-portals') {
          const methods=command.methods&&typeof command.methods==='object'?command.methods:{};
          const result=presentations?.previewPortals(command.ids??[],presentationFocus,methods);
          if(!result||result.error){reply(result??{error:'Temporary portal preview is unavailable.'});return;}
          presentationObservation=undefined;later(()=>{try{reply({...presentationView(),...result,portalBindings:presentations?.portalBindings(presentationFocus),effectBindings:presentations?.uiEffectBindings?.(presentationFocus)});}catch(error){reply({error:'Presentation inspection is unavailable.',detail:String(error?.message??error).slice(0,1000)});}},80);return;
        }
        if (command.type === 'presentation-effects') {
          const before=presentations?.checkpoint()??0;
          const result=presentations?.previewEffects?.(command.matches??[],presentationFocus);
          const after=presentations?.checkpoint()??before;
          for(let level=before;level<after;level++)presentationFrames.push({focus:presentationFocus,expected:presentationExpected});
          if(!result||result.error){reply(result??{error:'Temporary UI effects are unavailable.'});return;}
          presentationObservation=undefined;later(()=>{try{reply({...presentationView(),...result,portalBindings:presentations?.portalBindings(presentationFocus),effectBindings:presentations?.uiEffectBindings?.(presentationFocus)});}catch{reply({error:'Presentation inspection is unavailable.'});}},80);return;
        }
        if (command.type === 'presentation-view') {
          const deadline=Date.now()+Math.min(20000,Math.max(0,command.waitMs||0)),ticket=generation;
          const check=()=>{
            if(stopped||ticket!==generation){reply({error:'Presentation wait was cancelled.'});return;}
            try{
              const view={...presentationView(command),portalBindings:presentations?.portalBindings?.(presentationFocus),effectBindings:presentations?.uiEffectBindings?.(presentationFocus)};
              // Source approvals still happen on the server. Loading, native
              // motion and paint settle here without a CDP request per sample.
              if(view.ready||view.error||view.portalBindings?.length||view.effectBindings?.length||Date.now()>=deadline){reply(view);return;}
              later(check,view.loading?100:40,()=>reply({error:'Presentation wait was cancelled.'}));
            }catch(error){reply({error:'Presentation inspection is unavailable.',detail:String(error?.message??error).slice(0,1000)});}
          };
          check();return;
        }
        if (command.type === 'presentation-checkpoint') { reply({level:presentations?.checkpoint()??0}); return; }
        if (command.type === 'presentation-rollback') { generation++; cancelWaits(); const level=command.level??0; void (presentations?.rollback(level) ?? Promise.resolve()).then(() => {while(presentationFrames.length>level){const previous=presentationFrames.pop();presentationFocus=previous.focus;presentationExpected=previous.expected;}presentationObservation=undefined;reply({});}, error => reply({error:presentations?.nativeFailure?.()||'Presentation restoration failed.',nativeFailure:!!presentations?.nativeFailure?.(),detail:String(error?.message??error).slice(0,1000)})); return; }
        if (command.type === 'presentation-project') {
          const result=presentations?.project(presentationFocus);if(!result||result.error){reply(result??{error:'Presentation projection is unavailable.'});return;}
          presentationFrames.push({focus:presentationFocus,expected:presentationExpected});presentationObservation=undefined;later(()=>{try{reply(presentationView());}catch(error){reply({error:'Presentation inspection is unavailable.',detail:String(error?.message??error).slice(0,1000)});}},80);return;
        }
        if (command.type === 'presentation-handoff') {
          const ticket=generation;
          void (presentations?.handoff(command.id,presentationFocus,()=>stopped||ticket!==generation)??Promise.resolve({closed:false})).then(result=>{
            if(result.closed){presentationFocus=result.focus;presentationExpected=undefined;presentationObservation=undefined;}
            reply({closed:result.closed,error:result.error});
          },error=>reply({error:'Presentation handoff failed.',detail:String(error?.message??error).slice(0,1000)}));
          return;
        }
        if (command.type === 'presentation-open') {
          let before = presentations?.checkpoint() ?? 0;
          let result = presentations?.open(command.id,presentationFocus,undefined,callerSite(command.instance)) ?? { error: 'Presentation capture is unavailable.' };
          if (result.error) { reply(result); return; }
          let after = presentations?.checkpoint() ?? before;
          for(let level=before;level<after;level++)presentationFrames.push({focus:presentationFocus,expected:presentationExpected});
          presentationExpected=result.expected; presentationObservation = undefined;
          const started=Date.now(),ticket=generation;
          const cancelled=()=>reply({cancelled:true,error:'Presentation opening was interrupted.'});
          const mounted=()=>{
            if(stopped||ticket!==generation){cancelled();return;}
            try {
              if(result.advance){
                if(Date.now()-started>=1200){reply({error:'The form choices did not finish rendering.'});return;}
                const next=result.advance();
                if(next.pending){later(mounted,16,cancelled);return;}
                if(next.error){reply(next);return;}
                before=after;const current=presentations?.checkpoint()??before;
                // A level restores the focus that was active before it. The
                // first level of a form keeps the focus before the form opened.
                for(let level=before;level<current;level++)presentationFrames.push({focus:presentationFrames.length?result.focus??presentationFocus:presentationFocus,expected:presentationExpected});
                after=current;result=next;presentationExpected=result.expected;
                later(mounted,0,cancelled);return;
              }
              presentationFocus=result.focus??presentations?.focusFor(result.name,result.scope);
              if(!presentationFocus){
                if(Date.now()-started>=1200){reply({error:'The presentation target did not mount.'});return;}
                later(mounted,32,cancelled);return;
              }
              presentations?.focused(presentationFocus);
              reply({...presentationView(),portalBindings:presentations?.portalBindings(presentationFocus),effectBindings:presentations?.uiEffectBindings?.(presentationFocus)});
            } catch(error){reply({error:'Presentation inspection is unavailable.',detail:String(error?.message??error).slice(0,1000)});}
          };
          // A retained projection has an exact owner before its copy commits.
          // Readiness follows that copy and its native onShow; no fixed sleep.
          later(mounted,0,cancelled);
          return;
        }
        if (command.type === 'resume') {
          cancelWaits(); generation++;
          const saved = original;
          root = undefined;
          const info = inspect();
          original = saved ?? original;
          reply(info); return;
        }
        if (command.type === 'inspect') { reply(inspect()); return; }
        if (['open','recover'].includes(command.type)&&presentations?.checkpoint()) { reply({error:'Restore presentations before changing navigation.'});return; }
        if (!navigatorState()?.routeNames?.length) inspect();
        if (command.type === 'recover') {
          cancelWaits();
          const ticket = ++generation, started = Date.now();
          refreshNavigation();
          // The next open replaces the current leaf and checks its content.
          // Returning to the starting feed here mounts and measures it again,
          // even when the connection and current navigator are healthy.
          let previous, painted=false, painting=false, paintTicket=0, finished=false;
          const complete=value=>{if(finished)return;finished=true;cancelWaits();reply(value);};
          const check = () => {
            if (ticket !== generation || stopped) return;
            try {
              const state=navigatorState(),path=JSON.stringify(active(state)),live=visible();
              if(path!==previous||live.transitioning){paintTicket++;painted=painting=false;}
              previous=path;
              if(state?.routeNames?.length&&!live.transitioning&&Date.now()-transitionAt>=32){
                if(painted){complete({recovered:true});return;}
                if(!painting){painting=true;const paint=++paintTicket;frame(()=>frame(()=>{if(paint===paintTicket)painted=true;}));}
              }
              if(Date.now()-started>=1200){complete({recovered:false,reason:'Navigation has not settled.'});return;}
              later(check,40,()=>complete({recovered:false,reason:'Navigation recovery was cancelled.'}));
            } catch { complete({ recovered: false }); }
          };
          check(); return;
        }
        if (command.type === 'verify') { const state=root?.getRootState?.() ?? root?.getState?.(); reply({ active: active(state), routeMatches:matchesRoute(state,command), ...visualSignature(command.name), ...visible() }); return; }
        if(command.type==='open')refreshNavigation();
        if (command.type === 'open' && !navigatorState()?.routeNames?.length) { reply({ready: false, reason: 'The navigator is remounting. This screen will be retried.'}); return; }
        if (command.type !== 'open' || !root) { reply({ error: 'No mounted navigator found. Use Record a flow for screens outside navigation.' }); return; }
        cancelWaits();
        // A route opening with no presentation open starts a new base. A focus
        // left from an earlier presentation would scope later openings to it.
        if(!command.settleOnly&&!presentationFrames.length&&!(presentations?.checkpoint()>0)){presentationFocus=presentationExpected=presentationObservation=undefined;}
        const ticket = ++generation, path = command.path;
        let expected = path[path.length - 1];
        if(command.settleOnly){
          if(!matchesRoute(navigatorState(),command)){reply({ready:false,redirected:true,reason:'The screen changed during capture.'});return;}
        } else if (command.expo) {
          const router = expoRouter();
          if (!router) { reply({ error: 'Expo Router is not exposed by this development runtime.' }); return; }
          router.replace({ pathname: path[0], params: command.params ?? {} });
          expected = undefined;
        } else {
          const current = root.getRootState?.() ?? root.getState();
          if (!current.routeNames?.includes(path[0])) { reply({ error: 'This route is not registered in the active navigator.' }); return; }
          // Let each router create its own route keys and native screen state.
          // Replacing only the focused stack leaf bounds the number of mounted screens.
          let leaf = current;
          for (let index = 0; index < path.length - 1; index++) {
            const route = leaf?.routes?.[leaf.index ?? 0];
            if (route?.name !== path[index]) { leaf = undefined; break; }
            leaf = route.state;
          }
          visible();
          const selected = leaf?.routes?.[leaf.index ?? 0];
          if (leaf?.type === 'stack' && leaf.key && leaf.routeNames?.includes(expected)) {
            if (selected?.name !== expected || command.params && !sameRouteParams(selected.params??{},command.params)) (navigationFor(leaf.key)??root).dispatch({ type: 'REPLACE', target: leaf.key, payload: { name: expected, params: command.params } });
          } else {
            let params = command.params ?? {};
            for (let index = path.length - 1; index > 0; index--) params = { screen: path[index], params, initial: false };
            root.dispatch({ type: 'NAVIGATE', payload: { name: path[0], params } });
          }
        }
        const started = Date.now();
        let previous, quietSince = started, watched = false, sawLoading = false, loadingMs = 0, sampledAt = started, wasLoading = false;
        let paintTicket = 0, painting = false, painted = false, settleUntil;
        let finished = false;
        const complete = value => { if (finished) return; finished = true; cancelWaits(); reply(value); };
        const cancelled = () => complete({cancelled:true, ready:false, reason:'Navigation was interrupted.'});
        function check() {
          try {
          if (ticket !== generation || stopped) { cancelled(); return; }
          if (appFailed) { complete({appFailed:true}); return; }
          const state = root.getRootState?.() ?? root.getState();
          const actual = active(state), name = expected ?? actual[actual.length - 1];
          const visual = visualSignature(name);
          const normalizePath = value => value.split('/').filter(part => part && part !== 'index' && !/^\(.+\)$/.test(part)).join('/');
          let leaf = state; while (leaf?.routes?.length) { const route = leaf.routes[leaf.index ?? 0]; if (!route) { leaf = undefined; break; } if (!route.state) { leaf = route; break; } leaf = route.state; }
          const paramsMatch = Object.entries(command.params ?? {}).every(([name, value]) => JSON.stringify(leaf?.params?.[name]) === JSON.stringify(value));
          const routeMatches = command.expo ? normalizePath(actual.join('/')) === normalizePath(path[0]) : path.every((part, index) => actual[index] === part) && actual.length === path.length;
          const matches = routeMatches && paramsMatch;
          const now = Date.now();
          if (wasLoading) loadingMs += now - sampledAt;
          sampledAt = now; wasLoading = visual.loading; sawLoading ||= visual.loading;
          if (!matches || !visual.found || !visual.hosts || visual.loading || visual.signature !== previous) { quietSince = now; painted = false; painting = false; paintTicket++; }
          previous = visual.signature;
          if (matches && visual.found && !watched) { visible(); watched = true; }
          // A native reset can unmount a busy navigator before transitionEnd.
          // Refresh subscriptions while busy so detached listeners cannot hold
          // readiness forever; mounted transitions must still finish.
          if ([...transitions.values()].some(record => record.busy)) visible();
          const transitioning = [...transitions.values()].some(record => record.busy);
          if (transitioning) { quietSince = now; painted = false; painting = false; paintTicket++; }
          lastOpenProbe={elapsedMs:now-started,quietMs:now-quietSince,matches,found:visual.found,content:visual.content,loading:visual.loading,loadingReason:visual.loadingReason,transitioning,painted};
          if (now - quietSince >= 80 && visual.content && !transitioning && now - transitionAt >= 32) {
            if (painted) { complete({ ready: true, active: actual, name, signature: previous, motion: visual.motion, readinessMs: now - started, loadingMs, ...visible() }); return; }
            if (!painting) {
              painting = true; const commit = ++paintTicket;
              frame(() => { if (ticket === generation && !stopped && commit === paintTicket) frame(() => { if (commit === paintTicket) painted = true; }); });
            }
          }
          const deadline = sawLoading ? Math.max(command.timeoutMs, command.loadingTimeoutMs ?? command.timeoutMs) : command.timeoutMs;
          if (now - started >= deadline) {
            // A loaded screen can reach the short deadline just as its paint
            // check starts. Finish that check in place instead of reopening the
            // route on another attempt. Unfinished loading/motion never passes,
            // and changing content cannot extend this bounded grace repeatedly.
            const settling=!sawLoading&&matches&&visual.found&&visual.content&&!transitioning;
            if(settling&&settleUntil===undefined)settleUntil=now+500;
            if(!settling||now>=settleUntil){complete({ ready: false, active: actual, redirected: !routeMatches && visualSignature(actual[actual.length - 1]).found, reason: !matches ? 'Navigation redirected or the target did not mount.' : visual.loading ? `Screen is still loading (${visual.loadingReason}${visual.loadingComponent ? ` in ${visual.loadingComponent}` : ''}).` : transitioning ? 'Native transition did not finish.' : !visual.content ? 'Screen has no visible content yet.' : 'Screen did not settle in time.', readinessMs: now - started, loadingMs, ...visible() }); return;}
          }
          later(check, painting ? 16 : visual.loading ? 100 : 40, cancelled);
          } catch { complete({ ready: false, reason: 'The screen detached while opening. It will be retried.' }); }
        }
        later(check, 0, cancelled);
      } catch (error) { reply({ error: String(error?.message ?? 'Runtime navigation failed.').slice(0, 300) }); }
    },
  };
}
