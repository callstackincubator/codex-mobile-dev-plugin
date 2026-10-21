import type {
  AppFlowDestinationLocator,
  AppFlowNavigationAction,
  AppFlowNavigationDecision
} from './capture.ts'
import type {
  AppFlowCaptureStatus,
  AppFlowGuard,
  AppFlowPressable,
  AppFlowTrigger
} from '../shared/app-flow.ts'
import { PARAM_VALUE_RE } from './param-store.ts'
import type { ParamResolution, ParamRouteNode, ParamSource } from './param-store.ts'
import { fingerprint, similarity, tokenize } from './screen-signals.ts'

const LOCATOR_KINDS = new Set(['text', 'label', 'id'])

/**
 * `qualifiers` appends extra selector terms to narrow an otherwise ambiguous match — agent-device's
 * selector grammar is a space-separated term list, so `label="Menu" hittable=true` is one selector
 * matching only the tappable `Menu`. Used by `executeNavigationActions`'s ambiguity retry; see there
 * for why a plain locator is tried first.
 */
export function serializeLocator(
  locator: { by: 'text' | 'label' | 'id'; value: string },
  qualifiers?: Readonly<Record<string, string | boolean>>
): string {
  const value = locator.value.trim()
  if (!LOCATOR_KINDS.has(locator.by) || !value) throw new Error('Invalid navigation locator')
  const base = `${locator.by}=${JSON.stringify(value)}`
  const extra = Object.entries(qualifiers ?? {}).map(
    ([key, term]) => `${key}=${typeof term === 'boolean' ? term : JSON.stringify(term)}`
  )
  return [base, ...extra].join(' ')
}

/** agent-device refuses to act on a selector matching more than one element, rather than guessing
 *  which one the caller meant. Recognised so a caller can narrow and retry instead of giving up. */
export function isAmbiguousSelectorMessage(message: string): boolean {
  return /matched \d+ distinct actionable elements/i.test(message)
}

export function parseNavigationDecision(value: unknown): AppFlowNavigationDecision | null {
  if (!value || typeof value !== 'object') return null
  const decision = value as Record<string, unknown>
  if (decision.decision === 'arrived') {
    if (typeof decision.reason !== 'string') return null
    // A malformed `destinationLocator` is dropped rather than failing the decision. The locator
    // only decides whether the walk's recording can be published; the arrival itself was judged by
    // a separate screenshot verdict. Rejecting the whole decision over it would throw away a
    // correct, already-walked journey because the model named a landmark the wrong way — the
    // caller's landmark fallback handles the gap far better than a retry loop would.
    const destinationLocator = asDestinationLocator(decision.destinationLocator)
    return destinationLocator
      ? { decision: 'arrived', reason: decision.reason, destinationLocator }
      : { decision: 'arrived', reason: decision.reason }
  }
  if (decision.decision === 'blocked') {
    return typeof decision.reason === 'string'
      ? { decision: 'blocked', reason: decision.reason }
      : null
  }
  if (decision.decision !== 'act' || !isNavigationAction(decision.action)) return null
  return {
    decision: 'act',
    action: decision.action,
    reason: typeof decision.reason === 'string' ? decision.reason : ''
  }
}

function isNavigationAction(value: unknown): value is AppFlowNavigationAction {
  if (!value || typeof value !== 'object') return false
  const action = value as Record<string, unknown>
  if (!['tap', 'swipe', 'input', 'wait'].includes(String(action.type))) return false
  if (action.type === 'tap' || action.type === 'input') {
    if (!isLocator(action.locator)) return false
  }
  if (action.type === 'input' && typeof action.value !== 'string') return false
  if (
    action.type === 'swipe' &&
    action.direction !== undefined &&
    !['up', 'down', 'left', 'right'].includes(String(action.direction))
  ) {
    return false
  }
  if (action.duration !== undefined && typeof action.duration !== 'number') return false
  return true
}

/**
 * Narrows an arbitrary value to a locator usable as a saved recording's destination guard, or
 * returns null.
 *
 * `by: 'text'` is deliberately not accepted, and this is the whole reason this is separate from
 * `isLocator`. agent-device's publish check wants a `wait` whose matched element it could record a
 * re-verifiable identity for, and it only records that identity when the element has an id or an
 * accessibility label — a matched node with neither yields no evidence, and the guard is then
 * rejected for having none. `label=` and `id=` selectors match *on* those attributes, so anything
 * they resolve necessarily carries one; `text=` matches rendered text, which on a plain RN `Text`
 * routinely exists with no `nativeID` and no `accessibilityLabel` at all. Accepting `text` would
 * therefore produce a guard that works sometimes and silently loses the script the rest of the
 * time, which is worse than never offering it.
 */
function asDestinationLocator(value: unknown): AppFlowDestinationLocator | null {
  if (!isLocator(value) || value.by === 'text') return null
  return { by: value.by, value: value.value.trim() }
}

// `chromeLocatorValues`, `isChromeLocator` and `pickLandmarkLocator` lived here. All three existed
// to choose the *destination guard* a recorded `.ad` script needed before agent-device would
// publish it — a wait on a durable, non-chrome landmark of the screen the walk ended on. The sweep
// records no scripts now (see `walk-commands.ts`), so nothing needs a guard chosen for it, and the
// manual recorder picks its own from the live snapshot (`manual/locators.ts`'s
// `destinationLocator`). `chrome-inventory.ts` still refers to `pickLandmarkLocator` by name in a
// comment contrasting its own locator rules; that contrast is with the rules, not the function.

function isLocator(value: unknown): value is { by: 'text' | 'label' | 'id'; value: string } {
  if (!value || typeof value !== 'object') return false
  const locator = value as Record<string, unknown>
  return (
    LOCATOR_KINDS.has(String(locator.by)) &&
    typeof locator.value === 'string' &&
    !!locator.value.trim()
  )
}

/** Tracks active exploration time while allowing user-controlled waits to be excluded. */
export class ActiveTimeBudget {
  private excludedMs = 0
  private readonly limitMs: number
  private readonly startedAt: number
  private readonly now: () => number

  constructor(limitMs: number, startedAt = Date.now(), now: () => number = Date.now) {
    this.limitMs = limitMs
    this.startedAt = startedAt
    this.now = now
  }

  exclude(ms: number): void {
    this.excludedMs += Math.max(0, ms)
  }

  get remainingMs(): number {
    return Math.max(0, this.limitMs - (this.now() - this.startedAt - this.excludedMs))
  }

  get expired(): boolean {
    return this.remainingMs === 0
  }
}

/**
 * Remembers which deep-link URLs the arrival judge has already rejected this sweep, so a caller
 * can skip reopening one it already knows fails instead of paying for the open, the
 * `waitForRoute`, the screenshot and the judge call again to relearn the same fact.
 *
 * This exists because `paramFreeDeepLink` truncates every route with an unresolved param to a
 * shared ancestor prefix (`/profile/:name…` becomes `/profile`), so every sibling route under
 * that ancestor computes the identical URL — and a node that gets requeued after the blocked-run
 * breaker fires recomputes the same URL for itself a second time too. A device run against
 * social-app hit both: five distinct nodes each independently rediscovered that `/profile` 404s,
 * and one of them (`ProfileFollows`) rediscovered it twice after a requeue. Keyed by the exact URL
 * opened rather than by node, so it catches both cases without knowing anything about the route
 * tree.
 *
 * Deliberately in-memory and scoped to one sweep, not persisted on the node — that is a later,
 * schema-backed step of the larger plan. This is only the cheap, self-contained subset of it.
 */
export class DeepLinkRejectionMemo {
  private readonly rejected = new Set<string>()

  wasRejected(url: string): boolean {
    return this.rejected.has(url)
  }

  reject(url: string): void {
    this.rejected.add(url)
  }
}

/**
 * Remembers which in-component guard conditions this build has already been *observed* to hold
 * closed, so sibling screens behind the same flag skip the device probe that would rediscover it.
 *
 * `explainUnavailable` can already name the gate from the source the moment a guarded route 404s —
 * but it is only consulted *after* the deep link has been opened, settled, screenshotted and
 * judged. That ordering is right for a single node (the parser knows the flag exists, not what the
 * build set it to, and only the device can answer that) and wasteful across a family of them: a
 * sweep against social-app paid 4.1s apiece to learn four separate times that
 * `ax.features.ModerationInboxEnable` is off, each probe ending in the identical 'Page not found'
 * frame and the identical static explanation.
 *
 * So the first node behind a condition still pays full price and settles the question empirically;
 * every later node carrying the *same* condition text reads the answer off this memo for free. The
 * verdict recorded is therefore always a measured one, never an assumption from static source —
 * which is the distinction `explainUnavailable` exists to protect and this memo must not erode.
 *
 * Keyed by the condition's source text because that is what makes two guards the same gate: the
 * fallback component is too coarse (every gated screen in an app tends to render the same
 * `NotFoundScreen`) and the node is too fine (the whole point is to span siblings). Two screens
 * whose conditions are written differently but evaluate alike simply each pay once, which is the
 * cheap failure.
 *
 * In-memory and scoped to one sweep, exactly like `DeepLinkRejectionMemo` above and for the same
 * reason: a feature flag is a fact about one build, and the per-node durable record
 * (`deep-link-policy.ts`) is the thing that already rides across sweeps.
 */
export class GuardGateMemo {
  private readonly closed = new Set<string>()

  wasClosed(condition: string): boolean {
    return this.closed.has(condition)
  }

  close(condition: string): void {
    this.closed.add(condition)
  }
}

// `discardRecordingCandidate` lived here: unlink a walk's `.candidate.ad` and soft-home the app.
// Exploration writes no candidate file now, so there is nothing to discard and no caller left.

/**
 * What one unresolved hop costs relative to a whole extra screen in the journey. A hop the parser
 * resolved to a named control is something the planner can tap; one it could not is a claim that
 * the two screens are connected somehow, and walking it means finding the link yourself — often on
 * content that only exists once the app has loaded data. Any number of named taps is a better
 * journey than one guess, so the penalty is larger than any realistic path length.
 */
const UNRESOLVED_HOP_PENALTY = 1_000

/**
 * The most reliable path through the parsed route graph from a screen the app opens on to the
 * target: fewest hops whose control the parser could not name, and among those, fewest hops.
 *
 * Hop count alone picks the wrong journey. The graph is built by scanning each screen for
 * `navigate('X')`, so a screen that lists other records gets an edge to every screen those records
 * open — and that edge is a shortcut on paper only, because the control that walks it is a row the
 * app renders at runtime, not something the planner can find on a cold screen. The journey the
 * source spells out control-by-control is longer and actually walkable.
 *
 * `entryIds` are the screens reachable straight from the app's entry chrome — its tabs. A path is
 * only returned when it actually starts at one of them: walking back to "whatever has no incoming
 * edge" invents journeys that begin on an arbitrary screen the user can't even see at launch. No
 * honest path is better than a fabricated one — the caller then tells the planner to explore from
 * the tab bar instead.
 */
export function findNavigationPath(
  edges: readonly { from: string; to: string | null; trigger?: AppFlowTrigger | null }[],
  targetId: string,
  entryIds: Iterable<string>
): string[] | null {
  const entries = new Set(entryIds)
  if (entries.has(targetId)) return [targetId]

  const incoming = new Map<string, { from: string; cost: number }[]>()
  for (const edge of edges) {
    if (!edge.to || edge.from === edge.to) continue
    const hop = { from: edge.from, cost: edge.trigger ? 1 : 1 + UNRESOLVED_HOP_PENALTY }
    const sources = incoming.get(edge.to)
    if (sources) sources.push(hop)
    else incoming.set(edge.to, [hop])
  }

  // Walked backwards from the target, cheapest partial journey first. `cheapest` is what stops a
  // cyclic graph looping: a screen is only re-expanded when a strictly cheaper way to it turns up.
  const cheapest = new Map<string, number>([[targetId, 0]])
  const frontier: { path: string[]; cost: number }[] = [{ path: [targetId], cost: 0 }]
  let best: { path: string[]; cost: number } | null = null
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost)
    const current = frontier.shift()!
    // Everything still queued costs at least this much, so no cheaper journey can come out of it.
    if (best && current.cost >= best.cost) break
    for (const hop of incoming.get(current.path[0]) ?? []) {
      const cost = current.cost + hop.cost
      const known = cheapest.get(hop.from)
      if (known !== undefined && known <= cost) continue
      cheapest.set(hop.from, cost)
      const path = [hop.from, ...current.path]
      // An entry screen ends the journey rather than extending it: a path is what the user walks
      // from launch, so it starts at the first entry it reaches and never passes through another.
      if (entries.has(hop.from)) {
        if (!best || cost < best.cost) best = { path, cost }
        continue
      }
      frontier.push({ path, cost })
    }
  }
  return best?.path ?? null
}

/**
 * Renders a journey as the taps that walk it, naming the control for each hop the parser resolved.
 * A hop with no known control is stated as such rather than left out, so the planner can see which
 * single step it has to work out for itself instead of re-deriving the whole route.
 */
export function describeJourney(
  edges: readonly { from: string; to: string | null; trigger?: AppFlowTrigger | null }[],
  path: readonly string[]
): string {
  if (path.length < 2) return path[0] ?? ''
  const hops: string[] = [path[0]]
  for (let index = 1; index < path.length; index++) {
    const edge = edges.find(
      (candidate) => candidate.from === path[index - 1] && candidate.to === path[index]
    )
    const trigger = edge?.trigger
    hops.push(
      trigger
        ? `--[tap ${trigger.by}=${JSON.stringify(trigger.value)}]--> ${path[index]}`
        : `--[control unknown, find it on screen]--> ${path[index]}`
    )
  }
  return hops.join(' ')
}

export type ReachMethod = 'saved-replay' | 'deep-link' | 'agent-navigation'

export interface ExplorationObservation {
  pressables: AppFlowPressable[]
  screenshotPath: string
}

export interface ExplorationResult {
  arrived: boolean
  actions: AppFlowNavigationAction[]
  reason: string
  /**
   * Set only on an arrival, and only when the planner named a usable one. The caller needs it to
   * guard the recording it is about to publish — see `AppFlowNavigationDecision` — and falls back
   * to `pickLandmarkLocator` over the arrival observation's controls when it is absent.
   */
  destinationLocator?: AppFlowDestinationLocator
}

/**
 * How many planner decisions one exploration attempt gets before it gives up on the target.
 *
 * The walk itself is short when it is going to work at all: a screen behind a tab bar is one tap, a
 * screen behind a drawer is two, and a seeded walk starts a hop away by construction. What the
 * higher cap bought was not deeper walks but longer flailing on screens that cannot be reached at
 * all from where the explorer is standing — a route whose list is empty so no row exists to open,
 * or a destination whose entry point sits behind a feature flag that is off in this build. Those
 * look identical to the planner on every step: a plausible screen, no control leading onward. It
 * cannot conclude "unreachable" from one frame, so it keeps proposing the next most promising tap
 * until something else stops it, and every one of those taps is a screenshot, a control read and a
 * vision call.
 *
 * Seven is chosen to clear a realistic walk with room to recover from a wrong turn, and to stop
 * well before a doomed one has spent a whole budget. Two attempts per node (seeded, then from the
 * entry screen) still apply, so a genuinely reachable screen that the first walk approached badly
 * gets a second, independent seven.
 */
export const EXPLORATION_MAX_DECISIONS = 7

/** Screenmap-style observe → one action → observe loop, with injected device/model operations. */
export async function runInteractiveExploration(options: {
  budget: ActiveTimeBudget
  maxDecisions?: number
  maxNoProgress?: number
  maxPlannerFailures?: number
  /**
   * How many times the planner may claim arrival and be overruled by `verifyArrival` before the
   * walk gives up. Two by default.
   *
   * This is its own budget because a rejected arrival is the one unproductive step that no other
   * counter sees. It executes no action, so `actionAttempted` stays false and the no-progress
   * fingerprint comparison never runs; it parses fine, so `maxPlannerFailures` is not touched. On
   * device that left `maxDecisions` as its only bound, and a `SearchTab/Search` walk spent all of
   * it: the planner said "arrived" on steps 2, 3 and 4 of the same unchanged screen, the judge
   * said mismatch twice and match on the third, and each round cost a full planner call plus a
   * full judge call — about 12k tokens to re-roll a verdict on pixels that never changed.
   */
  maxArrivalRejections?: number
  observe(step: number): Promise<ExplorationObservation>
  /**
   * `history` carries only what went wrong along the way — a rejected arrival, a failed action, a
   * planner call that errored — never a log of every successful step. That is deliberate: `decide`
   * is expected to be backed by one long-lived model session per exploration attempt (a fresh
   * sub-agent session per call would pay for resending the full history every time, which is the
   * quadratic-cost problem this shape exists to avoid), so the model already has its own
   * successful actions in its own conversation. Only the failures are new information the model
   * would not otherwise have — a rejected `decide` call never becomes a turn in that conversation.
   */
  decide(
    observation: ExplorationObservation,
    history: readonly string[]
  ): Promise<AppFlowNavigationDecision | null>
  act(action: AppFlowNavigationAction): Promise<void>
  verifyArrival(observation: ExplorationObservation): Promise<boolean>
  check?(): void
  /**
   * Fired once per observation, after it is taken but before it feeds the no-progress fingerprint
   * comparison or the planner. Exists so the orchestrator can opportunistically recognise a
   * *different* pending screen the walk toward this target happened to land on — Settings, Profile
   * and the other hub screens this loop passes through on the way to almost anywhere — without this
   * module knowing anything about capture maps, slugs, or checkpoints. A failure here must not derail
   * the walk toward the real target, so it is swallowed rather than propagated.
   */
  observed?(observation: ExplorationObservation): Promise<void>
}): Promise<ExplorationResult> {
  const actions: AppFlowNavigationAction[] = []
  const history: string[] = []
  let previous: Set<string> | null = null
  let noProgress = 0
  let actionAttempted = false
  let successfulActionPendingObservation = false
  let plannerFailures = 0
  const maxDecisions = options.maxDecisions ?? 30
  const maxNoProgress = options.maxNoProgress ?? 3
  const maxPlannerFailures = options.maxPlannerFailures ?? 3
  const maxArrivalRejections = options.maxArrivalRejections ?? 2
  let arrivalRejections = 0

  for (let step = 0; step < maxDecisions && !options.budget.expired; step++) {
    options.check?.()
    const observation = await options.observe(step)
    options.check?.()
    if (options.observed) {
      try {
        await options.observed(observation)
      } catch (error) {
        // Opportunistic capture is a side effect of observing, never a reason the real target's
        // walk should stop — see the doc comment on `observed` above.
        console.error('[app-flow] observed hook failed:', error)
      }
      options.check?.()
    }
    if (options.budget.expired) break
    const current = fingerprint(observation.pressables)
    if (actionAttempted) {
      if (previous && similarity(previous, current) >= 0.98) noProgress += 1
      else noProgress = 0
    }
    previous = current
    actionAttempted = false
    successfulActionPendingObservation = false
    if (noProgress >= maxNoProgress) {
      return {
        arrived: false,
        actions,
        reason: 'Three consecutive actions made no visible progress.'
      }
    }

    let decision: AppFlowNavigationDecision | null
    try {
      decision = await options.decide(observation, history)
    } catch (error) {
      // A planner call that times out or errors says nothing about the screen — the app is still
      // sitting where the last action left it. Losing the whole target to one slow call throws away
      // every step already walked, so the failure costs this step and the loop observes again.
      plannerFailures += 1
      const detail = error instanceof Error ? error.message : String(error)
      history.push(`Planner call failed: ${detail}; decide again from the fresh observation.`)
      options.check?.()
      if (plannerFailures >= maxPlannerFailures) {
        return {
          arrived: false,
          actions,
          reason: `Planner failed ${plannerFailures} times in a row: ${detail}`
        }
      }
      continue
    }
    options.check?.()
    if (options.budget.expired) break
    if (!decision) {
      // Counted against the same budget as a thrown planner call, and for a sharper reason than
      // symmetry. A call that returns unparseable JSON is the *most* expensive kind: on device, the
      // two `/profile/:name` steps that produced no usable decision burned 3,076 and 5,890 reasoning
      // tokens before emitting 44 and 203 characters of text. Leaving this path uncounted meant the
      // costliest failure mode was the only one with no failure budget at all — it ran until
      // `maxDecisions`, and every step after it also re-read the dead trace as input.
      plannerFailures += 1
      history.push('Planner returned an invalid decision; inspect the fresh UI and correct it.')
      if (plannerFailures >= maxPlannerFailures) {
        return {
          arrived: false,
          actions,
          reason: `Planner failed ${plannerFailures} times in a row: returned an invalid decision.`
        }
      }
      continue
    }
    // Reset here rather than the moment `decide` returns: a call that came back with unparseable
    // JSON has not succeeded, and resetting on return would have made the counter above unreachable.
    plannerFailures = 0
    if (decision.decision === 'blocked') return { arrived: false, actions, reason: decision.reason }
    if (decision.decision === 'arrived') {
      if (await options.verifyArrival(observation)) {
        return decision.destinationLocator
          ? {
              arrived: true,
              actions,
              reason: decision.reason,
              destinationLocator: decision.destinationLocator
            }
          : { arrived: true, actions, reason: decision.reason }
      }
      arrivalRejections += 1
      history.push(`Arrival rejected: ${decision.reason}`)
      // The planner and the judge disagree about the screen in front of them, and nothing the loop
      // does next changes that screen — it re-observes the same frame and asks the same two
      // questions again. Past a couple of rounds that is not exploration, it is paying twice per
      // round to re-roll a non-deterministic verdict, so the walk stops and says so rather than
      // spending the rest of `maxDecisions` on it.
      if (arrivalRejections >= maxArrivalRejections) {
        return {
          arrived: false,
          actions,
          reason: `Planner claimed arrival ${arrivalRejections} times and the arrival check rejected each one: ${decision.reason}`
        }
      }
      continue
    }

    try {
      actionAttempted = true
      await options.act(decision.action)
      actions.push(decision.action)
      successfulActionPendingObservation = true
      // No "action succeeded" note: a successful action needs no correction, and with a
      // session-scoped planner (see `decide`'s doc comment) the model already knows what it just
      // did — it is sitting right there in its own conversation. Recording it here too would only
      // resurrect the per-step history dump this shape exists to avoid.
    } catch (error) {
      history.push(
        `Action failed: ${JSON.stringify(decision.action)} — ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  // A decision cap limits model calls, not observations. If the final permitted decision was a
  // successful action, inspect its result once before giving up. Previously an action that reached
  // the target on decision seven was guaranteed to be reported missing because the loop ended
  // before the corresponding observe/arrival check; Moderation did exactly that in the regression
  // run. This adds no planner call and only pays the verifier when there is a new final frame.
  if (successfulActionPendingObservation && !options.budget.expired) {
    options.check?.()
    const observation = await options.observe(maxDecisions)
    options.check?.()
    if (options.observed) {
      try {
        await options.observed(observation)
      } catch (error) {
        console.error('[app-flow] observed hook failed:', error)
      }
      options.check?.()
    }
    if (!options.budget.expired && (await options.verifyArrival(observation))) {
      return {
        arrived: true,
        actions,
        reason: 'The final navigation action reached the target.'
      }
    }
  }
  return {
    arrived: false,
    actions,
    reason: options.budget.expired
      ? 'Navigation budget exhausted after five minutes.'
      : `Navigation stopped after ${maxDecisions} decisions.`
  }
}

/**
 * Every ancestor of `urlPath` that is itself a route, deepest first — `/moderation/inbox` then
 * `/moderation` for `/moderation/inbox/settings`. Deepest first because the shortest remaining
 * journey is the one least likely to go wrong.
 *
 * Kept here, verbatim, as the ancestry primitive `reach/seed.ts`'s `findSeedSource` builds on —
 * that module supersedes this file's old `findSeedAncestor`, which offered only one proof of
 * reachability (a deep link opened this run). `findSeedSource` adds a second, stronger one (a
 * verified replay) without touching how ancestry itself is computed.
 */
export function findRouteAncestors<T extends { id: string; urlPath: string | null }>(
  urlPath: string,
  nodes: readonly T[]
): T[] {
  const byPath = new Map<string, T>()
  for (const node of nodes) {
    if (node.urlPath) byPath.set(node.urlPath.replace(/\/+$/, ''), node)
  }
  const segments = urlPath.replace(/\/+$/, '').split('/')
  const found: T[] = []
  for (let cut = segments.length - 1; cut > 1; cut--) {
    const ancestor = byPath.get(segments.slice(0, cut).join('/'))
    if (ancestor) found.push(ancestor)
  }
  return found
}

/**
 * The nearest ancestor of `urlPath` that is itself a route, e.g. `/moderation/inbox` for
 * `/moderation/inbox/settings`. Used to judge whether a 404 is about this one screen or about a
 * whole branch of the app being absent.
 */
export function findRouteAncestor<T extends { id: string; urlPath: string | null }>(
  urlPath: string,
  nodes: readonly T[]
): T | null {
  return findRouteAncestors(urlPath, nodes)[0] ?? null
}

/**
 * The settled explanation for a screen its own build gates off, in one place because two callers
 * now produce it: `explainUnavailable` below, for the node that discovers the gate by probing it,
 * and the deep-link strategy's `GuardGateMemo` short-circuit, for every sibling that then skips
 * the probe. The two must read identically — they are the same finding about the same gate, and a
 * reader comparing two nodes' recorded reasons should not have to work out whether a wording
 * difference means something.
 */
export function explainGuardGate(guard: AppFlowGuard): string {
  return `Registered but gated off in this build: the screen renders <${guard.fallback}/> unless \`${guard.condition}\` is false.`
}

/**
 * Explains a deep link that resolved but landed on the app's own not-found screen, or returns null
 * when the sweep still has to explore to find out.
 *
 * A registered route rendering 404 means one of two things: the build gates the screen off, or the
 * URL the sweep built was not the one the route wanted. Telling them apart matters — the first is a
 * final answer worth recording, the second is exactly the case exploration exists for.
 */
export function explainUnavailable(
  node: {
    urlPath: string | null
    params: readonly string[]
    guard: AppFlowGuard | null
  },
  ancestorStatus: AppFlowCaptureStatus | null
): string | null {
  // A sample param the sweep invented is at least as likely as a gate to be why the route 404s,
  // and unlike a gate it is something exploration can get past.
  if (node.params.length) return null
  if (node.guard) return explainGuardGate(node.guard)
  // No gate found in the source — but a 404 under a branch the sweep has already reached cannot be
  // a wrong URL, because the surrounding routes resolved. Something in the build withholds it.
  if (ancestorStatus === 'ok' || ancestorStatus === 'unavailable') {
    return 'Registered but not available in this build: the route resolves under a reachable branch yet renders the not-found screen.'
  }
  return null
}

/** The subset of a node `indexDeepLinkPath` reads. */
export interface IndexDeepLinkNode {
  id: string
  group: string
  file: string | null
}

/**
 * The route a root-path screen (`urlPath: '/'`) should be deep-linked at, or **null when no honest
 * answer exists** and the screen has to be reached through the UI instead.
 *
 * Opening the bare scheme does not switch tabs, so a screen registered at `/` cannot be deep-linked
 * directly and something has to stand in for it. Exactly one substitution is grounded: an Expo
 * Router route group (`(tabs)/index` → `/(tabs)`) is a real route the app declares, read off the
 * node's own id or group.
 *
 * Everything else used to fall back to the first segment of the source file path, and that is not a
 * guess so much as an invention. On Bluesky — React Navigation, no route groups —
 * `HomeTab/Home` (`src/view/screens/Home.tsx`) produced `bluesky://src`, a path the app has never
 * heard of, and the only thing it could possibly do was render the build's own 404. The device log
 * shows the full price paid per root-path node: a URL open, a `waitForRoute`, a screenshot and a
 * 3.5s arrival call, all to be told `Page not found`, before the ladder fell through to the walk
 * that was always going to be the answer. Worse, the mismatch is indistinguishable from a route the
 * build genuinely withholds, so it also fed `registerDeepLinkFailure` — an invented URL voting on
 * whether the app's URL scheme works.
 *
 * Returning null makes "there is no URL for this screen" a first-class answer, which is the truth
 * for a React Navigation root screen, and lets `deepLinkStrategy` skip straight to the walk.
 * `probe-route.ts` already refuses to *probe* a root path for this same reason; this is the
 * per-node half of the same rule.
 */
export function indexDeepLinkPath(node: IndexDeepLinkNode): string | null {
  const group = node.id.split('/').find((seg) => seg.startsWith('(') && seg.endsWith(')'))
  if (group) return `/${group}`
  if (node.group.startsWith('(') && node.group.endsWith(')')) return `/${node.group}`
  return null
}

/** Whether `node` is a root-path screen with no grounded stand-in route — the case where a deep
 *  link can only be invented, and so must not be attempted at all. */
export function isUndeeplinkableRoot(
  node: IndexDeepLinkNode & { urlPath: string | null }
): boolean {
  return (node.urlPath === '/' || node.urlPath === '') && indexDeepLinkPath(node) === null
}

/**
 * The longest prefix of `urlPath` that carries no unresolved param, or null when the route needs one
 * in its very first segment.
 *
 * A route the call sites never supply a value for is not automatically unreachable by URL: apps
 * routinely resolve the parameterised route's own prefix on their own — `/profile/:name` opens the
 * signed-in user's profile. Trying that costs one open and one arrival check, and the arrival
 * verifier is what decides whether it landed on the target, so a prefix that means something else
 * simply falls through to exploration.
 */
export function paramFreeDeepLink(
  urlPath: string,
  unresolvedParams: readonly string[]
): string | null {
  if (!unresolvedParams.length) return urlPath
  const wanted = new Set(unresolvedParams)
  const segments = urlPath.replace(/\/+$/, '').split('/')
  const at = segments.findIndex((segment) => wanted.has(paramKey(segment) ?? ''))
  if (at === -1) return urlPath
  const prefix = segments.slice(0, at).join('/')
  return prefix && prefix !== '/' ? prefix : null
}

/** The param a route segment declares — `:name` and `[name]` alike — or null for a literal one. */
function paramKey(segment: string): string | null {
  if (segment.startsWith(':')) return segment.slice(1)
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return segment.slice(1, -1).replace(/^\.\.\./, '')
  }
  return null
}

/** Longest control caption the planner is shown before it is cut. */
const PRESSABLE_TEXT_LIMIT = 80

/**
 * The visible controls trimmed to what a planner can act on. A content-heavy screen — a feed, a
 * search result list — exposes hundreds of pressables whose captions are whole posts, and sending
 * them verbatim has cost a single navigation step over twenty thousand input tokens and a hundred
 * seconds. Captions are cut to a length that still identifies the control, entries that collapse
 * onto each other once cut are dropped as the duplicate locators they are, and the count left out
 * is reported so the planner knows it is looking at a window rather than the whole screen.
 *
 * `identifier` — when a control has one — is put first in the object and `text` is left out
 * entirely, rather than the two of them sitting alongside `label` as equally-weighted fields. The
 * ProfileFollowers walk in session_2026-09-22_22-48-44.log is why: the row's name was only ever
 * exposed as `label` (`{"label":"Clockwork Creature","role":"StaticText"}`, no `identifier` at
 * all), and the planner still spent its first step on `by:"text"`, which agent-device rejected
 * outright ("Selector did not match: text=\"Clockwork Creature\""), then a second step on a
 * same-shaped neighbour (`label:"Clockwork Creature's avatar"`) that matched but opened a post
 * thread instead of the profile — two of five steps burned, versus the very next screen
 * (ProfileFollows) landing in two taps because every control on it carried a testID
 * (`bottomBarProfileBtn`, `profileHeaderFollowsButton`). A control list where `text` and `label`
 * flank `identifier` as one option among three invites exactly that guessing; leading with
 * `identifier` and dropping the field that duplicates `label` most often (`text` is `node.value` in
 * capture.ts, which for a plain pressable is usually the same caption `label` already carries)
 * makes the stable handle the obvious first read and shrinks the payload besides — this list is
 * resent for the two most recent observations on every step, so every byte trimmed here is paid
 * back on every subsequent step.
 */
export function summarizePressables(
  pressables: readonly AppFlowPressable[],
  limit = 60,
  maxChars = PRESSABLE_TEXT_LIMIT
): { shown: AppFlowPressable[]; omitted: number } {
  const seen = new Set<string>()
  const unique: AppFlowPressable[] = []
  for (const pressable of pressables) {
    const identifier = pressable.identifier ? cut(pressable.identifier, maxChars) : undefined
    const trimmed: AppFlowPressable = identifier
      ? {
          identifier,
          ...(pressable.role ? { role: pressable.role } : {}),
          // `text` is dropped only when `label` is there to carry the caption: capture.ts sets
          // `text` from node.value and `label` from node.label (two independent fields), and on an
          // identified pressable that has both, node.value is almost always the same caption
          // node.label already carries — repeating it a third way just spends tokens nudging the
          // planner back toward the selectors that keep failing. When there is no `label`, node.value
          // is the control's only caption and dropping it would leave `{identifier, role}` saying
          // nothing about what the control holds — a text field's current contents, a control whose
          // state lives in its value. capture.ts keeps a pressable when ANY of text/label/identifier
          // is set, so that shape is one the capture side explicitly expects to emit.
          ...(pressable.label
            ? { label: cut(pressable.label, maxChars) }
            : pressable.text
              ? { text: cut(pressable.text, maxChars) }
              : {})
        }
      : {
          ...(pressable.text ? { text: cut(pressable.text, maxChars) } : {}),
          ...(pressable.label ? { label: cut(pressable.label, maxChars) } : {}),
          ...(pressable.role ? { role: pressable.role } : {})
        }
    const identity = JSON.stringify(trimmed)
    if (seen.has(identity)) continue
    seen.add(identity)
    unique.push(trimmed)
  }
  return { shown: unique.slice(0, limit), omitted: Math.max(0, unique.length - limit) }
}

function cut(value: string, maxChars: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}\u2026` : collapsed
}

/**
 * Whether a message describes the agent-device session or daemon being gone rather than the app
 * doing anything in particular — the daemon was replaced mid-walk (agent-device does this
 * transparently and logs it to stderr, never to a thrown error) and the session the replaced
 * daemon owned dies with it, so the next call against that session fails with wording like
 * "No active proxy device lease for this session; run open first." None of that says anything
 * about the app; it says the harness's connection to the device needs to be re-established.
 *
 * `capture.ts`'s `isMissingSessionError` (which decides whether to recover by relaunching) and
 * this file's `isToolingFailure` (which decides whether a reach failure counts against the
 * no-progress breaker) both need to recognise the same set of messages, so this is the one place
 * that wording lives — `isMissingSessionError` defers to it instead of keeping its own regex.
 */
export function isSessionLostMessage(message: string): boolean {
  return /no active session|run open first|session_not_found/i.test(message)
}

/**
 * One log-ready clause saying what a recovery site saw when it decided the session was gone: which
 * field carried the session-loss wording and what it said.
 *
 * "no active session, recovering" used to name only the step that caught it. The two causes that
 * matter — the literal wording on the message (the daemon was replaced, the session died with it)
 * and the wording only on `details.hint` (a replay's post-failure snapshot hit the dead session,
 * and the message says "capture-failed") — are different failures with different fixes, and
 * neither is recoverable from the bare line. Collapsed and cut so a replay failure that quotes a
 * long locator cannot flood the log; the caller adds what it was doing, which only it knows.
 */
export function describeSessionLoss(message: string, hint?: string): string {
  const cut = (value: string): string => {
    const collapsed = value.replace(/\s+/g, ' ').trim()
    return collapsed.length > 160 ? `${collapsed.slice(0, 160)}\u2026` : collapsed
  }
  if (isSessionLostMessage(message)) return `error message: ${cut(message)}`
  if (hint !== undefined && isSessionLostMessage(hint)) {
    return `error hint: ${cut(hint)} (message: ${cut(message)})`
  }
  return `error message: ${cut(message)}`
}

/**
 * Whether a failed reach is about the harness rather than the app — a planner that ran out of time,
 * an exhausted budget, a device command that could not complete, or the agent-device session it was
 * using having died (see `isSessionLostMessage`, most recently observed when a daemon replacement
 * mid-walk killed the session `saveAndReplayRecording` needed).
 *
 * The no-progress counter exists to spot an app stuck behind one screen it will not leave, and it
 * decides that by comparing the UI left behind by consecutive failures. Sibling screens look alike
 * — a followers list and a follows list are near-identical — so counting timeouts alongside real
 * navigation failures stops the sweep to ask the user to clear a blocker that was never there.
 */
export function isToolingFailure(reason: string | null): boolean {
  if (!reason) return false
  return (
    /sub-agent timed out|planner failed|budget exhaust|runner busy|screenshot failed/i.test(
      reason
    ) || isSessionLostMessage(reason)
  )
}

/**
 * Whether a walk seeded at a deep-linked ancestor is worth repeating from the app entry after it
 * failed.
 *
 * A retry earns its cost only when the first attempt left something unlearned. Two things do: the
 * walk never ran (the seed's recording could not launch, so the entry walk is the first real try),
 * or it died of the harness rather than the app (`isToolingFailure` — a planner timeout or a lost
 * session says nothing about whether the target is reachable). A walk that ran its decision loop
 * to an ordinary end — decisions spent, no visible progress, the planner returning blocked — has
 * already put the same planner, the same target and the same app in front of the question, from a
 * start the sweep had *proved* it could reach. Repeating it from the entry screen buys a second
 * seven decisions on the same evidence: measured, the retry cost ~55s and ended at the same
 * unresolved-param path, and two never-captured screens in the baseline sweep took 129.3s between
 * them. The replay-seeded branch already stops here for the same reason (`seedBaseReplayFailed`);
 * this extends that gate to the deep-link-seeded one instead of adding a second counter beside the
 * no-progress breaker, which counts *sweep-wide* failures and could not see a single node's two.
 */
export function shouldRetryFromEntry(seeded: {
  /** The seeded attempt reached the decision loop and ended without arriving. */
  walkRan: boolean
  reason: string | null
}): boolean {
  return !seeded.walkRan || isToolingFailure(seeded.reason)
}

/**
 * Real values for a route's params, harvested from the call sites that navigate to it. Only params
 * this finds evidence for appear in the result: an invented id is not a weaker deep link but a
 * different one, pointing at a record the app does not have, and the 404 it lands on says nothing
 * about the screen.
 */
export function resolveRouteParams(
  node: { id: string; params: readonly string[] },
  edges: readonly { to: string | null; raw: string; target: string | null }[]
): Record<string, string> {
  const incoming = edges.filter((edge) => edge.to === node.id && edge.raw)
  const resolved: Record<string, string> = {}
  for (const key of node.params) {
    const escaped = escapeParamKey(key)
    for (const edge of incoming) {
      const candidate =
        // `?name=alice` or `/name=alice` in a href-style target.
        edge.raw.match(new RegExp(`[/?&]${escaped}=([^&/'"\`\\s)]+)`))?.[1] ??
        // `navigate('Profile', { name: 'alice' })` — the params object at the call site.
        edge.raw.match(new RegExp(`\\b${escaped}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`))?.[1] ??
        // A literal segment sitting where the route declares the param.
        segmentForParam(edge, key)
      if (candidate && PARAM_VALUE_RE.test(candidate)) {
        resolved[key] = candidate
        break
      }
    }
  }
  return resolved
}

function escapeParamKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The subset of `ParamStore` this resolver needs, so callers and tests can pass a stub. */
export interface ParamStoreLike {
  noteStatic(node: ParamRouteNode, resolved: Record<string, string>): void
  best(node: ParamRouteNode): ParamResolution | null
}

/** A route's params as far as anything can honestly fill them, and where the values came from. */
export interface ResolvedRouteParams {
  /** Every param with a real value. Complete when `unresolved` is empty, partial otherwise. */
  values: Record<string, string>
  /** Params still without one — what `paramFreeDeepLink` truncates the URL at. */
  unresolved: string[]
  /** Where a *complete* set came from, for the sweep log. Null while the set is partial. */
  source: ParamSource | null
  /** The screen a complete harvested set was observed on, for the same log line. */
  seenOn: string | null
  /**
   * The route that owns the record a complete harvested set came from — not always this node; see
   * `sharesRouteParams`. Null for a static or partial set, which belong to no record. `demote` is
   * keyed on this.
   */
  ownedBy: string | null
}

/**
 * The values a route's params can be opened with, from the call sites *and* from what the app has
 * been seen holding.
 *
 * `resolveRouteParams` above stays exactly as pure as it was: it reads literals out of source text
 * and nothing else, and its tests are unchanged. This wraps it with the observed layer, and is the
 * single place the two meet — the orchestrator previously computed the static half twice per node,
 * once for the agent-device manifest's descriptive path and once for the gate that decides whether
 * a deep link is attempted at all, which is also how the two could drift.
 *
 * A complete harvested record **replaces** the static partial outright rather than topping it up.
 * That is the whole point of storing records: a `/profile/:name/lists/:rkey` built from a static
 * `name` and some other record's `rkey` opens cleanly, captures the wrong list, and nothing
 * downstream can tell. Precedence inside the store (`static` first, then navigation observations,
 * then learned testID shapes, then guessed ones) decides which single record wins; see `best`.
 */
export function resolveNodeParams(
  node: ParamRouteNode & { id: string; params: readonly string[] },
  edges: readonly { to: string | null; raw: string; target: string | null }[],
  store?: ParamStoreLike | null
): ResolvedRouteParams {
  const fromSource = resolveRouteParams(node, edges)
  // Registering the static read is what gives the store its shape baseline: a param whose call
  // sites spell out `alice.test` will not later accept a bare `42` scraped off a list row. It also
  // promotes a *complete* static read into a record, so the precedence comparison below has
  // something to compare against instead of being special-cased here.
  store?.noteStatic(node, fromSource)
  const harvested = store?.best(node) ?? null
  if (harvested) {
    return {
      values: { ...harvested.values },
      unresolved: [],
      source: harvested.source,
      seenOn: harvested.seenOn,
      ownedBy: harvested.ownedBy
    }
  }
  const unresolved = node.params.filter((key) => !(key in fromSource))
  return {
    values: fromSource,
    unresolved,
    source: !node.params.length || unresolved.length ? null : 'static',
    seenOn: null,
    ownedBy: null
  }
}

/** The segment of `edge.raw` that lines up with `:key` in the edge's target pattern. */
function segmentForParam(edge: { raw: string; target: string | null }, key: string): string | null {
  if (!edge.target) return null
  const pattern = edge.target.split(/[?#]/)[0].split('/')
  const actual = edge.raw.split(/[?#]/)[0].split('/')
  if (pattern.length !== actual.length) return null
  const at = pattern.findIndex((seg) => seg === `:${key}` || seg === `[${key}]`)
  return at === -1 ? null : (actual[at] ?? null)
}

/** What the candidate scorer below needs to know about a still-pending node. */
export interface OpportunisticCandidateNode {
  id: string
  title: string
  urlPath: string | null
}

/**
 * Splits `ProfileFollowers`-style identifiers into words before tokenizing. Route ids and
 * component names are source identifiers, not prose — they carry no spaces — while a live
 * observation's pressable text is real on-screen words (`fingerprint` tokenizes actual UI
 * labels). Without this, an id's own token never matches anything a screen actually shows.
 */
function splitCamelCase(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

/** Whether a url segment is a param placeholder (`:name`, `[name]`) rather than static text. */
function isParamSegment(segment: string): boolean {
  return segment.startsWith(':') || (segment.startsWith('[') && segment.endsWith(']'))
}

/**
 * The vocabulary a node's own static description contributes — the same shape `fingerprint`
 * builds from a live observation's pressables, so the two are comparable. `id`'s last `/`-segment
 * is used rather than the whole id, because parser ids for a duplicate screen name are qualified
 * as `layoutName/ScreenName` (see `parser.ts`); the layout half is the same for every screen it
 * registers and would dilute every one of that layout's candidates by the same amount rather than
 * help tell them apart. Param placeholders in `urlPath` (`:name`, `[id]`) are dropped for the same
 * reason: a param name is shared by every route that happens to take one, not evidence this
 * particular screen is on screen.
 */
export function expectedNodeTokens(node: OpportunisticCandidateNode): Set<string> {
  const parts = [node.title, node.id.split('/').pop() ?? node.id]
  if (node.urlPath) {
    for (const segment of node.urlPath.split('/')) {
      if (segment && !isParamSegment(segment)) parts.push(segment)
    }
  }
  const out = new Set<string>()
  for (const part of parts) for (const token of tokenize(splitCamelCase(part))) out.add(token)
  return out
}

/**
 * How much of a node's own descriptive vocabulary must actually appear in the live observation
 * before it is worth a vision call at all. This is coverage of `expected`, not a symmetric
 * (Jaccard) overlap: a content-heavy screen's observation routinely carries dozens of pressable
 * words having nothing to do with any one candidate's identity, and dividing by that huge union
 * would keep every genuine match near zero. What matters here is simpler — does this node's own
 * few words show up on screen — so the score is shared tokens over `expected.size` alone.
 *
 * Exported (plan Step 3d) so `reach/chrome-inventory.ts` can score a chrome item's pressable text
 * against a node's or a layout's own vocabulary with the identical scorer `pickOpportunisticCandidate`
 * uses below, rather than forking a second copy of this exact formula that could drift from it.
 */
export function expectedCoverage(
  observed: ReadonlySet<string>,
  expected: ReadonlySet<string>
): number {
  if (expected.size === 0) return 0
  let shared = 0
  for (const token of expected) if (observed.has(token)) shared += 1
  return shared / expected.size
}

/**
 * Coverage an opportunistic candidate needs before it is worth a vision call at all. Below this,
 * the shared app chrome most screens expose (a back button, a tab bar) produces enough incidental
 * overlap with almost any node's title to nominate something on every single step — exactly the
 * per-step-per-pending-node cost this pre-filter exists to avoid paying.
 *
 * This was 0.5, and a measured run showed that was far too lenient: 19 opportunistic checks were
 * made and 17 were rejected by the vision call — a 15% hit rate — costing 33.6s and 15,043 tokens
 * to confirm just 2 screens. A node's expected vocabulary is only a handful of words, so coverage
 * is coarse (1/2, 2/3, 3/5 all landed at or above 0.5), and a node needing only half its own
 * words was routinely nominated by a screen sharing a generic word or two. 0.7 sits just above
 * 2/3 and 3/5, the partial matches that dominated the rejected checks, while still admitting 3/4
 * and anything stronger; it is deliberately not higher, because a genuine match can legitimately
 * miss a word (a title the screen renders differently from its route name), and each missed
 * confirmation only costs a screen its own real exploration, not a wrong capture.
 *
 * Raised again from 0.7 to 0.85. `session_2026-10-09_17-22-18.log` measured one such check at
 * 3.2s with a wrong answer: it proposed `ProfileSearch` while the walk was heading to
 * `ProfileFollowers`, two screens whose titles and URLs overlap heavily. 0.7 still admitted
 * sibling screens, which are both the case this scorer cannot separate and the most common thing
 * to walk past, so only a near-complete match is now worth a model call.
 */
const MIN_OPPORTUNISTIC_OVERLAP = 0.85

/**
 * How much clearer the best candidate's coverage must be than the runner-up's before it is
 * trusted without a vision call to break the tie. Sibling screens that share almost their entire
 * vocabulary — a Followers list and a Follows list, see the comment on `isToolingFailure` above —
 * sit close together in score; without a margin requirement the pre-filter would confidently
 * nominate whichever of the two happened to sort first, and a mistaken opportunistic capture
 * writes a result with no replay and no way to notice it was ever wrong. Below this margin,
 * neither is proposed and both stay pending for their own real exploration.
 *
 * Raised from 0.25 to 0.35 alongside `MIN_OPPORTUNISTIC_OVERLAP` for the same measured reason
 * (17 of 19 checks rejected, 33.6s and 15,043 tokens for 2 confirmed screens). Only candidates
 * that already cleared the overlap floor reach this comparison, so they sit in [0.7, 1.0]; a
 * 0.25 margin let a full match beat a 0.75 sibling, which is a near-tie on vocabularies this
 * small, and the vision call then rejected it. 0.35 means a 1.0 winner needs the runner-up to
 * be at or below 0.65 — in practice a runner-up must be clearly weaker, not merely one word short.
 *
 * Raised again from 0.35 to 0.5 for the same `session_2026-10-09_17-22-18.log` measurement
 * (3.2s, wrong answer, `ProfileSearch` proposed over `ProfileFollowers`): siblings that close
 * together still got through at 0.35, so a winner now needs a runner-up at half its coverage or
 * less before the pre-filter nominates it.
 */
const MIN_OPPORTUNISTIC_MARGIN = 0.5

/**
 * Cheap textual pre-filter for opportunistic capture: picks at most one still-pending node whose
 * static description (title, id, url) overlaps the current live observation strongly and
 * unambiguously enough to be worth a single confirming vision call. Returns null when nothing
 * clears the bar or when the top two candidates are too close to call — either way, no candidate
 * is worth spending a model call on, so the caller spends nothing.
 */
export function pickOpportunisticCandidate<T extends OpportunisticCandidateNode>(
  observedTokens: ReadonlySet<string>,
  pending: readonly T[]
): T | null {
  const scored = pending
    .map((node) => ({ node, overlap: expectedCoverage(observedTokens, expectedNodeTokens(node)) }))
    .filter((entry) => entry.overlap >= MIN_OPPORTUNISTIC_OVERLAP)
    .sort((a, b) => b.overlap - a.overlap)
  if (scored.length === 0) return null
  const [best, runnerUp] = scored
  if (runnerUp && best.overlap - runnerUp.overlap < MIN_OPPORTUNISTIC_MARGIN) return null
  return best.node
}

/**
 * Withdraw a harvested record once a rung that *used* it has failed on the device, whatever the
 * node ended up as.
 *
 * Demotion used to run only when the whole ladder ended unreached. But the ladder ends with
 * exploration, which routinely rescues a node whose deep link and render both just failed on a bad
 * value — so the record stayed, and every sibling that borrowed it (`sharesRouteParams`) paid the
 * same failed attempts again. Measured on one sweep: a value valid on its own route and rejected by
 * two siblings, ~63s of wasted deep-link and render attempts each, ~126s in all, and the node was
 * still captured at the end so the old gate never fired.
 *
 * Keyed on observed failure, not on the value: a rung that declined without touching the device
 * says nothing about it, and neither does a tooling failure (timeout, dead session). Static
 * literals are the source's own claim and are never in the store to withdraw. After demotion the
 * store has nothing for the route, so the next borrower is declined for free and goes straight to
 * exploration rather than being handed a less trustworthy substitute.
 *
 * Returns whether a record was withdrawn.
 */
export function demoteFailedHarvest(
  store: { demote(nodeId: string, values: Record<string, string>): void },
  nodeId: string,
  resolution: Pick<ResolvedRouteParams, 'values' | 'unresolved' | 'source' | 'ownedBy'>,
  attempts: readonly {
    strategy: string
    ok: boolean
    touchedDevice: boolean
    reason: string
  }[]
): boolean {
  if (resolution.unresolved.length || !resolution.source || resolution.source === 'static') {
    return false
  }
  const failedOnValue = attempts.some(
    (attempt) =>
      (attempt.strategy === 'deep-link' || attempt.strategy === 'render') &&
      !attempt.ok &&
      attempt.touchedDevice &&
      !isToolingFailure(attempt.reason)
  )
  if (!failedOnValue) return false
  store.demote(resolution.ownedBy ?? nodeId, resolution.values)
  return true
}
