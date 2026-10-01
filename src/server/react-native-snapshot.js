// Runs inside the app through CDP. Keep this function self-contained and read-only.
export function collectReactNativeTree(complete) {
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook?.renderers || typeof hook.getFiberRoots !== "function") {
    const result = { available: false, reason: "unsupported" };
    complete?.(result);
    return result;
  }
  const nodes = [], stack = [], measured = [];
  let visited = 0, windowWidth = 0, pending = 0, gathered = false, finished = false, timer;
  const nativeRefs = new Set();
  function readNativeChildren(instance) {
    if (!instance || nativeRefs.has(instance) || nativeRefs.size >= 1000) return;
    nativeRefs.add(instance);
    try { for (const child of instance.children ?? []) readNativeChildren(child); } catch { /* Detached document. */ }
  }
  const clean = value => typeof value === "string" ? value.slice(0, 256) : undefined;
  for (const [id, renderer] of hook.renderers) {
    if (renderer.rendererPackageName !== "react-native-renderer") continue;
    for (const root of hook.getFiberRoots(id)) stack.push({ fiber: root.current, parent: undefined, depth: 0 });
  }
  stack.reverse();
  // Bound total work, not React wrapper depth. Nested navigators can exceed 200 fibers.
  while (stack.length && nodes.length < 3000 && visited < 10000) {
    const { fiber, parent, depth } = stack.pop();
    if (!fiber) continue;
    visited++;
    if (fiber.sibling) stack.push({ fiber: fiber.sibling, parent, depth });
    const props = fiber.memoizedProps;
    // Native-stack retains inactive screens with activityState=2 but aria-hidden=true.
    // Other aria-hidden elements can still be visible, such as decorative chevrons.
    if (props?.hidden === true || props?.activityState === 0 || props?.style?.display === "none"
      || (props?.activityState !== undefined && props?.["aria-hidden"] === true)) continue;
    const instance = fiber.stateNode?.canonical?.publicInstance ?? fiber.stateNode;
    if (fiber.tag === 5 && instance?.isConnected === false) continue;
    const type = fiber.type;
    const name = clean(typeof type === "string" ? type : type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name);
    let node = parent;
    if (name && fiber.tag !== 10 && fiber.tag !== 9) {
      node = { source: "react-native", role: name, label: clean(props?.accessibilityLabel) ?? clean(props?.children) ?? name, identifier: clean(props?.testID), nodeId: `rn-${nodes.length}`, parentId: parent?.nodeId, depth, children: [] };
      parent?.children.push(node);
      nodes.push(node);
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
    if (fiber.child) stack.push({ fiber: fiber.child, parent: node, depth: depth + 1 });
  }
  function finalize() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    // Children follow parents in the flat list, so reverse order resolves their bounds.
    for (let index = nodes.length - 1; index >= 0; index--) {
      const node = nodes[index];
      if (node.frame) continue;
      const frames = node.children.map(child => child.frame).filter(Boolean);
      if (!frames.length) continue;
      const x = Math.min(...frames.map(frame => frame.x)), y = Math.min(...frames.map(frame => frame.y));
      node.frame = { x, y, width: Math.max(...frames.map(frame => frame.x + frame.width)) - x, height: Math.max(...frames.map(frame => frame.y + frame.height)) - y };
    }
    const tree = nodes.filter(node => node.frame).map(({ children, ...node }) => node);
    // The measured window width supplies the DIP-to-pixel scale on Android.
    const result = { available: tree.length > 0, tree, windowWidth, truncated: stack.length > 0 || nativeRefs.size >= 1000 || measured.length >= 1000 || pending > 0 };
    try { complete?.(result); } catch { /* The debugger session may have closed. */ }
    return result;
  }
  gathered = true;
  if (!pending) return finalize();
  timer = setTimeout(finalize, 800);
  return undefined;
}
