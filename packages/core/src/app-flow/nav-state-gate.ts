import { findRouteAncestors } from './exploration.ts'

/**
 * Speculative nav-state reads one sweep may spend on screens that ancestry cannot vouch for. The
 * worst case a sweep can add beyond the ancestry-gated reads is this many CLI round trips
 * (~0.5-1s each); a sweep with nothing blocked adds none.
 */
export const NAV_STATE_SPECULATIVE_READS = 3

/**
 * Which blocked nodes justify reading the navigator after capturing `from`.
 *
 * Ancestry is by urlPath prefix (`findRouteAncestors`), which is blind to a screen with no
 * `urlPath`: the parser derives `params` from the path, so such a screen has none and is no
 * node's prefix either, yet it is exactly the kind of screen (a detail view pushed with params in
 * navigation state, never in a URL) that holds the values blocked nodes lack. In a measured sweep
 * the values sat on one such screen at 169.7s, were never read, and 12 nodes stayed blocked behind
 * ~400s of exploration. The gate is a cost heuristic, not a correctness constraint, so for those
 * screens only, it spends from `speculativeBudget` instead of requiring ancestry. A screen with a
 * urlPath that is nobody's ancestor still reads nothing: its position is known and says no.
 */
export function selectNavStateWaiters<T extends { id: string; urlPath: string | null }>(
  from: T,
  blocked: readonly T[],
  nodes: readonly T[],
  speculativeBudget: number
): { waiting: T[]; speculative: boolean } {
  if (!blocked.length) return { waiting: [], speculative: false }
  const waiting = blocked.filter(
    (other) =>
      other.urlPath &&
      findRouteAncestors(other.urlPath, nodes).some((ancestor) => ancestor.id === from.id)
  )
  if (waiting.length) return { waiting, speculative: false }
  if (!from.urlPath && speculativeBudget > 0) return { waiting: [...blocked], speculative: true }
  return { waiting: [], speculative: false }
}
