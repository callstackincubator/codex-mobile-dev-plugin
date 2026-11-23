/**
 * The routes the running app's navigator is currently holding, read out of the JS runtime.
 *
 * `param-store.ts` harvests param values from testIDs, which works only where the app happens to
 * stamp a value into one *and* that testID survives into the accessibility tree. Both conditions
 * fail often enough that this module is the difference between reaching a parameterised route and
 * walking to it. Two ways they fail, measured on a real app rather than imagined:
 *
 * - **The value is in a testID that never reaches the tree.** An interpolated testID sitting under
 *   a wrapper that carries its own `accessibilityLabel` is replaced by that label in the read, so
 *   the row arrives as a sentence and the identifier is simply not there to harvest.
 * - **The value is in no testID at all.** Opaque record keys — a post id, a list key — are
 *   routinely passed as navigation params without ever being stamped into a control.
 *
 * The navigator knows those values in both cases, because it is what the app passed them to. That
 * is the whole reason to read it.
 *
 * This is **not** the CDP transport rewrite that was deliberately deferred. There is no new socket
 * client, no second `DevicePort`, and nothing persistent: it is one `agent-device cdp runtime eval`
 * per read, through the same CLI and the same target-selection helpers the CPU profiler already
 * uses (`profiling/cpu-evidence.ts`). The whole module is read-only — the expression it evaluates
 * must never call `navigate` or touch app state, and it is written so that it cannot.
 *
 * Everything here degrades to `null`. A release build has no DevTools hook, Metro may not be
 * running, Hermes implements only a subset of CDP, and React Navigation's internals move between
 * versions. None of those are errors the sweep should care about — they mean "no extra values
 * today", and the sweep explores exactly as it does now. The caller latches the first failure (see
 * `NavStateStatus`) so a sweep never pays for this twice.
 */

import { FIND_NAVIGATOR_JS } from './runtime-navigator.ts'

/** One route out of a flattened navigation state. */
export interface NavRoute {
  /** The navigator's own name for the screen — usually the route id the parser also knows. */
  name: string
  /** The URL path the route was entered at, when the app recorded one. */
  path?: string
  /** Only values that can honestly become a URL segment; see the expression below. */
  params?: Record<string, string>
}

/** What `readNavState` needs from the outside world, so tests never shell out. */
export interface NavStateDeps {
  /** Runs a shell command and returns its combined output. Rejects on a non-zero exit. */
  run(command: string, timeoutMs: number): Promise<string>
  /** `agent-device --session <name> cdp <args>`. Injected so the quoting stays in one place. */
  cdpCommand(args: string): string
  /** Shell-quotes one argument. */
  quote(value: string): string
  log?(message: string): void
}

/**
 * How long the one-off target list and select may take, matching `selectMetroCdpTarget`'s own
 * budget. Generous because `agent-device cdp` runs a pinned helper through npm and the very first
 * invocation on a machine may download it; a tighter bound here would latch `unavailable` for a
 * sweep purely because a package was cold.
 */
const SETUP_TIMEOUT_MS = 30_000
/** A read that has not answered in this long is not going to; the walk is waiting behind it. */
const EVAL_TIMEOUT_MS = 5_000

/**
 * The expression evaluated in the app's JS context.
 *
 * Written as one self-contained arrow IIFE that can only return a string or null, because anything
 * it throws surfaces as a CLI failure that says nothing useful. Three constraints shaped it:
 *
 * - **No instrumentation to rely on.** The comparison project injects a Babel transform and can
 *   assume a global navigation ref. We have neither, so the ref has to be *found*: walk the fiber
 *   tree from React DevTools' own hook and look for anything the app has handed a navigator to.
 * - **It runs on the app's JS thread.** An unbounded walk over a large tree would stall the UI,
 *   which is the one thing a read must never do, so the traversal is bounded and gives up rather
 *   than finishing at any cost.
 * - **Only URL-able values are worth returning.** Params are filtered to strings and finite
 *   numbers in the page, so a route object holding a whole post or a callback neither crosses the
 *   wire nor arrives as `[object Object]` pretending to be an id.
 *
 * ## Why this returned nothing on every real run, and what actually fixed it
 *
 * The first version of this module logged `navigation state eval returned nothing usable` on every
 * sweep against Bluesky, which latched `unavailable` and left the app's ten `:rkey` routes with no
 * value source at all. The obvious suspect was the fiber walk, and it was the wrong one. Evaluated
 * live against the running app, the original expression returns the full, correct payload:
 *
 * ```
 * [{"name":"HomeTab"},{"name":"Home"},{"name":"PostThread","params":{"name":"alice.test",
 *  "rkey":"3kabc7xyz"}},{"name":"PostQuotes","params":{…}},{"name":"SearchTab"},…]
 * ```
 *
 * **The payload was being cut off in transit.** `agent-device cdp runtime eval` truncates a
 * returned string at exactly 200 characters — measured, not inferred: `'X'.repeat(400)` comes back
 * as 200 `X`s. A real navigator's flattened state is 400-plus characters, so what reached
 * `parseNavStateOutput` was a string containing `[` and no closing `]`. Both candidate forms failed
 * to parse, the function returned null, and the module reported the runtime as unable to answer
 * when in fact it had answered perfectly. A 200-character ceiling is also why no amount of
 * re-running or re-scheduling would ever have helped.
 *
 * So the read is now **chunked**: the expression stashes its own payload on one namespaced global
 * and returns a short header plus the first slice, and `readNavState` asks for the remaining slices
 * until it has the whole string. A payload that fits in one slice still costs exactly one eval,
 * which is the common case. See `NAV_STATE_CHUNK` for the slice size and the header format.
 *
 * Stashing is the one write this module performs, and it is deliberate: recomputing the state for
 * each slice would be read-only but could interleave slices from two different navigation states
 * and assemble a payload that never existed. A single harness-owned global under a reserved name
 * is the lesser risk, and it touches nothing the app can observe.
 *
 * ## Why the carrier search still changed
 *
 * The truncation fix alone would have been enough on this app, so the discovery changes below are
 * robustness rather than the bug fix, and they are kept because each covers a case this app simply
 * does not exercise:
 *
 * - **`getRootState` is the container's method, not a screen's.** It lives on what
 *   `useNavigationContainerRef()` holds and on `NavigationContainerRefContext`, neither of which is
 *   guaranteed to sit in the fiber tree. What *is* in the tree, on every screen React Navigation
 *   renders, is the `navigation` prop, which carries `getState` and `getParent`. That shape is now
 *   accepted and climbed to the root, as the comparison project's runtime does (`runtime.js`'s
 *   `navigation(value)` helper). It discriminates on read-only methods rather than on `dispatch`,
 *   which is what that project uses, so this expression never so much as names a mutating method
 *   and the test asserting that stays a real guard instead of a thing to be exempted from.
 * - **Renderer ids are not stable and 1 was a guess.** On this app id 1 is in fact the React
 *   Native renderer, but `hook.renderers` is keyed by registration order, so a bundle that
 *   registers anything first would have left `getFiberRoots(1)` empty. The renderers are now
 *   enumerated and filtered by `rendererPackageName`, with the fixed-id call kept as a fallback.
 * - **A carrier that answers badly must not end the search.** Each `getRootState()` is called in
 *   its own try/catch and its result is required to have `routes`, so a detached or still-mounting
 *   container ref is skipped rather than accepted as a successful read of an empty sweep.
 *
 * The budget moved for a measured reason: the live tree is **17,822 fibers**, and the comparison
 * project's own comment records a busy feed exceeding 16,000, which made the original 20,000-fiber
 * cap a coin flip on exactly the screens that matter. The real protection for the JS thread is the
 * wall-clock deadline, so the node count is now generous and the deadline is what stops the walk.
 * A `seen` set guards cycles, which a `child`/`sibling` push cannot do on its own.
 */

/**
 * How much payload one eval may return, and the header that frames it.
 *
 * `agent-device cdp runtime eval` truncates a returned string at 200 characters. The header is
 * `AIHNS1:<total>:` — a format marker, the full payload length, and a colon — so 160 characters of
 * slice leaves room for a five-digit length and never approaches the ceiling.
 */
const NAV_STATE_CHUNK = 160
/** The global the expression stashes its payload on, so slices come from one consistent read. */
const NAV_STATE_STASH = '__aiHarnessNavState'

export const NAV_STATE_EXPR = `(() => {
  try {
    ${FIND_NAVIGATOR_JS}
    var found = findNavigator()
    if (!found) return null
    var state = found.state
    if (!state) return null
    var flat = []
    var walk = function (node, depth) {
      if (!node || depth > 12 || !Array.isArray(node.routes)) return
      for (var i = 0; i < node.routes.length; i++) {
        var route = node.routes[i]
        if (!route || typeof route.name !== "string") continue
        var entry = { name: route.name }
        if (typeof route.path === "string" && route.path) entry.path = route.path
        var raw = route.params
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          var kept = {}
          var any = false
          for (var key in raw) {
            var value = raw[key]
            if (typeof value === "string") { kept[key] = value; any = true }
            else if (typeof value === "number" && isFinite(value)) { kept[key] = String(value); any = true }
          }
          if (any) entry.params = kept
        }
        flat.push(entry)
        if (route.state) walk(route.state, depth + 1)
      }
    }
    walk(state, 0)
    var payload = JSON.stringify(flat)
    // Stashed so the remaining slices come from this same read; see the doc comment above.
    try { globalThis[${JSON.stringify(NAV_STATE_STASH)}] = payload } catch (error) {}
    return "AIHNS1:" + payload.length + ":" + payload.slice(0, ${NAV_STATE_CHUNK})
  } catch (error) {
    return null
  }
})()`

/**
 * Asks for one more slice of the payload the last `NAV_STATE_EXPR` stashed.
 *
 * Returns the same `AIHNS1:<total>:<slice>` framing so the caller has one parser, and `null` when
 * the stash is gone — an app reload between slices drops it, and a partial assembly must be
 * abandoned rather than parsed, because half a JSON array is not a smaller answer.
 */
export function navStateChunkExpr(offset: number): string {
  return `(() => {
  try {
    var payload = globalThis[${JSON.stringify(NAV_STATE_STASH)}]
    if (typeof payload !== "string") return null
    return "AIHNS1:" + payload.length + ":" + payload.slice(${Math.trunc(offset)}, ${Math.trunc(offset) + NAV_STATE_CHUNK})
  } catch (error) {
    return null
  }
})()`
}

/**
 * Pulls `AIHNS1:<total>:<slice>` back out of the CLI's own reporting.
 *
 * The slice is raw JSON, so it arrives escaped inside the CLI's `string: "…"` envelope and has to
 * be unescaped before it can be concatenated — the same quote-and-parse trick
 * `navStateCandidates` uses below. Returns null for anything that is not this framing, which
 * covers both an expression that returned null and a CLI that reported an error instead.
 */
export function parseNavStateChunk(output: string): { total: number; slice: string } | null {
  const envelope = /"((?:\\.|[^"\\])*)"/g
  for (const match of output.matchAll(envelope)) {
    const text = tryParse(`"${match[1]}"`)
    if (typeof text !== 'string') continue
    const framed = /^AIHNS1:(\d{1,9}):([\s\S]*)$/.exec(text)
    if (!framed) continue
    return { total: Number(framed[1]), slice: framed[2] ?? '' }
  }
  return null
}

/**
 * Finds the JSON array in whatever `agent-device cdp runtime eval` printed around it.
 *
 * The CLI wraps the evaluated value in its own reporting, and the exact shape belongs to a pinned
 * helper package rather than to this repo, so matching it exactly would be a version dependency
 * nobody would remember to update. Scanning for the payload is version-proof, and the cost of
 * being wrong is a `null` that latches `unavailable` — the same outcome as not trying.
 *
 * The expression returns a JSON *string*, so the array usually arrives escaped inside the CLI's
 * own JSON; both the escaped and the bare form are tried.
 */
export function parseNavStateOutput(output: string): NavRoute[] | null {
  for (const candidate of navStateCandidates(output)) {
    const routes = asRoutes(tryParse(candidate))
    if (routes) return routes
  }
  return null
}

function* navStateCandidates(output: string): Generator<string> {
  // The bare array, as the expression returned it.
  const open = output.indexOf('[')
  const close = output.lastIndexOf(']')
  if (open !== -1 && close > open) yield output.slice(open, close + 1)
  // The same array escaped inside the CLI's own JSON envelope, e.g. "value": "[{\"name\":…}]".
  for (const match of output.matchAll(/"(\[(?:\\.|[^"\\])*\])"/g)) {
    const unescaped = tryParse(`"${match[1]}"`)
    if (typeof unescaped === 'string') yield unescaped
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Accepts only the shape this module promises; anything else is treated as "not the payload". */
function asRoutes(value: unknown): NavRoute[] | null {
  if (!Array.isArray(value)) return null
  const routes: NavRoute[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const entry = item as { name?: unknown; path?: unknown; params?: unknown }
    if (typeof entry.name !== 'string' || !entry.name) return null
    const route: NavRoute = { name: entry.name }
    if (typeof entry.path === 'string' && entry.path) route.path = entry.path
    if (entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params)) {
      const params: Record<string, string> = {}
      for (const [key, raw] of Object.entries(entry.params)) {
        if (typeof raw === 'string') params[key] = raw
      }
      if (Object.keys(params).length) route.params = params
    }
    routes.push(route)
  }
  return routes
}

/**
 * Selects a Metro CDP target once, so later reads are a single eval.
 *
 * Separate from the read itself because selection is the expensive, once-per-sweep half and the
 * read is the cheap repeatable one. Returns false rather than throwing: every caller's answer to
 * "could not reach the runtime" is the same, and it is not an error.
 */
export async function selectNavStateTarget(
  metroPort: number,
  appLabel: string | null,
  deps: NavStateDeps,
  pickTarget: (output: string, preferred: Array<string | null | undefined>) => string | null
): Promise<boolean> {
  const metroUrl = `http://127.0.0.1:${metroPort}`
  try {
    const listed = await deps.run(
      deps.cdpCommand(`target list --url ${deps.quote(metroUrl)}`),
      SETUP_TIMEOUT_MS
    )
    const target = pickTarget(listed, [appLabel, 'React Native'])
    if (!target) {
      deps.log?.(`no Metro CDP target at ${metroUrl}`)
      return false
    }
    await deps.run(deps.cdpCommand(`target select ${deps.quote(target)}`), SETUP_TIMEOUT_MS)
    return true
  } catch (error) {
    deps.log?.(`could not select a Metro CDP target — ${errorText(error)}`)
    return false
  }
}

/**
 * The currently mounted navigator's routes, or null when the runtime cannot answer.
 *
 * **Honest limit, and it decides how this should be scheduled.** This sees the mounted navigator
 * state and its stack history — not every record the app holds, only the ones it is showing or has
 * shown. So it is worth reading right after capturing a screen that is a parent (or, through
 * `findRouteAncestors`, an ancestor) of a still-unreached node with unresolved params, and worth
 * nothing at all otherwise. Read on that schedule it is a handful of CLI round trips per sweep;
 * read eagerly it is a tax on every screen for values that are not there yet.
 */
export async function readNavState(deps: NavStateDeps): Promise<NavRoute[] | null> {
  try {
    const first = parseNavStateChunk(
      await deps.run(
        deps.cdpCommand(`runtime eval --expr ${deps.quote(NAV_STATE_EXPR)}`),
        EVAL_TIMEOUT_MS
      )
    )
    if (!first) {
      deps.log?.('navigation state eval returned nothing usable')
      return null
    }
    let payload = first.slice
    // Bounded by the payload's own declared length, so a stash that keeps answering with the same
    // slice cannot loop: every pass must extend `payload` or the read is abandoned.
    while (payload.length < first.total) {
      const next = parseNavStateChunk(
        await deps.run(
          deps.cdpCommand(`runtime eval --expr ${deps.quote(navStateChunkExpr(payload.length))}`),
          EVAL_TIMEOUT_MS
        )
      )
      if (!next?.slice.length || next.total !== first.total) {
        // The app reloaded, or the stash went away mid-read. Half a JSON array is not a smaller
        // answer, so this is reported the same way an unreachable runtime is.
        deps.log?.(
          `navigation state read truncated at ${payload.length} of ${first.total} characters`
        )
        return null
      }
      payload += next.slice
    }
    const routes = parseNavStateOutput(payload)
    if (!routes) deps.log?.('navigation state eval returned nothing usable')
    return routes
  } catch (error) {
    deps.log?.(`navigation state eval failed — ${errorText(error)}`)
    return null
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
