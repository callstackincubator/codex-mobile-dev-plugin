// Injected into a development runtime through one CDP connection. No app-specific code.
export function installFlowRuntime(key, leaseMs, presentationFactory) {
  if (globalThis[key]) return;
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  // Expo's native developer menu can cover every captured screen while JS keeps running.
  try { globalThis.expo?.modules?.ExpoDevMenu?.hideMenu?.()?.catch?.(() => {}); } catch {}
  let root, original, observation, observing = false, stopped = false, generation = 0, safeBudget = 2000;
  // Preserve RN's error handler. A live navigator behind LogBox is not a
  // capturable screen, even when its React tree has finished rendering.
  let appFailed = false, errorUtils, originalErrorHandler, errorHandler;
  try {
    errorUtils = globalThis.ErrorUtils;
    if (typeof errorUtils?.getGlobalHandler === 'function' && typeof errorUtils?.setGlobalHandler === 'function') {
      originalErrorHandler = errorUtils.getGlobalHandler();
      if (typeof originalErrorHandler === 'function') {
        errorHandler = function(error, fatal) {
          if (fatal) appFailed = true;
          return originalErrorHandler.apply(this, arguments);
        };
        errorUtils.setGlobalHandler(errorHandler);
      }
    }
  } catch { /* Not every development runtime exposes RN ErrorUtils. */ }
  let logBoxSubscription, logBoxVisible = false;
  function observeLogBox() {
    if(logBoxSubscription)return;
    // Read only RN's initialized framework store. Do not initialize an app
    // module, suppress errors, or send log content through the capture bridge.
    for(const module of globalThis.__r?.getModules?.()?.values?.()??[]){
      if(!module.isInitialized||typeof module.verboseName!=='string'||!/(?:^|\/)react-native\/Libraries\/LogBox\/Data\/LogBoxData\.js$/.test(module.verboseName.replaceAll('\\','/')))continue;
      const exports=module.publicModule?.exports,descriptor=exports&&Object.getOwnPropertyDescriptor(exports,'observe');
      if(typeof descriptor?.value!=='function')continue;
      try{logBoxSubscription=descriptor.value(state=>{logBoxVisible=state?.isDisabled!==true&&Number.isInteger(state?.selectedLogIndex)&&state.selectedLogIndex>=0;});}catch{}
      break;
    }
  }
  observeLogBox();
  const observed = new Map();
  const transitions = new Map();
  const waitTimers = new Set(), paintFrames = new Set();
  const cancelledWaits = new Map();
  const later = (callback, ms, onCancel) => {
    const timer = setTimeout(() => { waitTimers.delete(timer); cancelledWaits.delete(timer); callback(); }, ms);
    if(onCancel)cancelledWaits.set(timer,onCancel);
    waitTimers.add(timer); return timer;
  };
  const frame = callback => {
    if (typeof globalThis.requestAnimationFrame !== 'function') return later(callback, 16);
    const id = globalThis.requestAnimationFrame(() => { paintFrames.delete(id); callback(); });
    paintFrames.add(id); return id;
  };
  const cancelWaits = () => {
    for (const timer of waitTimers) clearTimeout(timer);
    for (const id of paintFrames) globalThis.cancelAnimationFrame?.(id);
    waitTimers.clear(); paintFrames.clear();
    for(const resolve of cancelledWaits.values())resolve();cancelledWaits.clear();
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
  const presentations = presentationFactory?.({ hook, fibers, hidden: props => hidden(props), later });
  let presentationFocus, presentationObservation, presentationExpected, lastProbe, lastPresentationProbe;
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
  function visible() {
    const links = [], components = new Set(), destinations = new Set(), live = new Set();
    safeBudget = 2000;
    fibers(fiber => {
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
    });
    for (const [nav, record] of transitions) if (!live.has(nav)) {
      for (const off of record.off) { try { off(); } catch {} }
      transitions.delete(nav);
    }
    return { links, components: [...components], transitioning: [...transitions.values()].some(record => record.busy) };
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
  function visualSignature(name, wholeApp = false, focus) {
    let hosts = 0, content = 0, screen = focus, loadingReason, bounds, title;
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
        if(typeof native?.getBoundingClientRect==='function'){
          probe.layoutReads++;const before=Date.now();
          try{value=native.getBoundingClientRect();}finally{probe.layoutMs+=Date.now()-before;}
        }
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
      const { box, host } = rect(fiber, includeTransparent);
      if (!host) return false;
      if (!bounds) return true;
      // Offscreen list footers and preloaded tabs must not delay this preview.
      return !box || box.x < bounds.x + bounds.width && box.x + box.width > bounds.x && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y;
    };
    const pendingData = value => {
      if (!value || typeof value !== 'object') return false;
      try {
        // Query observers belong to the component's hooks, so background queries
        // elsewhere in the app do not block the focused screen.
        if (typeof value.getCurrentResult === 'function' && typeof value.getCurrentQuery === 'function') value = value.getCurrentResult();
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
        if (!disabled && /Skeleton|Shimmer|LoadingPlaceholder|LoadingIndicator|LoadingSpinner|LoadingView|LoadingScreen|ActivityIndicator|Spinner|^Loader$/.test(component)) reason = 'skeleton';
        else if (props.accessibilityState?.busy === true || props['aria-busy'] === true || props.isLoading === true || props.loading === true || props.animating === true || (props.accessibilityRole === 'progressbar' || props.role === 'progressbar') && !disabled) reason = 'busy';
        else if (fiber.tag === 13 && fiber.memoizedState !== null && fiber.memoizedState !== undefined) reason = 'suspense';
        else {
          let hook = fiber.memoizedState, count = 0;
          while (hook && count++ < 40) {
            if (pendingData(hook.memoizedState)) { reason = 'data'; break; }
            hook = hook.next;
          }
        }
        if (reason && visibleLoader(fiber)) loadingReason = reason;
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
    if (motion.length) signature.push(['opacity', motion]);
    return { found: wholeApp ? hosts > 0 : !!screen, loading: !!loadingReason, loadingReason, hosts, content, bounds, motion: motion.length ? JSON.stringify(motion) : undefined, title: typeof title === 'string' ? title.slice(0, 80) : undefined, components: wholeApp ? [...components] : undefined, signature: JSON.stringify(signature) };
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
  function presentationView() {
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
    const visual = visualSignature(undefined, true, visualFocus);
    probe.visualMs=Date.now()-before;probe.stage='visible';before=Date.now();
    const live = visible();
    probe.visibleMs=Date.now()-before;probe.stage='motion';before=Date.now();
    const componentTree = visual.components;
    const nativeMotion=presentationProbe?.motion(visual.bounds)??presentations?.motion(presentationFocus,visual.bounds);
    probe.motionMs=Date.now()-before;
    if(nativeMotion){visual.signature+=nativeMotion.signature;visual.motion=JSON.stringify([visual.motion,nativeMotion.signature]);}
    const key = JSON.stringify([active(root?.getRootState?.() ?? root?.getState?.()), visual.components?.sort(), visual.title]),now=Date.now();
    const keyChanged=presentationObservation?.key!==key,signatureChanged=presentationObservation?.signature!==visual.signature;
    if (!presentationObservation || keyChanged || signatureChanged || visual.loading || live.transitioning || nativeMotion?.pending || !expectedReady) {
      const next = presentationObservation = { key, signature: visual.signature, since: now, painted: false };
      frame(() => frame(() => { if (presentationObservation === next) next.painted = true; }));
    }
    const reason=!expectedReady?'target':nativeMotion?.error?'preview-error':!visual.found?'missing':!visual.content?'empty':visual.loading?'loading':live.transitioning?'transition':nativeMotion?.pending?'native':!presentationObservation.painted?'paint':now-presentationObservation.since<160?'settling':undefined;
    Object.assign(probe,{stage:'done',totalMs:Date.now()-start,expectedReady,found:visual.found,hosts:visual.hosts,content:visual.content,loading:visual.loading,transitioning:live.transitioning,nativePending:!!nativeMotion?.pending,painted:presentationObservation.painted,quietMs:now-presentationObservation.since,keyChanged,signatureChanged,reason});
    return { ...visual, key, active: active(root?.getRootState?.() ?? root?.getState?.()), ready: !reason, reason, ...live, nativePending:nativeMotion?.pending, error:nativeMotion?.error, components:componentTree };
  }
  function returnToStart() {
    const path = active(original);
    let leaf = original;
    while (leaf?.routes?.length) { const route = leaf.routes[leaf.index ?? 0]; if (!route?.state) { leaf = route; break; } leaf = route.state; }
    let params = leaf?.params ?? {};
    for (let index = path.length - 1; index > 0; index--) params = { screen: path[index], params, initial: false };
    if (path.length) root.dispatch({ type: 'NAVIGATE', payload: { name: path[0], params } });
  }
  async function restore() {
    if (stopped) return;
    stopped = true; generation++; clearTimeout(watchdog); cancelWaits();
    // Native sheets must dismiss before their parent modal unmounts. Dropping
    // both at once can leave UIKit showing a detached, blank presentation.
    try { if(presentations?.checkpoint())await presentations.rollback(0,true); }
    catch(error){stopped=false;renewLease();throw error;}
    try { if (errorHandler && errorUtils.getGlobalHandler() === errorHandler) errorUtils.setGlobalHandler(originalErrorHandler); } catch {}
    try{logBoxSubscription?.unsubscribe?.();}catch{}logBoxSubscription=undefined;logBoxVisible=false;
    presentations?.cleanup(); presentationFrames.length=0; presentationFocus=presentationObservation=presentationExpected=undefined;
    cancelWaits();
    try { if (!observing && root && original) root.dispatch({ type: 'RESET', payload: original }); } catch {}
    for (const record of transitions.values()) for (const off of record.off) { try { off(); } catch {} }
    transitions.clear();
    observed.clear(); root = original = observation = undefined;
    delete globalThis[key];
  }
  let watchdog;
  function renewLease() { clearTimeout(watchdog); watchdog = setTimeout(() => { void restore().catch(() => {}); }, Math.max(1, leaseMs)); }
  renewLease();
  globalThis[key] = {
      invoke(command, reply) {
      const originalReply = reply;
      const cleanup = ['restore', 'heartbeat', 'presentation-rollback'].includes(command.type);
      const failed = () => { if ((!appFailed&&!logBoxVisible) || cleanup) return false; originalReply({appFailed:true}); return true; };
      reply = value => { if (!failed()) originalReply(value); };
      try {
        if (command.type === 'restore') { void restore().then(() => reply({restored:true}),()=>reply({error:'App Flow restoration failed.'})); return; }
        if (stopped) { reply({ error: 'Capture stopped.' }); return; }
        renewLease();
        if (failed()) return;
        if (command.type === 'heartbeat') { reply({ alive: true }); return; }
        if (command.type === 'diagnostics') {
          let mountedFibers=0,mountedHosts=0;fibers(fiber=>{mountedFibers++;if(fiber.tag===5)mountedHosts++;});
          reply({mountedFibers,mountedHosts,...navigationCounts(),transitions:transitions.size,transitionsPending:[...transitions.values()].filter(record=>record.busy).length,waitTimers:waitTimers.size,paintFrames:paintFrames.size,lastProbe,lastPresentationProbe,presentations:presentations?.diagnostics?.()});return;
        }
        if (command.type === 'context-data') { reply(contextData()); return; }
        if (command.type === 'observe') { reply(observe()); return; }
        if (observing) { reply({ error: 'Recording observes screens; navigation commands are disabled.' }); return; }
        if (command.type === 'presentation-collect') { if (!presentations) { reply({bindings:[]}); return; } void presentations.collect(command.states,command.actions,command.projectRoot).then(reply, error => reply({error:'Presentation bindings could not be read.',detail:String(error?.message??error).slice(0,1000)})); return; }
        if (command.type === 'presentation-bindings') { reply(presentations?.records(command.offset ?? 0) ?? {bindings:[]}); return; }
        if (command.type === 'presentation-configure') { presentations?.configure(command.catalog, command.matches ?? [], command.checked ?? []); reply({}); return; }
        if (command.type === 'presentations') { reply(presentations?.list(presentationFocus) ?? []); return; }
        if (command.type === 'presentation-active') { reply(presentations?.activeViews(presentationFocus) ?? []); return; }
        if (command.type === 'presentation-portals') {
          const result=presentations?.previewPortals(command.ids??[],presentationFocus);
          if(!result||result.error){reply(result??{error:'Temporary portal preview is unavailable.'});return;}
          presentationObservation=undefined;later(()=>{try{reply({...presentationView(),...result,portalBindings:presentations?.portalBindings(presentationFocus)});}catch(error){reply({error:'Presentation inspection is unavailable.',detail:String(error?.message??error).slice(0,1000)});}},80);return;
        }
        if (command.type === 'presentation-view') { reply(presentationView()); return; }
        if (command.type === 'presentation-checkpoint') { reply({level:presentations?.checkpoint()??0}); return; }
        if (command.type === 'presentation-rollback') { const level=command.level??0; void (presentations?.rollback(level) ?? Promise.resolve()).then(() => {while(presentationFrames.length>level){const previous=presentationFrames.pop();presentationFocus=previous.focus;presentationExpected=previous.expected;}presentationObservation=undefined;reply({});}, error => reply({error:'Presentation restoration failed.',detail:String(error?.message??error).slice(0,1000)})); return; }
        if (command.type === 'presentation-project') {
          const result=presentations?.project(presentationFocus);if(!result||result.error){reply(result??{error:'Presentation projection is unavailable.'});return;}
          presentationFrames.push({focus:presentationFocus,expected:presentationExpected});presentationObservation=undefined;later(()=>{try{reply(presentationView());}catch(error){reply({error:'Presentation inspection is unavailable.',detail:String(error?.message??error).slice(0,1000)});}},80);return;
        }
        if (command.type === 'presentation-open') {
          const result = presentations?.open(command.id,presentationFocus) ?? { error: 'Presentation capture is unavailable.' };
          if (result.error) { reply(result); return; }
          presentationFrames.push({focus:presentationFocus,expected:presentationExpected});presentationExpected=result.expected; presentationObservation = undefined;
          later(() => {
            try {
              presentationFocus = result.focus;
              if (!presentationFocus) presentationFocus=presentations?.focusFor(result.name,result.scope);
              if (!presentationFocus) { reply({ error: 'The presentation target did not mount.' }); return; }
              presentations?.focused(presentationFocus); reply({...presentationView(),portalBindings:presentations?.portalBindings(presentationFocus)});
            } catch(error) { reply({error:'Presentation inspection is unavailable.',detail:String(error?.message??error).slice(0,1000)}); }
          }, 80);
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
          const ticket = ++generation, started = Date.now(), path = active(original);
          returnToStart();
          // Wait for recovery to finish before dispatching another native transition.
          const check = () => {
            if (ticket !== generation || stopped) return;
            try {
              const actual = active(root.getRootState?.() ?? root.getState());
              const visual = visualSignature(path[path.length - 1]);
              if ((Date.now() - started >= 240 && JSON.stringify(actual) === JSON.stringify(path) && visual.found && visual.content && !visual.loading) || Date.now() - started >= 1200) {
                reply({ recovered: JSON.stringify(actual) === JSON.stringify(path) }); return;
              }
              later(check, 80);
            } catch { reply({ recovered: false }); }
          };
          later(check, 80); return;
        }
        if (command.type === 'verify') { reply({ active: active(root?.getRootState?.() ?? root?.getState?.()), ...visualSignature(command.name), ...visible() }); return; }
        if(command.type==='open')refreshNavigation();
        if (command.type === 'open' && !navigatorState()?.routeNames?.length) { reply({ready: false, reason: 'The navigator is remounting. This screen will be retried.'}); return; }
        if (command.type !== 'open' || !root) { reply({ error: 'No mounted navigator found. Use Record a flow for screens outside navigation.' }); return; }
        cancelWaits();
        const ticket = ++generation, path = command.path;
        let expected = path[path.length - 1];
        if (command.expo) {
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
            if (selected?.name !== expected || command.params) (navigationFor(leaf.key)??root).dispatch({ type: 'REPLACE', target: leaf.key, payload: { name: expected, params: command.params } });
          } else {
            let params = command.params ?? {};
            for (let index = path.length - 1; index > 0; index--) params = { screen: path[index], params, initial: false };
            root.dispatch({ type: 'NAVIGATE', payload: { name: path[0], params } });
          }
        }
        const started = Date.now();
        let previous, quietSince = started, watched = false, sawLoading = false, loadingMs = 0, sampledAt = started, wasLoading = false;
        let paintTicket = 0, painting = false, painted = false;
        const complete = value => { cancelWaits(); reply(value); };
        function check() {
          try {
          if (ticket !== generation || stopped) return;
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
          if (now - quietSince >= 80 && visual.content && !transitioning && now - transitionAt >= 32) {
            if (painted) { complete({ ready: true, active: actual, name, signature: previous, motion: visual.motion, readinessMs: now - started, loadingMs, ...visible() }); return; }
            if (!painting) {
              painting = true; const commit = ++paintTicket;
              frame(() => { if (ticket === generation && !stopped && commit === paintTicket) frame(() => { if (commit === paintTicket) painted = true; }); });
            }
          }
          const deadline = sawLoading ? Math.max(command.timeoutMs, command.loadingTimeoutMs ?? command.timeoutMs) : command.timeoutMs;
          if (now - started >= deadline) { complete({ ready: false, active: actual, redirected: !routeMatches && visualSignature(actual[actual.length - 1]).found, reason: !matches ? 'Navigation redirected or the target did not mount.' : visual.loading ? `Screen is still loading (${visual.loadingReason}).` : transitioning ? 'Native transition did not finish.' : !visual.content ? 'Screen has no visible content yet.' : 'Screen did not settle in time.', readinessMs: now - started, loadingMs, ...visible() }); return; }
          later(check, painting ? 16 : visual.loading ? 100 : 40);
          } catch { complete({ ready: false, reason: 'The screen detached while opening. It will be retried.' }); }
        }
        later(check, 0);
      } catch (error) { reply({ error: String(error?.message ?? 'Runtime navigation failed.').slice(0, 300) }); }
    },
  };
}
