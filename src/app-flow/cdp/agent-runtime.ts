/* eslint-disable @typescript-eslint/no-explicit-any, no-var, @typescript-eslint/no-unused-vars, prefer-rest-params, @typescript-eslint/no-this-alias --
   `any`: everything below reads objects owned by the app under test (fibers, navigation state,
   props). None of it has a type we control, and a fake hierarchy would only pretend otherwise.
   `var`: deliberate, see the syntax constraint below; the lint rule's advice is the very thing the
   Hermes debugger evaluator is not trusted with. Unused catch bindings: `catch (error)` is kept
   over the newer binding-less form for the same reason. `arguments` and `this` aliasing: the
   patch wrappers forward whatever the app passed, of any arity, with its own receiver; rest
   parameters are banned syntax here. */
/**
 * The in-app agent: the code that runs inside the app under test's JS runtime, as real typed
 * source.
 *
 * Until now every expression we evaluated in the app was a template-string constant
 * (`COLLECT_ROOTS_JS`, `FIND_NAVIGATOR_JS`, `NAV_STATE_EXPR`, `readinessExpr`). Those cannot be
 * type-checked, linted, or unit-tested, and the cost of that was paid for in real bugs: the
 * `hidden()` style-array prune in `runtime-render.ts` was found by running against a live app
 * because no test could reach it. Here the same logic is ordinary exported functions. They are
 * tested directly against a hand-built fake fiber tree (`agent-runtime.test.ts`), and at runtime
 * `runtime-source.ts` injects them by calling `fn.toString()` on each.
 *
 * ## CRITICAL SYNTAX CONSTRAINT -- read before "modernising" anything in this file
 *
 * The source below is evaluated by Hermes' **debugger** evaluator (`Runtime.evaluate`), which does
 * not lower code the way the app's bundler does. The reference implementation this transport is
 * modelled on runs an esbuild `target: 'es2015'` pass over its agent for exactly that reason. We
 * avoid that build step by writing the agent in conservative syntax by hand, which is also what the
 * existing ES5-style expressions already did. Inside every function in `AGENT_FUNCTIONS`:
 *
 * - no `async` / `await` (and so no promises-as-control-flow);
 * - no optional chaining and no nullish coalescing: write the explicit null check;
 * - no spread or rest syntax, in object literals, arrays or calls;
 * - no `for...of` (use an indexed loop; `for...in` over a plain object is fine);
 * - no classes, no destructuring, no default parameters, no template literals, no getters;
 * - `var` and plain `function` only. `Set` and `Map` exist in Hermes and are already used by the
 *   expressions this replaces.
 *
 * A violation does not fail at the edit: it type-checks, passes every test that runs the functions
 * under Node, and then arrives as a Hermes compile error against a live device. So `runtime-source.ts`
 * scans the assembled source for these tokens and refuses to build it, and the test suite runs that
 * scan. Do not add comments inside a function body that contain those tokens spelled out; the scan
 * is textual and cannot tell a comment from code.
 *
 * ## Other rules that follow from "this is toString()'d"
 *
 * - **A function may reference only other `AGENT_FUNCTIONS` and the app's globals.** It is
 *   re-created in a fresh scope in the app, so a module constant (`WALK_BUDGET`) or an imported
 *   helper does not exist there and fails as a `ReferenceError` on first use. Configuration crosses
 *   the boundary as an argument (`AgentLimits`), and the test suite evaluates the assembled source
 *   in an empty `node:vm` context so such a reference cannot hide.
 * - **Names are load-bearing.** Functions call each other by their declared name, so a bundler that
 *   renames a top-level declaration (to dodge a collision) would silently break the call. Every
 *   name carries an `agent` prefix to make a collision unlikely, and `runtime-source.ts` checks
 *   `fn.name` against the registry and throws rather than inject a renamed function.
 * - **No recursion by name, no closures over module state.** The helpers that would naturally
 *   recurse (`agentStyleFlags`, `agentComponentName`) are iterative.
 *
 * ## One navigator search, shared
 *
 * `runtime-navigator.ts` explains that the reader and the writer must share a single search so they
 * can never disagree about which navigator is real. That property is kept here by construction:
 * `agentFindNavigator` is the only place a navigator is found, and `nav-state` and `readiness`
 * (and, later, a navigate command) all call it. Until the old string path is retired there are
 * still two copies of that search in the repo; `agent-runtime.test.ts` runs both against the same
 * fake tree so they cannot drift apart unnoticed.
 *
 * ## The lease
 *
 * `agentInstall` arms a watchdog that is refreshed by every command. If the host stops talking for
 * `leaseMs` (a crashed Electron process, a dropped socket nobody noticed) the watchdog calls
 * `restore()` and deletes the agent global, so a dead harness cannot leave the app permanently
 * instrumented. This is the safety property the rest of the transport exists to serve, so it is
 * deliberately fail-closed: with no working timer the install refuses rather than run without a
 * watchdog, and a failure to re-arm the timer restores immediately instead of continuing.
 *
 * `restore()` runs the `undo` list in reverse order, and every entry is isolated so one failing undo
 * cannot strand the others or the global. Since readiness moved into the app (below) the list is no
 * longer empty: it holds the reversal of every patch the agent applies to the app's own globals,
 * which is exactly why the lease exists. If the host dies, the 10s watchdog un-patches `fetch`,
 * `XMLHttpRequest.prototype.send` and the DevTools hook before it deletes the agent.
 *
 * ## Readiness lives in the app
 *
 * The old settle loop sampled a stateless snapshot from Node and called the screen settled after two
 * identical samples (`runtime-render.ts`, `reach/adapters.ts`). That was sound only because a CLI
 * evaluation cost ~570ms: two samples were >500ms apart, six times the 80ms quiet window the
 * reference implementation waits for, with frames certainly painted in between. The socket transport
 * measured **13.8ms median round-trip (11.7-23.5ms over 20 samples)** against a real device: two
 * polls are now less than one 60Hz frame apart, and two identical samples prove neither a quiet
 * window nor a painted frame. Keeping that heuristic would make the render rung confidently wrong,
 * which is worse than slow. So the decision moves to where the evidence is:
 *
 * - **React commits** are timestamped by chaining `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`.
 * - **In-flight network** is counted by wrapping `fetch` and `XMLHttpRequest.prototype.send`.
 * - **A quiet window** is the time since the last commit and the last network completion, compared
 *   by the agent against thresholds the host passes in (`quietMs`, `idleMs`).
 * - **A paint check** is two nested `requestAnimationFrame` callbacks, with no commit in between.
 *
 * The reply carries the verdict plus the evidence behind it, and `confident`/`missing` say which
 * signals could not be installed, so a verdict that rests on fewer signals is distinguishable from
 * one that does not. What no longer has parity with the old string path is listed on
 * `agentReadiness`'s sibling `agentVerdict`.
 *
 * ## Patching the app is the risky part
 *
 * Each patch goes through `agentPatchProperty`, which owns the rules: pass arguments, `this` and
 * results through untouched; keep bookkeeping in its own try block so it cannot reach the app;
 * register the reversal on `undo`; refuse (rather than throw) when the target is missing or not
 * writable; and, if something else wrapped the property after us, neutralise our wrapper instead of
 * overwriting theirs on restore.
 */

import type { NavRoute } from '../nav-state.ts'
import type { ReadinessSnapshot } from '../runtime-render.ts'

/** Node ceiling for the fiber walk. Generous by design; the deadline below is the real bound. */
export const WALK_BUDGET = 60_000
/** How long the walk may occupy the app's JS thread before abandoning the search. */
export const WALK_DEADLINE_MS = 1_000
/** Ceiling for the walk beneath the focused screen when sampling readiness. */
export const INNER_WALK_BUDGET = 40_000
/** How long the host may go quiet before the app restores itself. Matches the reference's 10s. */
export const AGENT_LEASE_MS = 10_000

/**
 * Default time with no React commit before the tree counts as quiet.
 *
 * 500ms is ~30 frames at 60Hz. It has to cover the gap between a response landing and the commit
 * that renders it (a few frames) and the gap from that commit to a dependent request starting (a
 * waterfall: the next request bumps the in-flight count, so only the commit-to-request hop needs
 * covering). It is shorter than the reference implementation's 1500ms on purpose: every capture in
 * a sweep pays this wait, hundreds of times, and the old path accepted a 570ms sample spacing. The
 * margin the 1500ms buys is mostly sampling error, which an exact in-app timestamp does not have.
 * The cost of being too short is a premature capture; the host's own settle budget and the arrival
 * judge are the backstops. Not measured on a device: tune it from capture results, and note a screen
 * that commits more often than this (a ticking clock, a live feed) never reports quiet.
 */
export const QUIET_MS = 500
/** Default time with no request in flight and none completed before the network counts as idle. */
export const IDLE_MS = 500
/**
 * How long to wait for the two animation frames before reporting `painted: false`. A frame that has
 * not arrived in 500ms (~30 frames) means the app is backgrounded or its UI thread is stalled, and
 * waiting longer only burns the host's 1500ms command timeout.
 */
export const PAINT_TIMEOUT_MS = 500

/** The walk bounds, passed into the app because module constants do not survive `toString()`. */
export interface AgentLimits {
  walkBudget: number
  walkDeadlineMs: number
  innerWalkBudget: number
  /** Default `quietMs` for a readiness command that does not carry its own. */
  quietMs: number
  /** Default `idleMs` for a readiness command that does not carry its own. */
  idleMs: number
  paintTimeoutMs: number
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  walkBudget: WALK_BUDGET,
  walkDeadlineMs: WALK_DEADLINE_MS,
  innerWalkBudget: INNER_WALK_BUDGET,
  quietMs: QUIET_MS,
  idleMs: IDLE_MS,
  paintTimeoutMs: PAINT_TIMEOUT_MS
}

/** Commands the host may send. `restore` is also what the lease watchdog does on its own. */
export type AgentCommand =
  | { type: 'heartbeat' }
  | { type: 'restore' }
  | { type: 'nav-state' }
  | { type: 'navigate'; route: string[]; params: Record<string, string> | null }
  | {
      type: 'readiness'
      route: string
      expectedParams: Record<string, string> | null
      /** Override the commit quiet window for this call. */
      quietMs?: number
      /** Override the network idle window for this call. */
      idleMs?: number
    }

export interface HeartbeatReply {
  alive: true
}
export interface RestoreReply {
  restored: true
}
/** `routes` is null when no navigator is mounted (release build, still booting, no DevTools hook). */
export interface NavStateReply {
  routes: NavRoute[] | null
}
export type NavigateReply =
  | { ok: true }
  | {
      ok: false
      reason: 'no-navigator' | 'no-dispatch' | 'unregistered' | 'invalid-route' | 'threw'
      detail?: string
    }
/**
 * `ReadinessSnapshot` as the app computes it, plus the in-app verdict. Unlike the pipe-delimited
 * string it replaces, nothing here has to fit in 200 characters, so `active` is the whole focused
 * path rather than its last three segments.
 */
export interface ReadinessReply extends ReadinessSnapshot {
  /**
   * The app's own verdict: the screen was found, shows no loading affordance, the tree has been
   * quiet, and frames painted. Computed over the signals that are available; read `confident`.
   */
  settled: boolean
  /** No commit for `quietMs` and no request in flight or recently completed for `idleMs`. */
  quiet: boolean
  /** Two frames ran with no commit between them; null when there is no `requestAnimationFrame`. */
  painted: boolean | null
  /** True only when every signal (commits, fetch, xhr, paint) was installed. */
  confident: boolean
  /** Signals that could not be installed. Non-empty means `settled` rests on less evidence. */
  missing: string[]
  /** Milliseconds since the last observed commit; null when commits cannot be observed. */
  commitQuietMs: number | null
  /** 0 while a request is in flight, else ms since the last completion; null when untracked. */
  networkQuietMs: number | null
  /** Requests started and not yet completed; null when no network signal is available. */
  inflight: number | null
}
/** What the agent says about a command it will not run. Passed through to the caller as data. */
export interface AgentErrorReply {
  error: 'invalid-command' | 'unknown-command' | 'command-failed'
  detail?: string
}
export interface AgentStoppedReply {
  stopped: true
}

/** The shape of the object installed at `globalThis[key]`. */
export interface InstalledAgent {
  invoke(commandJson: string, reply: (value: unknown) => void): void
  restore(): void
}

/**
 * The fibers to start a walk from: one `current` per root of every React Native renderer.
 *
 * Renderers are enumerated and filtered by `rendererPackageName` rather than assuming React Native
 * is renderer id 1. `hook.renderers` is keyed by registration order, so a bundle that registers
 * anything first would leave `getFiberRoots(1)` empty. Id 1 stays as the fallback because on the
 * measured reference app it is in fact the React Native renderer.
 */
export function agentCollectFiberRoots(): any[] {
  var hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (!hook || typeof hook.getFiberRoots !== 'function') return []
  var rendererIds: any[] = []
  try {
    if (hook.renderers && typeof hook.renderers.forEach === 'function') {
      hook.renderers.forEach(function (renderer: any, id: any) {
        if (!renderer || renderer.rendererPackageName === 'react-native-renderer') {
          rendererIds.push(id)
        }
      })
    }
  } catch (error) {
    rendererIds = []
  }
  if (!rendererIds.length) rendererIds.push(1)
  var stack: any[] = []
  for (var r = 0; r < rendererIds.length; r++) {
    var roots: any = null
    try {
      roots = hook.getFiberRoots(rendererIds[r])
    } catch (error) {
      roots = null
    }
    if (!roots || typeof roots.forEach !== 'function') continue
    roots.forEach(function (root: any) {
      if (root && root.current) stack.push(root.current)
    })
  }
  return stack
}

/**
 * Finds the app's React Navigation root. Returns `{ nav, state }` -- the object a caller can read
 * or dispatch through, and the root state already read from it -- or null when none is mounted.
 *
 * Two shapes are probed because which one is reachable is a property of the app under test. A
 * **container ref** exposes `getRootState` directly but is not guaranteed to sit in the fiber tree
 * as a prop or a `stateNode`. A **screen's `navigation` prop** is in the tree on every screen
 * React Navigation renders and carries `getState` and `getParent`, but knows only its own
 * navigator, so it is climbed to the root: reading it directly would report one stack and miss
 * every sibling tab. The climb discriminates on those two read-only methods rather than on
 * `dispatch`, which keeps the reading commands from ever naming a mutating one.
 *
 * Bounded by `limits.walkBudget` nodes and `limits.walkDeadlineMs` of wall clock, and gives up
 * rather than finishing at any cost: this runs on the app's JS thread. The deadline is the real
 * protection. The node cap is generous because a measured live tree ran to 17,822 fibers and the
 * comparison project records a busy feed exceeding 16,000, so a tight cap would fail on exactly the
 * screens that matter. A `seen` set guards cycles, which a child/sibling push cannot do alone.
 *
 * A carrier that answers badly does not end the search: each `getRootState()` is called in its own
 * try block and its result must have `routes`, so a still-mounting container ref is skipped rather
 * than accepted as a successful read of an empty sweep. It is called on the carrier, not detached,
 * because a container ref reads its internals through its receiver.
 */
export function agentFindNavigator(limits: AgentLimits): { nav: any; state: any } | null {
  var stack = agentCollectFiberRoots()
  if (!stack.length) return null
  var deadline = Date.now() + limits.walkDeadlineMs
  var budget = limits.walkBudget
  var seen = new Set()
  var climb = function (value: any): { nav: any; state: any } | null {
    if (!value || typeof value !== 'object') return null
    if (typeof value.getState !== 'function' || typeof value.getParent !== 'function') return null
    try {
      var nav = value
      var climbed = new Set()
      while (typeof nav.getParent === 'function' && !climbed.has(nav)) {
        climbed.add(nav)
        var parent = nav.getParent()
        if (!parent) break
        nav = parent
      }
      var state = typeof nav.getRootState === 'function' ? nav.getRootState() : nav.getState()
      return state && state.routes ? { nav: nav, state: state } : null
    } catch (error) {
      return null
    }
  }
  var found: { nav: any; state: any } | null = null
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
      if (carrier && typeof carrier.getRootState === 'function') {
        try {
          var direct = carrier.getRootState()
          if (direct && direct.routes) found = { nav: carrier, state: direct }
        } catch (error) {
          found = null
        }
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

/**
 * Flattens a navigation state into the routes `nav-state.ts` has always returned, depth first.
 *
 * Only values that can honestly become a URL segment survive: strings and finite numbers (as
 * strings). A route object holding a whole post or a callback neither crosses the wire nor arrives
 * as `[object Object]` pretending to be an id. Depth is capped at 12, as before.
 */
export function agentFlattenRoutes(state: any): NavRoute[] {
  var flat: NavRoute[] = []
  var walk = function (node: any, depth: number): void {
    if (!node || depth > 12 || !Array.isArray(node.routes)) return
    for (var i = 0; i < node.routes.length; i++) {
      var route = node.routes[i]
      if (!route || typeof route.name !== 'string') continue
      var entry: NavRoute = { name: route.name }
      if (typeof route.path === 'string' && route.path) entry.path = route.path
      var raw = route.params
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        var kept: Record<string, string> = {}
        var any = false
        for (var key in raw) {
          var value = raw[key]
          if (typeof value === 'string') {
            kept[key] = value
            any = true
          } else if (typeof value === 'number' && isFinite(value)) {
            kept[key] = String(value)
            any = true
          }
        }
        if (any) entry.params = kept
      }
      flat.push(entry)
      if (route.state) walk(route.state, depth + 1)
    }
  }
  walk(state, 0)
  return flat
}

/** The `nav-state` command: the flattened navigator state, or `{ routes: null }`. */
export function agentNavState(limits: AgentLimits): NavStateReply {
  var found = agentFindNavigator(limits)
  if (!found || !found.state) return { routes: null }
  return { routes: agentFlattenRoutes(found.state) }
}

/** Dispatches a nested React Navigation route after proving its leaf is registered live. */
export function agentNavigate(
  route: string[],
  params: Record<string, string> | null,
  limits: AgentLimits
): NavigateReply {
  if (!Array.isArray(route) || !route.length) return { ok: false, reason: 'invalid-route' }
  var found = agentFindNavigator(limits)
  if (!found) return { ok: false, reason: 'no-navigator' }
  var nav = found.nav
  if (!nav || typeof nav.dispatch !== 'function') return { ok: false, reason: 'no-dispatch' }
  var names: string[] = []
  var pending: any[] = [{ state: found.state, depth: 0 }]
  for (var seen = 0; pending.length && seen < 500; seen++) {
    var item = pending.pop()
    var state = item && item.state
    if (!state || item.depth >= 16) continue
    if (Array.isArray(state.routeNames)) names = names.concat(state.routeNames)
    if (!Array.isArray(state.routes)) continue
    for (var index = 0; index < state.routes.length; index++) {
      var child = state.routes[index]
      if (child && child.state) pending.push({ state: child.state, depth: item.depth + 1 })
    }
  }
  if (names.indexOf(String(route[route.length - 1])) < 0) {
    return { ok: false, reason: 'unregistered' }
  }
  var nested: any = params && Object.keys(params).length ? params : undefined
  for (var offset = route.length - 1; offset > 0; offset--) {
    nested = { screen: String(route[offset]), params: nested, initial: false }
  }
  var payload: any = { name: String(route[0]) }
  if (nested !== undefined) payload.params = nested
  try {
    nav.dispatch({ type: 'NAVIGATE', payload: payload })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: 'threw',
      detail: String(error && (error as any).message).slice(0, 80)
    }
  }
}

/**
 * Reduces a React Native `style` prop to the two flags that decide visibility.
 *
 * Style props are routinely **arrays**, and nested ones, so reading only a plain object misses most
 * of the hidden subtrees an app actually produces. Flattened with the array's own merge semantics:
 * left to right, a later entry overrides an earlier one. Depth is capped at 5. Iterative, because
 * an injected function cannot rely on calling itself by name (see the file doc).
 */
export function agentStyleFlags(style: any): { display?: unknown; opacity?: unknown } {
  var out: { display?: unknown; opacity?: unknown } = {}
  // Entries are processed in reading order; a stack of [node, depth] pairs is reversed on push so
  // the first array element is popped first.
  var stack: Array<{ node: any; depth: number }> = [{ node: style, depth: 0 }]
  while (stack.length) {
    var item = stack.pop() as { node: any; depth: number }
    var node = item.node
    if (!node || item.depth > 5) continue
    if (Array.isArray(node)) {
      for (var index = node.length - 1; index >= 0; index--) {
        stack.push({ node: node[index], depth: item.depth + 1 })
      }
      continue
    }
    if (typeof node !== 'object') continue
    if (node.display !== undefined) out.display = node.display
    if (node.opacity !== undefined) out.opacity = node.opacity
  }
  return out
}

/**
 * Whether the app has hidden this subtree, so it should not count as on screen.
 *
 * Counting a hidden subtree reports content and stability for a screen the user cannot see.
 * Measured on a real app: a stopped `ActivityIndicator` sat under
 * `style: [{display:"none",opacity:0}]` and was counted as a live loading affordance, so every
 * readiness poll on that screen reported a skeleton and the settle loop burned its whole 8s budget
 * on a fully rendered screen. That is why the style is flattened with array merge semantics
 * (`agentStyleFlags`) rather than "any entry hides it": `[{display:"none"},{display:"flex"}]` is
 * visible, and pruning a visible screen is the more damaging way to be wrong.
 *
 * Deliberately more thorough than the reference implementation, which reads a plain-object style
 * only and so misses every array-valued one.
 */
export function agentHidden(props: any): boolean {
  if (!props) return false
  if (props.focused === false || props.isFocused === false || props.screenFocused === false) {
    return true
  }
  if (props.style) {
    var flags = agentStyleFlags(props.style)
    if (flags.display === 'none' || flags.opacity === 0) return true
  }
  return props.accessibilityElementsHidden === true || props['aria-hidden'] === true
}

/**
 * A component's display name. It may sit on a function, or on the object `memo` and `forwardRef`
 * wrap it in; the latter is routine in React Native, and reading only functions would miss most of
 * the loading indicators worth detecting. Follows `type` wrappers a bounded number of times.
 */
export function agentComponentName(value: any): string {
  for (var hops = 0; hops < 8; hops++) {
    if (!value) return ''
    if (typeof value === 'function') return value.displayName || value.name || ''
    if (typeof value !== 'object') return ''
    var direct =
      value.displayName ||
      (typeof value.render === 'function'
        ? value.render.displayName || value.render.name || ''
        : '')
    if (direct) return direct
    value = value.type
  }
  return ''
}

/**
 * The `readiness` command: one stateless snapshot of how settled a screen is.
 *
 * Ported from `readinessExpr`; see `runtime-render.ts` for why this decides *when to photograph*
 * rather than *whether we arrived*. This function is still the stateless sample (the result is an
 * object, not an `AIHR1|` string); `agentSettle` adds the stateful evidence around it, and
 * `agentVerdict` folds the two together.
 *
 * Two traversal details were each found by measurement and are kept exactly:
 *
 * - **Siblings are pushed before the hidden check.** A fiber's later siblings are reachable only
 *   through it, so skipping the push together with the subtree severs the rest of the sibling list.
 *   One hidden scene cut a walk from 1425 nodes to 937 and hid the focused screen entirely, so every
 *   poll reported `found: false`.
 * - **A parameter mismatch makes `found` false**, not merely a different signature. A dispatch still
 *   in flight lands with the previous instance's params for a poll or two, and settling on that
 *   would photograph the wrong screen.
 */
export function agentReadiness(
  routeName: string,
  expectedParams: Record<string, string> | null,
  limits: AgentLimits
): ReadinessSnapshot {
  var empty: ReadinessSnapshot = {
    found: false,
    content: 0,
    loading: null,
    signature: '',
    active: [],
    paramMismatch: []
  }
  var found = agentFindNavigator(limits)
  if (!found) return empty
  // The focused route path, innermost last, bounded at 16 levels of nesting.
  var state = found.state
  var active: string[] = []
  for (var depth = 0; state && state.routes && state.routes.length && depth < 16; depth++) {
    var route = state.routes[state.index == null ? 0 : state.index]
    if (!route) break
    active.push(route.name)
    state = route.state
  }
  var expected: Record<string, string> = expectedParams || {}
  var screen: any = null
  var stack = agentCollectFiberRoots()
  var seen = new Set()
  var budget = limits.walkBudget
  var deadline = Date.now() + limits.walkDeadlineMs
  while (stack.length && budget-- > 0 && !screen) {
    if ((budget & 255) === 0 && Date.now() > deadline) break
    var fiber = stack.pop()
    if (!fiber || seen.has(fiber)) continue
    seen.add(fiber)
    if (fiber.sibling) stack.push(fiber.sibling)
    var props = fiber.memoizedProps
    if (agentHidden(props)) continue
    if (props && props.route && props.route.name === routeName) {
      var focused = true
      try {
        if (props.navigation && typeof props.navigation.isFocused === 'function') {
          focused = props.navigation.isFocused()
        }
      } catch (error) {
        focused = true
      }
      if (focused) screen = fiber
    }
    if (fiber.child) stack.push(fiber.child)
  }
  var content = 0
  var loading = ''
  var parts: string[] = []
  var missed: string[] = []
  if (screen) {
    var inner = [screen.child]
    var innerSeen = new Set()
    var innerBudget = limits.innerWalkBudget
    var loaderPattern =
      /Skeleton|Shimmer|LoadingPlaceholder|LoadingIndicator|LoadingSpinner|LoadingView|LoadingScreen|ActivityIndicator|Spinner|^Loader$/
    while (inner.length && innerBudget-- > 0) {
      var node = inner.pop()
      if (!node || innerSeen.has(node)) continue
      innerSeen.add(node)
      // Same reason as the outer walk: pruning a hidden subtree must not take its siblings with it.
      if (node.sibling) inner.push(node.sibling)
      var nodeProps = node.memoizedProps
      if (agentHidden(nodeProps)) continue
      if (!loading) {
        var typeName = agentComponentName(node.type) || agentComponentName(node.elementType)
        if (typeName && loaderPattern.test(typeName)) loading = 'skeleton'
        else if (node.tag === 13 && node.memoizedState !== null) loading = 'suspense'
        else if (nodeProps) {
          var busy =
            (nodeProps.accessibilityState && nodeProps.accessibilityState.busy) ||
            nodeProps['aria-busy']
          if (busy === true) loading = 'busy'
          else if (
            nodeProps.isLoading === true ||
            nodeProps.loading === true ||
            nodeProps.animating === true
          ) {
            loading = 'busy'
          } else if (
            nodeProps.accessibilityRole === 'progressbar' ||
            nodeProps.role === 'progressbar'
          ) {
            loading = 'busy'
          }
        }
      }
      if (node.tag === 5 && nodeProps) {
        var text = typeof nodeProps.children === 'string' ? nodeProps.children : null
        var media = nodeProps.source || nodeProps.src
        var label =
          typeof nodeProps.accessibilityLabel === 'string' ? nodeProps.accessibilityLabel : null
        if (text || media || label) {
          content += 1
          if (parts.length < 250) {
            parts.push(String(node.type) + ':' + String(text || label || 'src').slice(0, 60))
          }
        }
      }
      if (node.child) inner.push(node.child)
    }
    // Only the keys the caller asked about, compared on the focused leaf's params. A screen
    // carrying extra params is still the screen that was asked for.
    var leaf = found.state
    while (leaf && leaf.routes && leaf.routes.length) {
      var next = leaf.routes[leaf.index == null ? 0 : leaf.index]
      if (!next) break
      leaf = next.state || next
    }
    for (var key in expected) {
      var actual = leaf && leaf.params ? leaf.params[key] : undefined
      if (String(actual) !== String(expected[key]) && missed.length < 4) missed.push(key)
    }
    if (missed.length) {
      screen = null
      content = 0
    }
  }
  // A 32-bit hash of the structure: only equality across polls is ever asked of it, and the
  // structure itself runs to thousands of characters.
  var joined = parts.join('|')
  var hash = 0
  for (var at = 0; at < joined.length; at++) {
    hash = (hash * 31 + joined.charCodeAt(at)) | 0
  }
  return {
    found: !!screen,
    content: content,
    loading: loading ? loading : null,
    signature: (hash >>> 0).toString(36),
    active: active,
    paramMismatch: missed
  }
}

/**
 * Replaces `target[name]` with a wrapper, safely, and registers the reversal. Returns whether the
 * property is now patched; **never throws**, because a signal that cannot be installed must be
 * reported as missing, not abort the install.
 *
 * The rules every patch in this agent follows, kept in one place so none of them can be forgotten:
 *
 * - **Refuse rather than force.** A missing property (when `requireOriginal`), a throwing getter, a
 *   frozen object, or an accessor with no setter all end in `false`. Writability is checked by
 *   *doing* the assignment and reading it back: a non-writable property silently ignores the write
 *   in sloppy mode and throws in strict mode, and the evaluator's mode is not ours to assume.
 * - **No stacking.** If the current value is already one of our wrappers (it carries
 *   `__aiHarnessRelease`, the owning agent's `restore`), that agent is restored first, so a second
 *   install under a different key wraps the real original instead of wrapping the first wrapper.
 *   A same-key reinstall is already covered by `agentInstall` restoring its predecessor.
 * - **Exact reversal.** The original value is kept and written back, or the own property is deleted
 *   when it was inherited, so the object ends up as it started. If something else wrapped the
 *   property after us, the reversal does *not* overwrite it (that would silently unhook a third
 *   party); it flips `control.live` so our wrapper becomes a pure pass-through and leaves it in the
 *   chain.
 *
 * `makeWrapper(original, control)` receives the original (null if it is not a function) and the
 * control flag, and must return the replacement.
 */
export function agentPatchProperty(
  target: any,
  name: string,
  requireOriginal: boolean,
  makeWrapper: (original: any, control: { live: boolean }) => any,
  undo: Array<() => void>,
  release: () => void
): boolean {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false
  var current: any
  try {
    current = target[name]
  } catch (error) {
    return false
  }
  if (current && typeof current.__aiHarnessRelease === 'function') {
    try {
      current.__aiHarnessRelease()
    } catch (error) {
      current = null
    }
    try {
      current = target[name]
    } catch (error) {
      return false
    }
  }
  if (requireOriginal && typeof current !== 'function') return false
  var hadOwn = Object.prototype.hasOwnProperty.call(target, name)
  var control = { live: true }
  var wrapper: any
  try {
    wrapper = makeWrapper(typeof current === 'function' ? current : null, control)
  } catch (error) {
    return false
  }
  if (typeof wrapper !== 'function') return false
  try {
    wrapper.__aiHarnessRelease = release
  } catch (error) {
    /* an unmarked wrapper still works; it just cannot be released by a later install */
  }
  try {
    target[name] = wrapper
  } catch (error) {
    return false
  }
  var applied = false
  try {
    applied = target[name] === wrapper
  } catch (error) {
    applied = false
  }
  if (!applied) return false
  undo.push(function () {
    control.live = false
    if (target[name] !== wrapper) return
    if (hadOwn) target[name] = current
    else delete target[name]
  })
  return true
}

/**
 * Installs the three observers and returns the state they write to.
 *
 * ## What each patch touches
 *
 * - **`__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`**: replaced by a function that stamps
 *   `commitAt` and then calls whatever handler was there (DevTools' own, usually), with the same
 *   `this` and arguments, returning its result. React calls the property at commit time, so
 *   replacing it on the hook object is enough. The handler is optional: with none, only the stamp
 *   runs. Chained, never replaced.
 * - **`fetch`**: replaced by a function that counts the call as in flight and returns the *same
 *   promise object* the original returned. Completion is observed by attaching a fulfilment and a
 *   rejection handler to it, so a rejection decrements the count and still reaches the app
 *   unchanged. One consequence, stated plainly: attaching a handler marks the promise as handled, so
 *   an app that never catches a failed request loses the engine's unhandled-rejection warning for
 *   it. The alternative (returning a derived promise) would preserve that warning but change the
 *   identity of the value the app holds, which is the worse trade for an apparatus that must not
 *   change behaviour.
 * - **`XMLHttpRequest.prototype.send`**: replaced (the prototype, not the constructor, so
 *   `instanceof`, statics and subclasses are untouched). A `loadend` listener, plus a
 *   `readystatechange` at state 4 as a second route, decrements the count; the first to fire wins
 *   because each request holds a one-shot token. `send` itself is called with the original
 *   arguments and receiver and its result or exception propagates.
 *
 * ## Counting a request once
 *
 * React Native's `fetch` is a polyfill over `XMLHttpRequest` that calls `send` synchronously inside
 * the promise executor, so without care one request counts twice. `fetchDepth` is raised for the
 * duration of the synchronous original `fetch` call and `send` does not count while it is raised.
 * This matters only for the count's honesty (`inflight`); quiet depends on it reaching zero. A
 * native fetch that does not use `XMLHttpRequest` is unaffected.
 *
 * ## Blind spots (what quiet cannot see)
 *
 * Requests started before the install are invisible, so `commitAt` and `settledAt` start at the
 * install time: the first `quietMs` after connecting is reported as not quiet rather than guessed.
 * Native image loading, WebSocket traffic and anything that bypasses both globals is not counted. A
 * long-lived request (long poll, server-sent events over XHR) holds `inflight` above zero for its
 * whole life, so such a screen reports not quiet until the host's budget gives up. That is the safe
 * direction to be wrong in.
 *
 * Bookkeeping lives in its own try block everywhere so an exception in it can never reach the app.
 */
export function agentCreateSignals(root: any, undo: Array<() => void>, release: () => void): any {
  var started = Date.now()
  var signals: any = {
    installedAt: started,
    commitAt: started,
    settledAt: started,
    pending: 0,
    fetchDepth: 0,
    available: { commits: false, fetch: false, xhr: false }
  }
  signals.begin = function () {
    try {
      signals.pending += 1
      return { done: false }
    } catch (error) {
      return null
    }
  }
  signals.end = function (token: any) {
    try {
      if (!token || token.done) return
      token.done = true
      if (signals.pending > 0) signals.pending -= 1
      signals.settledAt = Date.now()
    } catch (error) {
      token = null
    }
  }

  var hook: any = null
  try {
    hook = root.__REACT_DEVTOOLS_GLOBAL_HOOK__
  } catch (error) {
    hook = null
  }
  signals.available.commits = agentPatchProperty(
    hook,
    'onCommitFiberRoot',
    false,
    function (original: any, control: any) {
      return function (this: any) {
        if (control.live) {
          try {
            signals.commitAt = Date.now()
          } catch (error) {
            control.live = true
          }
        }
        if (typeof original === 'function') return original.apply(this, arguments)
        return undefined
      }
    },
    undo,
    release
  )

  signals.available.fetch = agentPatchProperty(
    root,
    'fetch',
    true,
    function (original: any, control: any) {
      return function (this: any) {
        if (!control.live) return original.apply(this, arguments)
        var token = signals.begin()
        var result: any
        signals.fetchDepth += 1
        try {
          result = original.apply(this, arguments)
        } catch (error) {
          signals.end(token)
          throw error
        } finally {
          signals.fetchDepth -= 1
        }
        try {
          if (result && typeof result.then === 'function') {
            var done = function (): void {
              signals.end(token)
            }
            result.then(done, done)
          } else {
            signals.end(token)
          }
        } catch (error) {
          signals.end(token)
        }
        return result
      }
    },
    undo,
    release
  )

  var xhrProto: any = null
  try {
    xhrProto = root.XMLHttpRequest ? root.XMLHttpRequest.prototype : null
  } catch (error) {
    xhrProto = null
  }
  if (xhrProto && typeof xhrProto.addEventListener === 'function') {
    signals.available.xhr = agentPatchProperty(
      xhrProto,
      'send',
      true,
      function (original: any, control: any) {
        return function (this: any) {
          if (!control.live || signals.fetchDepth > 0) return original.apply(this, arguments)
          var token = signals.begin()
          try {
            var xhr = this
            var done = function (): void {
              signals.end(token)
            }
            xhr.addEventListener('loadend', done)
            xhr.addEventListener('readystatechange', function () {
              if (xhr.readyState === 4) done()
            })
          } catch (error) {
            signals.end(token)
          }
          try {
            return original.apply(this, arguments)
          } catch (error) {
            signals.end(token)
            throw error
          }
        }
      },
      undo,
      release
    )
  }
  return signals
}

/**
 * Folds a stateless snapshot and the in-app evidence into the verdict. Pure: `now` is passed in so
 * the arithmetic is testable without a clock.
 *
 * - `commitQuietMs = now - lastCommit` (null if commits cannot be observed).
 * - `networkQuietMs = 0` while anything is in flight, else `now - lastCompletion` (null if neither
 *   `fetch` nor `XMLHttpRequest` could be wrapped).
 * - `quiet` needs each *available* clock to have reached its threshold and nothing in flight. An
 *   unavailable signal does not block quiet (it cannot be consulted) but it is named in `missing`
 *   and clears `confident`, so the host can tell a verdict made on fewer signals.
 * - `settled` = found, no loading affordance, quiet, and not `painted === false`. `painted` null
 *   (no `requestAnimationFrame`) does not block; it is listed as missing like any other.
 *
 * ## What no longer has parity with the old `readinessExpr` path, and why that is correct
 *
 * The structure signature, `hidden()` pruning, focused-screen identification, `content`, `loading`,
 * `active` (apart from path length) and `paramMismatch` are the same code in the same order and are
 * still asserted equal. `settled`, `quiet`, `painted`, the timings and `missing` have no
 * counterpart: the old path inferred quiet from two identical samples ~570ms apart, which is
 * meaningless at 14ms. A snapshot that is identical twice in a row is no longer treated as evidence
 * of anything; the app's own commit and request clocks are.
 */
export function agentVerdict(
  snapshot: any,
  signals: any,
  painted: boolean | null,
  now: number,
  quietMs: number,
  idleMs: number
): ReadinessReply {
  var missing: string[] = []
  if (!signals.available.commits) missing.push('commits')
  if (!signals.available.fetch) missing.push('fetch')
  if (!signals.available.xhr) missing.push('xhr')
  if (painted === null) missing.push('paint')
  var commitQuietMs: number | null = signals.available.commits
    ? Math.max(0, now - signals.commitAt)
    : null
  var networkTracked = signals.available.fetch || signals.available.xhr
  var networkQuietMs: number | null = networkTracked
    ? signals.pending > 0
      ? 0
      : Math.max(0, now - signals.settledAt)
    : null
  var quiet =
    (commitQuietMs === null || commitQuietMs >= quietMs) &&
    (networkQuietMs === null || (signals.pending === 0 && networkQuietMs >= idleMs))
  var out: any = snapshot
  out.quiet = quiet
  out.painted = painted
  out.commitQuietMs = commitQuietMs
  out.networkQuietMs = networkQuietMs
  out.inflight = networkTracked ? signals.pending : null
  out.missing = missing
  out.confident = missing.length === 0
  out.settled = !!out.found && !out.loading && quiet && painted !== false
  return out
}

/**
 * The `readiness` command: waits for two frames, then answers once with the verdict.
 *
 * ## The paint check
 *
 * Two nested `requestAnimationFrame` callbacks: the first runs before the next paint, the second
 * before the one after, so by the time the second fires a frame has been presented for whatever the
 * tree looked like when the first was queued. This is what the 570ms CLI round-trip used to supply
 * for free. `painted` is also false if a commit landed while the frames were pending, because then
 * the frames painted a tree that is no longer the tree.
 *
 * A backgrounded app or a stalled UI thread never delivers the frames, so a timer (`paintTimeoutMs`)
 * answers `painted: false` instead of leaving the host to time out with no information. With no
 * `requestAnimationFrame` at all the check is reported unavailable (`painted: null`) and the reply is
 * immediate. The snapshot and the timestamps are taken *after* the frames, so the verdict describes
 * the tree as it is when the reply is sent.
 */
export function agentSettle(
  signals: any,
  routeName: string,
  expectedParams: Record<string, string> | null,
  limits: AgentLimits,
  quietMs: number,
  idleMs: number,
  reply: (value: unknown) => void
): void {
  var root = globalThis as any
  var finished = false
  var timer: any = null
  var commitAtStart = signals.commitAt
  var finish = function (painted: boolean | null): void {
    if (finished) return
    finished = true
    try {
      if (timer !== null) root.clearTimeout(timer)
    } catch (error) {
      timer = null
    }
    try {
      var now = Date.now()
      var snapshot = agentReadiness(routeName, expectedParams, limits)
      reply(agentVerdict(snapshot, signals, painted, now, quietMs, idleMs))
    } catch (error) {
      reply({
        error: 'command-failed',
        detail: String(error && (error as any).message).slice(0, 200)
      })
    }
  }
  var raf = root.requestAnimationFrame
  if (typeof raf !== 'function') {
    finish(null)
    return
  }
  try {
    var timeout =
      typeof limits.paintTimeoutMs === 'number' && limits.paintTimeoutMs > 0
        ? limits.paintTimeoutMs
        : 500
    timer = root.setTimeout(function () {
      finish(false)
    }, timeout)
    raf.call(root, function () {
      raf.call(root, function () {
        finish(signals.commitAt === commitAtStart)
      })
    })
  } catch (error) {
    finish(null)
  }
}

/**
 * Installs the agent at `globalThis[key]` and arms the lease. See the file doc for the lease and
 * the fail-closed rules; the order below matters:
 *
 * 1. Restore any previous agent under the same key (a reconnect re-installs under the key it used
 *    before, and two live agents would double-arm the watchdog).
 * 2. Refuse outright if there is no timer to arm. An agent that cannot expire is the one outcome
 *    this design exists to prevent.
 * 3. Arm the lease *before* publishing the global, and restore on any failure, so there is no window
 *    in which the agent is reachable but unguarded.
 *
 * `invoke` takes the command as a JSON string and replies at most once, through the callback the
 * host wraps around its binding. It never throws: a malformed or failing command becomes an
 * `AgentErrorReply`, because an exception inside `Runtime.evaluate` would surface on the host as an
 * evaluation failure and be indistinguishable from the wrapper itself failing to compile.
 */
export function agentInstall(key: string, leaseMs: number, limits: AgentLimits): void {
  var root = globalThis as any
  var previous = root[key]
  if (previous && typeof previous.restore === 'function') {
    try {
      previous.restore()
    } catch (error) {
      previous = null
    }
  }
  if (typeof root.setTimeout !== 'function' || typeof root.clearTimeout !== 'function') {
    throw new Error('no timers available: refusing to install without a watchdog')
  }
  var lease = typeof leaseMs === 'number' && isFinite(leaseMs) && leaseMs > 0 ? leaseMs : 10000
  var stopped = false
  var watchdog: any = null
  var undo: Array<() => void> = []
  var agent: InstalledAgent | null = null
  var signals: any = null

  function restore(): void {
    if (stopped) return
    stopped = true
    try {
      root.clearTimeout(watchdog)
    } catch (error) {
      watchdog = null
    }
    watchdog = null
    for (var i = undo.length - 1; i >= 0; i--) {
      try {
        undo[i]()
      } catch (error) {
        continue
      }
    }
    undo.length = 0
    // Only remove the global if it is still ours, so a stale watchdog cannot delete a newer agent.
    try {
      if (root[key] === agent) delete root[key]
    } catch (error) {
      try {
        root[key] = undefined
      } catch (inner) {
        stopped = true
      }
    }
  }

  function renewLease(): void {
    if (stopped) return
    try {
      root.clearTimeout(watchdog)
      watchdog = root.setTimeout(function () {
        restore()
      }, lease)
    } catch (error) {
      // Fail closed: an agent that cannot re-arm its watchdog must not keep running.
      restore()
    }
  }

  /* Runs a command and hands its reply to the callback; readiness calls it after the paint check. */
  function dispatch(command: any, done: (value: unknown) => void): void {
    var type = command && command.type
    if (type === 'heartbeat') {
      done({ alive: true })
    } else if (type === 'nav-state') {
      done(agentNavState(limits))
    } else if (type === 'navigate') {
      done(agentNavigate(command.route, command.params || null, limits))
    } else if (type === 'readiness') {
      var quiet =
        typeof command.quietMs === 'number' && isFinite(command.quietMs) && command.quietMs >= 0
          ? command.quietMs
          : limits.quietMs
      var idle =
        typeof command.idleMs === 'number' && isFinite(command.idleMs) && command.idleMs >= 0
          ? command.idleMs
          : limits.idleMs
      agentSettle(
        signals,
        String(command.route),
        command.expectedParams || null,
        limits,
        quiet,
        idle,
        done
      )
    } else {
      done({ error: 'unknown-command' })
    }
  }

  agent = {
    invoke: function (commandJson: string, reply: (value: unknown) => void): void {
      var replied = false
      var once = function (value: unknown): void {
        if (replied) return
        replied = true
        try {
          reply(value)
        } catch (error) {
          replied = true
        }
      }
      var command: any
      try {
        command = JSON.parse(commandJson)
      } catch (error) {
        once({ error: 'invalid-command' })
        return
      }
      if (command && command.type === 'restore') {
        restore()
        once({ restored: true })
        return
      }
      if (stopped) {
        once({ stopped: true })
        return
      }
      renewLease()
      if (stopped) {
        once({ stopped: true })
        return
      }
      try {
        dispatch(command, once)
      } catch (error) {
        once({
          error: 'command-failed',
          detail: String(error && (error as any).message).slice(0, 200)
        })
      }
    },
    restore: restore
  }
  renewLease()
  if (stopped) throw new Error('could not arm the lease watchdog')
  // Patch only after the watchdog is armed, so the app is never instrumented without an expiry, and
  // restore on any failure so a half-installed agent cannot leave patches behind.
  try {
    signals = agentCreateSignals(root, undo, restore)
    root[key] = agent
  } catch (error) {
    restore()
    throw error
  }
}

/**
 * Everything that is injected, in the order it is declared in the app. The key is the name each
 * function is declared and called by; `runtime-source.ts` verifies `fn.name` matches it.
 */
export const AGENT_FUNCTIONS = {
  agentCollectFiberRoots,
  agentFindNavigator,
  agentFlattenRoutes,
  agentNavState,
  agentNavigate,
  agentStyleFlags,
  agentHidden,
  agentComponentName,
  agentReadiness,
  agentPatchProperty,
  agentCreateSignals,
  agentVerdict,
  agentSettle,
  agentInstall
} as const
