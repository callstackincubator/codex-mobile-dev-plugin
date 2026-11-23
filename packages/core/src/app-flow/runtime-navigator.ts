/**
 * Finding the running app's React Navigation root, as a JavaScript source string.
 *
 * This exists as a string rather than a function because it runs *in the app*, evaluated through
 * `agent-device cdp runtime eval`. Two callers need it and must not drift apart: `nav-state.ts`
 * reads the navigator's routes to harvest param values, and the render reach rung dispatches
 * navigation through the same object. A second copy of this search would mean a sweep where the
 * reader and the writer disagree about which navigator is the real one, which is the kind of bug
 * that produces a confidently wrong capture rather than a visible failure.
 *
 * Nothing here is specific to any app. It keys on React DevTools' hook and on React Navigation's
 * public surface (`getState`, `getParent`, `getRootState`, `routes`), both of which Expo Router
 * also exposes because it is built on React Navigation.
 *
 * ## What it searches for, and why there are two shapes
 *
 * - A **container ref** exposes `getRootState` directly. That is what `useNavigationContainerRef()`
 *   holds and what `NavigationContainerRefContext` carries, but neither is guaranteed to appear in
 *   the fiber tree as a prop or a `stateNode` — it depends on how the app is written.
 * - A **screen's `navigation` prop** is in the tree on every screen React Navigation renders, and
 *   carries `getState` and `getParent`. It only knows its own navigator, so it has to be climbed
 *   to the root; reading it directly would report one stack's routes and miss every sibling tab.
 *
 * Both are probed because which one is reachable is a property of the app under test. The climb
 * discriminates on `getState` and `getParent` — both read-only — rather than on `dispatch`, so a
 * caller that only reads never evaluates a snippet that so much as names a mutating method.
 *
 * ## Bounds
 *
 * The walk is capped by a node count and a wall-clock deadline, and gives up rather than finishing
 * at any cost: it runs on the app's JS thread, and stalling the UI is the one thing a probe must
 * never do. The deadline is the real protection; the node count is deliberately generous because a
 * measured live tree ran to 17,822 fibers and the comparison project's own notes record a busy feed
 * exceeding 16,000, so a tight cap would fail on exactly the screens that matter. A `seen` set
 * guards cycles, which a `child`/`sibling` push cannot do on its own.
 */

/** Node ceiling for the fiber walk. Generous by design; the deadline below is the real bound. */
const WALK_BUDGET = 60_000
/** How long the walk may occupy the app's JS thread before abandoning the search. */
const WALK_DEADLINE_MS = 1_000

/**
 * Defines `findNavigator()` in the evaluated scope. It returns `{ nav, state }` — the navigator
 * object a caller can read or dispatch through, and the root state already read from it — or
 * `null` when no navigator is mounted. Embed this at the top of an expression and call it.
 *
 * `nav` is whichever shape was found, so a caller that intends to dispatch must check for the
 * method it needs rather than assuming: a container ref and a root navigator expose overlapping
 * but not identical surfaces.
 */
export const COLLECT_ROOTS_JS = `
  var collectFiberRoots = function () {
    var hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__
    if (!hook || typeof hook.getFiberRoots !== "function") return []
    // Enumerate renderers rather than assuming React Native is id 1: \`hook.renderers\` is keyed by
    // registration order, so a bundle that registers anything first would leave a fixed id empty.
    var rendererIds = []
    try {
      if (hook.renderers && typeof hook.renderers.forEach === "function") {
        hook.renderers.forEach(function (renderer, id) {
          if (!renderer || renderer.rendererPackageName === "react-native-renderer") rendererIds.push(id)
        })
      }
    } catch (error) {}
    if (!rendererIds.length) rendererIds.push(1)
    var stack = []
    for (var r = 0; r < rendererIds.length; r++) {
      var roots = null
      try { roots = hook.getFiberRoots(rendererIds[r]) } catch (error) { roots = null }
      if (!roots || typeof roots.forEach !== "function") continue
      roots.forEach(function (root) { if (root && root.current) stack.push(root.current) })
    }
    return stack
  }
`

/**
 * Defines `findNavigator()` in the evaluated scope, and `collectFiberRoots()` with it. Embed this
 * at the top of an expression and call either.
 */
export const FIND_NAVIGATOR_JS = `
  ${COLLECT_ROOTS_JS}
  var findNavigator = function () {
    var stack = collectFiberRoots()
    if (!stack.length) return null
    var deadline = Date.now() + ${WALK_DEADLINE_MS}
    var budget = ${WALK_BUDGET}
    var seen = new Set()
    // Climbs a screen's navigation object to the navigator that owns the whole tree.
    var climb = function (value) {
      if (!value || typeof value !== "object") return null
      if (typeof value.getState !== "function" || typeof value.getParent !== "function") return null
      try {
        var nav = value
        var climbed = new Set()
        while (typeof nav.getParent === "function" && !climbed.has(nav)) {
          climbed.add(nav)
          var parent = nav.getParent()
          if (!parent) break
          nav = parent
        }
        var state = typeof nav.getRootState === "function" ? nav.getRootState() : nav.getState()
        return state && state.routes ? { nav: nav, state: state } : null
      } catch (error) {
        return null
      }
    }
    var found = null
    while (stack.length && budget-- > 0 && !found) {
      if ((budget & 255) === 0 && Date.now() > deadline) return null
      var fiber = stack.pop()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      var memo = fiber.memoizedState
      var props = fiber.memoizedProps
      var carriers = [
        fiber.stateNode,
        props && props.value,
        props && props.navigationRef,
        memo && memo.memoizedState && memo.memoizedState.current
      ]
      for (var at = 0; at < carriers.length && !found; at++) {
        var carrier = carriers[at]
        if (carrier && typeof carrier.getRootState === "function") {
          try {
            // Called on the carrier, not detached from it: a container ref reads its own internals
            // through its receiver, and a detached reference would throw on the first read. A
            // carrier that throws or answers without routes is skipped rather than accepted, so a
            // still-mounting ref cannot end the search as a successful read of an empty sweep.
            var direct = carrier.getRootState()
            if (direct && direct.routes) found = { nav: carrier, state: direct }
          } catch (error) {}
        }
      }
      if (!found) found = climb(props && props.navigation)
      if (!found) found = climb(props && props.value)
      if (!found) found = climb(fiber.stateNode)
      if (fiber.child) stack.push(fiber.child)
      if (fiber.sibling) stack.push(fiber.sibling)
    }
    return found
  }
`
