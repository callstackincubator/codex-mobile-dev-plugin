/**
 * Swift parse reports → the screen graph the rest of App Flow already reads.
 *
 * This is the seam `parser.ts` left open (its "SEAM: Swift screen parsing" note). The parser hands
 * back one report per source root; this turns them into `AppFlowNode[]` and `AppFlowEdge[]`, which
 * is the point where a SwiftUI project stops being a special case and becomes a project.
 *
 * ---- What becomes a node ----
 *
 * One node per *screen*: a resolved view the parser found positive evidence for — it is the body of
 * a `NavigationLink`, an arm of a `navigationDestination(for:)`, a `sheet`'s content, an `App`'s
 * root, or it sets a `navigationTitle`. A view with no such evidence is a leaf component, and the
 * distinction is the parser's `screens` vs `views` count, not a judgement made here.
 *
 * A screen the parser refused to construct is still a node. It has to be: the map is only honest if
 * it says the screen exists and could not be reached, and the capture loop reports it as `refused`
 * for exactly the same reason. Hiding it would turn a known gap into a smaller map that looks
 * complete.
 *
 * ---- What becomes an edge ----
 *
 * Only `viewEdges` whose *both* ends are nodes. The parser records an edge wherever it can read a
 * `from` and a `to`, including to leaf components and to views another source root owns; an edge
 * pointing at something this graph has no node for would render as a dangling arrow, so it is
 * dropped rather than drawn to nothing.
 *
 * `kind` is carried through: `push` and `modal` are relations a user can trace, `route` is the arm
 * of a route switch and is declared on the navigator's host rather than on the screen the user was
 * on. All three are kept, because dropping `route` would throw away most of what a real SwiftUI
 * app's navigation is written as — see `AppFlowSwiftViewEdgeKind` for why they are not the same
 * claim.
 *
 * ---- Where a journey starts ----
 *
 * `layouts`, `entryLayouts`, `entryScreenIds` and `rootNavigator` come from the parser's
 * `appEntries` and `navigators`: the views an `App`'s scenes present, and the navigation container
 * each view's body builds. `TabView` → `Tabs`, `NavigationSplitView` → `Drawer`, `NavigationStack`
 * → `Stack`.
 *
 * Only an *entry* view's navigator becomes a layout. `AppFlowLayout.parent` means "the layout this
 * one is mounted inside, or null for the app root", and nothing the parser reports says which
 * navigator is nested in which — so reporting the other thirty would mean thirty claims of being at
 * the app root, which is worse than reporting none. The navigator tree we can observe is one level
 * deep, and that is what is reported.
 *
 * ---- What is deliberately empty ----
 *
 * `urlPath` is null on every node, and `reach` is `navigation-only`, even when the project's
 * `Info.plist` registers a URL scheme. The scheme says the app can be opened by URL; it says
 * nothing about which screen any given URL reaches, and deriving a path from a type name would be
 * the guess the whole design refuses to make. `node.navigator` is null for the same reason: knowing
 * that a screen's own body builds a `NavigationStack` is not knowing which navigator presented it.
 */
import type {
  AppFlowEdge,
  AppFlowLayout,
  AppFlowNode,
  AppFlowSwiftNavigatorKind,
  AppFlowSwiftParseReport,
  AppFlowSwiftResolution,
  AppFlowSwiftViewEdge
} from '../shared/app-flow.ts'

/** A screen graph built from Swift parse reports, in the shape `ParsedAppGraph` needs. */
export interface SwiftScreenGraph {
  nodes: AppFlowNode[]
  edges: AppFlowEdge[]
  /** Screens the parser could not construct, view name → what stood in the way. */
  refusedByParser: Record<string, string[]>
  /** The navigator tree, as far as the entries observe it. See the header note. */
  layouts: AppFlowLayout[]
  rootNavigator: string | null
  entryLayouts: string[]
  /** Entry views that are nodes in this graph, in the order the app's scenes present them. */
  entryScreenIds: string[]
}

/** `AppFlowLayout.navigator` for a parsed container. The mapping lives here, not in the parser. */
function layoutNavigator(kind: AppFlowSwiftNavigatorKind): string {
  if (kind === 'tabs') return 'Tabs'
  // A `NavigationSplitView` is a sidebar beside a detail pane, which is what `Drawer` names in this
  // vocabulary; there is no split-view value, and `Stack` would lose the sidebar entirely.
  if (kind === 'splitView') return 'Drawer'
  return 'Stack'
}

/**
 * Turns a view type name into a node id.
 *
 * The type name is the id. Swift type names are unique within a module, and the registry the
 * capture loop drives is keyed by the same string — so an id that is anything else would need a
 * translation table between the map and the thing it captures, and a wrong entry in that table is
 * a screenshot filed under the wrong screen. A name that two source roots both declare collides
 * here, and the collision is resolved by keeping the first and recording nothing for the second;
 * see `buildSwiftScreenGraph`.
 */
function nodeId(view: string): string {
  return view
}

/**
 * A screen's display title.
 *
 * The type name with a trailing `View` removed, because every second SwiftUI type is called
 * `SomethingView` and a map of forty of them reads as noise. Nothing else is changed — no
 * camel-case splitting, no prettifying — so the title stays something a reader can grep for in the
 * source. A type named exactly `View` keeps its name rather than becoming empty.
 */
function title(view: string): string {
  const trimmed = view.endsWith('View') ? view.slice(0, -'View'.length) : view
  return trimmed.length > 0 ? trimmed : view
}

/** A view the parser found positive evidence is a navigation destination. */
function isScreen(resolution: AppFlowSwiftResolution): boolean {
  return resolution.screenEvidence.length > 0
}

function toNode(resolution: AppFlowSwiftResolution, slug: string): AppFlowNode {
  return {
    id: nodeId(resolution.view),
    // No route path exists for a SwiftUI screen, and no URL scheme was read. Both are the honest
    // null rather than a synthesised path.
    urlPath: null,
    reach: 'navigation-only',
    title: title(resolution.view),
    file: resolution.file,
    slug,
    // There is no navigator attribution to group by yet (see the header note), so every screen is
    // in one group named for the source root it came from — which is a true statement about where
    // it lives, unlike a tab name nothing observed.
    group: '',
    groups: [],
    navigator: null,
    // What the parser could not supply a value for. Empty for a screen it constructed, and the
    // same list the capture loop reports as `missing` on a `refused` screen.
    params: resolution.missing,
    presentation: null,
    guard: null,
    capture: null
  }
}

/**
 * Builds one graph from every report of a project.
 *
 * Reports are per source root and are merged here, because the app the capture loop drives is one
 * app: a screen in a package and a screen in the app target are both in its registry, under one
 * flat namespace of type names. A name declared in two roots is kept once, because the registry
 * the capture loop drives is keyed by that name and cannot tell the two apart either — two nodes
 * would mean two map entries racing for one screenshot.
 */
export function buildSwiftScreenGraph(
  reports: readonly AppFlowSwiftParseReport[]
): SwiftScreenGraph {
  const nodes: AppFlowNode[] = []
  const byId = new Map<string, AppFlowNode>()
  const refusedByParser: Record<string, string[]> = {}
  const usedSlugs = new Set<string>()

  for (const report of reports) {
    for (const resolution of report.resolutions) {
      if (!isScreen(resolution)) continue
      const id = nodeId(resolution.view)
      if (byId.has(id)) continue
      // A slug is what the screenshot is filed under, so it has to be unique even when two type
      // names normalise to the same thing.
      let slug = resolution.view
      for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${resolution.view}-${String(n)}`
      usedSlugs.add(slug)
      const node = toNode(resolution, slug)
      // Grouping by source root is the only grouping anything observed. It is the parser's own
      // `app` field: the last path component of the root it was given.
      node.group = report.app
      node.groups = [report.app]
      nodes.push(node)
      byId.set(id, node)
      if (resolution.rung === 'skipped') refusedByParser[resolution.view] = resolution.missing
    }
  }

  const edges: AppFlowEdge[] = []
  const seen = new Set<string>()
  for (const report of reports) {
    for (const edge of report.viewEdges ?? []) {
      if (!byId.has(nodeId(edge.from)) || !byId.has(nodeId(edge.to))) continue
      // The same relation is written more than once in real source — two `NavigationLink`s to the
      // same editor, a route arm repeated per tab. One edge is the true statement; a second drawn
      // on top of it says nothing extra.
      //
      // Keyed on the *emitted* edge, not the parser's own kind. `route` and `push` both emit
      // `push`, so keying on the parser's kind let a screen reachable both by a `NavigationLink`
      // and by a route arm — which, on IceCubesApp's settings tab, is nine of them — draw two
      // identical arrows. They differ only in `raw`, and `pathsForScreen` hashes `raw` into a
      // profiling transition identity, so the duplicate was also a second transition for one hop.
      const mapped = toEdge(edge)
      const key = `${mapped.from}\u0000${mapped.to}\u0000${mapped.kind}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push(mapped)
    }
  }

  // The navigator a view's own body builds, across every report. One entry per view: a body with a
  // `TabView` inside a `NavigationStack` is reported by the parser as both, and the outermost is the
  // shape the screens under it are in — which, in source order, is the first one recorded.
  const navigatorByView = new Map<string, AppFlowSwiftNavigatorKind>()
  for (const report of reports) {
    for (const navigator of report.navigators ?? []) {
      if (!navigatorByView.has(navigator.view)) navigatorByView.set(navigator.view, navigator.kind)
    }
  }

  const entryScreenIds: string[] = []
  const layouts: AppFlowLayout[] = []
  const entryLayouts: string[] = []
  for (const report of reports) {
    for (const entry of report.appEntries ?? []) {
      for (const view of entry.entryViews) {
        const id = nodeId(view)
        // An entry the graph has no node for is dropped rather than named, the same way an edge to
        // nothing is: a journey cannot start at a screen the map does not have.
        if (!byId.has(id) || entryScreenIds.includes(id)) continue
        entryScreenIds.push(id)
        const kind = navigatorByView.get(view)
        if (kind === undefined || entryLayouts.includes(view)) continue
        layouts.push({ name: view, navigator: layoutNavigator(kind), parent: null })
        entryLayouts.push(view)
      }
    }
  }
  // The app's first entry that builds a navigator is its root. A later entry — a settings scene, a
  // media window — is a second window, not the shape the app opens in.
  const rootNavigator = layouts[0]?.navigator ?? null

  return { nodes, edges, refusedByParser, layouts, rootNavigator, entryLayouts, entryScreenIds }
}

function toEdge(edge: AppFlowSwiftViewEdge): AppFlowEdge {
  return {
    from: nodeId(edge.from),
    to: nodeId(edge.to),
    // `raw` is what a reader is shown to explain the edge. The modifier plus the destination is
    // what the source actually says; there is no route string to quote.
    raw: `${edge.via} → ${edge.to}`,
    target: nodeId(edge.to),
    // `route` is a push in navigation terms — it appends to a `NavigationPath` — but it is the one
    // kind whose `from` is the navigator's host rather than the screen the user was on, which is
    // why the parser keeps it separate and why it is not reported as a plain push here either.
    kind: edge.kind === 'modal' ? 'modal' : 'push',
    // No trigger: nothing read the label of the control that fires this. A `NavigationLink`'s
    // label is a view, not a string, and guessing one would send the explorer tapping at a word
    // that is not on screen.
    trigger: null
  }
}
