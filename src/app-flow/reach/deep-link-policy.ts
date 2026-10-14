/**
 * Persisted deep-link rejections — plan Step 3a.
 *
 * When the arrival judge rejects a deep link opened at a route's *own* URL, that is a verdict about
 * this build: the route does not resolve to the target. Recording it means a later sweep can skip
 * straight to exploration for that node instead of re-paying a URL open, a `waitForRoute` and a
 * vision call to rediscover the identical answer. The record lives on the node
 * (`AppFlowNode.deepLinkRejection`, see its doc comment in `shared/app-flow.ts`) and is invalidated
 * per node by `nodeStructureSignature`, not by the graph-wide structure key — a rejection about one
 * route must not evaporate because some unrelated screen in the app moved.
 *
 * Relationship to `DeepLinkRejectionMemo` (`exploration.ts`): that class dedupes by exact URL
 * string, in memory, for the lifetime of one sweep — it is what stops five sibling `/profile/:name`
 * routes from each rediscovering that the shared `/profile` prefix 404s. It is deliberately broader
 * than this module in one way (it also catches *partial*-prefix repeats, which this module never
 * records at all) and narrower in another (it forgets everything the moment the sweep ends). This
 * module is the opposite: narrow (only ever the node's own URL, never a prefix) and durable (rides
 * along in `app-flow.json` across sweeps). Merging them would blur both invariants — a memo entry
 * for a rejected partial prefix has no per-node structure to validate against, and a persisted
 * rejection must never accidentally attach to a prefix. They are kept as two separate, narrow
 * layers instead: `exploration.ts` still guards in-sweep partial repeats via the memo, and the
 * orchestrator additionally consults this module's `evaluateDeepLinkAttempt` for the node's own
 * durable verdict before it ever reaches the memo check. A structural reason reinforces the
 * decision: `exploration.ts` already imports several `reach/*.ts` modules (`arrival.ts`,
 * `delivery.ts`, `prompts.ts`), so this module importing `DeepLinkRejectionMemo` back out of
 * `exploration.ts` would create an import cycle.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values.
 */
import { createHash } from 'node:crypto'
import type { AppFlowDeepLinkRejection } from '../../shared/app-flow.ts'

/** The subset of `AppFlowNode` this module's signature and checks need. */
export interface DeepLinkPolicyNode {
  id: string
  file: string | null
  urlPath: string | null
  params: readonly string[]
}

/**
 * A fingerprint of one node's structure — its id, source file, URL and params — stable across
 * builds that parse the identical route and different the moment any of them changes. Sibling to
 * `computeStructureKey` (`orchestrator.ts`), which fingerprints the whole graph at once; this one
 * is deliberately scoped to a single node, because keying a rejection on the graph-wide signature
 * would discard every recorded rejection in the app the instant one unrelated route moved.
 */
export function nodeStructureSignature(node: DeepLinkPolicyNode): string {
  const hash = createHash('sha256')
  // NUL between fields, because it is the one byte none of them can contain: a plain separator a
  // file path or URL could itself hold would let two different nodes hash identically, and a
  // signature that collides silently reuses one route's rejection on another route.
  hash.update(node.id)
  hash.update('\0')
  hash.update(node.file ?? '')
  hash.update('\0')
  hash.update(node.urlPath ?? '')
  hash.update('\0')
  hash.update([...node.params].sort().join(','))
  return hash.digest('hex').slice(0, 16)
}

/**
 * Whether a stored rejection still describes the node as currently parsed. A `false` result means
 * the node's id, file, URL or params changed since the rejection was recorded — the route this
 * build actually serves at that id may be a different screen entirely, so the old verdict must be
 * dropped rather than carried forward or acted on.
 */
export function isDeepLinkRejectionCurrent(
  rejection: AppFlowDeepLinkRejection | null | undefined,
  node: DeepLinkPolicyNode
): rejection is AppFlowDeepLinkRejection {
  return Boolean(rejection) && rejection!.parsedSignature === nodeStructureSignature(node)
}

/**
 * Carries a stored rejection forward onto a freshly parsed node, the same way `capture` is carried
 * forward at the `orchestrator.ts` rebuild site — alongside it, not instead of it, since the two are
 * independent facts about the node. Returns null (never the stale record) when the signature no
 * longer matches, so a structurally-changed node starts this sweep with no suppression at all.
 */
export function carryForwardDeepLinkRejection(
  previous: AppFlowDeepLinkRejection | null | undefined,
  node: DeepLinkPolicyNode
): AppFlowDeepLinkRejection | null {
  return isDeepLinkRejectionCurrent(previous, node) ? previous : null
}

/** Builds the record to store after the judge rejects a node's own URL — see `evaluateDeepLinkAttempt`. */
export function recordDeepLinkRejection(
  node: DeepLinkPolicyNode,
  target: string,
  reason: string,
  rejectedAt: string
): AppFlowDeepLinkRejection {
  return {
    url: target,
    reason,
    rejectedAt,
    parsedSignature: nodeStructureSignature(node)
  }
}

/**
 * How many consecutive deep-link arrival mismatches trip the running circuit breaker and switch
 * deep links off for the rest of the sweep. Matches `BLOCKED_RUN_LIMIT`'s convention in
 * `orchestrator.ts`: one mismatch is ordinary (a guessed param, a route this build withholds),
 * three in a row without a single success in between is the scheme itself not routing — no point
 * paying a URL open, a `waitForRoute`, a screenshot and a vision call per remaining node to find
 * that out again.
 */
export const DEEPLINK_BREAKER_LIMIT = 3

/**
 * The deep-link circuit breaker's state, moved here from `orchestrator.ts`'s `deepLinkEnabled` /
 * `consecutiveDeepLinkFailures` locals — plan landing-order item 4. Kept as plain, immutable data
 * (every function below returns a new state rather than mutating one) so the decision of when to
 * trip, reset or re-confirm the breaker can be unit-tested with no device, no `ports`, and no
 * sweep-scoped closure — the strategy that calls a real device only has to run the *device* half
 * (the re-probe itself) and hand the boolean result back to `applyDeepLinkReprobeResult`.
 */
export interface DeepLinkBreakerState {
  enabled: boolean
  consecutiveFailures: number
}

/** Deep links start enabled with a clean slate — the initial one-time scheme probe in
 * `orchestrator.ts` decides the true starting `enabled` value; this is only the breaker's zero
 * state before that probe's result is folded in. */
export function initialDeepLinkBreakerState(enabled = true): DeepLinkBreakerState {
  return { enabled, consecutiveFailures: 0 }
}

/**
 * What to do after `registerDeepLinkFailure` bumps the counter to (or past) the limit. `'reprobe'`
 * means the caller must re-open `probeRoute` — the one route already proven to work — and report
 * the result back through `applyDeepLinkReprobeResult` before trusting `enabled` again;
 * `'disabled-immediately'` means there was no probe route to re-confirm against, so the breaker
 * trips on the raw count alone, exactly as it did before a probe route existed to re-check against.
 */
export type DeepLinkBreakerDecision =
  { action: 'continue' } | { action: 'reprobe' } | { action: 'disabled-immediately' }

/**
 * Registers one arrival mismatch that is real evidence about the transport (never call this for a
 * partial-prefix mismatch or a suppressed/skipped attempt — see `DeepLinkAttemptOutcome.feedsBreaker`
 * and this module's own doc comment on why a cached verdict must not feed the breaker). Below the
 * limit this only bumps the counter; at the limit it hands back a decision rather than deciding
 * `enabled` itself, because reaching the limit with a probe route available means the real verdict
 * depends on a device call only the caller can make.
 */
export function registerDeepLinkFailure(
  state: DeepLinkBreakerState,
  hasProbeRoute: boolean
): { state: DeepLinkBreakerState; decision: DeepLinkBreakerDecision } {
  const consecutiveFailures = state.consecutiveFailures + 1
  if (consecutiveFailures < DEEPLINK_BREAKER_LIMIT) {
    return { state: { ...state, consecutiveFailures }, decision: { action: 'continue' } }
  }
  if (!hasProbeRoute) {
    return {
      state: { enabled: false, consecutiveFailures },
      decision: { action: 'disabled-immediately' }
    }
  }
  return { state: { ...state, consecutiveFailures }, decision: { action: 'reprobe' } }
}

/**
 * Folds the result of re-opening `probeRoute` back into the breaker state. A route that still
 * resolves means the last three mismatches were about those specific screens, not the transport —
 * reset rather than merely "not disabled", so the next three mismatches get their own fresh count
 * instead of tripping the breaker on one more. A route that no longer resolves means the scheme
 * really is not routing; `consecutiveFailures` is left at the tripping count only for logging.
 */
export function applyDeepLinkReprobeResult(
  state: DeepLinkBreakerState,
  stillRoutes: boolean
): DeepLinkBreakerState {
  return stillRoutes
    ? { enabled: true, consecutiveFailures: 0 }
    : { enabled: false, consecutiveFailures: state.consecutiveFailures }
}

/** A deep link that matched resets the running count — see `registerDeepLinkFailure`'s doc comment. */
export function registerDeepLinkSuccess(state: DeepLinkBreakerState): DeepLinkBreakerState {
  return state.consecutiveFailures === 0 ? state : { ...state, consecutiveFailures: 0 }
}

export type DeepLinkAttemptOutcome =
  | {
      action: 'skip'
      /** A suppressed attempt never opens anything, so the device is never touched. */
      touchedDevice: false
      /**
       * A cached verdict is not new evidence about the transport — counting it would trip the
       * circuit breaker on stored history alone and disable deep links for the whole sweep on no
       * fresh signal at all. Explicit here so a caller reads the rule off the type rather than
       * having to infer it from "this branch happens to return before the breaker call".
       */
      feedsBreaker: false
      reason: string
    }
  | { action: 'proceed' }

/**
 * Decides whether a deep-link attempt at the node's own URL should be skipped because this build
 * already rejected it. Only ever applies to the non-partial attempt: a rejection is never recorded
 * for a prefix (see `recordDeepLinkRejection`'s caller), so a `target` that differs from the node's
 * own `urlPath` — the partial-prefix case — always proceeds regardless of what is stored.
 */
export function evaluateDeepLinkAttempt(
  node: DeepLinkPolicyNode,
  target: string,
  rejection: AppFlowDeepLinkRejection | null | undefined
): DeepLinkAttemptOutcome {
  if (rejection && rejection.url === target && isDeepLinkRejectionCurrent(rejection, node)) {
    return {
      action: 'skip',
      touchedDevice: false,
      feedsBreaker: false,
      reason: `Deep link ${target} already rejected — ${rejection.reason}`
    }
  }
  return { action: 'proceed' }
}
