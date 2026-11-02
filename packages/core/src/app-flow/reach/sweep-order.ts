/**
 * Sweep ordering — plan Step 3c.
 *
 * The sweep used to walk `nodesWithSlug` in parser order, which is an artifact of how the file tree
 * happened to be traversed and has nothing to do with which screens are cheapest to reach. Entry
 * screens (the ones a person lands on with zero navigation, straight off the app's own tab bar or
 * drawer) cost a deep link or a one-hop walk; everything else either needs a static path through the
 * graph from one of those, or — if the parser found no path at all — a full, unseeded exploration.
 * Reaching the cheap screens first also produces the chrome inventory and the parent replays every
 * later screen in the same tab/drawer reuses (plan 3d/3e), so the order the sweep visits nodes in
 * directly determines how much of the sweep can reuse work instead of paying full exploration price
 * per screen.
 *
 * `orderSweepNodes` produces five stable tiers, in order:
 *   1. `entryScreenIds` — the screens `entryLayouts` says are reached with no navigation at all,
 *      ordered by which entry layout they belong to (an entry id with no matching layout, such as
 *      the outermost root's own initial screen, sorts before every layout-matched one — it is the
 *      overarching entry, one level up from any individual tab/drawer item).
 *   2. Group siblings of an entry screen — other screens registered under the same layout directory
 *      as an entry screen (drawer/tab items one hop from the chrome) but not themselves an entry.
 *   3. Nodes with a static edge path from an entry screen, shortest path first — computed by BFS over
 *      `edges` from every tier-1 node as a joint source, so a screen three navigators deep still sorts
 *      ahead of one with no path at all.
 *   4. Everything else — no static path from any entry screen was found. These are the ones most
 *      likely to need a full, unseeded exploration.
 *   5. Nodes with no *walkable* path from an entry screen — every edge into them is one the parser
 *      could not name a control for, so there is no known tap sequence in. Drawn out of tiers 3 and
 *      4 (never 1 or 2) and kept in their original relative order, so a demoted shortest-path node
 *      still precedes a demoted pathless one. A node a live deep link can open is exempt.
 *   6. Fallback routes (`isFallbackRoute`) — always last, and checked first internally, so a fallback
 *      route can never be pulled into an earlier tier just because it happens to sit in an entry
 *      layout's directory or has an incoming edge from one.
 *
 * One node may jump the tiers entirely: `probeRouteId`, the route the deep-link probe already
 * opened and verified, is rotated to the front so the sweep opens on the screen already in front of
 * it and can claim that work rather than repeat it.
 *
 * The result is total (every input node appears exactly once) and stable: a node matching more than
 * one tier's criterion — most commonly a `groups` member of several layout directories — is placed by
 * the earliest tier it qualifies for, never duplicated into a later one too.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Plain data and pure
 * functions, run under `node --test` with no Electron runtime.
 */

/** The subset of `AppFlowNode` this module's tiering needs. */
export interface SweepOrderNode {
  id: string
  title: string
  /** The node's one canonical layout directory — used to order tier 1 against `entryLayouts`. */
  group: string
  /**
   * Every layout directory this node is registered under, not just `group` — a screen reachable
   * through a shared helper called from several tabs genuinely belongs to all of them, and tier 2
   * must recognise it as an entry sibling from any one of those, not only its single canonical group.
   */
  groups: readonly string[]
  /** The node's route pattern, when it has one — the walkability tier's deep-link escape hatch. */
  urlPath?: string | null
  /** Route params the URL needs filled in; a deep link can only stand in for a walk without them. */
  params?: readonly string[]
}

/** The subset of `AppFlowEdge` the static-path tier's BFS needs. */
export interface SweepOrderEdge {
  from: string
  to: string | null
  /**
   * What to tap to follow this edge, when the parser could read it off the call site. The
   * walkability tier turns on this field and nothing else: an edge that says two screens are
   * connected but not *how* hands the planner no control to press, so a target reachable only
   * across such edges has no known tap sequence from the app's chrome — see `orderSweepNodes`'s
   * tier 5. Shaped as `{ value }` to match `AppFlowTrigger` without importing it.
   */
  trigger?: { value?: string | null } | null
}

/**
 * Expo Router's `+not-found` and React Navigation's NotFound screen are reached by an unmatched URL,
 * never by tapping through the UI, so they never belong ahead of a screen with a real path in. Moved
 * here (was `orchestrator.ts`'s private `isFallbackRoute`) so the sweep order can apply the identical
 * rule that decides the loop's own fallback handling — the two must never drift into disagreeing
 * about which routes are fallbacks.
 */
export function isFallbackRoute(node: { id: string; title: string }): boolean {
  return /(^|[/\W_])(\+?not[\W_]?found|error[\W_]?boundary|unmatched)([\W_]|$)/i.test(
    `${node.id} ${node.title}`
  )
}

export interface OrderSweepNodesOptions {
  /**
   * Whether this sweep's deep-link transport is live (the probe matched, or was inconclusive and
   * left enabled). Passed in rather than assumed because it decides whether tier 5 may demote a
   * node at all: a param-free URL the app can open is a way in that owes nothing to the control
   * graph, so while deep links work such a node keeps its earned tier however unnamed its inbound
   * edges are. With the transport off, the control graph is the only way in and the demotion
   * applies. Omitted means enabled — the sweep's own default before the probe has concluded.
   */
  deepLinksEnabled?: boolean
  /**
   * The node the sweep's deep-link probe already opened and the arrival judge already accepted, so
   * it can be visited first and claim that work instead of repeating it.
   *
   * `orchestrator.ts` holds a `probeCredit` — the probe's own verdict and accepted frame — but
   * `claimProbeCredit` only honours it for the *first* node the sweep reaches, and deliberately so:
   * the app is standing on the probe route with nothing in between, and a credit that survived one
   * unrelated navigation would be a claim about a screen nobody has looked at. The flaw was never
   * that invariant, it was the ordering — the probe route sorted wherever its tier put it, some
   * other node went first and moved the app, and the credit expired unclaimed. A device log shows
   * `/lists` opened twice for this reason, the second time to be told exactly what the first told
   * us. Hoisting costs tier 1 one position and saves an open, a settle, a screenshot and a judge
   * call.
   *
   * Ignored when the id is not in `nodes`, or when nothing proved reachable (no probe, or it
   * mismatched) — in both cases there is no credit to claim and the earned tiers stand.
   */
  probeRouteId?: string | null
}

/** A route's literal path segments, or null for a route with no path to nest anything under. */
function routeSegments(urlPath: string | null | undefined): string[] | null {
  if (!urlPath || urlPath === '/') return null
  const segments = urlPath.split('/').filter(Boolean)
  return segments.length ? segments : null
}

/** Whether `child` nests under `parent` — a strictly longer path sharing every leading segment. */
function isRouteDescendant(parent: readonly string[], child: readonly string[]): boolean {
  return child.length > parent.length && parent.every((segment, at) => segment === child[at])
}

/**
 * The same nodes, reordered so each one is followed immediately by the subtree nesting under it.
 *
 * A stable permutation: nodes are emitted in their incoming order except that a descendant is
 * pulled forward to sit behind its ancestor, and a node is only ever moved earlier. That keeps the
 * exactly-once invariant `orderSweepNodes` asserts, and keeps the tier ordering intact for every
 * node that is not somebody's child.
 *
 * Recursive so a depth-3 subtree comes out whole — `/profile/:name` then its `/followers`, and a
 * `/post/:id` then its `/liked-by`, `/reposted-by` and `/quotes` — rather than one level at a time.
 */
function depthFirstByRoute<T extends SweepOrderNode>(nodes: readonly T[]): T[] {
  const segments = new Map(nodes.map((node) => [node.id, routeSegments(node.urlPath)]))
  const emitted = new Set<string>()
  const ordered: T[] = []
  const emit = (node: T): void => {
    if (emitted.has(node.id)) return
    emitted.add(node.id)
    ordered.push(node)
    const parent = segments.get(node.id)
    if (!parent) return
    for (const candidate of nodes) {
      if (emitted.has(candidate.id)) continue
      const child = segments.get(candidate.id)
      if (child && isRouteDescendant(parent, child)) emit(candidate)
    }
  }
  for (const node of nodes) emit(node)
  return ordered
}

export function orderSweepNodes<T extends SweepOrderNode>(
  nodes: readonly T[],
  edges: readonly SweepOrderEdge[],
  entryScreenIds: readonly string[],
  entryLayouts: readonly string[],
  options: OrderSweepNodesOptions = {}
): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const assigned = new Set<string>()

  const fallback: T[] = []
  const eligible: T[] = []
  for (const node of nodes) {
    if (isFallbackRoute(node)) fallback.push(node)
    else eligible.push(node)
  }
  const eligibleIds = new Set(eligible.map((node) => node.id))

  // Tier 1 — entryScreenIds, following entryLayouts order. An id whose node's `group` is not one of
  // entryLayouts (the outermost root's own entry, which sits one level above any individual
  // tab/drawer item) sorts first, as `layoutIndex` reports `-1` for it; ties keep their original
  // relative order in `entryScreenIds` because `Array.prototype.sort` is stable.
  const layoutIndex = new Map(entryLayouts.map((name, index) => [name, index]))
  const tier1 = [...new Set(entryScreenIds)]
    .map((id) => byId.get(id))
    .filter((node): node is T => node !== undefined && eligibleIds.has(node.id))
  tier1.sort((a, b) => (layoutIndex.get(a.group) ?? -1) - (layoutIndex.get(b.group) ?? -1))
  for (const node of tier1) assigned.add(node.id)

  const entryLayoutSet = new Set(entryLayouts)

  // Tier 2 — group siblings of an entry screen: registered under the same layout directory as an
  // entry screen (via any of its `groups`, not just the canonical `group`), but not themselves the
  // entry. Kept in original array order. A node belonging to several entry layouts still lands in
  // this array once — `.some(...)` is a boolean test, not a per-group iteration — which is what
  // keeps a multi-group node from being duplicated here.
  const tier2 = eligible.filter(
    (node) => !assigned.has(node.id) && node.groups.some((group) => entryLayoutSet.has(group))
  )
  for (const node of tier2) assigned.add(node.id)

  // Tier 3 — nodes with a static edge path from an entry screen, shortest first. BFS with every
  // tier-1 node as a joint source, over the full graph (so the path can pass through a tier-2 node
  // on its way to a deeper one) — only nodes not already claimed by tier 1/2 are pulled out of it.
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (!edge.to) continue
    const list = adjacency.get(edge.from)
    if (list) list.push(edge.to)
    else adjacency.set(edge.from, [edge.to])
  }
  const distance = new Map<string, number>()
  const queue: string[] = []
  for (const node of tier1) {
    if (!distance.has(node.id)) {
      distance.set(node.id, 0)
      queue.push(node.id)
    }
  }
  let head = 0
  while (head < queue.length) {
    const current = queue[head]
    head += 1
    const currentDistance = distance.get(current)!
    for (const next of adjacency.get(current) ?? []) {
      if (distance.has(next)) continue
      distance.set(next, currentDistance + 1)
      queue.push(next)
    }
  }
  const tier3 = eligible
    .filter((node) => !assigned.has(node.id) && distance.has(node.id))
    .sort((a, b) => distance.get(a.id)! - distance.get(b.id)!)
  for (const node of tier3) assigned.add(node.id)

  // Tier 4 — the rest: no static path from any entry screen was found. Original order.
  const tier4 = eligible.filter((node) => !assigned.has(node.id))

  // Tier 5 — nodes with no *walkable* path from an entry screen: every route into them crosses at
  // least one edge the parser could not name a control for. Tiers 3 and 4 are decided by the graph's
  // shape alone, which says two screens are connected without saying how to get across; this second
  // BFS keeps only the edges that name their trigger, so the closure it builds is the set of screens
  // a planner can actually tap its way to.
  //
  // Demoting rather than dropping is the whole point. "No named control leads here" is a statement
  // about the *parse*, not about the app — a control the scanner could not read may still be sitting
  // on screen, and the planner does sometimes find it. So these nodes stay in the sweep and are
  // still attempted; they simply go last, after every screen with a known way in, where
  // `ExplorationControl`'s attempt ceiling and deadline decide whether they are worth the remaining
  // budget. On the social-app run the four moderator-inbox routes were explored *before* reachable
  // screens and spent roughly two minutes concluding, correctly and at full planner price, that an
  // ordinary account cannot open a moderation queue. Ordered last, that two minutes is spent on
  // screens that exist first, and these are reached only if the budget outlasts them.
  const namedAdjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (!edge.to || !edge.trigger?.value) continue
    const list = namedAdjacency.get(edge.from)
    if (list) list.push(edge.to)
    else namedAdjacency.set(edge.from, [edge.to])
  }
  const walkable = new Set<string>()
  const walkQueue: string[] = []
  // Tiers 1 and 2 seed the closure and are never demoted by it. A tier-1 node is on the chrome by
  // definition and a tier-2 node is one hop from it under the same navigator, so both are reachable
  // whatever the parser managed to name — and demoting an entry screen would reorder the very
  // screens whose chrome inventory and verified replays every later tier reuses.
  for (const node of [...tier1, ...tier2]) {
    if (walkable.has(node.id)) continue
    walkable.add(node.id)
    walkQueue.push(node.id)
  }
  let walkHead = 0
  while (walkHead < walkQueue.length) {
    const current = walkQueue[walkHead]
    walkHead += 1
    for (const next of namedAdjacency.get(current) ?? []) {
      if (walkable.has(next)) continue
      walkable.add(next)
      walkQueue.push(next)
    }
  }
  const deepLinksEnabled = options.deepLinksEnabled ?? true
  const reachableByUrl = (node: T): boolean =>
    deepLinksEnabled && Boolean(node.urlPath) && node.urlPath !== '/' && !node.params?.length
  const isUnwalkable = (node: T): boolean => !walkable.has(node.id) && !reachableByUrl(node)
  // Partition tiers 3 and 4 in place rather than appending a sixth array, so a demoted node keeps
  // its own tier's relative order among the other demoted ones — a shortest-path tier-3 node still
  // sorts ahead of a tier-4 node with no path at all, which is the right order to spend a dwindling
  // budget in.
  const tier5 = [...tier3, ...tier4].filter(isUnwalkable)
  const walkableTier3 = tier3.filter((node) => !isUnwalkable(node))
  const walkableTier4 = tier4.filter((node) => !isUnwalkable(node))

  // Depth-first within the earned tiers, so a screen is swept immediately after the screen it
  // nests under.
  //
  // The tiers above answer "how cheaply can this screen be reached from a cold start", which is
  // the right question for a sweep that relaunches between screens, and the wrong one for a sweep
  // that does not. On Bluesky, `Profile` and all eight of its children share `group: HomeTab` and
  // so share tier 2, where they sit in parser order — `Profile` at position 4 and
  // `ProfileFollowers` at position 14. By the time the followers list comes up the app has been
  // driven through ten unrelated screens, so the only way back is a cold relaunch and a re-walk of
  // the hop that was already walked for the parent. The reference sweep paid that three times over
  // for one subtree (20.9s, 17.4s, 29.1s), and it is also what makes a harvested param arrive too
  // late to help the route that needed it.
  //
  // Grouped by **URL prefix** rather than by edges: the parsed edge graph is sparse and does not
  // contain a `Profile -> ProfileFollowers` edge at all, while the paths say so plainly, and
  // `findRouteAncestors` already derives parentage the same way.
  //
  // Applied only to tiers 2-4. Tier 1 is left alone because its order is the entry-layout order
  // every later tier's chrome inventory and verified replays are built on, and tiers 5 and
  // fallback are left alone because their whole purpose is to be last — a demoted route pulled
  // forward as somebody's child would undo that deliberately.
  const tiered = [
    ...tier1,
    ...depthFirstByRoute([...tier2, ...walkableTier3, ...walkableTier4]),
    ...tier5,
    ...fallback
  ]

  // The verified probe route goes first, so the sweep's opening node is the screen already on the
  // device — see `probeRouteId`. A plain rotation of one element: it cannot change the multiset, so
  // the exactly-once invariant asserted below still holds, and every other node keeps its relative
  // order behind it.
  const probeIndex = options.probeRouteId
    ? tiered.findIndex((node) => node.id === options.probeRouteId)
    : -1
  const ordered =
    probeIndex > 0
      ? [tiered[probeIndex], ...tiered.slice(0, probeIndex), ...tiered.slice(probeIndex + 1)]
      : tiered

  // `eligible`/`fallback` are built by one pass over `nodes` and every later tier filter preserves
  // that relative order, and `assigned` guarantees no node is pulled into more than one tier — so
  // the invariant this function promises (every input node exactly once) reduces to the two arrays
  // partitioning `nodes` completely. Asserted rather than silently trusted, since a future tier added
  // here without updating `assigned` would otherwise duplicate or drop a node with no compile error.
  if (ordered.length !== nodes.length) {
    throw new Error(
      `orderSweepNodes produced ${ordered.length} nodes from ${nodes.length} input nodes — ` +
        'every node must appear exactly once.'
    )
  }
  return ordered
}
