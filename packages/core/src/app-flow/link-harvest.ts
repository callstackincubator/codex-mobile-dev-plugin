/**
 * Turning the destinations a screen's link elements name into param records.
 *
 * ## The gap this closes
 *
 * `ParamStore.best()` only answers with a record covering *every* param a node declares, and
 * nothing merges two partial records into one. That is a deliberate safety property, not an
 * oversight: two values harvested from two different controls are not known to co-occur, and a
 * `name` from one row paired with an `rkey` from another is an invented URL that resolves to
 * somebody else's post. So the two accessibility learners refuse to produce multi-param records at
 * all — `ingestPressables` requires every param to come out of one identifier, the affinity
 * bootstrap is single-param only, and `learnFromArrival` bails on a node declaring more than one.
 *
 * The consequence, measured on a 78-screen sweep of a real social app: 16 of 19 unreached screens
 * were blocked purely on unresolved params, and nine of those are `name` + `rkey` shaped
 * (`/profile/:name/post/:rkey` and its siblings). Both halves were demonstrably on screen the whole
 * time — the feed resolves `name` from a `profileCard-<handle>-link` testID and the rows carry the
 * rkey — and the store could never put them together.
 *
 * ## Why a link prop is the right evidence
 *
 * An `href`/`to` prop is a destination the *app itself* composed. Its `name` and `params` arrived
 * as one object, from one row, naming one record. There is no co-occurrence question to answer and
 * so no new precedence rule to get wrong: the candidate goes straight into `ingestNavRoute` or
 * `ingestUrl`, which are the paths navigator state already uses, and every existing guard
 * (`addObserved`'s shape baseline, the unsafe-value rejections, `demote`) applies unchanged.
 *
 * It also sees what neither other source can. Navigator state knows only routes the app has
 * *entered*; the accessibility harvest knows only values that reached a testID. A feed row's link
 * names its destination before anybody presses it.
 *
 * This module is the host half: the walk lives in `cdp/agent-runtime.ts` (`agentCollectLinks`) and
 * is pure data by the time it arrives here, so the matching below is testable without a device.
 */

import type { LinkCandidate } from './cdp/agent-runtime.ts'
import { resolveNavRouteTarget } from './nav-route-target.ts'
import type { ParamRouteNode, ParamStore } from './param-store.ts'

/** What this module needs from a parsed node: `ParamRouteNode` plus the file the bridge uses. */
export interface LinkHarvestNode extends ParamRouteNode {
  file: string | null
}

/** Bounded counts only — never a param value, a route name or a path. Safe to meter and log. */
export interface LinkHarvestResult {
  /** Candidates the store accepted a record from. */
  usable: number
  /** Candidates that named a destination no param-declaring node answers to. */
  unmatched: number
}

/**
 * Feeds harvested destinations into the store, and reports only how many landed.
 *
 * A candidate may carry both a path and a `screen`/`params` pair; both are offered, because the
 * path matches by template (which can resolve a route the navigator never registered under that
 * name) and the pair matches by route identity (which works for a route with no URL at all). The
 * store deduplicates, so offering both costs nothing beyond two lookups.
 *
 * A name is only ever resolved through `resolveNavRouteTarget`, so an ambiguous name — two nodes
 * answering to it — attaches to neither, exactly as a navigator-state read does.
 */
export function ingestLinkCandidates<T extends LinkHarvestNode>(
  links: readonly LinkCandidate[],
  seenOn: string,
  nodes: readonly T[],
  store: ParamStore
): LinkHarvestResult {
  let usable = 0
  let unmatched = 0
  for (const link of links) {
    let landed = false
    if (link.path && store.ingestUrl(link.path, seenOn, nodes)) landed = true
    if (link.name && link.params) {
      const target = resolveNavRouteTarget(nodes, link.name)
      if (target && store.ingestNavRoute(target, link.params, seenOn)) landed = true
    }
    if (landed) usable += 1
    else unmatched += 1
  }
  return { usable, unmatched }
}
