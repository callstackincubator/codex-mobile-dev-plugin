// Injected into a development runtime through one CDP connection. No app-specific code.
export function installFlowRuntime(key, leaseMs) {
  if (globalThis[key]) return;
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  // Expo's native developer menu can cover every captured screen while JS keeps running.
  try { globalThis.expo?.modules?.ExpoDevMenu?.hideMenu?.()?.catch?.(() => {}); } catch {}
  let root, original, stopped = false, generation = 0, safeBudget = 2000;
  const observed = new Map();
  const transitions = new Map();
  let transitionAt = 0;
  const sensitive = /token|password|secret|authorization|cookie|^(__proto__|constructor|prototype)$/i;
  function safe(value, depth = 0) {
    if (depth > 8 || --safeBudget < 0) return undefined;
    if (typeof value === 'string') return value.length <= 256 && !/^(Bearer |eyJ[A-Za-z0-9_-]+\.)/.test(value) ? value : undefined;
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 12).map(item => safe(item, depth + 1));
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
  function remember(name, params) {
    if (typeof name !== 'string' || !params || typeof params !== 'object' || observed.size >= 200) return;
    const value = safe(params);
    if (!Object.keys(value || {}).length) return;
    observed.set(JSON.stringify([name, value]), { name, params: value });
  }
  function fibers(callback, subtree) {
    if (!hook?.renderers || typeof hook.getFiberRoots !== 'function') return;
    const stack = [];
    if (subtree) stack.push(subtree);
    else for (const [id, renderer] of hook.renderers) {
      if (renderer.rendererPackageName !== 'react-native-renderer') continue;
      for (const item of hook.getFiberRoots(id)) stack.push(item.current);
    }
    let count = 0;
    while (stack.length && count++ < 16000) {
      const fiber = stack.pop(); if (!fiber) continue;
      if (fiber !== subtree && fiber.sibling) stack.push(fiber.sibling);
      const descend = callback(fiber) !== false;
      if (descend && fiber.child) stack.push(fiber.child);
    }
  }
  function navigation(value) {
    if (!value || typeof value !== 'object' || typeof value.getState !== 'function' || typeof value.dispatch !== 'function') return;
    try {
      let nav = value;
      const visited = new Set();
      while (typeof nav.getParent === 'function' && !visited.has(nav)) {
        visited.add(nav);
        const parent = nav.getParent(); if (!parent) break; nav = parent;
      }
      if (nav.getState()?.routeNames?.length && !root) { root = nav; original = nav.getRootState?.() ?? nav.getState(); }
    } catch { /* Detached navigation objects are ignored. */ }
  }
  const hidden = props => props?.hidden === true || props?.activityState === 0 || props?.route && props.navigation?.isFocused && !props.navigation.isFocused();
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
    safeBudget = 2000;
    const mounted = [], registrations = [], entries = [], data = [], seen = new Set(), clients = new Set();
    fibers(fiber => {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== 'object') return;
      navigation(props.navigation); navigation(props.value);
      const client = props.client;
      if (client && typeof client.getQueryCache === 'function' && !clients.has(client) && data.length < 40) {
        clients.add(client);
        try {
          for (const query of client.getQueryCache().getAll().slice(0, 40)) {
            if (data.length >= 40) break;
            const value = safe(query.state?.data);
            if (value) data.push({ query: safe(query.queryKey), value });
          }
        } catch { /* Optional query caches may be unavailable. */ }
      }
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
  function visualSignature(name) {
    let hosts = 0, content = 0, loading = false, screen;
    const signature = [];
    fibers(fiber => {
      const props = fiber.memoizedProps;
      if (hidden(props)) return false;
      if (!screen && props?.route?.name === name && props.navigation?.isFocused?.()) { screen = fiber; return false; }
    });
    if (screen) fibers(fiber => {
      const props = fiber.memoizedProps;
      if (hidden(props)) return false;
      if (fiber.tag !== 5 || !props) return;
      if (props.accessibilityRole === 'progressbar' || props.role === 'progressbar' || props.animating === true) loading = true;
      hosts++;
      const text = typeof props.children === 'string' ? props.children.slice(0, 100) : '';
      if (text || props.source || props.src || props.accessibilityLabel) content++;
      if (signature.length < 250) signature.push([typeof fiber.type === 'string' ? fiber.type : '', text, !!props.source]);
    }, screen);
    return { found: !!screen, loading, hosts, content, signature: JSON.stringify(signature) };
  }
  function returnToStart() {
    const path = active(original);
    let leaf = original;
    while (leaf?.routes?.length) { const route = leaf.routes[leaf.index ?? 0]; if (!route?.state) { leaf = route; break; } leaf = route.state; }
    let params = leaf?.params ?? {};
    for (let index = path.length - 1; index > 0; index--) params = { screen: path[index], params, initial: false };
    if (path.length) root.dispatch({ type: 'NAVIGATE', payload: { name: path[0], params } });
  }
  function restore() {
    if (stopped) return;
    stopped = true; generation++; clearTimeout(watchdog);
    try { if (root && original) root.dispatch({ type: 'RESET', payload: original }); } catch {}
    for (const record of transitions.values()) for (const off of record.off) { try { off(); } catch {} }
    transitions.clear();
    delete globalThis[key];
  }
  let watchdog;
  function renewLease() { clearTimeout(watchdog); watchdog = setTimeout(restore, Math.max(1, leaseMs)); }
  renewLease();
  globalThis[key] = {
    invoke(command, reply) {
      try {
        if (command.type === 'restore') { restore(); reply({ restored: true }); return; }
        if (stopped) { reply({ error: 'Capture stopped.' }); return; }
        renewLease();
        if (command.type === 'heartbeat') { reply({ alive: true }); return; }
        if (command.type === 'inspect') { reply(inspect()); return; }
        if (!root) inspect();
        if (command.type === 'recover') {
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
              setTimeout(check, 80);
            } catch { reply({ recovered: false }); }
          };
          setTimeout(check, 80); return;
        }
        if (command.type === 'verify') { reply({ active: active(root?.getRootState?.() ?? root?.getState?.()), ...visualSignature(command.name), ...visible() }); return; }
        if (command.type !== 'open' || !root) { reply({ error: 'No mounted React Navigation container found. Open the app and log in first.' }); return; }
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
            if (selected?.name !== expected || command.params) root.dispatch({ type: 'REPLACE', target: leaf.key, payload: { name: expected, params: command.params } });
          } else {
            let params = command.params ?? {};
            for (let index = path.length - 1; index > 0; index--) params = { screen: path[index], params, initial: false };
            root.dispatch({ type: 'NAVIGATE', payload: { name: path[0], params } });
          }
        }
        const started = Date.now(); let previous, stable = 0, watched = false;
        function check() {
          try {
          if (ticket !== generation || stopped) return;
          const state = root.getRootState?.() ?? root.getState();
          const actual = active(state), name = expected ?? actual[actual.length - 1];
          const visual = visualSignature(name);
          const normalizePath = value => value.split('/').filter(part => part && part !== 'index' && !/^\(.+\)$/.test(part)).join('/');
          let leaf = state; while (leaf?.routes?.length) { const route = leaf.routes[leaf.index ?? 0]; if (!route) { leaf = undefined; break; } if (!route.state) { leaf = route; break; } leaf = route.state; }
          const paramsMatch = Object.entries(command.params ?? {}).every(([name, value]) => JSON.stringify(leaf?.params?.[name]) === JSON.stringify(value));
          const routeMatches = command.expo ? normalizePath(actual.join('/')) === normalizePath(path[0]) : path.every((part, index) => actual[index] === part) && actual.length === path.length;
          const matches = routeMatches && paramsMatch;
          if (matches && visual.found && visual.hosts && !visual.loading && visual.signature === previous) stable++; else stable = 0;
          previous = visual.signature;
          if (matches && visual.found && !watched) { visible(); watched = true; }
          const transitioning = [...transitions.values()].some(record => record.busy);
          if (stable >= 2 && visual.content && !transitioning && Date.now() - started >= 240 && Date.now() - transitionAt >= 32) { reply({ ready: true, active: actual, name, signature: previous, ...visible() }); return; }
          if (Date.now() - started >= command.timeoutMs) { reply({ ready: false, active: actual, redirected: !routeMatches && visualSignature(actual[actual.length - 1]).found, reason: !matches ? 'Navigation redirected or the target did not mount.' : visual.loading ? 'Screen is still loading.' : transitioning ? 'Native transition did not finish.' : !visual.content ? 'Screen has no visible content yet.' : 'Screen did not settle in time.', ...visible() }); return; }
          setTimeout(check, 80);
          } catch { reply({ ready: false, reason: 'The screen detached while opening. It will be retried.' }); }
        }
        setTimeout(check, 0);
      } catch (error) { reply({ error: String(error?.message ?? 'Runtime navigation failed.').slice(0, 300) }); }
    },
  };
}
