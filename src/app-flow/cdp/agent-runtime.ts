/* eslint-disable @typescript-eslint/no-explicit-any, no-var, @typescript-eslint/no-unused-vars, prefer-rest-params, @typescript-eslint/no-this-alias --
   `any`: everything below reads objects owned by the app under test (fibers, navigation state,
   props). None of it has a type we control, and a fake hierarchy would only pretend otherwise.
   `var`: how the existing functions are written, see the syntax rules below; `let`/`const` are
   allowed now but rewriting the existing bodies would be churn with no benefit. Unused catch bindings: `catch (error)` is kept
   over the newer binding-less form for the same reason. `arguments` and `this` aliasing: the
   patch wrappers forward whatever the app passed, of any arity, with its own receiver. */
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
 * ## SYNTAX RULES -- read before "modernising" anything in this file
 *
 * The source below is evaluated by Hermes' **debugger** evaluator (`Runtime.evaluate`), which does
 * not lower code the way the app's bundler does. Nothing transforms these functions on the way out
 * either: `runtime-source.ts` injects `fn.toString()` verbatim. (It briefly ran an esbuild
 * `target: 'es2015'` pass, mirroring the reference's build step, but esbuild's JavaScript API
 * cannot run from the bundled `dist/server.mjs`, so the packaged plugin failed on first connect.
 * See the header of `runtime-source.ts`.) **What you write here is what Hermes gets.**
 *
 * The ban list is still narrower than the old hand-written one, because the evidence is: the
 * reference's packaged artefact ships `class`, `for...of`, template literals, spread and optional
 * chaining to the same Hermes debugger evaluator through the same `Runtime.evaluate` call, and
 * performs no syntax scan on them at all. Inside every function in `AGENT_FUNCTIONS`:
 *
 * - **ES2015 and below is fine**: `class`, `for...of`, template literals, spread/rest,
 *   destructuring, default parameters, arrow functions, `let`/`const`, `Set` and `Map`.
 * - **Optional chaining (`?.`) is fine** — the reference ships it raw to the same evaluator.
 * - **No `async` / `await`, and so no promises-as-control-flow.** Without a lowering pass these
 *   reach Hermes exactly as written, and this agent has no await-based path that would justify
 *   finding out how its debugger evaluator handles them.
 * - **No nullish coalescing (`??`).** Banned for the same reason; write the explicit null check,
 *   which is clearer about which falsy values you meant anyway.
 *
 * `runtime-source.ts` scans the assembled source for `async`, `await` and `??` and refuses to build
 * if any appears. That scan is textual and cannot tell a comment from code, so do not spell those
 * tokens out inside a function body — and note that comments now ride along into the injected
 * text, where the esbuild pass used to strip them.
 *
 * ## Other rules that follow from "this is toString()'d"
 *
 * - **A function may reference only other `AGENT_FUNCTIONS` and the app's globals.** It is
 *   re-created in a fresh scope in the app, so a module constant (`WALK_BUDGET`) or an imported
 *   helper does not exist there and fails as a `ReferenceError` on first use. Configuration crosses
 *   the boundary as an argument (`AgentLimits`), and the test suite evaluates the assembled,
 *   lowered source in an empty `node:vm` context and calls every function there, so such a
 *   reference surfaces as a `ReferenceError` in the test run instead of against a device.
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
  | {
      type: 'navigate'
      route: string[]
      params: Record<string, string> | null
      /** Expo Router routes by pathname rather than React Navigation's nested route names. */
      expoPath: string | null
      /**
       * Ancestor navigator names the host believes may register `route[0]`, from the parser's own
       * grouping. Tried against the root's `routeNames` only when the live tree has no match,
       * which is what an unvisited tab looks like: it has no mounted state to search.
       */
      candidates?: string[] | null
    }
  | {
      type: 'links'
      /** Candidate cap for this call; defaults to `LINK_CANDIDATE_CAP`. */
      max?: number
    }
  | {
      type: 'readiness'
      route: string
      expectedParams: Record<string, string> | null
      /** Override the commit quiet window for this call. */
      quietMs?: number
      /** Override the network idle window for this call. */
      idleMs?: number
    }
  /**
   * Hands the agent the source presentation catalog and binds its state sites to live hooks.
   * Opens the bounded hook-patch window, so the host allows it 5000ms — the reference's own
   * timeout for the same command.
   */
  | {
      type: 'presentation-setup'
      states: PresentationStateSite[]
      actions: PresentationAction[]
      /** Metro's project root, used to resolve a catalog's relative file against a module path. */
      projectRoot?: string | null
    }
  /**
   * Labels live bindings with the source sites the host's symbolication join proved they belong
   * to (`presentations-bindings.ts`). The in-app pass can only attribute a binding whose owner is
   * a candidate for exactly one site; everything else needs Metro's source maps, which only the
   * host can read. Pure bookkeeping — nothing is rendered, opened or patched — so it keeps the
   * list command's 2000ms.
   */
  | { type: 'presentation-configure'; matches: { binding: string; site: string }[] }
  /** Which catalog entries are openable right now. The reference allows this 2000ms. */
  | { type: 'presentations' }
  /** Opens one catalog entry and pushes its undo checkpoint. */
  | { type: 'presentation-open'; id: string }
  /** Unwinds the undo stack to `level`, confirming every native dismissal unless `wait` is false. */
  | { type: 'presentation-rollback'; level?: number; wait?: boolean }

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
  | {
      ok: true
      action: 'expo-replace' | 'replace' | 'navigate' | 'noop'
      /** The full root-to-leaf navigator path actually dispatched, once resolved. */
      path?: string[]
      /** Whether `route[0]` was a root route, or had to be located inside a nested navigator. */
      via?: 'exact' | 'nested'
    }
  | {
      ok: false
      reason:
        | 'no-navigator'
        | 'no-dispatch'
        | 'no-expo-router'
        | 'unregistered'
        | 'invalid-route'
        | 'threw'
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

/* --------------------------------------------------------------- link harvest */

/** Most link candidates one `links` command may return. Matches the reference runtime's cap. */
export const LINK_CANDIDATE_CAP = 200

/**
 * One destination a link element in the tree names.
 *
 * `name` and `params` together are the thing the a11y learners structurally cannot assemble: both
 * halves of a two-param route arrive in a single record, so no precedence rule has to decide which
 * identifier on screen owned which key.
 */
export interface LinkCandidate {
  /** The route name an object destination named (`screen`). */
  name?: string
  /** A routable path, from a string destination or an object's `pathname`. */
  path?: string
  /** URL-able values only — strings and finite numbers, as `agentFlattenRoutes` filters them. */
  params?: Record<string, string>
}

/** The `links` command's reply. `scanned` and `capped` are host diagnostics, never param values. */
export interface LinksReply {
  links: LinkCandidate[]
  /** Fibers visited by the walk. */
  scanned: number
  /** True when the walk stopped on the node budget, the deadline, or the candidate cap. */
  capped: boolean
}

/**
 * The path part of a string destination, or null when there is nothing routable in it.
 *
 * Deliberately permissive about the scheme and strict about nothing else: `normalizePath` in
 * `param-store.ts` owns the real parsing, and this only has to keep obvious non-routes (a label, a
 * callback stringified by accident, an absolute asset URL) out of the 200-candidate budget.
 */
export function agentRoutablePath(value: any): string | null {
  if (typeof value !== 'string') return null
  if (!value || value.length > 500) return null
  if (value.charAt(0) === '/') return value
  if (/^[a-zA-Z][\w+.-]*:\/\//.test(value)) return value
  return null
}

/**
 * Reads one `href`/`to` prop into a candidate, or null when it names no destination.
 *
 * Accepts the two shapes React Navigation and Expo Router apps actually use: a path string, and an
 * object carrying `screen`/`pathname` alongside `params`. A bare route name with no params is
 * dropped -- it resolves nothing the navigator state did not already say -- so every candidate
 * returned is either a path or a name with values attached.
 */
export function agentLinkCandidate(href: any): LinkCandidate | null {
  var candidate: LinkCandidate = {}
  var asPath = agentRoutablePath(href)
  if (asPath) {
    candidate.path = asPath
    return candidate
  }
  if (!href || typeof href !== 'object' || Array.isArray(href)) return null
  if (typeof href.screen === 'string' && href.screen) candidate.name = href.screen
  var fromPathname = agentRoutablePath(href.pathname)
  if (fromPathname) candidate.path = fromPathname
  var raw = href.params
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
    if (any) candidate.params = kept
  }
  if (candidate.path) return candidate
  if (candidate.name && candidate.params) return candidate
  return null
}

/**
 * Every destination the mounted tree's link elements name, deduplicated.
 *
 * This is the one read that can see a destination the app has **not navigated to yet**. The
 * navigator state (`agentNavState`) only knows routes the app has actually entered, and the
 * accessibility harvest can only learn a value that reached a testID; a feed row's `href` carries
 * `name` and `rkey` together, before anybody presses it, which is exactly what neither of the
 * other two sources can produce.
 *
 * Unlike the readiness walk this one does **not** prune hidden subtrees. An unfocused tab and an
 * off-screen row still hold their destinations, and those are the ones worth having.
 *
 * Bounded exactly like `agentFindNavigator` -- `limits.walkBudget` nodes, `limits.walkDeadlineMs`
 * of wall clock, a `seen` set for cycles -- because it runs on the app's JS thread. It stops at
 * `max` candidates rather than walking a whole feed for destinations that will not fit in the
 * reply, and says so through `capped`.
 */
export function agentCollectLinks(limits: AgentLimits, max: number): LinksReply {
  var stack = agentCollectFiberRoots()
  var links: LinkCandidate[] = []
  var keys = new Set()
  var seen = new Set()
  var scanned = 0
  var capped = false
  var deadline = Date.now() + limits.walkDeadlineMs
  var budget = limits.walkBudget
  while (stack.length) {
    if (budget-- <= 0) {
      capped = true
      break
    }
    if ((budget & 255) === 0 && Date.now() > deadline) {
      capped = true
      break
    }
    var fiber = stack.pop()
    if (!fiber || seen.has(fiber)) continue
    seen.add(fiber)
    scanned += 1
    if (fiber.child) stack.push(fiber.child)
    if (fiber.sibling) stack.push(fiber.sibling)
    var props = fiber.memoizedProps
    if (!props || typeof props !== 'object') continue
    var href = props.href
    if (href === undefined || href === null) href = props.to
    if (href === undefined || href === null) continue
    var candidate = agentLinkCandidate(href)
    if (!candidate) continue
    var key: string
    try {
      key = JSON.stringify([candidate.name, candidate.path, candidate.params])
    } catch (error) {
      continue
    }
    if (keys.has(key)) continue
    if (links.length >= max) {
      capped = true
      break
    }
    keys.add(key)
    links.push(candidate)
  }
  return { links: links, scanned: scanned, capped: capped }
}

/** Where `agentResolveRoutePath` found the requested route, and the path to dispatch for it. */
export interface ResolvedRoutePath {
  /** The root-to-leaf path. Equal to the requested route unless a nested navigator supplied it. */
  path: string[]
  via: 'exact' | 'nested' | 'none'
  /** How many navigators were inspected, for the host's diagnostics only. */
  searched: number
}

/**
 * Resolves a requested route to a path the root navigator can actually dispatch.
 *
 * The parser spells most react-navigation ids as bare leaf names, so `route[0]` is usually a screen
 * registered inside some nested navigator rather than a root route. Checking only the root's
 * `routeNames` (which is all the dispatch guard used to do) refuses those outright. So when the root
 * does not register it, the mounted navigator tree is searched breadth first - bounded at 500
 * navigators and 16 levels - carrying each child navigator's ancestor route-name chain, and the
 * match becomes the chain concatenated with the requested route.
 *
 * A screen registered in several tabs matches several times. The candidate sharing the longest
 * prefix with the live focused path wins, which keeps the app in the tab it is already on instead
 * of yanking it to whichever navigator the walk happened to reach first.
 */
export function agentResolveRoutePath(state: any, route: string[]): ResolvedRoutePath {
  var head = String(route[0])
  if (state && Array.isArray(state.routeNames) && state.routeNames.indexOf(head) >= 0) {
    return { path: route.slice(), via: 'exact', searched: 0 }
  }
  // The focused route names from the root down, innermost last, bounded like every other walk here.
  var focused: string[] = []
  var cursor = state
  for (var level = 0; cursor && Array.isArray(cursor.routes) && cursor.routes.length && level < 16; level++) {
    var active = cursor.routes[cursor.index == null ? 0 : cursor.index]
    if (!active || typeof active.name !== 'string') break
    focused.push(active.name)
    cursor = active.state
  }
  var matches: string[][] = []
  var pending: any[] = [{ state: state, depth: 0, chain: [] as string[] }]
  var searched = 0
  while (pending.length && searched < 500) {
    var item = pending.shift()
    var node = item && item.state
    if (!node || item.depth >= 16) continue
    searched++
    if (
      item.chain.length &&
      Array.isArray(node.routeNames) &&
      node.routeNames.indexOf(head) >= 0
    ) {
      matches.push(item.chain.concat(route))
    }
    if (!Array.isArray(node.routes)) continue
    for (var index = 0; index < node.routes.length; index++) {
      var child = node.routes[index]
      if (!child || !child.state || typeof child.name !== 'string') continue
      pending.push({
        state: child.state,
        depth: item.depth + 1,
        chain: item.chain.concat([child.name])
      })
    }
  }
  if (!matches.length) return { path: route.slice(), via: 'none', searched: searched }
  var best = matches[0]
  var bestScore = -1
  for (var candidate = 0; candidate < matches.length; candidate++) {
    var shared = 0
    while (
      shared < matches[candidate].length &&
      shared < focused.length &&
      matches[candidate][shared] === focused[shared]
    ) shared++
    if (shared > bestScore) {
      bestScore = shared
      best = matches[candidate]
    }
  }
  return { path: best, via: 'nested', searched: searched }
}

/** Dispatches a nested React Navigation route after proving its leaf is registered live. */
export function agentNavigate(
  route: string[],
  params: Record<string, string> | null,
  limits: AgentLimits,
  expoPath: string | null,
  candidates: string[] | null
): NavigateReply {
  if (!Array.isArray(route) || !route.length) return { ok: false, reason: 'invalid-route' }
  if (expoPath) {
    // Match the original App Flow runtime: inspect only Metro modules the app already initialized,
    // never execute a cold module just to obtain Expo Router's imperative singleton.
    var modules = (globalThis as any).__r && (globalThis as any).__r.getModules
      ? (globalThis as any).__r.getModules()
      : null
    if (modules && typeof modules.values === 'function') {
      var values = modules.values()
      var next = values.next()
      while (!next.done) {
        var module = next.value
        if (module && module.isInitialized) {
          var exports = module.publicModule && module.publicModule.exports
          var descriptor = exports && Object.getOwnPropertyDescriptor(exports, 'router')
          var router = descriptor && 'value' in descriptor ? descriptor.value : null
          if (
            router &&
            typeof router.push === 'function' &&
            typeof router.replace === 'function' &&
            typeof router.canGoBack === 'function'
          ) {
            try {
              router.replace({ pathname: expoPath, params: params || {} })
              return { ok: true, action: 'expo-replace' }
            } catch (error) {
              return {
                ok: false,
                reason: 'threw',
                detail: String(error && (error as any).message).slice(0, 80)
              }
            }
          }
        }
        next = values.next()
      }
    }
    return { ok: false, reason: 'no-expo-router' }
  }
  var found = agentFindNavigator(limits)
  if (!found) return { ok: false, reason: 'no-navigator' }
  var nav = found.nav
  if (!nav || typeof nav.dispatch !== 'function') return { ok: false, reason: 'no-dispatch' }
  var current = found.state
  var resolved = agentResolveRoutePath(current, route)
  // An unvisited tab has no mounted state for the walk above to see, so the host's parsed ancestor
  // names get one last try against the root before the route is called unregistered.
  if (resolved.via === 'none' && Array.isArray(candidates) && Array.isArray(current.routeNames)) {
    for (var guess = 0; guess < candidates.length; guess++) {
      var ancestor = String(candidates[guess])
      if (!ancestor || current.routeNames.indexOf(ancestor) < 0) continue
      resolved = {
        path: [ancestor].concat(route),
        via: 'nested',
        searched: resolved.searched
      }
      break
    }
  }
  if (resolved.via === 'none') {
    return {
      ok: false,
      reason: 'unregistered',
      detail: 'searched ' + resolved.searched + ' mounted navigator(s)'
    }
  }
  var path = resolved.path
  var via: 'exact' | 'nested' = resolved.via

  // Preserve the original runtime's bounded-stack behavior: replace the focused leaf when the
  // requested path is already inside that stack, otherwise navigate through the nested payload.
  // This avoids accumulating one mounted screen per Fast capture.
  var leaf = current
  for (var depth = 0; depth < path.length - 1; depth++) {
    var step = leaf && leaf.routes && leaf.routes[leaf.index == null ? 0 : leaf.index]
    if (!step || step.name !== path[depth]) {
      leaf = null
      break
    }
    leaf = step.state
  }
  var expected = String(path[path.length - 1])
  var selected = leaf && leaf.routes && leaf.routes[leaf.index == null ? 0 : leaf.index]
  var same = function (before: any, after: any, depth: number, budget: any): boolean {
    if (Object.is(before, after)) return true
    if (
      !before ||
      !after ||
      typeof before !== 'object' ||
      typeof after !== 'object' ||
      depth > 6 ||
      --budget.left < 0
    ) return false
    var array = Array.isArray(before)
    if (
      array !== Array.isArray(after) ||
      (!array &&
        (Object.getPrototypeOf(before) !== Object.prototype ||
          Object.getPrototypeOf(after) !== Object.prototype))
    ) return false
    var a = Object.getOwnPropertyDescriptors(before)
    var b = Object.getOwnPropertyDescriptors(after)
    var keys = Object.keys(a)
    if (keys.length > 200 || keys.length !== Object.keys(b).length) return false
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      var key = keys[keyIndex]
      if (
        !a[key] ||
        !b[key] ||
        !('value' in a[key]) ||
        !('value' in b[key]) ||
        !same(a[key].value, b[key].value, depth + 1, budget)
      ) return false
    }
    return true
  }
  var nested: any = params && Object.keys(params).length ? params : undefined
  for (var offset = path.length - 1; offset > 0; offset--) {
    nested = { screen: String(path[offset]), params: nested, initial: false }
  }
  var payload: any = { name: String(path[0]) }
  if (nested !== undefined) payload.params = nested
  try {
    if (
      leaf &&
      leaf.type === 'stack' &&
      leaf.key &&
      Array.isArray(leaf.routeNames) &&
      leaf.routeNames.indexOf(expected) >= 0
    ) {
      if (
        selected &&
        selected.name === expected &&
        (!params || same(selected.params || {}, params, 0, { left: 200 }))
      ) return { ok: true, action: 'noop', path: path, via: via }
      nav.dispatch({
        type: 'REPLACE',
        target: leaf.key,
        payload: { name: expected, params: params || undefined }
      })
      return { ok: true, action: 'replace', path: path, via: via }
    }
    nav.dispatch({ type: 'NAVIGATE', payload: payload })
    return { ok: true, action: 'navigate', path: path, via: via }
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


/* ======================================================================= presentations

   The in-app presentation runtime, ported from the reference implementation's
   `src/server/app-flow/presentations-runtime.js`.

   ## What this buys

   A modal, bottom sheet or dialog is a *variant* of a screen, not a route. The sweep cannot reach
   one by navigating, and reaching one by tapping needs a model planner plus a tap that may do
   something else entirely. The reference's answer, ported here, is to open it the way the app
   itself opens it: call the component's own `useState` setter, or the zero-argument `open()` on the
   controller object the app already holds. The host's existing capture then photographs it, and
   `presentation-rollback` puts the app back exactly as it was.

   ## The three effect kinds

   - **state** — the opening is `setShowSheet(true)`. We find the live hook, remember the current
     value, and call the app's own setter with the functional form, which is what keeps a queued app
     update from being clobbered by ours.
   - **control** — the opening is `sheetRef.current.present()`. We call that zero-argument method
     and remember its paired closer.
   - **mount** — there is no opening at all: the component is projected on its own (below).

   ## The synthetic-Modal projection

   `agentProject` is the part that most deserves reading before changing. It does **not** clone a
   fiber tree. It builds one element, `react.createElement(type, props)`, re-wraps it in the context
   providers found up the focus's `return` chain, puts it inside an error boundary, and appends that
   as a **sibling** of the live app inside a fresh `Modal`. Four properties are load-bearing and each
   was a bug in the reference before it was a rule:

   - The copy is a *new element of the same type*, so it renders from scratch with the app's own
     component. A fiber clone would share mutable state with the live tree.
   - Contexts are re-created up the chain, **excluding** `ScrollView.Context` and
     `VirtualizedList.contextType`: a new Modal is a new native window, and restoring a list parent
     from a different window hands native list code a container it does not own.
   - Errors are contained by swapping the root's `onCaughtError` for a wrapper that suppresses
     **only** this boundary's errors. Every other app error keeps the original handler, so the app's
     own LogBox behaviour is unchanged.
   - The new Modal is attached with `renderer.overrideProps(root, [], record.next)` where `next`
     spreads the app's existing root children *flat* alongside the modal. Nesting them under a new
     array would change the element identity React reconciles against and remount the whole live
     app, re-running every effect in it.

   ## Why rollback is the safety-critical half

   Opening is one call. Putting the app back is a protocol. On iOS a `Modal` reports its dismissal
   through `onDismiss`, and React Native removes that listener when the Modal unmounts. So the order
   is: set `visible: false` but **keep the Modal mounted**, poll for `record.dismissed` with a
   2000ms deadline, and only then restore the root's original children. Unmounting first removes the
   listener before the event can arrive, and the app is then left with a native window nothing can
   prove is closed. For the same reason a detached owner on iOS throws rather than quietly dropping
   the checkpoint: a projection whose root vanished cannot be confirmed dismissed.

   ## What is bounded, and why every bound is kept

   Everything here runs on the app's JS thread. The hook-collection patch window is 80ms and the
   patch is removed in every exit path; bindings are capped at 1500, hook indices at 300, stacks at
   8000 characters; the seed substitution expires after 1000ms; a control dismissal waits at most
   4000ms with one retry; a modal dismissal at most 2000ms. These are the reference's numbers and
   are deliberately not re-tuned here.

   ## Deliberately not ported

   - The reference's Babel instrumentation plugin and its `__MOBILE_DEV_FLOW_REGISTRY__` prepared
     binding fast path. This repo has no transform hook, so there is no registry to read and the
     stack-symbolication path below is the only binding route.
   - `openedSites`/`controlSites`. Those read `flow-owner-N:` ids off Profiler (`tag === 12`)
     markers that only the instrumentation plugin emits, so here they would always return nothing.
   - The in-app capture driver and queue. The host drives capture.
   - The TanStack Query observer result reuse, the portal/UI-effect approval paths, the prepared
     host-slot placement and the inline (non-Modal) projection placement. Each is an optimisation
     layered on top of the mechanics above and each needs its own stage. */

/** Most hook slots walked on one owner when locating a binding. The reference's cap. */
export const PRESENTATION_HOOK_INDEX_CAP = 300
/** Most live hook bindings held at once. The reference's cap. */
export const PRESENTATION_BINDING_CAP = 1500
/** Longest creation stack retained per binding, in characters. The reference's cap. */
export const PRESENTATION_STACK_CAP = 8000
/** How long hooks stay patched around a forced render pass, in milliseconds. */
export const PRESENTATION_COLLECT_WINDOW_MS = 80
/** How long a projected copy may go without consuming its seeded hook value. */
export const PRESENTATION_SEED_DEADLINE_MS = 1000
/** How long an iOS modal may take to report `onDismiss` before rollback gives up. */
export const PRESENTATION_DISMISS_DEADLINE_MS = 2000
/** How long a controller-owned native presentation may take to close, with one retry inside. */
export const PRESENTATION_CONTROL_DEADLINE_MS = 4000
/** Poll interval while waiting for a native dismissal. The reference's 40ms. */
export const PRESENTATION_POLL_MS = 40

/** The six `Modal` props a projected copy inherits from the nearest ancestor `Modal`. */
export const MODAL_CARRY_OVER_PROPS = [
  'presentationStyle',
  'transparent',
  'statusBarTranslucent',
  'navigationBarTranslucent',
  'hardwareAccelerated',
  'supportedOrientations'
] as const

/** A state site as the source scan emits it; only the fields the agent reads are named. */
export interface PresentationStateSite {
  id: string
  file: string
  owner: string
  hook?: 'useState' | 'useReducer'
  owners?: string[]
  ownerSites?: { file: string; owner: string }[]
}
/** A presentation action as the source scan emits it; only the fields the agent reads are named. */
export interface PresentationAction {
  id: string
  name: string
  owner: string
  component: string
  prop: string
  preview?: boolean
  views?: string[]
  effect:
    | { kind: 'mount'; file: string; export: string }
    | { kind: 'state'; site: string; path: string[]; value: unknown }
    | { kind: 'control'; component: string; prop: string; method: string; close: string | string[] }
}

/** `presentation-setup`: hand the agent the source catalog and bind it to the live tree. */
export interface PresentationSetupReply {
  ok: boolean
  /** Live hook bindings after the collection pass. */
  bindings: number
  /** Bindings matched to a source state site. */
  matched: number
  /** Owners the pass forced a render on. Bounded; never a component name. */
  scheduled: number
  /**
   * Bindings with no site yet, with the creation stack the host symbolicates against Metro. The
   * host answers with `presentation-configure`. Bounded at 400 entries.
   */
  unbound?: { id: string; owner: string; kind: 'state'; stack: string }[]
  /** Wall clock the whole pass occupied, for the host's bounded meter. */
  elapsedMs: number
  error?: string
}
/** `presentation-configure`: how many of the host's matches named a live binding. */
export interface PresentationConfigureReply {
  ok: boolean
  configured: number
  elapsedMs: number
}
/** `presentations`: which catalog entries are openable against the tree as it is now. */
export interface PresentationListReply {
  available: { id: string; kind: 'state' | 'control' | 'mount' }[]
  /** Catalog entries with no live binding. A count only; never an id or a name. */
  unavailable: number
  elapsedMs: number
}
/** `presentation-open` / `presentation-rollback`. */
export type PresentationOpenReply =
  | { ok: true; kind: 'state' | 'control' | 'mount'; checkpoint: number; elapsedMs: number }
  | { ok: false; error: string; checkpoint: number; elapsedMs: number }
export type PresentationRollbackReply =
  | { ok: true; checkpoint: number; elapsedMs: number }
  | { ok: false; error: string; checkpoint: number; elapsedMs: number }

/**
 * Whether `value` is a presentation controller: a zero-argument opener paired with a closer.
 *
 * Ported verbatim from the reference (`openingControl`). The arity check is the whole point — a
 * one-argument `open(id)` is an app API that needs data we do not have, and calling it would be a
 * guess. Descriptors are read rather than properties, so a getter is never invoked: evaluating an
 * app getter to decide whether something is a sheet controller is exactly the kind of side effect
 * this runtime must not have.
 */
export function agentOpeningControl(value: any, method?: string): boolean {
  if (!value || typeof value !== 'object') return false
  var data = function (key: string): any {
    var descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  }
  var pairs: Array<[string, string[]]> = [
    ['open', ['close', 'dismiss', 'hide']],
    ['present', ['dismiss', 'close']],
    ['show', ['hide', 'close']],
    ['expand', ['close', 'collapse']]
  ]
  for (var at = 0; at < pairs.length; at++) {
    var key = pairs[at]![0]
    var closers = pairs[at]![1]
    if (method && method !== key) continue
    var opener = data(key)
    if (typeof opener !== 'function' || opener.length !== 0) continue
    for (var c = 0; c < closers.length; c++) {
      if (typeof data(closers[c]!) === 'function') return true
    }
  }
  return false
}

/** The paired closer's name for a controller, or null. Mirrors `agentOpeningControl`'s table. */
export function agentControlCloser(value: any, method: string): string | null {
  if (!value || typeof value !== 'object') return null
  var table: Record<string, string[]> = {
    open: ['close', 'dismiss', 'hide'],
    present: ['dismiss', 'close'],
    show: ['hide', 'close'],
    expand: ['close', 'collapse']
  }
  var closers = table[method]
  if (!closers) return null
  for (var at = 0; at < closers.length; at++) {
    var descriptor = Object.getOwnPropertyDescriptor(value, closers[at]!)
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'function') {
      return closers[at]!
    }
  }
  return null
}

/**
 * Immutably writes `next` at `path` inside `value`. The reference's `setPath`, iterative here
 * because an injected function cannot rely on recursing by name (see the file doc).
 *
 * An empty path replaces the whole value, which is the common case (`setShowSheet(true)`).
 */
export function agentSetPath(value: any, path: string[], next: any): any {
  if (!Array.isArray(path) || !path.length) return next
  var copies: any[] = []
  var cursor = value
  for (var at = 0; at < path.length; at++) {
    copies.push(cursor)
    cursor = cursor === null || cursor === undefined ? undefined : cursor[path[at]!]
  }
  var result = next
  for (var back = path.length - 1; back >= 0; back--) {
    var source = copies[back]
    var copy: any
    if (Array.isArray(source)) copy = source.slice()
    else if (source && typeof source === 'object') {
      copy = {}
      for (var key in source) copy[key] = source[key]
    } else copy = {}
    copy[path[back]!] = result
    result = copy
  }
  return result
}

/**
 * A committed-tree index: every visible fiber, a map from either alternate to the *current* one,
 * and a map from a props object to the fibers rendering it.
 *
 * The reference's `committedStructure`/`index` pair, reduced to the three lookups this stage needs.
 * `current` is what makes a checkpoint survive a commit: React swaps alternates on every render, so
 * a fiber captured at open time is routinely the stale half by the time rollback runs, and every
 * read of a remembered fiber goes through this map first. `props` is what lets a projected copy's
 * element be found again in the tree without matching on a component name.
 *
 * Hidden subtrees are pruned with `agentHidden`, and — exactly as in the readiness walk — the
 * sibling is pushed *before* the prune, because a fiber's later siblings are reachable only through
 * it and dropping them would sever the rest of the list.
 */
export function agentPresentationIndex(pres: any): any {
  if (pres.structureCache) return pres.structureCache
  var all: any[] = []
  var current = new Map()
  var props = new Map()
  var names = new Map()
  var seen = new Set()
  var concealed = new Set()
  var stack = agentCollectFiberRoots()
  var budget = pres.limits.walkBudget
  var deadline = Date.now() + pres.limits.walkDeadlineMs
  var capped = false
  while (stack.length) {
    if (budget-- <= 0 || ((budget & 255) === 0 && Date.now() > deadline)) {
      capped = true
      break
    }
    var fiber = stack.pop()
    if (!fiber || seen.has(fiber)) continue
    seen.add(fiber)
    if (fiber.sibling) stack.push(fiber.sibling)
    if (concealed.has(fiber.return) || agentHidden(fiber.memoizedProps)) {
      concealed.add(fiber)
      continue
    }
    if (fiber.child) stack.push(fiber.child)
    all.push(fiber)
    current.set(fiber, fiber)
    if (fiber.alternate) current.set(fiber.alternate, fiber)
    var label = agentComponentName(fiber.type) || agentComponentName(fiber.elementType)
    if (label) {
      var byName = names.get(label)
      if (!byName) {
        byName = []
        names.set(label, byName)
      }
      byName.push(fiber)
    }
    var owned = fiber.memoizedProps
    if (owned && typeof owned === 'object') {
      var byProps = props.get(owned)
      if (!byProps) {
        byProps = []
        props.set(owned, byProps)
      }
      byProps.push(fiber)
    }
  }
  var tree = {
    all: all,
    current: current,
    props: props,
    names: names,
    capped: capped,
    inside: function (fiber: any, owner: any): boolean {
      if (!owner) return false
      // Prepared JSX and native navigation wrappers can exceed 100 ancestors. Compare exact
      // fibers and stop on a cycle, not at an arbitrary UI depth.
      var walked = new Set()
      for (var parent = fiber; parent && !walked.has(parent); parent = parent.return) {
        if (parent === owner || parent === owner.alternate) return true
        walked.add(parent)
      }
      return false
    }
  }
  pres.structureCache = tree
  return tree
}

/**
 * The value a hook binding currently holds. The reference's `hookValue`.
 *
 * Re-reads through the tree's `current` map first, for the alternate-swap reason above, and rebinds
 * `binding.fiber` to the live half so the next read starts from the right place.
 */
export function agentHookValue(pres: any, binding: any): any {
  var tree = agentPresentationIndex(pres)
  var live = tree.current.get(binding.fiber)
  if (!live) return undefined
  binding.fiber = live
  var state = live.memoizedState
  for (var at = 0; state && at < binding.index; at++) state = state.next
  return state ? state.memoizedState : undefined
}

/**
 * The component identities a source state site's owner could be, read out of Metro's module map.
 *
 * Ported from the reference's `collectionTargets`. The one rule that must not be relaxed: only
 * **data** descriptors are read (`'value' in descriptor`). Invoking an export getter to find out
 * whether it is the `Settings` component would initialise a project module as a side effect of
 * looking, which is the kind of thing this runtime exists not to do. A module that has not been
 * initialised is skipped rather than loaded for the same reason.
 *
 * A site whose owner cannot be resolved to an identity sets `fallback`, which widens collection to
 * every fiber with that display name rather than refusing the site outright.
 */
export function agentCollectionTargets(pres: any, states: any[]): any {
  var targets = new Map()
  var modules = (globalThis as any).__r && (globalThis as any).__r.getModules
    ? (globalThis as any).__r.getModules()
    : null
  var initialized = new Map()
  var normalize = function (value: string): string {
    return String(value).split('\\').join('/').replace(/^file:\/\//, '').replace(/^\.\//, '')
  }
  if (modules && typeof modules.values === 'function') {
    var values = modules.values()
    var next = values.next()
    while (!next.done) {
      var module = next.value
      if (module && module.isInitialized && typeof module.verboseName === 'string') {
        initialized.set(
          normalize(module.verboseName),
          module.publicModule ? module.publicModule.exports : undefined
        )
      }
      next = values.next()
    }
  }
  var exportsFor = function (file: string): any {
    var direct = initialized.get(file)
    if (direct !== undefined) return direct
    return pres.sourceRoot ? initialized.get(pres.sourceRoot + '/' + file) : undefined
  }
  for (var s = 0; s < states.length; s++) {
    var site = states[s]
    if (!site || typeof site.id !== 'string') continue
    var qualified = Array.isArray(site.ownerSites) ? site.ownerSites : []
    var sources: Array<{ owner: string; file: string }> = [{ owner: site.owner, file: site.file }]
    for (var q = 0; q < qualified.length; q++) sources.push(qualified[q])
    var extra = Array.isArray(site.owners) ? site.owners : []
    for (var e = 0; e < extra.length; e++) {
      var already = false
      for (var k = 0; k < qualified.length; k++) if (qualified[k].owner === extra[e]) already = true
      if (!already) sources.push({ owner: extra[e], file: site.file })
    }
    for (var at = 0; at < sources.length; at++) {
      var owner = sources[at]!.owner
      var file = sources[at]!.file
      var target = targets.get(owner)
      if (!target) {
        target = { types: new Set(), sitesByType: new Map(), fallbackSites: new Set(), fallback: false }
        targets.set(owner, target)
      }
      var addType = function (bucket: any, type: any, id: string): void {
        bucket.types.add(type)
        var sites = bucket.sitesByType.get(type)
        if (!sites) {
          sites = new Set()
          bucket.sitesByType.set(type, sites)
        }
        sites.add(id)
      }
      var exported = exportsFor(file)
      var matches: any[] = []
      var descriptors =
        exported && (typeof exported === 'object' || typeof exported === 'function')
          ? Object.getOwnPropertyDescriptors(exported)
          : {}
      for (var key in descriptors) {
        var descriptor = (descriptors as any)[key]
        // Read data exports only. Never initialize a project module or invoke a getter to
        // identify one of several unrelated same-named components.
        if (!descriptor || !('value' in descriptor)) continue
        var type = descriptor.value
        var read = function (holder: any, field: string): any {
          if (!holder || (typeof holder !== 'object' && typeof holder !== 'function')) return undefined
          var found = Object.getOwnPropertyDescriptor(holder, field)
          return found && 'value' in found ? found.value : undefined
        }
        var body = read(type, 'render')
        if (body === undefined) body = read(type, 'type')
        if (body === undefined) body = type
        var named =
          key === owner ||
          (body && (body.displayName === owner || body.name === owner))
        if (named && typeof body === 'function') {
          matches.push(type)
          matches.push(body)
        }
      }
      if (typeof exported === 'function' && exported.name === owner) matches.push(exported)
      if (matches.length) {
        for (var m = 0; m < matches.length; m++) addType(target, matches[m], site.id)
      } else {
        target.fallback = true
        target.fallbackSites.add(site.id)
      }
    }
  }
  return targets
}

/**
 * Replaces React's `useState`/`useReducer` with wrappers that record every setter the forced render
 * pass produces, and that substitute a seeded initial value for a projected copy's first render.
 *
 * Ported from the reference's `patchHooks`. Two properties carry over unchanged:
 *
 * - The **first** module exposing a complete React surface wins and the loop breaks. Several
 *   modules re-export React; patching more than one would wrap the same functions twice.
 * - A non-writable `useState` aborts the whole patch and un-patches what was already applied,
 *   rather than leaving React half-wrapped.
 *
 * The wrappers are created by `agentHookWrapper` rather than inline in the loop because **some
 * Hermes versions share loop bindings across closures** — the reference's own comment, and the
 * reason each wrapper needs its own function scope. Injected code bypasses Metro's block-scope
 * transform, so the `let` that would make this safe in app code does not help here.
 */
export function agentPatchPresentationHooks(pres: any): boolean {
  if (pres.patches.length) return true
  var modules = (globalThis as any).__r && (globalThis as any).__r.getModules
    ? (globalThis as any).__r.getModules()
    : null
  if (!modules || typeof modules.values !== 'function') return false
  var values = modules.values()
  var next = values.next()
  while (!next.done) {
    var module = next.value
    if (module && module.isInitialized) {
      var react = agentMutableReact(module.publicModule ? module.publicModule.exports : undefined)
      if (
        react &&
        typeof react.createElement === 'function' &&
        typeof react.useState === 'function' &&
        typeof react.useReducer === 'function'
      ) {
        var keys = ['useState', 'useReducer']
        for (var at = 0; at < keys.length; at++) {
          var key = keys[at]!
          var descriptor = Object.getOwnPropertyDescriptor(react, key)
          if (!descriptor || !descriptor.writable) continue
          var original = react[key]
          var wrapped = agentHookWrapper(pres, key, original)
          try {
            react[key] = wrapped
          } catch (error) {
            agentUnpatchPresentationHooks(pres)
            return false
          }
          pres.patches.push({ react: react, key: key, original: original, wrapped: wrapped })
        }
        break
      }
    }
    next = values.next()
  }
  return pres.patches.length > 0
}

/** Removes the hook patch, leaving anything a third party wrapped afterwards in place. */
export function agentUnpatchPresentationHooks(pres: any): void {
  for (var at = 0; at < pres.patches.length; at++) {
    var patch = pres.patches[at]
    if (patch.react[patch.key] === patch.wrapped) patch.react[patch.key] = patch.original
  }
  pres.patches.length = 0
}

/**
 * One hook wrapper, in its own function scope.
 *
 * Injected code bypasses Metro's block-scope transform. Some Hermes versions share loop bindings
 * across closures, so each wrapper needs a function scope of its own; this is that scope.
 */
export function agentHookWrapper(pres: any, kind: string, original: any): any {
  return function (): any {
    var args: any[] = []
    for (var at = 0; at < arguments.length; at++) args.push(arguments[at])
    return agentRegisterHook(pres, kind, original, args)
  }
}

/**
 * The body of every hook wrapper: seed the copy, call the real hook, record the setter.
 *
 * Ported from the reference's `register`. Three things are exact and each matters:
 *
 * - **The seed substitutes arguments, it never dispatches.** A projected copy that needs its state
 *   to start at some value gets that value as the hook's *initial* argument
 *   (`useReducer` keeps its reducer and takes `[reducer, value, () => value]`). Dispatching the
 *   app's own reducer, or running its initializer, could fire a request and manufacture a backend
 *   response for a screenshot.
 * - **Nothing is wrapped and nothing is retained.** The real setter is returned to the app
 *   untouched; restoration later uses the exact hook index collected during this render, including
 *   indices contributed by custom hooks.
 * - **The owner's alternate is checked too**, because the render being observed may be running on
 *   either half.
 */
export function agentRegisterHook(pres: any, kind: string, original: any, args: any[]): any {
  var live = pres.current()
  if (!live) return original.apply(undefined, args)
  var index = 0
  for (var hook = live.fiber.memoizedState; hook && index < 300; hook = hook.next) index++
  var pending = live.fiber.pendingProps
  if (pending === undefined || pending === null) pending = live.fiber.memoizedProps
  var projection: any = null
  for (var at = 0; at < pres.projected.length && !projection; at++) {
    var candidate = pres.projected[at]
    if (candidate.seed && candidate.child.props === pending && candidate.focus.type === live.fiber.type) {
      projection = candidate
    }
  }
  if (projection && projection.seed.index === index && projection.seed.kind === kind) {
    var value = projection.seed.value
    projection.seed.applied = true
    // Seed the temporary instance's hook. Never dispatch the original reducer or run its
    // initializer to manufacture a backend response.
    args =
      kind === 'useReducer'
        ? [args[0], value, function () { return value }]
        : [function () { return value }]
  }
  var result = original.apply(undefined, args)
  if (!pres.collecting.has(live.fiber) && !pres.collecting.has(live.fiber.alternate)) return result
  if (!Array.isArray(result) || typeof result[1] !== 'function') return result
  var record = pres.owners.get(live.fiber)
  if (!record) record = pres.owners.get(live.fiber.alternate)
  if (!record) record = new Map()
  pres.owners.set(live.fiber, record)
  var id = record.get(index)
  var binding = id ? pres.bindings.get(id) : undefined
  if (!binding && pres.bindings.size < 1500) {
    id = String(++pres.sequence)
    record.set(index, id)
    binding = {
      id: id,
      index: index,
      kind: kind,
      stack: String(new Error().stack).slice(0, 8000),
      fiber: live.fiber,
      renderer: live.renderer,
      setter: result[1]
    }
    pres.bindings.set(id, binding)
  }
  if (binding) {
    binding.fiber = live.fiber
    binding.setter = result[1]
  }
  // Do not wrap setters or keep a second callback in the app. Restoration uses the exact hook
  // index collected during this render, including custom hooks.
  return result
}

/**
 * The real React object behind a module's exports.
 *
 * The reference's `mutableReact`, kept because its reason is still true here: an ESM namespace
 * object can report a property as writable and then reject the assignment, so the `default` export
 * is preferred — but only when it is provably the *same* runtime (same `createElement`, same
 * `useState`, same `useReducer`), never merely because a `default` exists.
 */
export function agentMutableReact(exported: any): any {
  if (!exported) return exported
  var descriptor = Object.getOwnPropertyDescriptor(exported, 'default')
  var value = descriptor && 'value' in descriptor ? descriptor.value : undefined
  if (
    value &&
    value.createElement === exported.createElement &&
    typeof value.useState === 'function' &&
    value.useState === exported.useState &&
    value.useReducer === exported.useReducer
  ) return value
  return exported
}

/**
 * Binds the source catalog's state sites to live hooks, inside a bounded patch window.
 *
 * Ported from the reference's `collect`. The shape of it is the whole safety argument:
 *
 * 1. Drop bindings whose owner is no longer mounted.
 * 2. Decide which mounted fibers are candidate owners, from `agentCollectionTargets`. A fiber whose
 *    `_debugHookTypes` proves it has no `useState`/`useReducer` is skipped, and so is `tag === 14`
 *    (`SimpleMemoComponent`), exactly as in the reference.
 * 3. Patch hooks, force a render on each candidate with `renderer.scheduleUpdate(fiber)`, and wait
 *    **80ms**.
 * 4. Un-patch, in every exit path.
 *
 * Step 4 is why step 3 may be bounded at all. The app runs with wrapped hooks only for the length
 * of one forced render pass; nothing observes it afterwards, no timer survives, no dispatcher is
 * replaced and the app's own source is never touched. If the wait were unbounded, or the un-patch
 * conditional, a disconnect in the middle would leave the app permanently instrumented — which is
 * also why the agent's lease watchdog calls `restore` and reaches this through `undo`.
 */
export function agentPresentationCollect(pres: any, done: (value: unknown) => void): void {
  var started = Date.now()
  var root = globalThis as any
  var finish = function (error?: string): void {
    agentUnpatchPresentationHooks(pres)
    pres.collecting.clear()
    pres.structureCache = undefined
    var matched = 0
    // Bindings the in-app attribution could not name a site for, with the creation stack the host
    // needs to symbolicate them through Metro (`presentations-bindings.ts`) and hand back with
    // `presentation-configure`. Bounded, and carrying nothing but a stack and an owner label.
    var unbound: Array<{ id: string; owner: string; kind: string; stack: string }> = []
    pres.bindings.forEach(function (binding: any) {
      if (binding.site) {
        matched += 1
        return
      }
      if (unbound.length >= 400 || !binding.stack) return
      unbound.push({
        id: binding.id,
        owner:
          agentComponentName(binding.fiber && binding.fiber.type) ||
          agentComponentName(binding.fiber && binding.fiber.elementType) ||
          '',
        kind: 'state',
        stack: binding.stack
      })
    })
    done({
      ok: !error,
      bindings: pres.bindings.size,
      matched: matched,
      unbound: unbound,
      scheduled: pres.lastScheduled,
      elapsedMs: Date.now() - started,
      error: error
    })
  }
  try {
    pres.lastScheduled = 0
    pres.structureCache = undefined
    var tree = agentPresentationIndex(pres)
    var mounted = new Set(tree.all)
    var stale: string[] = []
    pres.bindings.forEach(function (binding: any, id: string) {
      if (!mounted.has(binding.fiber) && !mounted.has(binding.fiber.alternate)) stale.push(id)
    })
    for (var s = 0; s < stale.length; s++) pres.bindings.delete(stale[s]!)
    var targets = agentCollectionTargets(pres, pres.catalog.states)
    for (var at = 0; at < tree.all.length; at++) {
      var fiber = tree.all[at]
      if (fiber.tag === 14) continue
      if (Array.isArray(fiber._debugHookTypes)) {
        var stateful = false
        for (var h = 0; h < fiber._debugHookTypes.length; h++) {
          var kind = fiber._debugHookTypes[h]
          if (kind === 'useState' || kind === 'useReducer') stateful = true
        }
        if (!stateful) continue
      }
      var label = agentComponentName(fiber.type) || agentComponentName(fiber.elementType)
      var target = targets.get(label)
      if (!target) continue
      if (target.fallback || target.types.has(fiber.type) || target.types.has(fiber.elementType)) {
        pres.collecting.add(fiber)
        var byType = target.sitesByType.get(fiber.type)
        if (!byType) byType = target.sitesByType.get(fiber.elementType)
        pres.pendingSites.set(fiber, byType ? byType : target.fallbackSites)
      }
    }
    if (!pres.collecting.size || !agentPatchPresentationHooks(pres)) {
      finish()
      return
    }
    pres.collecting.forEach(function (fiber: any) {
      var renderers = pres.renderers()
      for (var r = 0; r < renderers.length; r++) {
        if (typeof renderers[r].scheduleUpdate !== 'function') continue
        try {
          renderers[r].scheduleUpdate(fiber)
          pres.lastScheduled += 1
        } catch (error) {
          continue
        }
        break
      }
    })
    if (!pres.lastScheduled) {
      finish()
      return
    }
    root.setTimeout(function () {
      try {
        agentAttributeBindings(pres)
      } catch (error) {
        finish(String(error && (error as any).message).slice(0, 120))
        return
      }
      finish()
    }, 80)
  } catch (error) {
    finish(String(error && (error as any).message).slice(0, 120))
  }
}

/**
 * Labels each freshly collected binding with the source site its owner was a candidate for.
 *
 * Without the reference's instrumentation plugin there is no per-hook marker, so a binding can only
 * be attributed by its owner. An owner that is a candidate for exactly one site takes that site; an
 * owner that is a candidate for several is left unattributed rather than guessed at, because
 * opening the wrong state is indistinguishable from the app doing it.
 */
export function agentAttributeBindings(pres: any): void {
  pres.bindings.forEach(function (binding: any) {
    if (binding.site) return
    var sites = pres.pendingSites.get(binding.fiber)
    if (!sites) sites = pres.pendingSites.get(binding.fiber.alternate)
    if (!sites || sites.size !== 1) return
    sites.forEach(function (id: string) {
      binding.site = id
    })
  })
}

/**
 * The bindings and controllers one catalog action could be opened through, right now.
 *
 * This is the reduced stand-in for the reference's `resolveEntry`. The reference resolves an entry
 * through its instrumented JSX markers and falls back to an elaborate identity search; with no
 * instrumentation the only honest resolution is:
 *
 * - **state**: the live binding whose `site` matches, and exactly one of them. More than one live
 *   owner of the same source site is genuinely ambiguous and is refused, matching the reference's
 *   `'More than one live instance owns this opening state.'`
 * - **control**: a mounted fiber rendering the named component which carries, on the named prop (or
 *   that prop's `ref.current`), an object `agentOpeningControl` accepts. Again exactly one.
 * - **mount**: the exported component identity named by the effect, read from Metro's module map
 *   without initialising anything.
 */
export function agentResolvePresentationEntry(pres: any, action: any, tree: any): any {
  if (action.effect.kind === 'state') {
    var found: any[] = []
    pres.bindings.forEach(function (binding: any) {
      if (binding.site === action.effect.site && tree.current.get(binding.fiber)) found.push(binding)
    })
    if (found.length !== 1) {
      return { error: found.length ? 'More than one live instance owns this opening state.' : 'The opening state could not be bound to its source.' }
    }
    return { binding: found[0] }
  }
  if (action.effect.kind === 'control') {
    var candidates: any[] = []
    var byName = tree.names.get(action.effect.component)
    var list = byName ? byName : []
    for (var at = 0; at < list.length; at++) {
      var fiber = list[at]
      var props = fiber.memoizedProps
      if (!props || typeof props !== 'object') continue
      var carried = props[action.effect.prop]
      if (carried && typeof carried === 'object' && 'current' in carried) carried = carried.current
      if (!agentOpeningControl(carried, action.effect.method)) continue
      var close = agentControlCloser(carried, action.effect.method)
      if (!close) continue
      var duplicate = false
      for (var d = 0; d < candidates.length; d++) if (candidates[d].value === carried) duplicate = true
      if (!duplicate) candidates.push({ value: carried, close: close, fiber: fiber })
    }
    if (candidates.length !== 1) {
      return { error: candidates.length ? 'More than one live control matches this opening.' : 'The opening control could not be bound to its source.' }
    }
    return { target: candidates[0] }
  }
  if (action.effect.kind === 'mount') {
    var type = agentMountedExport(pres, action.effect.file, action.effect.export)
    if (!type) return { error: 'The source component is not loaded.' }
    return { type: type }
  }
  return { error: 'Unsupported presentation transition.' }
}

/**
 * One named export of an already-initialised Metro module, read as a data descriptor.
 *
 * Never calls `__r(key)` to warm a cold module: the reference only does that behind its prepared
 * build, and executing a project module to obtain a component would run its top-level side effects.
 */
export function agentMountedExport(pres: any, file: string, name: string): any {
  var modules = (globalThis as any).__r && (globalThis as any).__r.getModules
    ? (globalThis as any).__r.getModules()
    : null
  if (!modules || typeof modules.values !== 'function') return null
  var normalize = function (value: string): string {
    return String(value).split('\\').join('/').replace(/^file:\/\//, '').replace(/^\.\//, '')
  }
  var values = modules.values()
  var next = values.next()
  while (!next.done) {
    var module = next.value
    if (module && module.isInitialized && typeof module.verboseName === 'string') {
      var path = normalize(module.verboseName)
      if (path === file || (pres.sourceRoot && path === pres.sourceRoot + '/' + file)) {
        var exported = module.publicModule ? module.publicModule.exports : undefined
        var descriptor = exported ? Object.getOwnPropertyDescriptor(exported, name) : undefined
        if (descriptor && 'value' in descriptor && descriptor.value) return descriptor.value
      }
    }
    next = values.next()
  }
  return null
}

/**
 * The React and React Native module objects plus the root host `View` a projection attaches to.
 *
 * Ported from the reference's `projectionRoot`. Only **framework** exports are accepted: a module
 * qualifies as React Native when it exposes `Platform.OS`, `StyleSheet.create`, `View` and `Modal`
 * together. No project module, account store or screen controller is ever evaluated to manufacture
 * a destination, and nothing is initialised to look.
 *
 * The attachment point is the nearest ancestor `View` of the focus, because the app's main window
 * cannot present while one of its own native sheets is open; attaching inside the container the
 * focus already lives in keeps the copy in the same native window.
 */
export function agentProjectionRoot(pres: any, focus: any): any {
  var modules = (globalThis as any).__r && (globalThis as any).__r.getModules
    ? (globalThis as any).__r.getModules()
    : null
  if (!modules || typeof modules.values !== 'function') return null
  var react: any = null
  var native: any = null
  var values = modules.values()
  var next = values.next()
  while (!next.done) {
    var module = next.value
    if (module && module.isInitialized) {
      var exported = module.publicModule ? module.publicModule.exports : undefined
      if (exported && typeof exported.createElement === 'function' && typeof exported.useState === 'function') {
        react = agentMutableReact(exported)
      }
      // Framework exports only. No project module, account store or native screen controller is
      // evaluated to manufacture a destination.
      if (
        exported &&
        Object.getOwnPropertyDescriptor(exported, 'Platform') &&
        Object.getOwnPropertyDescriptor(exported, 'StyleSheet')
      ) {
        try {
          if (
            exported.Platform &&
            typeof exported.Platform.OS === 'string' &&
            exported.StyleSheet &&
            typeof exported.StyleSheet.create === 'function' &&
            exported.View &&
            exported.Modal
          ) native = exported
        } catch (error) {
          native = native
        }
      }
    }
    next = values.next()
  }
  if (!react || typeof react.Component !== 'function' || !native) return null
  var ancestor: any = null
  var seen = new Set()
  for (var parent = focus; parent && !seen.has(parent) && !ancestor; parent = parent.return) {
    seen.add(parent)
    if (parent.type === native.View || parent.elementType === native.View) ancestor = parent
  }
  if (!ancestor) return null
  var tree = agentPresentationIndex(pres)
  var root = tree.current.get(ancestor)
  if (!root) return null
  var renderers = pres.renderers()
  for (var at = 0; at < renderers.length; at++) {
    if (typeof renderers[at].overrideProps === 'function') {
      return { root: root, renderer: renderers[at], react: react, native: native }
    }
  }
  return null
}

/**
 * The union of a component's outermost native views, in window coordinates.
 *
 * The reference's `bodyFrame`. A projected copy goes into a brand new `Modal`, and a `Modal` starts
 * at the window origin — so a sheet that lived below the status bar would jump to the top of the
 * screen and photograph differently from the real thing. Positioning the copy at the original's
 * frame is what keeps the screenshot comparable.
 */
export function agentBodyFrame(focus: any): any {
  var left = Infinity
  var top = Infinity
  var right = -Infinity
  var bottom = -Infinity
  var hosts = 0
  var stack = [focus ? focus.child : null]
  while (stack.length && hosts < 50) {
    var fiber = stack.pop()
    if (!fiber) continue
    if (fiber.sibling) stack.push(fiber.sibling)
    if (fiber.tag !== 5) {
      stack.push(fiber.child)
      continue
    }
    hosts++
    try {
      var box = agentWindowRect(fiber)
      if (!box) continue
      if (!isFinite(box.x) || !isFinite(box.y) || !isFinite(box.width) || !isFinite(box.height)) continue
      if (box.width <= 0 || box.height <= 0) continue
      left = Math.min(left, box.x)
      top = Math.min(top, box.y)
      right = Math.max(right, box.x + box.width)
      bottom = Math.max(bottom, box.y + box.height)
    } catch (error) {
      continue
    }
  }
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : undefined
}

/** One host fiber's window rect, through the public instance or Fabric's UI manager. */
export function agentWindowRect(fiber: any): any {
  var state = fiber.stateNode
  var instance = state && state.canonical && state.canonical.publicInstance
    ? state.canonical.publicInstance
    : state
  if (instance && typeof instance.getBoundingClientRect === 'function') {
    return instance.getBoundingClientRect()
  }
  var node = state ? state.node : undefined
  var manager = (globalThis as any).nativeFabricUIManager
  var rect =
    node && manager && typeof manager.getBoundingClientRect === 'function'
      ? manager.getBoundingClientRect(node, true)
      : undefined
  if (!Array.isArray(rect) || rect.length !== 4) return undefined
  return { x: rect[0], y: rect[1], width: rect[2], height: rect[3] }
}

/**
 * The `Modal` props a projected copy inherits from the nearest ancestor `Modal`.
 *
 * Ported from the reference. A sheet rendered inside a `transparent` `pageSheet` modal looks
 * nothing like the same sheet in an opaque full-screen one, so these six presentation props are
 * carried over — and only these six, from the **nearest** ancestor, stopping at the first one
 * found. `transparent: false` is the default the carried-over props then override, which is why the
 * caller spreads this *after* the default rather than before.
 *
 * Pure, so the selection is testable without a device.
 */
export function agentModalCarryOver(focus: any, Modal: any): Record<string, unknown> {
  var carried: Record<string, unknown> = {}
  if (!Modal) return carried
  var keys = [
    'presentationStyle',
    'transparent',
    'statusBarTranslucent',
    'navigationBarTranslucent',
    'hardwareAccelerated',
    'supportedOrientations'
  ]
  var seen = new Set()
  for (var parent = focus ? focus.return : null; parent && !seen.has(parent); parent = parent.return) {
    seen.add(parent)
    if (parent.type !== Modal && parent.elementType !== Modal) continue
    var props = parent.memoizedProps
    if (props) {
      for (var at = 0; at < keys.length; at++) {
        if (keys[at]! in props) carried[keys[at]!] = props[keys[at]!]
      }
    }
    break
  }
  return carried
}

/**
 * Whether copying this component would mount a second copy of the live app navigation.
 *
 * The reference's `copiesLiveNavigation`, and the single most important refusal in this file. A
 * provider's existing `children` can contain the whole app navigator; re-creating that provider
 * would mount a second navigator, run its framework subscriptions, and leave errors in every later
 * capture. The reference's rule is kept exactly: walk the element tree the props carry, find the
 * fibers rendering those exact props objects *inside* the focus, and refuse if any mounted fiber
 * under one of them looks like a React Navigation screen (a `route.name` string together with a
 * `navigation.getState` function).
 *
 * Two deliberate conservatisms, both the reference's: an element graph that exceeds 2000 nodes is
 * refused outright rather than walked further, and descriptors are read rather than properties so
 * no app getter runs during the check. The branch is left unresolved rather than made to work by
 * stripping children; only a source recipe that isolates the presentation body may unblock it.
 */
export function agentCopiesLiveNavigation(focus: any, props: any, tree: any): boolean {
  var own = function (holder: any, key: string): any {
    if (!holder || (typeof holder !== 'object' && typeof holder !== 'function')) return undefined
    var descriptor = Object.getOwnPropertyDescriptor(holder, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  }
  var children = own(props, 'children')
  if (!children || typeof children !== 'object') return false
  var scopes: any[] = []
  var seen = new Set()
  var queue: any[] = [children]
  while (queue.length && seen.size < 2000) {
    var element = queue.pop()
    if (!element || typeof element !== 'object' || seen.has(element)) continue
    seen.add(element)
    if (Array.isArray(element)) {
      for (var at = 0; at < element.length; at++) queue.push(element[at])
      continue
    }
    var type = own(element, 'type')
    var elementProps = own(element, 'props')
    if (!type || !elementProps) continue
    var rendering = tree.props.get(elementProps)
    var list = rendering ? rendering : []
    for (var r = 0; r < list.length; r++) {
      var fiber = list[r]
      if ((fiber.type === type || fiber.elementType === type) && tree.inside(fiber, focus)) {
        scopes.push(fiber)
      }
    }
    var nested = own(elementProps, 'children')
    if (nested) queue.push(nested)
  }
  if (queue.length) return true
  if (!scopes.length) return false
  for (var n = 0; n < tree.all.length; n++) {
    var node = tree.all[n]
    var nodeProps = node.memoizedProps
    var route = own(nodeProps, 'route')
    var navigation = own(nodeProps, 'navigation')
    if (typeof own(route, 'name') !== 'string') continue
    if (typeof own(navigation, 'getState') !== 'function') continue
    for (var s = 0; s < scopes.length; s++) if (tree.inside(node, scopes[s])) return true
  }
  return false
}

/**
 * Suppresses **only** this projection's caught render errors.
 *
 * Ported from the reference's `containPreviewErrors`/`previewErrorHandler`. React Native reports
 * even caught render errors to LogBox, so a copy that throws once would paint a red box over every
 * later capture. The root's `onCaughtError` is swapped for a wrapper that returns early *only* when
 * the error came from this exact boundary class on this exact root; every other error reaches the
 * app's original handler unchanged. Neither the error nor its message is retained.
 */
export function agentContainPreviewErrors(pres: any, focus: any, record: any, boundaryType: any): void {
  var root: any = null
  var seen = new Set()
  for (var parent = focus; parent && !seen.has(parent); parent = parent.return) {
    seen.add(parent)
    if (parent.tag === 3) root = parent.stateNode
  }
  if (!root || typeof root.onCaughtError !== 'function') return
  record.errorRoot = root
  record.boundaryType = boundaryType
  for (var at = 0; at < pres.caughtPatches.length; at++) {
    if (pres.caughtPatches[at].root === root && root.onCaughtError === pres.caughtPatches[at].wrapped) return
  }
  var original = root.onCaughtError
  var projected = pres.projected
  var wrapped = function (this: any, error: any, info: any): any {
    for (var index = 0; index < projected.length; index++) {
      var item = projected[index]
      if (item.errorRoot === root && info && info.errorBoundary && info.errorBoundary.constructor === item.boundaryType) {
        item.failed = true
        return undefined
      }
    }
    return original.apply(this, arguments)
  }
  root.onCaughtError = wrapped
  pres.caughtPatches.push({ root: root, original: original, wrapped: wrapped })
}

/** Restores every root error handler no live projection still needs. */
export function agentReleasePreviewErrors(pres: any, all: boolean): void {
  for (var index = pres.caughtPatches.length - 1; index >= 0; index--) {
    var patch = pres.caughtPatches[index]
    var needed = false
    if (!all) {
      for (var at = 0; at < pres.projected.length; at++) {
        if (pres.projected[at].errorRoot === patch.root) needed = true
      }
    }
    if (needed) continue
    if (patch.root.onCaughtError === patch.wrapped) patch.root.onCaughtError = patch.original
    pres.caughtPatches.splice(index, 1)
  }
}

/** Expires a seeded hook value so the hook patch cannot outlive one render. */
export function agentSeedDeadline(pres: any, record: any): void {
  var root = globalThis as any
  try {
    root.clearTimeout(record.seedTimer)
  } catch (error) {
    record.seedTimer = undefined
  }
  record.seedTimer = root.setTimeout(function () {
    if (pres.projected.indexOf(record) < 0) return
    if (!record.seed.applied) record.failed = true
    var waiting = false
    for (var at = 0; at < pres.projected.length; at++) {
      var item = pres.projected[at]
      if (item.seed && !item.seed.applied && !item.failed) waiting = true
    }
    if (!pres.collecting.size && !waiting) agentUnpatchPresentationHooks(pres)
  }, 1000)
}

/**
 * Projects a component as a synthetic `Modal` sibling of the live app.
 *
 * Ported from the reference's `project`, minus its prepared host-slot and inline placements (see
 * the section doc). Read the file doc above for why each of the following is the way it is; in
 * order, this function:
 *
 * 1. Refuses when the copy would duplicate live navigation.
 * 2. Builds the copy as `react.createElement(type, preview.props || focus.memoizedProps)` — one new
 *    element of the same type, **not** a fiber-tree clone.
 * 3. Re-wraps it in the context providers up `focus.return`, excluding `ScrollView.Context` and
 *    `VirtualizedList.contextType`, because a new `Modal` is a new native window and restoring a
 *    list parent from a different window hands native code a container it does not own.
 * 4. Wraps it in a `PreviewBoundary` and swaps the root error handler for one that suppresses only
 *    this boundary.
 * 5. Carries the six presentation props over from the nearest ancestor `Modal`, over a default of
 *    `transparent: false`, with `animationType: 'none'` so no transition is photographed.
 * 6. Positions the body absolutely at the original's frame.
 * 7. Attaches the modal as a **flat sibling** of the app's existing root children through
 *    `renderer.overrideProps(root, [], record.next)`. Nesting the existing children under a new
 *    array instead would change what React reconciles against and remount the live app.
 */
export function agentProject(pres: any, focus: any, preview: any, mountedContext: any): any {
  pres.structureCache = undefined
  var tree = agentPresentationIndex(pres)
  var live = tree.current.get(focus)
  if (live) focus = live
  if (!focus) return { error: 'This view cannot be projected.' }
  for (var at = 0; at < pres.projected.length; at++) {
    if (!preview && (pres.projected[at].focus === focus || pres.projected[at].focus === focus.alternate)) {
      return { error: 'This view cannot be projected.' }
    }
  }
  var sourceProps = preview && preview.props ? preview.props : focus.memoizedProps
  // A provider's existing children can contain the live app navigator. Copying that provider would
  // mount a second app, run framework subscriptions and leave errors in later captures. Keep the
  // branch unresolved until a source recipe isolates its body; never strip arbitrary children.
  if (agentCopiesLiveNavigation(focus, sourceProps, tree)) {
    return {
      status: 'needs-data',
      error: 'This preview would duplicate live navigation. Its source recipe must isolate the presentation from the existing app children.'
    }
  }
  var context = mountedContext ? mountedContext : agentProjectionRoot(pres, focus)
  if (!context) return { error: 'This renderer cannot project a local view.' }
  var type = focus.elementType ? focus.elementType : focus.type
  if (!type || typeof type === 'string') return { error: 'No component view to project.' }
  var root = context.root
  var renderer = context.renderer
  var react = context.react
  var native = context.native
  var props = root.memoizedProps
  var child = react.createElement(type, sourceProps)
  var content = child
  // Keep live app providers. A new Modal resets native list/scroll ownership; copying those
  // contexts inside it would restore a parent from a different native window.
  var resetContexts: any[] = []
  if (native.ScrollView && native.ScrollView.Context) resetContexts.push(native.ScrollView.Context)
  if (native.VirtualizedList && native.VirtualizedList.contextType) {
    resetContexts.push(native.VirtualizedList.contextType)
  }
  var ancestors = new Set()
  for (var parent = focus.return; parent && !ancestors.has(parent); parent = parent.return) {
    ancestors.add(parent)
    if (parent.tag !== 10 || !parent.memoizedProps || !('value' in parent.memoizedProps)) continue
    var provider = parent.elementType ? parent.elementType : parent.type
    if (!provider) continue
    var identity = provider._context ? provider._context : provider
    if (resetContexts.indexOf(identity) >= 0) continue
    var carried = preview && preview.providers ? preview.providers.get(parent) : undefined
    content = react.createElement(
      provider,
      { value: carried === undefined ? parent.memoizedProps.value : carried },
      content
    )
  }
  var record: any = {
    root: root,
    renderer: renderer,
    react: react,
    props: props,
    focus: focus,
    child: child,
    content: content,
    seed: preview ? preview.seed : undefined,
    mount: preview ? preview.mount : undefined,
    ios: native.Platform.OS === 'ios',
    shown: false,
    dismissed: false,
    failed: false
  }
  var PreviewBoundary = class extends react.Component {
    constructor(boundaryProps: any) {
      super(boundaryProps)
      ;(this as any).state = { failed: false }
    }
    static getDerivedStateFromError(): any {
      return { failed: true }
    }
    componentDidCatch(): void {
      record.failed = true
    }
    render(): any {
      return (this as any).state.failed ? null : (this as any).props.children
    }
  }
  var body = react.createElement(PreviewBoundary, null, content)
  var key = 'mobile-flow-preview-' + ++pres.sequence
  // A temporary Modal starts at the window origin. Keep the copy at its original body's frame, so
  // a body below the status bar stays below it.
  record.frame = agentBodyFrame(focus)
  var frame = record.frame
  var placed =
    frame && (frame.x >= 1 || frame.y >= 1)
      ? react.createElement(
          native.View,
          { style: { position: 'absolute', left: frame.x, top: frame.y, width: frame.width, height: frame.height } },
          body
        )
      : body
  record.positioned = placed !== body
  var modalProps: any = { key: key, transparent: false }
  var carriedProps = agentModalCarryOver(focus, native.Modal)
  for (var carryKey in carriedProps) modalProps[carryKey] = carriedProps[carryKey]
  modalProps.visible = true
  modalProps.animationType = 'none'
  modalProps.onShow = function () {
    record.shown = true
  }
  modalProps.onDismiss = function () {
    record.dismissed = true
  }
  var modal = react.createElement(native.Modal, modalProps, placed)
  // React unwraps one unkeyed root Fragment before reconciling children. Append at that same
  // level. Nesting the existing Fragment under a new sibling array would remount the live app and
  // rerun all of its effects.
  var transparentRoot =
    props.children &&
    props.children.type === react.Fragment &&
    props.children.key == null &&
    props.children.props &&
    props.children.props.ref === undefined
  var appBody = transparentRoot ? props.children.props.children : props.children
  var appChildren = Array.isArray(appBody) ? appBody : [appBody]
  record.element = modal
  var nextChildren = react.createElement.apply(
    react,
    [react.Fragment, null].concat(appChildren).concat([modal])
  )
  record.next = {}
  for (var propKey in props) record.next[propKey] = props[propKey]
  record.next.children = nextChildren
  if (record.seed && !agentPatchPresentationHooks(pres)) {
    return { error: 'Temporary hook initialization is unavailable.' }
  }
  // React Native reports even caught render errors to LogBox. Contain only errors caught by this
  // exact temporary boundary; all app errors keep the root's original handler.
  agentContainPreviewErrors(pres, focus, record, PreviewBoundary)
  pres.projected.push(record)
  pres.undo.push({ projection: record })
  pres.structureCache = undefined
  renderer.overrideProps(root, [], record.next)
  if (record.seed) agentSeedDeadline(pres, record)
  return { ok: true, focus: focus }
}

/** Whether a projection's modal is still among its root's children. */
export function agentProjectionAttached(pres: any, record: any): boolean {
  var tree = agentPresentationIndex(pres)
  var root = tree.current.get(record.root)
  var children =
    root && root.memoizedProps && root.memoizedProps.children && root.memoizedProps.children.props
      ? root.memoizedProps.children.props.children
      : undefined
  if (!Array.isArray(children)) return false
  for (var at = 0; at < children.length; at++) if (children[at] === record.element) return true
  return false
}

/** Drops a projection's bookkeeping and un-patches anything no other projection still needs. */
export function agentReleaseProjection(pres: any, record: any): void {
  var root = globalThis as any
  try {
    root.clearTimeout(record.seedTimer)
  } catch (error) {
    record.seedTimer = undefined
  }
  var position = pres.projected.indexOf(record)
  if (position >= 0) pres.projected.splice(position, 1)
  agentReleasePreviewErrors(pres, false)
  var waiting = false
  for (var at = 0; at < pres.projected.length; at++) {
    var item = pres.projected[at]
    if (item.seed && !item.seed.applied && !item.failed) waiting = true
  }
  if (record.seed && !waiting) agentUnpatchPresentationHooks(pres)
  pres.structureCache = undefined
}

/**
 * Opens one catalog entry and pushes its undo checkpoint.
 *
 * Ported from the reference's `open`. The three effect kinds are described in the section doc; what
 * is worth restating at the call site is the **functional setter**:
 *
 *     binding.setter(function (previous) { return guard ? previous : agentSetPath(...) })
 *
 * React may already have a queued update from the app itself (a response that landed between the
 * read and the write). Passing a plain value would discard it. Passing the functional form lets the
 * update see the newest state and decline when it is no longer the state that was read, so the
 * opening applies source-proven UI state and never replaces the app's own newer data.
 */
export function agentPresentationOpen(pres: any, id: string, focus: any): any {
  var started = Date.now()
  for (var at = 0; at < pres.undo.length; at++) {
    if (pres.undo[at].closing) {
      return { ok: false, error: 'A native presentation is still dismissing.', checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
    }
  }
  var action: any = null
  for (var a = 0; a < pres.catalog.actions.length; a++) {
    if (pres.catalog.actions[a].id === id) action = pres.catalog.actions[a]
  }
  if (!action) {
    return { ok: false, error: 'The requested view is not in the source catalog.', checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
  }
  pres.structureCache = undefined
  var tree = agentPresentationIndex(pres)
  var found = agentResolvePresentationEntry(pres, action, tree)
  if (found.error) {
    return { ok: false, error: found.error, checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
  }
  if (action.effect.kind === 'mount') {
    var context = agentProjectionRoot(pres, focus ? focus : tree.all[0])
    var owner = { type: found.type, elementType: found.type, memoizedProps: {}, return: focus }
    var projection = agentProject(pres, owner, { mount: true }, context)
    if (!projection.ok) {
      return { ok: false, error: projection.error, checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
    }
    return { ok: true, kind: 'mount', checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
  }
  if (action.effect.kind === 'state') {
    var binding = found.binding
    var previous = agentHookValue(pres, binding)
    for (var p = 0; p < action.effect.path.length; p++) {
      previous = previous === null || previous === undefined ? undefined : previous[action.effect.path[p]]
    }
    pres.undo.push({
      binding: binding,
      path: action.effect.path,
      value: previous,
      nativeDismiss: previous === null || previous === undefined || previous === false
    })
    var before = previous
    var path = action.effect.path
    var opened = action.effect.value
    // Apply source-proven UI state only. A queued app update owns its newer state; never replace
    // it with the captured opening data.
    binding.setter(function (current: any) {
      var reference = current
      for (var step = 0; step < path.length; step++) {
        reference = reference === null || reference === undefined ? undefined : reference[path[step]]
      }
      if (!Object.is(reference, before)) return current
      return agentSetPath(current, path, opened)
    })
    pres.structureCache = undefined
    return { ok: true, kind: 'state', checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
  }
  if (action.effect.kind === 'control') {
    var target = found.target
    for (var o = 0; o < pres.undo.length; o++) {
      if (!pres.undo[o].closed && pres.undo[o].control === target.value) {
        return { ok: true, kind: 'control', checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
      }
    }
    pres.undo.push({
      control: target.value,
      close: target.close,
      focus: target.fiber,
      nativeFocus: target.fiber,
      origin: target.fiber
    })
    target.value[action.effect.method]()
    pres.structureCache = undefined
    return { ok: true, kind: 'control', checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
  }
  return { ok: false, error: 'Unsupported presentation transition.', checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
}

/**
 * Waits for a controller-owned presentation to report that it closed.
 *
 * Ported from the reference's `waitForDismissal`, with its 4000ms deadline and its single retry.
 * The retry's reason is specific: a close can run before the native ref exists and silently do
 * nothing, so one more close is sent — but only once, and only while the control has acknowledged
 * no closing transition. An accepted close stays single, because sending a second one to a sheet
 * that is already closing can dismiss whatever opened behind it.
 *
 * Expressed as a poll rather than a promise chain because this agent has no promise-based control
 * flow (see the file's syntax rules).
 */
export function agentWaitForDismissal(pres: any, entry: any, done: (error: string | null) => void): void {
  var root = globalThis as any
  var started = Date.now()
  var step = function (): void {
    var open = agentOpeningControl(entry.control, undefined)
    var stillOpen = entry.closedAcknowledged ? false : open
    if (!stillOpen || entry.dismissed) {
      done(null)
      return
    }
    if (!entry.closeRetried && Date.now() - started >= 1000) {
      // A close can run before a native ref exists and silently do nothing. Retry once only.
      entry.closeRetried = true
      try {
        entry.control[entry.close]()
      } catch (error) {
        entry.closeRetried = true
      }
    }
    // A full-height sheet in a long-running, larger app can take more than two seconds to report
    // its dismissal; a confirmed close returns at once.
    if (Date.now() - started >= 4000) {
      done('Native presentation dismissal has not finished.')
      return
    }
    root.setTimeout(step, 40)
  }
  step()
}

/**
 * Unwinds the undo stack down to `level`, confirming every native dismissal on the way.
 *
 * Ported from the reference's `restorePresentations`. The iOS ordering in the projection branch is
 * the safety-critical part of this whole file and is kept exactly:
 *
 * 1. Clone the modal with `visible: false` and write it back — **the Modal stays mounted**.
 * 2. Poll for `record.dismissed` with a 2000ms deadline.
 * 3. Only then restore the root's original children.
 *
 * Unmounting at step 1 would remove React Native's event listener before `onDismiss` could run, and
 * the app would be left with a native window nothing can prove is closed. For the same reason a
 * projection whose root has detached, on iOS, after it was shown and before it was dismissed,
 * **throws** rather than quietly dropping the checkpoint.
 *
 * A checkpoint is kept until its close actually succeeds (`entry.closed` is set only afterwards), so
 * a thrown close does not discard the only way to restore the app on the next attempt.
 */
export function agentRestorePresentations(
  pres: any,
  level: number,
  wait: boolean,
  done: (error: string | null) => void
): void {
  var root = globalThis as any
  var floor = Math.max(0, level)
  var step = function (): void {
    if (pres.undo.length <= floor) {
      if (wait) {
        root.setTimeout(function () {
          done(null)
        }, 80)
        return
      }
      done(null)
      return
    }
    // Keep the checkpoint until its close operation succeeds. A thrown close must not discard the
    // only way to restore the app on the next attempt.
    var entry = pres.undo[pres.undo.length - 1]
    if (entry.closed) {
      pres.undo.pop()
      step()
      return
    }
    var finishEntry = function (): void {
      entry.closed = true
      pres.undo.pop()
      step()
    }
    if (entry.projection) {
      var record = entry.projection
      try {
        root.clearTimeout(record.seedTimer)
      } catch (error) {
        record.seedTimer = undefined
      }
      pres.structureCache = undefined
      // Preserve new app children, but never infer native dismissal from an unmount which removed
      // the callback needed to confirm it.
      if (!agentProjectionAttached(pres, record)) {
        if (record.ios && record.shown && !record.dismissed) {
          done('Temporary modal dismissal is unconfirmed after its owner detached.')
          return
        }
        agentReleaseProjection(pres, record)
        finishEntry()
        return
      }
      var restoreChildren = function (): void {
        var currentProps = record.root.memoizedProps ? record.root.memoizedProps : record.props
        var restored: any = {}
        for (var key in currentProps) restored[key] = currentProps[key]
        restored.children = record.props.children
        pres.structureCache = undefined
        record.renderer.overrideProps(record.root, [], restored)
      }
      if (!entry.closing) {
        if (wait && record.ios && record.shown) {
          // Keep Modal mounted while native dismissal runs. Unmounting first removes React
          // Native's event listener before onDismiss can run.
          var hidden = record.react.cloneElement(record.element, { visible: false })
          var siblings = record.next.children.props.children
          var swapped: any[] = []
          for (var s = 0; s < siblings.length; s++) {
            swapped.push(siblings[s] === record.element ? hidden : siblings[s])
          }
          var children = record.react.cloneElement.apply(
            record.react,
            [record.next.children, {}].concat(swapped)
          )
          var nextProps: any = {}
          var live = record.root.memoizedProps ? record.root.memoizedProps : record.props
          for (var liveKey in live) nextProps[liveKey] = live[liveKey]
          nextProps.children = children
          pres.structureCache = undefined
          record.renderer.overrideProps(record.root, [], nextProps)
        } else restoreChildren()
        entry.closing = true
      }
      if (wait && record.ios && record.shown) {
        // React Native emits Modal.onDismiss on iOS only. Retain the restore record while an
        // already shown iOS modal is still dismissing.
        var dismissStarted = Date.now()
        var poll = function (): void {
          if (record.dismissed) {
            restoreChildren()
            agentReleaseProjection(pres, record)
            finishEntry()
            return
          }
          if (!agentProjectionAttached(pres, record)) {
            done('Temporary modal dismissal is unconfirmed after its owner detached.')
            return
          }
          if (Date.now() - dismissStarted >= 2000) {
            done('Temporary modal dismissal has not finished.')
            return
          }
          root.setTimeout(poll, 40)
        }
        poll()
        return
      }
      agentReleaseProjection(pres, record)
      finishEntry()
      return
    }
    if (entry.control) {
      if (!entry.closing) {
        entry.closing = true
        try {
          entry.control[entry.close]()
        } catch (error) {
          done('The presentation control refused to close.')
          return
        }
      }
      if (wait) {
        agentWaitForDismissal(pres, entry, function (error: string | null) {
          if (error) {
            done(error)
            return
          }
          entry.closing = false
          finishEntry()
        })
        return
      }
      entry.closing = false
      finishEntry()
      return
    }
    if (!entry.closing) {
      var path = entry.path
      var value = entry.value
      entry.binding.setter(function (current: any) {
        return agentSetPath(current, path, value)
      })
      entry.closing = true
      pres.structureCache = undefined
    }
    entry.closing = false
    finishEntry()
  }
  step()
}

/**
 * Serialises rollbacks. The reference keeps a `rollbackTask` promise chain for the same reason: two
 * overlapping unwinds of one undo stack would each pop the other's checkpoint and leave the app in
 * a state neither of them can describe. Here the chain is a queue of callbacks, because this agent
 * has no promise-based control flow.
 */
export function agentPresentationRollback(
  pres: any,
  level: number,
  wait: boolean,
  done: (value: unknown) => void
): void {
  var started = Date.now()
  var run = function (): void {
    agentRestorePresentations(pres, level, wait, function (error: string | null) {
      pres.rollbackRunning = false
      var reply = error
        ? { ok: false, error: error, checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
        : { ok: true, checkpoint: pres.undo.length, elapsedMs: Date.now() - started }
      try {
        done(reply)
      } catch (replyError) {
        pres.rollbackRunning = false
      }
      var next = pres.rollbackQueue.shift()
      if (next) next()
    })
  }
  if (pres.rollbackRunning) {
    pres.rollbackQueue.push(function () {
      pres.rollbackRunning = true
      run()
    })
    return
  }
  pres.rollbackRunning = true
  run()
}

/** The `presentations` command: which catalog entries are openable against the tree as it is now. */
export function agentPresentationList(pres: any): any {
  var started = Date.now()
  pres.structureCache = undefined
  var tree = agentPresentationIndex(pres)
  var available: Array<{ id: string; kind: string }> = []
  var unavailable = 0
  for (var at = 0; at < pres.catalog.actions.length && available.length < 200; at++) {
    var action = pres.catalog.actions[at]
    var found = agentResolvePresentationEntry(pres, action, tree)
    if (found.error) unavailable += 1
    else available.push({ id: action.id, kind: action.effect.kind })
  }
  return { available: available, unavailable: unavailable, elapsedMs: Date.now() - started }
}

/**
 * The presentation runtime's state, created once per install and torn down with the agent.
 *
 * Everything mutable the port needs lives here rather than in a module constant, because an
 * injected function is re-created in a fresh scope inside the app (see the file doc). The teardown
 * is registered on the agent's `undo` list, so the lease watchdog un-patches React's hooks and
 * every root error handler if the host stops talking — which is the whole reason a bounded patch
 * window is safe to open at all.
 */
export function agentCreatePresentations(root: any, limits: AgentLimits, undo: Array<() => void>): any {
  var pres: any = {
    limits: limits,
    sequence: 0,
    sourceRoot: undefined,
    catalog: { states: [], actions: [] },
    bindings: new Map(),
    owners: new WeakMap(),
    pendingSites: new WeakMap(),
    collecting: new Set(),
    patches: [],
    caughtPatches: [],
    projected: [],
    undo: [],
    rollbackQueue: [],
    rollbackRunning: false,
    lastScheduled: 0,
    structureCache: undefined
  }
  pres.renderers = function (): any[] {
    var hook = root.__REACT_DEVTOOLS_GLOBAL_HOOK__
    var found: any[] = []
    try {
      if (hook && hook.renderers && typeof hook.renderers.forEach === 'function') {
        hook.renderers.forEach(function (renderer: any) {
          if (renderer && renderer.rendererPackageName === 'react-native-renderer') found.push(renderer)
        })
      }
    } catch (error) {
      return found
    }
    return found
  }
  pres.current = function (): any {
    var renderers = pres.renderers()
    for (var at = 0; at < renderers.length; at++) {
      var renderer = renderers[at]
      if (typeof renderer.getCurrentFiber !== 'function') continue
      var fiber: any = null
      try {
        fiber = renderer.getCurrentFiber()
      } catch (error) {
        fiber = null
      }
      if (fiber) return { fiber: fiber, renderer: renderer }
    }
    return null
  }
  undo.push(function () {
    agentUnpatchPresentationHooks(pres)
    agentReleasePreviewErrors(pres, true)
    pres.collecting.clear()
    pres.bindings.clear()
    pres.projected.length = 0
    pres.undo.length = 0
    pres.structureCache = undefined
  })
  return pres
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
  var presentations: any = null

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
      done(
        agentNavigate(
          command.route,
          command.params || null,
          limits,
          command.expoPath || null,
          command.candidates || null
        )
      )
    } else if (type === 'links') {
      var max =
        typeof command.max === 'number' && isFinite(command.max) && command.max > 0
          ? command.max
          : 200
      done(agentCollectLinks(limits, max))
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
    } else if (type === 'presentation-setup') {
      presentations.catalog = {
        states: Array.isArray(command.states) ? command.states : [],
        actions: Array.isArray(command.actions) ? command.actions : []
      }
      presentations.sourceRoot =
        typeof command.projectRoot === 'string'
          ? String(command.projectRoot).split('\\').join('/').replace(/\/$/, '')
          : undefined
      agentPresentationCollect(presentations, done)
    } else if (type === 'presentation-configure') {
      var configureStarted = Date.now()
      var matches = Array.isArray(command.matches) ? command.matches : []
      var configured = 0
      for (var mi = 0; mi < matches.length && mi < 3000; mi++) {
        var match = matches[mi]
        if (!match || typeof match.binding !== 'string' || typeof match.site !== 'string') continue
        var target = presentations.bindings.get(String(match.binding))
        if (!target) continue
        target.site = String(match.site)
        configured += 1
      }
      presentations.structureCache = undefined
      done({ ok: true, configured: configured, elapsedMs: Date.now() - configureStarted })
    } else if (type === 'presentations') {
      done(agentPresentationList(presentations))
    } else if (type === 'presentation-open') {
      done(agentPresentationOpen(presentations, String(command.id), null))
    } else if (type === 'presentation-rollback') {
      var level =
        typeof command.level === 'number' && isFinite(command.level) && command.level >= 0
          ? command.level
          : 0
      agentPresentationRollback(presentations, level, command.wait !== false, done)
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
    // The presentation runtime registers its own teardown on `undo`, so the lease watchdog
    // un-patches React hooks and every swapped root error handler if the host stops talking.
    presentations = agentCreatePresentations(root, limits, undo)
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
  agentRoutablePath,
  agentLinkCandidate,
  agentCollectLinks,
  agentResolveRoutePath,
  agentNavigate,
  agentStyleFlags,
  agentHidden,
  agentComponentName,
  agentReadiness,
  agentPatchProperty,
  agentCreateSignals,
  agentVerdict,
  agentSettle,
  agentOpeningControl,
  agentControlCloser,
  agentSetPath,
  agentPresentationIndex,
  agentHookValue,
  agentCollectionTargets,
  agentMutableReact,
  agentPatchPresentationHooks,
  agentUnpatchPresentationHooks,
  agentHookWrapper,
  agentRegisterHook,
  agentPresentationCollect,
  agentAttributeBindings,
  agentResolvePresentationEntry,
  agentMountedExport,
  agentProjectionRoot,
  agentWindowRect,
  agentBodyFrame,
  agentModalCarryOver,
  agentCopiesLiveNavigation,
  agentContainPreviewErrors,
  agentReleasePreviewErrors,
  agentSeedDeadline,
  agentProject,
  agentProjectionAttached,
  agentReleaseProjection,
  agentPresentationOpen,
  agentWaitForDismissal,
  agentRestorePresentations,
  agentPresentationRollback,
  agentPresentationList,
  agentCreatePresentations,
  agentInstall
} as const
