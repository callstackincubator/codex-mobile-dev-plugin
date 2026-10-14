/**
 * Seeding an exploration attempt from proven prior work — plan Step 3e.
 *
 * `findSeedAncestor` (formerly `exploration.ts`) only ever seeded from a deep link opened *this run*
 * (`openedByNode`): the deepest ancestor route whose URL the sweep already proved open in this build.
 * That is real evidence — the arrival judge accepted it — but it is also the narrowest possible
 * source of it, and it throws away something strictly better whenever it exists: a **stored
 * journey**, written down by an earlier node in this same sweep (or carried forward from one),
 * which lets the walk start one hop from its target instead of from a cold app launch. `findSeedSource`
 * supersedes it, returning either kind of seed the caller can act on.
 *
 * The invariant this module exists to protect is the one `findSeedAncestor`'s own doc comment
 * stated: seeding from an ancestor that was only *parsed* — a route the static scanner found, with
 * no proof it ever rendered in this build — drops the planner onto a screen it has no idea how to
 * reach, which is worse than the slow walk from the entry. Every branch below is gated on a caller
 * -supplied proof function (`storedPath`, `deepLinkedThisRun`) returning non-null, never on a
 * route merely existing in `nodes` or `edges` — so a node that was parsed but never reached can
 * never be selected, by construction, no matter which branch runs.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values. `findRouteAncestors` is imported from `exploration.ts`
 * rather than re-implemented, per the plan's "keep it verbatim" — that file is itself free of value
 * imports from `capture.ts`/`storage.ts` (type-only), so importing a function out of it does not
 * pull Electron into this module's test run.
 */
import type { AppFlowTrigger } from '../../shared/app-flow.ts'
import { findRouteAncestors } from '../exploration.ts'

/** The subset of a node `findSeedSource` needs for URL ancestry. */
export interface SeedRouteNode {
  id: string
  urlPath: string | null
}

/** The subset of an edge `findSeedSource` needs for graph-parent seeding. */
export interface SeedGraphEdge {
  from: string
  to: string | null
  trigger?: AppFlowTrigger | null
}

/**
 * A seed to start an exploration attempt from, instead of the app's cold launch screen.
 *
 * `kind: 'path'` is the strong case: `id` names the node whose journey this is, and `commands` is
 * its stored `pathToReach` — the `agent-device …` lines a walk wrote down for it, launch line
 * included, which the caller runs to put the app one hop from the target. It was `kind: 'replay'`
 * carrying a `.ad` path until the sweep stopped recording scripts; a command list seeds a walk the
 * same way and needs no file, no armed transaction and no in-place repair. `trigger` is set only
 * for a graph-parent seed (the edge that pointed at the target carried a named control) — a
 * URL-ancestor seed has no single "one more tap" to hand the planner, since the ancestor and the
 * target are related by nested routing rather than a control on the ancestor's own screen.
 *
 * `kind: 'deep-link'` is `findSeedAncestor`'s original, and only, case: the deepest URL ancestor a
 * deep link already opened and the arrival judge already accepted this run.
 */
export type SeedSource =
  | { kind: 'path'; id: string; commands: readonly string[]; trigger: AppFlowTrigger | null }
  | { kind: 'deep-link'; id: string; urlPath: string; url: string }

export interface FindSeedSourceOptions<T extends SeedRouteNode> {
  /** The target's own route pattern, or null for a route with no URL at all. */
  urlPath: string | null
  /** The target's node id — used to find graph parents (`edge.to === targetId`). */
  targetId: string
  nodes: readonly T[]
  edges: readonly SeedGraphEdge[]
  /**
   * The stored `pathToReach` for a node id, or null when the sweep has none for it.
   *
   * Stored, **not** re-verified. A seed is run by the walk that uses it, so seeding is where the
   * journey gets checked; requiring a prior verification meant no journey learned during a sweep
   * could seed anything within that same sweep — every walk was cold, and the Profile subtree
   * re-walked the same first hop three times for 67.4s. A path that turns out to be broken fails
   * the seed's own run and the caller falls back exactly as it did before.
   */
  storedPath(nodeId: string): readonly string[] | null
  /** The URL a deep link opened this node at and the judge accepted, this run, or null. */
  deepLinkedThisRun(nodeId: string): string | null
}

/**
 * The best available seed for an exploration attempt toward `targetId`, or null when nothing beats
 * starting from the app's entry.
 *
 * Preference order, evaluated in this exact sequence:
 *
 *  1. The deepest URL ancestor (`findRouteAncestors`, already deepest-first) that has a verified
 *     published replay — the strongest seed, since it is both structurally closest to the target
 *     (fewest segments truncated) and backed by a script the walk can literally replay rather than
 *     retrace.
 *  2. A graph parent — an edge whose `to` is the target — that has a stored journey *and* names its
 *     own trigger. The trigger is required here, not merely preferred: without it there is no known
 *     control to tap once the base path lands, and a graph parent's screen (unlike a URL ancestor)
 *     was never proven to expose one just by virtue of being upstream in the route graph.
 *  3. The deepest URL ancestor a deep link opened and the judge accepted this run — the one case
 *     `findSeedAncestor` already covered. Kept last because a deep-link seed only proves the
 *     ancestor's *screen* is reachable, not a specific control on it, so the walk from there still
 *     pays for finding its own way — strictly more expensive than either path seed above.
 *  4. `null` — nothing proven beats exploring from the entry chrome.
 */
export function findSeedSource<T extends SeedRouteNode>(
  options: FindSeedSourceOptions<T>
): SeedSource | null {
  const { urlPath, targetId, nodes, edges, storedPath, deepLinkedThisRun } = options
  const ancestors = urlPath ? findRouteAncestors(urlPath, nodes) : []

  for (const ancestor of ancestors) {
    const commands = storedPath(ancestor.id)
    if (commands?.length) return { kind: 'path', id: ancestor.id, commands, trigger: null }
  }

  const graphParent = edges
    .filter((edge) => edge.to === targetId && edge.from !== targetId && edge.trigger?.value)
    .map((edge) => ({ edge, commands: storedPath(edge.from) }))
    .find((entry) => entry.commands?.length)
  if (graphParent?.commands?.length) {
    return {
      kind: 'path',
      id: graphParent.edge.from,
      commands: graphParent.commands,
      trigger: graphParent.edge.trigger ?? null
    }
  }

  for (const ancestor of ancestors) {
    const url = deepLinkedThisRun(ancestor.id)
    if (url && ancestor.urlPath)
      return { kind: 'deep-link', id: ancestor.id, urlPath: ancestor.urlPath, url }
  }

  return null
}
