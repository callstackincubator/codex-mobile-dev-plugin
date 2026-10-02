// Injected into a development runtime through one CDP connection. No app-specific code.
export function installFlowRuntime(key, expiresIn) {
  if (globalThis[key]) return;
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  let root, original, stopped = false, generation = 0, safeBudget = 2000;
  const observed = new Map();
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
  function fibers(callback) {
    if (!hook?.renderers || typeof hook.getFiberRoots !== 'function') return;
    const stack = [];
    for (const [id, renderer] of hook.renderers) {
      if (renderer.rendererPackageName !== 'react-native-renderer') continue;
      for (const item of hook.getFiberRoots(id)) stack.push(item.current);
    }
    let count = 0;
    while (stack.length && count++ < 16000) {
      const fiber = stack.pop(); if (!fiber) continue;
      if (fiber.sibling) stack.push(fiber.sibling);
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
  function inspect() {
    safeBudget = 2000;
    const mounted = [], registrations = [], data = [], seen = new Set(), clients = new Set();
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
      for (const route of state.routes ?? []) { remember(route.name, route.params); walk(route.state, [...path, route.name]); }
    }
    const state = root?.getRootState?.() ?? root?.getState?.();
    walk(state);
    return { available: !!root, registrations, candidates: [...observed.values()], data, active: active(state), mounted };
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
    let hosts = 0, loading = false, found = false;
    const signature = [];
    fibers(fiber => {
      const props = fiber.memoizedProps;
      if (props?.route?.name === name && props.navigation?.isFocused?.()) found = true;
      if (props?.activityState === 0 || (props?.activityState !== undefined && props['aria-hidden'] === true) || props?.hidden === true) return false;
      if (fiber.tag !== 5 || !props) return;
      if (props.accessibilityRole === 'progressbar' || props.role === 'progressbar' || props.animating === true) loading = true;
      hosts++;
      if (signature.length < 250) {
        const instance = fiber.stateNode?.canonical?.publicInstance ?? fiber.stateNode;
        let bounds;
        try { const rect = instance?.getBoundingClientRect?.(); if (rect) bounds = [rect.x, rect.y, rect.width, rect.height].map(Math.round); } catch {}
        signature.push([typeof fiber.type === 'string' ? fiber.type : '', props.testID, bounds, typeof props.children === 'string' ? props.children.slice(0, 100) : '']);
      }
    });
    return { found, loading, hosts, signature: JSON.stringify(signature) };
  }
  function restore() {
    if (stopped) return;
    stopped = true; generation++; clearTimeout(watchdog);
    try { if (root && original) root.dispatch({ type: 'RESET', payload: original }); } catch {}
    delete globalThis[key];
  }
  const watchdog = setTimeout(restore, Math.max(1, expiresIn));
  globalThis[key] = {
    invoke(command, reply) {
      try {
        if (command.type === 'restore') { restore(); reply({ restored: true }); return; }
        if (stopped) { reply({ error: 'Capture stopped.' }); return; }
        const info = inspect();
        if (command.type === 'inspect') { reply(info); return; }
        if (command.type === 'verify') { reply({ active: info.active, ...visualSignature(command.name) }); return; }
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
          function nested(index) {
            return { index: 0, routes: [{ name: path[index], ...(index === path.length - 1 ? { params: command.params ?? {} } : { state: nested(index + 1) }) }] };
          }
          root.dispatch({ type: 'RESET', payload: nested(0) });
        }
        const started = Date.now(); let previous, stable = 0;
        function check() {
          if (ticket !== generation || stopped) return;
          const state = root.getRootState?.() ?? root.getState();
          const actual = active(state), name = expected ?? actual[actual.length - 1];
          const visual = visualSignature(name);
          const normalizePath = value => value.split('/').filter(part => part && part !== 'index' && !/^\(.+\)$/.test(part)).join('/');
          let leaf = state; while (leaf?.routes?.length) { const route = leaf.routes[leaf.index ?? 0]; if (!route.state) { leaf = route; break; } leaf = route.state; }
          const paramsMatch = Object.entries(command.params ?? {}).every(([name, value]) => JSON.stringify(leaf?.params?.[name]) === JSON.stringify(value));
          const routeMatches = command.expo ? normalizePath(actual.join('/')) === normalizePath(path[0]) : path.every((part, index) => actual[index] === part) && actual.length === path.length;
          const matches = routeMatches && paramsMatch;
          if (matches && visual.found && visual.hosts && !visual.loading && visual.signature === previous) stable++; else stable = 0;
          previous = visual.signature;
          if (stable >= 2 && Date.now() - started >= 80) { reply({ ready: true, active: actual, name, signature: previous }); return; }
          if (Date.now() - started >= command.timeoutMs) { reply({ ready: false, active: actual, reason: !matches ? 'Navigation redirected or the target did not mount.' : visual.loading ? 'Screen is still loading.' : 'Screen did not settle in time.' }); return; }
          setTimeout(check, 32);
        }
        setTimeout(check, 0);
      } catch (error) { reply({ error: String(error?.message ?? 'Runtime navigation failed.').slice(0, 300) }); }
    },
  };
}
