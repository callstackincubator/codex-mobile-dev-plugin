/**
 * Walked edges — turning arrival confirmations into `origin: 'runtime-walk'` edges.
 *
 * `AppFlowEdge.origin` has carried `'runtime-walk'` — "minted from an actual interactive hop the
 * explorer walked" — since the field was introduced, and nothing has ever produced one. Every
 * runtime edge seen on a real device run against the Bluesky app came from `'runtime-chrome'`: a
 * token-overlap guess off a single screen scrape, `evidence.verified: false` on 52 of 54. Meanwhile
 * the explorer genuinely does learn, mid-walk, that it is standing on a known screen — the arrival
 * judge confirms the target, and the `observed` hook (`orchestrator.ts`) reports
 * `opportunistic-capture` / `runtime-screen-sighted` facts for screens the walk passes through on
 * the way. That knowledge was only ever written as "I reached X", never as "I was on A, tapped E,
 * and arrived at B" — so the one trustworthy source of navigation truth in the whole system was
 * being thrown away every time. This module is the small piece of state that turns those
 * confirmations into edges: a cursor that remembers the last confirmed node and the actions taken
 * since, and a function that, on the next confirmation, decides whether an honest edge can be drawn
 * between the two.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values. Pure and synchronous throughout, so it runs under
 * `node --test` with no Electron runtime.
 */
import type { AppFlowEdge, AppFlowStep } from '../../shared/app-flow.ts'

/**
 * Tracks a walk's confirmed position and the actions taken since that confirmation, so the next
 * confirmation can decide whether the hop between them is honest to record as an edge. Fields are
 * exposed rather than hidden behind accessors because every consumer of this module lives in
 * `reach/` or `orchestrator.ts` and reads/writes it directly — there is no invariant here an opaque
 * wrapper would protect that `noteWalkAction`/`noteWalkArrival` do not already enforce.
 */
export interface WalkCursor {
  /** The node the walk was last confirmed to be standing on, or null before any confirmation. */
  confirmedNodeId: string | null
  /** Actions recorded since `confirmedNodeId` was last confirmed. */
  actionsSinceConfirmation: AppFlowStep[]
}

export function createWalkCursor(startNodeId: string | null): WalkCursor {
  return { confirmedNodeId: startNodeId, actionsSinceConfirmation: [] }
}

/** Record an action the walk just executed. */
export function noteWalkAction(cursor: WalkCursor, action: AppFlowStep): void {
  cursor.actionsSinceConfirmation.push(action)
}

/**
 * Record that the walk is now confirmed to be standing on `nodeId`. Returns the edge this hop
 * proves, or null when nothing honest can be claimed — see the checks below, each of which exists
 * to keep this module from fabricating adjacency it never actually observed. Whatever the outcome,
 * the cursor is always reset: `nodeId` becomes the new confirmed node and the pending action list is
 * cleared, so a rejected hop can never leak its actions into whatever comes next.
 */
export function noteWalkArrival(
  cursor: WalkCursor,
  nodeId: string,
  context: { structureRevision: string; observedAt: string; replayScript?: string | null }
): AppFlowEdge | null {
  const from = cursor.confirmedNodeId
  const actions = cursor.actionsSinceConfirmation

  const edge = buildWalkEdge(from, nodeId, actions, context)

  cursor.confirmedNodeId = nodeId
  cursor.actionsSinceConfirmation = []

  return edge
}

function buildWalkEdge(
  from: string | null,
  nodeId: string,
  actions: AppFlowStep[],
  context: { structureRevision: string; observedAt: string; replayScript?: string | null }
): AppFlowEdge | null {
  // Nothing to draw an edge from — this is the walk's first confirmation, or the cursor was just
  // reset by a rejected hop with no earlier confirmed node to fall back on.
  if (!from) return null

  // The walk re-confirmed where it already was. A self-loop here is noise, not a hop — the same
  // reasoning the parser's own self-loop filtering already applies to static edges.
  if (from === nodeId) return null

  // Zero actions means the screen was re-identified without moving — no hop happened at all.
  // Two or more means at least one screen in between was never identified, so `from -> to` would
  // assert a direct connection that was never observed: exactly the kind of fabricated adjacency
  // this module exists to remove. Only a single-action hop is honest enough to record.
  if (actions.length !== 1) return null

  const action = actions[0]
  // Only a tap is a navigational press. A `wait` or `input` does not by itself cause a transition.
  // A `swipe` may well change screens, but it carries no locator a later replay could use, and an
  // edge whose trigger can never be replayed is not worth asserting.
  if (action.type !== 'tap') return null

  const locator = action.locator ?? null
  // An observed transition is worth recording even when it cannot be replayed — the tap definitely
  // happened and definitely produced this hop, we just have no locator to hand a later replay. Say
  // so plainly in `raw` rather than pretending a trigger exists.
  const raw = locator
    ? `walked: tap ${locator.by}=${locator.value}`
    : 'walked: tap (control not captured)'

  return {
    from,
    to: nodeId,
    raw,
    target: null,
    trigger: locator,
    kind: 'push',
    origin: 'runtime-walk',
    evidence: {
      structureRevision: context.structureRevision,
      observedAt: context.observedAt,
      // The distinction from a chrome edge: this destination was confirmed by the arrival judge
      // after an actual walked hop, not guessed from a single screen's text overlap.
      verified: true,
      replayScript: context.replayScript ?? null
    }
  }
}

/**
 * Upserts `edge` into `edges` by `(from, to)` — matching how `orchestrator.ts` folds chrome edges
 * into `runtimeEdgesList` today. The one difference: this never downgrades an existing
 * `origin: 'runtime-walk'` edge to a chrome one, and never overwrites `evidence.verified: true` with
 * `false`. A walked, judge-confirmed edge is strictly better evidence than a chrome guess for the
 * same pair — the destination was actually visited and confirmed, not inferred from text overlap —
 * and which one happened to be recorded first (or second) is incidental to which is more trustworthy.
 */
export function mergeWalkEdge(edges: AppFlowEdge[], edge: AppFlowEdge): void {
  const at = edges.findIndex((existing) => existing.from === edge.from && existing.to === edge.to)
  if (at === -1) {
    edges.push(edge)
    return
  }
  const existing = edges[at]
  const existingIsWalked = existing.origin === 'runtime-walk'
  const incomingIsWalked = edge.origin === 'runtime-walk'
  if (existingIsWalked && !incomingIsWalked) return
  if (existing.evidence?.verified && !edge.evidence?.verified) return
  edges[at] = edge
}
