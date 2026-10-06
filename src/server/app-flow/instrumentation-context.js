/** Copy context references from one committed source owner. They stay in the app. */
export function capturePreviewContext(ownerId, boundaryType, projection, failed, hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  const matches = [];
  for (const [id, renderer] of hook?.renderers ?? []) {
    if (renderer.rendererPackageName !== 'react-native-renderer') continue;
    for (const root of hook.getFiberRoots?.(id) ?? []) {
      const pending = [root.current], seen = new Set();
      while (pending.length) {
        const fiber = pending.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        if (fiber.tag === 12 && fiber.memoizedProps?.id === ownerId) matches.push(fiber);
        if (fiber.child) pending.push(fiber.child);
        if (fiber.sibling) pending.push(fiber.sibling);
      }
    }
  }
  if (matches.length !== 1) throw new Error('The committed preview context is no longer available.');
  const providers = [], seen = new Set();
  let root;
  for (let fiber = matches[0].return; fiber && !seen.has(fiber); fiber = fiber.return) {
    seen.add(fiber);
    if (fiber.tag === 3) root = fiber.stateNode;
    if (fiber.tag === 10 && fiber.memoizedProps && 'value' in fiber.memoizedProps) {
      const type = fiber.elementType ?? fiber.type;
      if (type) providers.push({type, value: fiber.memoizedProps.value});
    }
  }
  let original = root?.onCaughtError, active = true;
  const wrapped = function(error, info) {
    if (active && info?.errorBoundary?.constructor === boundaryType && info.errorBoundary.props?.projection === projection) {
      failed();
      return;
    }
    return original.apply(this, arguments);
  };
  if (typeof original === 'function') root.onCaughtError = wrapped;
  return {providers, release() {
    active = false;
    if (root?.onCaughtError === wrapped) root.onCaughtError = original;
    // Another observer may retain our wrapper; do not retain app context there.
    projection = failed = root = undefined;
  }};
}
