// Runs inside the app through CDP. Keep this function self-contained and read-only.
export function collectReactNativeTree(complete) {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook?.renderers || typeof hook.getFiberRoots !== "function") {
    const result = { available: false, reason: "unsupported" };
    complete?.(result);
    return result;
  }
  const roots = [], measured = [];
  let count = 0, visited = 0, windowWidth = 0, pending = 0, gathered = false, finished = false, timer;
  const nativeRefs = new Set();
  function readNativeChildren(instance) {
    if (!instance || nativeRefs.has(instance) || nativeRefs.size >= 1000) return;
    nativeRefs.add(instance);
    try { for (const child of instance.children ?? []) readNativeChildren(child); } catch { /* Detached document. */ }
  }
  const clean = value => typeof value === "string" ? value.slice(0, 256) : undefined;
  function visit(fiber, parent, depth) {
    if (!fiber || depth > 160 || count >= 3000 || ++visited > 10000) return;
    const props = fiber.memoizedProps;
    if (props?.hidden === true || props?.activityState === 0 || props?.style?.display === "none") return;
    const type = fiber.type;
    const name = clean(typeof type === "string" ? type : type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name);
    let node = parent;
    if (name && fiber.tag !== 10 && fiber.tag !== 9) {
      node = { source: "react-native", role: name, label: clean(props?.accessibilityLabel) ?? name, identifier: clean(props?.testID), children: [] };
      (parent ? parent.children : roots).push(node);
      count++;
      const instance = fiber.stateNode?.canonical?.publicInstance ?? fiber.stateNode;
      if (instance) readNativeChildren(instance.ownerDocument?.documentElement ?? instance);
      if (fiber.tag === 5 && typeof instance?.getBoundingClientRect === "function" && measured.length < 1000) {
        measured.push(node);
        try {
          const { x, y, width, height } = instance.getBoundingClientRect();
          if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
            node.frame = { x, y, width, height };
            if (!windowWidth) {
              const documentWidth = instance.ownerDocument?.documentElement?.getBoundingClientRect?.().width;
              windowWidth = Number.isFinite(documentWidth) && documentWidth > 0 ? documentWidth : width;
            }
          }
        } catch { /* Some native screen containers need legacy measurement. */ }
        if (!node.frame && typeof instance.measureInWindow === "function" && complete) {
          pending++;
          let called = false;
          const measuredBounds = (x, y, width, height) => {
            if (called) return;
            called = true;
            if (!finished && [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) { node.frame = { x, y, width, height }; if (!windowWidth) windowWidth = width; }
            if (--pending === 0 && gathered) finalize();
          };
          try { instance.measureInWindow(measuredBounds); } catch { measuredBounds(); }
        }
      }
    }
    for (let child = fiber.child; child && count < 3000 && visited < 10000; child = child.sibling) visit(child, node, depth + 1);
  }
  for (const [id, renderer] of hook.renderers) {
    if (renderer.rendererPackageName !== "react-native-renderer") continue;
    for (const root of hook.getFiberRoots(id)) visit(root.current, undefined, 0);
  }
  function bounds(node) {
    node.children = node.children.filter(child => bounds(child));
    if (!node.frame && node.children.length) {
      const frames = node.children.map(child => child.frame);
      const x = Math.min(...frames.map(frame => frame.x)), y = Math.min(...frames.map(frame => frame.y));
      node.frame = { x, y, width: Math.max(...frames.map(frame => frame.x + frame.width)) - x, height: Math.max(...frames.map(frame => frame.y + frame.height)) - y };
    }
    return !!node.frame;
  }
  function finalize() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const tree = roots.filter(node => bounds(node));
    // The measured window width supplies the DIP-to-pixel scale on Android.
    const result = { available: tree.length > 0, tree, windowWidth, truncated: count >= 3000 || visited >= 10000 || nativeRefs.size >= 1000 || measured.length >= 1000 || pending > 0 };
    try { complete?.(result); } catch { /* The debugger session may have closed. */ }
    return result;
  }
  gathered = true;
  if (!pending) return finalize();
  timer = setTimeout(finalize, 800);
  return undefined;
}
