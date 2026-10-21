/**
 * Driving the running app to a screen through its own navigator, instead of walking there.
 *
 * This is the "rendering" reach path: rather than asking a model to tap its way to a screen, we
 * dispatch the navigation the app itself would dispatch, then wait for the screen to settle. On the
 * measured reference app a walked screen costs 22-33s and a deep link 5-7s; this sits with the deep
 * links while working on routes that have no URL at all.
 *
 * It is deliberately separate from `nav-state.ts`. That module is read-only and has a test
 * asserting its expression never so much as names a mutating method; this one dispatches, so
 * keeping them apart keeps that guard meaningful rather than something to be exempted from. Both
 * share one navigator search (`runtime-navigator.ts`) so the reader and the writer can never
 * disagree about which navigator is the real one.
 *
 * ## Why the app side is stateless, and why that is sound here
 *
 * The comparison project's runtime keeps real state to decide a screen has arrived: a previous
 * visual signature, an 80ms quiet timer, two `requestAnimationFrame` callbacks, and subscriptions
 * to navigator transition events installed before the transition starts. None of that survives
 * `agent-device cdp runtime eval`, which evaluates a fresh expression per call.
 *
 * It turns out not to matter, because the transport is slow in exactly the right way. A CLI eval
 * costs ~0.57s measured, so two consecutive polls are over half a second apart — roughly 34 frames
 * at 60Hz, and more than six times the 80ms quiet window that project waits for. So:
 *
 * - **The quiet window is free.** Two polls are already further apart than it requires.
 * - **The paint check is free.** Two rAF callbacks prove "frames have been painted since the tree
 *   went stable". If the signature is unchanged across polls 570ms apart, frames were painted.
 * - **Transition listeners are unnecessary.** A native transition runs a few hundred milliseconds
 *   and moves geometry and opacity while it does, so it changes the signature. Stability across two
 *   polls spans it without needing to have subscribed beforehand.
 *
 * The one thing that genuinely needs memory is the previous signature, and that is held **here, in
 * Node**, not in the app. So each evaluation is an independent snapshot, which also means a reload
 * mid-wait degrades to a changed signature rather than to corrupt state.
 *
 * ## What this readiness check does not do yet
 *
 * The reference implementation's `visualSignature` is a large pile of fiber heuristics. This ports
 * the cheap, high-value subset and deliberately leaves out the rest, because each omission costs
 * accuracy in a way the design below tolerates:
 *
 * - **No viewport/bounding-rect filtering.** That project excludes host nodes outside the screen
 *   bounds via `getBoundingClientRect`. We count them, so `content` can be non-zero for a screen
 *   whose visible area is still empty.
 * - **No react-query/SWR hook introspection, no Reanimated opacity, no modal mode.**
 *
 * Both are tolerable **only because this check is not the arrival authority**. See below.
 *
 * ## The arrival authority stays with the judge
 *
 * This decides *when the screen is settled enough to photograph*, not *whether we arrived*. The
 * existing arrival judge still rules on the captured frame. That split is deliberate: dispatching
 * the navigation is where nearly all the saving is (it replaces a 22-33s agentic walk), while
 * trusting a partial reimplementation of someone else's readiness heuristics to confirm arrival
 * would buy a few seconds and risk a confidently wrong capture. A wrong accept here is silent,
 * which is the one failure mode worth paying to avoid.
 *
 * Nothing in this module is specific to any app: it keys on React Navigation's public dispatch
 * shape and on generic React fiber structure.
 */
import { FIND_NAVIGATOR_JS } from './runtime-navigator.ts'

/** Frames the result so a caller can tell this module's output from the CLI's own reporting. */
const MARKER = 'AIHR1'

/** A navigation dispatch either happened, or it did not and we know why. */
export type NavigateOutcome =
  | { ok: true }
  | {
      ok: false
      reason: 'no-navigator' | 'no-dispatch' | 'unregistered' | 'threw'
      detail?: string
    }

/**
 * One snapshot of how settled a screen is. Every field is computed fresh from the current tree;
 * `signature` is a hash rather than the full structure because the CLI truncates a returned string
 * at 200 characters and the structure routinely runs to thousands.
 */
export interface ReadinessSnapshot {
  /** The focused route path the app is actually on, innermost name last. */
  active: string[]
  /** The target's screen fiber exists and is focused. */
  found: boolean
  /** Count of host nodes under the screen carrying text, an image source, or a label. */
  content: number
  /** A visible loading affordance, with a one-word reason when there is one. */
  loading: string | null
  /** 32-bit hash of the screen's structure, compared across polls to detect stability. */
  signature: string
  /**
   * Expected parameter keys whose value on the focused route does not match. Non-empty means
   * `found` is false *because of the parameters* rather than because the app is on another route
   * — a distinction worth keeping, since the two say different things about what to do next.
   */
  paramMismatch: string[]
}

/**
 * Builds the nested payload React Navigation expects for a target inside nested navigators.
 *
 * `['HomeTab','Profile']` with `{name:'alice.test'}` becomes
 * `{name:'HomeTab', params:{screen:'Profile', params:{name:'alice.test'}, initial:false}}`.
 * `initial: false` matters: without it the navigator may reset the nested stack to its first
 * screen instead of pushing the one asked for.
 */
export function navigatePayload(
  segments: readonly string[],
  params: Record<string, string> | null
): { name: string; params?: unknown } | null {
  if (!segments.length) return null
  const nest = (rest: readonly string[]): unknown => {
    if (!rest.length) return params && Object.keys(params).length ? { ...params } : undefined
    return { screen: rest[0], params: nest(rest.slice(1)), initial: false }
  }
  const payload = nest(segments.slice(1))
  return payload === undefined ? { name: segments[0]! } : { name: segments[0]!, params: payload }
}

/**
 * The expression that dispatches the navigation.
 *
 * It refuses rather than guesses: a target whose name is in no mounted navigator's
 * `routeNames` is reported as `unregistered` instead of dispatched, because dispatching an unknown
 * name is how you end up somewhere plausible and wrong. The check is against the *running* app, so
 * it also catches a route the parser found in source but this build does not register.
 */
export function navigateExpr(payload: { name: string; params?: unknown }): string {
  return `(() => {
  try {
    ${FIND_NAVIGATOR_JS}
    var found = findNavigator()
    if (!found) return "${MARKER}|no-navigator"
    var nav = found.nav
    if (typeof nav.dispatch !== "function") return "${MARKER}|no-dispatch"
    // Which names count as registered: every \`routeNames\` in the **mounted navigator tree**, not
    // just the root's and not just the focused chain's. Apps routinely register a screen inside
    // each tab's stack rather than at the root, so the root alone would reject almost every real
    // target. The focused chain alone was still too narrow, and measurably so: one sweep read a
    // route with params out of a mounted-but-unfocused tab (\`readNavState\` walks every branch)
    // while this check called the same name unregistered. React Navigation offers an action to
    // every mounted child navigator when the focused one cannot handle it, so a name registered in
    // any mounted branch is dispatchable. What stays refused is what no mounted navigator lists —
    // including a branch never visited, which has no \`state\` yet and so contributes nothing.
    // Bounded at 16 levels and 500 states so a pathological tree cannot stall the JS thread.
    var names = []
    var pending = [{ s: found.state, d: 0 }]
    for (var seen = 0; pending.length && seen < 500; seen++) {
      var item = pending.pop()
      var level = item.s
      if (!level || item.d >= 16) continue
      if (Array.isArray(level.routeNames)) names = names.concat(level.routeNames)
      if (!Array.isArray(level.routes)) continue
      for (var i = 0; i < level.routes.length; i++) {
        var child = level.routes[i]
        if (child && child.state) pending.push({ s: child.state, d: item.d + 1 })
      }
    }
    if (names.indexOf(${JSON.stringify(payload.name)}) < 0) return "${MARKER}|unregistered"
    nav.dispatch({ type: "NAVIGATE", payload: ${JSON.stringify(payload)} })
    return "${MARKER}|ok"
  } catch (error) {
    return "${MARKER}|threw|" + String(error && error.message).slice(0, 80)
  }
})()`
}

/** Reads a `navigateExpr` result back out of the CLI's reporting. */
export function parseNavigateOutcome(output: string): NavigateOutcome | null {
  const text = unwrap(output)
  if (text === null) return null
  const parts = text.split('|')
  if (parts[0] !== MARKER) return null
  if (parts[1] === 'ok') return { ok: true }
  if (parts[1] === 'no-navigator' || parts[1] === 'no-dispatch' || parts[1] === 'unregistered') {
    return { ok: false, reason: parts[1] }
  }
  if (parts[1] === 'threw') return { ok: false, reason: 'threw', detail: parts[2] }
  return null
}

/**
 * The expression that samples how settled the screen is.
 *
 * One pass over the mounted tree, no state, nothing retained. The returned string is kept short
 * enough to clear the CLI's 200-character ceiling in one eval even for a deep route path, because
 * a readiness poll that needs chunking would cost three round trips instead of one and the whole
 * point of polling is that each poll is cheap.
 */
export function readinessExpr(
  routeName: string,
  expectedParams: Record<string, string> | null
): string {
  return `(() => {
  try {
    ${FIND_NAVIGATOR_JS}
    var found = findNavigator()
    if (!found) return "${MARKER}|r|0|0||||"
    // The focused route path, innermost last — the same walk the reference implementation's
    // \`active(state)\` does, bounded identically at 16 levels of nesting.
    var state = found.state
    var active = []
    for (var depth = 0; state && state.routes && state.routes.length && depth < 16; depth++) {
      var route = state.routes[state.index == null ? 0 : state.index]
      if (!route) break
      active.push(route.name)
      state = route.state
    }
    var target = ${JSON.stringify(routeName)}
    var expected = ${JSON.stringify(expectedParams ?? {})}
    // A subtree the app has hidden is not on screen, and counting it would report content and
    // stability for a screen the user cannot see.
    // React Native style props are routinely **arrays**, and nested ones at that, so reading only
    // a plain object misses most of the hidden subtrees an app actually produces. Measured on a
    // real app: a stopped \`ActivityIndicator\` sat under \`style: [{display:"none",opacity:0}]\` and
    // was counted as a live loading affordance, so every readiness poll on that screen reported a
    // skeleton and the settle loop burned its whole 8s budget on a fully rendered screen.
    //
    // Flattened with the array's own merge semantics — left to right, a later entry overrides an
    // earlier one — rather than "any entry hides it". Treating \`[{display:"none"},{display:"flex"}]\`
    // as hidden would prune a visible screen, which is the more damaging way to be wrong.
    var styleFlags = function (style, out, depth) {
      if (!style || depth > 5) return
      if (Array.isArray(style)) {
        for (var index = 0; index < style.length; index++) styleFlags(style[index], out, depth + 1)
        return
      }
      if (typeof style !== "object") return
      if (style.display !== undefined) out.display = style.display
      if (style.opacity !== undefined) out.opacity = style.opacity
    }
    var hidden = function (props) {
      if (!props) return false
      if (props.focused === false || props.isFocused === false || props.screenFocused === false) return true
      if (props.style) {
        var flags = {}
        styleFlags(props.style, flags, 0)
        if (flags.display === "none" || flags.opacity === 0) return true
      }
      return props.accessibilityElementsHidden === true || props["aria-hidden"] === true
    }
    var screen = null
    var stack = collectFiberRoots()
    var seen = new Set()
    var budget = 60000
    var deadline = Date.now() + 1000
    while (stack.length && budget-- > 0 && !screen) {
      if ((budget & 255) === 0 && Date.now() > deadline) break
      var fiber = stack.pop()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      // The sibling is pushed **before** the hidden check, because a fiber's later siblings are
      // reachable only through it: skipping the push along with the subtree severs the rest of the
      // sibling list. Measured on a real app — one hidden scene cut the walk from 1425 nodes to
      // 937 and hid the focused screen entirely, so every poll reported \`found: false\`.
      if (fiber.sibling) stack.push(fiber.sibling)
      var props = fiber.memoizedProps
      if (hidden(props)) continue
      if (props && props.route && props.route.name === target) {
        var focused = true
        try { if (props.navigation && typeof props.navigation.isFocused === "function") focused = props.navigation.isFocused() } catch (error) {}
        if (focused) { screen = fiber }
      }
      if (fiber.child) stack.push(fiber.child)
    }
    var content = 0
    var loading = ""
    var parts = []
    var missed = []
    if (screen) {
      var inner = [screen.child]
      var innerSeen = new Set()
      var innerBudget = 40000
      var LOADER_RE = /Skeleton|Shimmer|LoadingPlaceholder|LoadingIndicator|LoadingSpinner|LoadingView|LoadingScreen|ActivityIndicator|Spinner|^Loader$/
      while (inner.length && innerBudget-- > 0) {
        var node = inner.pop()
        if (!node || innerSeen.has(node)) continue
        innerSeen.add(node)
        // Same reason as the outer walk: pruning a hidden subtree must not take its siblings
        // with it.
        if (node.sibling) inner.push(node.sibling)
        var nodeProps = node.memoizedProps
        if (hidden(nodeProps)) continue
        if (!loading) {
          // A component's name may sit on a function, or on the object \`memo\` and \`forwardRef\`
          // wrap it in — the latter is routine in React Native, and reading only functions would
          // miss most of the loading indicators worth detecting.
          var nameOf = function (value) {
            if (!value) return ""
            if (typeof value === "function") return value.displayName || value.name || ""
            if (typeof value === "object") {
              return value.displayName || (typeof value.render === "function" ? (value.render.displayName || value.render.name || "") : "") || (value.type ? nameOf(value.type) : "")
            }
            return ""
          }
          var typeName = nameOf(node.type) || nameOf(node.elementType)
          if (typeName && LOADER_RE.test(typeName)) loading = "skeleton"
          else if (node.tag === 13 && node.memoizedState !== null) loading = "suspense"
          else if (nodeProps) {
            var busy = (nodeProps.accessibilityState && nodeProps.accessibilityState.busy) || nodeProps["aria-busy"]
            if (busy === true) loading = "busy"
            else if (nodeProps.isLoading === true || nodeProps.loading === true || nodeProps.animating === true) loading = "busy"
            else if (nodeProps.accessibilityRole === "progressbar" || nodeProps.role === "progressbar") loading = "busy"
          }
        }
        if (node.tag === 5 && nodeProps) {
          var text = typeof nodeProps.children === "string" ? nodeProps.children : null
          var media = nodeProps.source || nodeProps.src
          var label = typeof nodeProps.accessibilityLabel === "string" ? nodeProps.accessibilityLabel : null
          if (text || media || label) {
            content += 1
            if (parts.length < 250) parts.push(String(node.type) + ":" + String(text || label || "src").slice(0, 60))
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
      // A route carrying different parameter values is a different screen, however much it looks
      // like the one that was asked for. So a mismatch makes \`found\` false, which is what the
      // caller already treats as "keep waiting" — a dispatch still in flight to this route lands
      // with the previous instance's params for a poll or two, and settling on that would
      // photograph the wrong screen. This used to only perturb the signature, which meant the
      // whole \`expectedParams\` argument changed nothing a caller could act on.
      if (missed.length) {
        screen = null
        content = 0
      }
    }
    // A 32-bit hash: the structure itself runs to thousands of characters and the transport stops
    // at 200. Only equality across polls is ever asked of it.
    var joined = parts.join("|")
    var hash = 0
    for (var at = 0; at < joined.length; at++) { hash = (hash * 31 + joined.charCodeAt(at)) | 0 }
    return "${MARKER}|r|" + (screen ? "1" : "0") + "|" + content + "|" + loading + "|" + (hash >>> 0).toString(36) + "|" + active.slice(-3).join("/") + "|" + missed.join(",")
  } catch (error) {
    return "${MARKER}|r|0|0||||"
  }
})()`
}

/** Reads a `readinessExpr` result back. Returns null for anything that is not this framing. */
export function parseReadiness(output: string): ReadinessSnapshot | null {
  const text = unwrap(output)
  if (text === null) return null
  const parts = text.split('|')
  if (parts[0] !== MARKER || parts[1] !== 'r') return null
  return {
    found: parts[2] === '1',
    content: Number(parts[3] ?? '0') || 0,
    loading: parts[4] ? parts[4] : null,
    signature: parts[5] ?? '',
    active: (parts[6] ?? '').split('/').filter(Boolean),
    paramMismatch: (parts[7] ?? '').split(',').filter(Boolean)
  }
}

/**
 * Pulls a returned string out of the CLI's `string: "…"` envelope.
 *
 * Shared by both parsers here. The CLI reports a returned value as JSON-escaped text alongside its
 * own output, so the value is recovered by finding the quoted run and parsing it as a JSON string —
 * the same approach `nav-state.ts` uses.
 */
function unwrap(output: string): string | null {
  for (const match of output.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    try {
      const text: unknown = JSON.parse(`"${match[1]}"`)
      if (typeof text === 'string' && text.startsWith(MARKER)) return text
    } catch {
      continue
    }
  }
  return null
}
