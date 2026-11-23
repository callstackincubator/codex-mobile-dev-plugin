import type { AppIntelSnapshot, IntelPlatform, IntelRef } from "@mobile-dev/shared/app-intelligence.ts";

/**
 * Pure geometry and aggregation for the App Intelligence Flow. Nothing here touches the DOM:
 * the panel measures once and passes width and height in, so every layout stays testable.
 */

export type NodePlatforms = "ios" | "android" | "both";
export type Rect = { x: number; y: number; width: number; height: number };

const PACKAGE_PREFIX = "node_modules/";

/** A file or package is platform-specific when every edge that reaches it names one platform. */
export function platformsFor(snapshot: AppIntelSnapshot, ref: IntelRef): NodePlatforms {
  const seen = new Set<IntelPlatform>();
  for (const index of snapshot.indexes.incoming[ref] ?? []) for (const platform of snapshot.edges[index].platforms ?? []) seen.add(platform);
  if (seen.size === 1) return seen.has("ios") ? "ios" : "android";
  return "both";
}

export function reachOf(snapshot: AppIntelSnapshot, ref: IntelRef): number {
  if (ref.startsWith("file:")) return snapshot.files[ref.slice(5)]?.reach ?? 0;
  if (ref.startsWith("package:")) return snapshot.packages[ref.slice(8)]?.reach ?? 0;
  return 0;
}

const INDEX_FILE = /^index\.[cm]?[jt]sx?$/;

/**
 * What to call a node. `index.tsx` names nothing, so a barrel file is named for the folder it
 * indexes: `src/components/forms/Toggle/index.tsx` reads as "Toggle", the way the import does.
 */
export function labelOf(ref: IntelRef): string {
  const path = ref.replace(/^(?:file|package|screen):/, "");
  if (ref.startsWith("package:")) return path;
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  return INDEX_FILE.test(name) && parts.length ? parts[parts.length - 1] : name;
}

/** Where that node lives, in full: several `index.tsx` differ by nothing else. */
export function pathOf(ref: IntelRef): string {
  if (ref.startsWith("package:")) return PACKAGE_PREFIX;
  const parts = ref.replace(/^(?:file|screen):/, "").split("/");
  const name = parts.pop() ?? "";
  if (INDEX_FILE.test(name) && parts.length) parts.pop();
  return parts.join("/");
}

/** Truncates a path from the left: the tail is what tells two of them apart. */
export function ellipsize(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;
}

/** Truncates a name from the right, where the distinguishing part comes first. */
export function clampName(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function channels(value: string): [number, number, number] {
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}

/**
 * Nesting tints. One muted card for every hop read as a grey ladder; one hue per depth makes the
 * hop a node sits at legible at a glance, in either theme.
 */
const DEPTH_HUES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899"] as const;

export const depthHue = (depth: number): string => DEPTH_HUES[Math.min(depth, DEPTH_HUES.length - 1)];

/** Translucent so the card tint sits on the panel background rather than fighting the theme. */
export function depthTint(depth: number, alpha: number): string {
  const [red, green, blue] = channels(depthHue(depth));
  return `rgba(${red},${green},${blue},${alpha})`;
}

/**
 * Architectural boundaries, derived from the path because the analyzer records files, not roles.
 * Which ones exist is a property of the app being mapped, so the Flow filter is built from the
 * boundaries actually present in a graph rather than from this list.
 */
export const boundaries = ["entry", "navigation", "hook", "component", "state", "api", "model", "native", "asset", "util", "package", "other"] as const;
export type Boundary = typeof boundaries[number];

/** "entry" rather than "screen": the analyzer's roots include lexicons and routes that render nothing. */
export const boundaryLabel: Record<Boundary, string> = {
  entry: "Entry points", navigation: "Navigation", hook: "Hooks", component: "Components", state: "State",
  api: "API & data", model: "Types & schemas", native: "Native", asset: "Assets", util: "Utilities",
  package: "Packages", other: "Other source",
};

const BOUNDARY_COLOR: Record<Boundary, string> = {
  entry: "#8b5cf6", navigation: "#6366f1", hook: "#0ea5e9", component: "#14b8a6", state: "#f97316",
  api: "#ef4444", model: "#a855f7", native: "#eab308", asset: "#84cc16", util: "#64748b",
  package: "#94a3b8", other: "#78839b",
};

export const boundaryColor = (boundary: Boundary): string => BOUNDARY_COLOR[boundary];

const ASSET_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|avif|ttf|otf|woff2?|mp[34]|wav|lottie)$/i;
const NATIVE_EXTENSIONS = /\.(?:swift|kt|java|m|mm|h|hpp|cpp|cc|rs|podspec|gradle)$/i;

/** Folder names that name a role, singular. The innermost folder that names one wins. */
const FOLDER_ROLES: ReadonlyArray<readonly [Boundary, readonly string[]]> = [
  ["hook", ["hook"]],
  ["navigation", ["navigation", "navigator", "router", "route", "routing"]],
  ["api", ["api", "service", "client", "network", "query", "mutation", "graphql", "endpoint", "request", "repository", "fetcher"]],
  ["state", ["store", "state", "redux", "context", "atom", "reducer", "slice", "provider"]],
  ["model", ["type", "model", "schema", "entity", "dto", "lexicon", "def", "generated", "proto", "graphql-generated"]],
  ["entry", ["screen", "page", "scene", "view"]],
  ["component", ["component", "ui", "widget", "element", "layout", "primitive"]],
  ["asset", ["asset", "image", "img", "font", "media", "icon"]],
  ["util", ["util", "helper", "lib", "shared", "common"]],
];

const folderRole = new Map<string, Boundary>();
for (const [boundary, words] of FOLDER_ROLES) for (const word of words) if (!folderRole.has(word)) folderRole.set(word, boundary);

/** "queries" → "query", "hooks" → "hook": enough plural handling for folder names. */
function singular(folder: string): string {
  if (folder.endsWith("ies")) return folder.slice(0, -3) + "y";
  if (folder.endsWith("ses") || folder.endsWith("xes")) return folder.slice(0, -2);
  return folder.endsWith("s") ? folder.slice(0, -1) : folder;
}

const FILE_ROLES: ReadonlyArray<readonly [Boundary, RegExp]> = [
  ["api", /^(?:api|client|service|queries|mutations|endpoints|fetch|request|graphql)$/i],
  ["state", /^(?:store|state|context|atoms?|reducers?|slices?)$/i],
  ["navigation", /^(?:navigation|navigator|router|routes)$/i],
];

/** Classifies one node by its path. Deliberately ordered: the first rule that matches wins. */
export function boundaryOf(ref: IntelRef): Boundary {
  if (ref.startsWith("screen:")) return "entry";
  if (ref.startsWith("package:")) return "package";
  const path = ref.slice(5);
  // A dependency inside node_modules is a package however the analyzer recorded it, and its own
  // folder names describe its author's layout, not this app's, so no other rule may read them.
  if (path === "node_modules" || path.includes("node_modules/")) return "package";
  const name = path.split("/").pop() ?? path;
  const base = name.replace(/\.[^.]+$/, "").replace(/\.(?:ios|android|native|web)$/i, "");
  if (NATIVE_EXTENSIONS.test(name)) return "native";
  if (ASSET_EXTENSIONS.test(name)) return "asset";
  if (/^use[A-Z]/.test(base)) return "hook";
  if (name.endsWith(".d.ts")) return "model";
  const folders = path.toLowerCase().split("/").slice(0, -1).reverse();
  for (const folder of folders) {
    const role = folderRole.get(singular(folder));
    if (role) return role;
  }
  for (const [boundary, pattern] of FILE_ROLES) if (pattern.test(base)) return boundary;
  return /^[A-Z]/.test(base) ? "component" : "other";
}

/** The boundaries a set of nodes falls into, in display order, with how many nodes each holds. */
export function boundariesIn(values: Iterable<Boundary>): Array<{ boundary: Boundary; count: number }> {
  const counts = new Map<Boundary, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return boundaries.filter(boundary => counts.has(boundary)).map(boundary => ({ boundary, count: counts.get(boundary) as number }));
}

// ── The Flow graph ────────────────────────────────────────────────────────────────────────────

/** Import hops drawn after the root. */
export const FLOW_DEPTH = 3;
/** Rows a boundary shows before the rest fold into one "+N more" that opens them. */
export const GROUP_CAP = 6;

export type FlowGroup = {
  key: string; boundary: Boundary; refs: IntelRef[]; count: number; hidden: number; collapsed: boolean;
  /** The cards at the hop above that import into this boundary — what its connectors come from. */
  sources: IntelRef[];
};
export type FlowGraph = { start: IntelRef; levels: FlowGroup[][]; parent: Map<IntelRef, IntelRef>; total: number };
export type FlowOptions = { depth?: number; groupCap?: number; toggled?: ReadonlySet<string>; expanded?: ReadonlySet<string> };

/** One key per boundary per hop, because the same boundary recurs at every depth. */
export const groupKey = (depth: number, boundary: Boundary) => `${depth}:${boundary}`;

/**
 * A whole app's imports three hops deep is thousands of cards and a thicket of links, so a hop
 * opens only its first boundary in display order and names the rest. That leaves one readable
 * spine down the graph to drill along, rather than a wall of cards or a row of bare headers.
 * `toggled` holds the keys flipped away from this default, in either direction, so one set
 * covers both folding an open boundary and opening a folded one.
 */
export const openByDefault = (depth: number, index: number) => depth <= 1 || index === 0;

/**
 * Breadth-first layering of one screen's dependencies, one level per import hop, with each level
 * split into the boundaries its nodes fall into. A boundary is the unit the reader folds away:
 * collapsing one drops its rows and everything they would have pulled in at the next hop.
 */
export function buildFlow(snapshot: AppIntelSnapshot, start: IntelRef, options: FlowOptions = {}): FlowGraph {
  const limit = options.depth ?? FLOW_DEPTH;
  const cap = options.groupCap ?? GROUP_CAP;
  const toggledKeys = options.toggled ?? new Set<string>();
  const expandedKeys = options.expanded ?? new Set<string>();
  const parent = new Map<IntelRef, IntelRef>();
  const visited = new Set<IntelRef>([start]);
  const rootBoundary = boundaryOf(start);
  const levels: FlowGroup[][] = [[{ key: groupKey(0, rootBoundary), boundary: rootBoundary, refs: [start], count: 1, hidden: 0, collapsed: false, sources: [] }]];
  let frontier: IntelRef[] = [start];
  let total = 1;
  for (let depth = 1; depth <= limit && frontier.length; depth++) {
    const next: IntelRef[] = [];
    for (const ref of frontier) for (const index of snapshot.indexes.outgoing[ref] ?? []) {
      const edge = snapshot.edges[index];
      if (!edge.to || edge.kind === "navigation" || visited.has(edge.to)) continue;
      visited.add(edge.to);
      parent.set(edge.to, ref);
      next.push(edge.to);
    }
    if (!next.length) break;
    const byBoundary = new Map<Boundary, IntelRef[]>();
    const sourcesOf = new Map<Boundary, Set<IntelRef>>();
    for (const ref of next) {
      const boundary = boundaryOf(ref);
      const bucket = byBoundary.get(boundary);
      if (bucket) bucket.push(ref); else byBoundary.set(boundary, [ref]);
      // Captured before the fold prunes `parent`, so a folded boundary still knows what feeds it.
      const from = parent.get(ref);
      if (from) (sourcesOf.get(boundary) ?? sourcesOf.set(boundary, new Set()).get(boundary) as Set<IntelRef>).add(from);
    }
    const level: FlowGroup[] = [];
    const carry: IntelRef[] = [];
    for (const boundary of boundaries) {
      const members = byBoundary.get(boundary);
      if (!members) continue;
      const index = level.length;
      members.sort((a, b) => reachOf(snapshot, b) - reachOf(snapshot, a) || labelOf(a).localeCompare(labelOf(b)));
      const key = groupKey(depth, boundary);
      const open = toggledKeys.has(key) ? !openByDefault(depth, index) : openByDefault(depth, index);
      const collapsed = !open;
      const shown = collapsed ? [] : members.slice(0, expandedKeys.has(key) ? members.length : cap);
      const kept = new Set(shown);
      // A row that is not drawn has no card to trace from, so it seeds no edge and no next hop.
      for (const ref of members) if (!kept.has(ref)) parent.delete(ref);
      // A folded group reports its whole size on the header, so it needs no "+N more" as well.
      level.push({ key, boundary, refs: shown, count: members.length, hidden: collapsed ? 0 : members.length - shown.length, collapsed, sources: [...(sourcesOf.get(boundary) ?? [])] });
      carry.push(...shown);
      total += members.length;
    }
    levels.push(level);
    frontier = carry;
  }
  return { start, levels, parent, total };
}

// ── Placing it ────────────────────────────────────────────────────────────────────────────────

export type FlowMetrics = {
  card: { width: number; height: number }; gap: number; header: number; headerGap: number;
  groupGap: number; column: number; pad: number; indent: number; more: number;
};

/**
 * `column` is deliberately wide: the links between hops fan out across the whole gap, and at the
 * old 52px they crossed each other into a thicket before reaching their cards.
 */
export const FLOW_METRICS: FlowMetrics = {
  card: { width: 226, height: 40 }, gap: 8, header: 22, headerGap: 6,
  groupGap: 20, column: 376, pad: 16, indent: 10, more: 22,
};

export type PlacedHeader = { key: string; boundary: Boundary; depth: number; count: number; shown: number; collapsed: boolean; sources: IntelRef[]; rect: Rect };
export type PlacedCard = { ref: IntelRef; depth: number; rect: Rect };
export type PlacedMore = { key: string; boundary: Boundary; depth: number; hidden: number; sources: IntelRef[]; rect: Rect };
export type FlowPlacement = {
  width: number; height: number;
  headers: PlacedHeader[]; cards: PlacedCard[]; more: PlacedMore[];
  rectOf: Map<IntelRef, Rect>;
  /** Where each boundary header landed, so a folded group can still be drawn a connector. */
  headerRectOf: Map<string, Rect>;
};

type Block = { headers: PlacedHeader[]; cards: PlacedCard[]; more: PlacedMore[]; width: number; height: number };

/** A level laid out at the origin: one stack of boundaries, to be shifted into its column. */
function columnBlock(level: FlowGroup[], depth: number, metrics: FlowMetrics): Block {
  const { card, gap, header, headerGap, groupGap, indent, more } = metrics;
  const block: Block = { headers: [], cards: [], more: [], width: card.width, height: 0 };
  let y = 0;
  for (const group of level) {
    block.headers.push({ key: group.key, boundary: group.boundary, depth, count: group.count, shown: group.refs.length, collapsed: group.collapsed, sources: group.sources, rect: { x: 0, y, width: card.width, height: header } });
    y += header + headerGap;
    for (const ref of group.refs) {
      block.cards.push({ ref, depth, rect: { x: indent, y, width: card.width - indent, height: card.height } });
      y += card.height + gap;
    }
    if (group.hidden) {
      block.more.push({ key: group.key, boundary: group.boundary, depth, hidden: group.hidden, sources: group.sources, rect: { x: indent, y, width: card.width - indent, height: more } });
      y += more + gap;
    }
    y += groupGap - (group.refs.length || group.hidden ? gap : 0);
  }
  block.height = Math.max(0, y - groupGap);
  return block;
}

function shift(block: Block, dx: number, dy: number) {
  for (const item of [...block.headers, ...block.cards, ...block.more]) { item.rect.x += dx; item.rect.y += dy; }
}

/** Places a built graph: one boundary stack per hop, read left to right. */
export function placeFlow(graph: FlowGraph, metrics: FlowMetrics = FLOW_METRICS): FlowPlacement {
  const blocks = graph.levels.map((level, depth) => depth === 0
    ? { headers: [], cards: [{ ref: level[0].refs[0], depth: 0, rect: { x: 0, y: 0, width: metrics.card.width, height: metrics.card.height } }], more: [], width: metrics.card.width, height: metrics.card.height } satisfies Block
    : columnBlock(level, depth, metrics));
  // Every level is anchored to the start of the cross axis rather than centred on it. Centring
  // reads better on a still graph, but folding one boundary then moves every other level, which
  // throws away where the reader had panned to. A fixed origin keeps folds local.
  blocks.forEach((block, depth) => shift(block, metrics.pad + depth * metrics.column, metrics.pad));
  const width = metrics.pad * 2 + (blocks.length - 1) * metrics.column + metrics.card.width;
  const height = metrics.pad * 2 + Math.max(0, ...blocks.map(block => block.height));
  const placement: FlowPlacement = { width, height, headers: [], cards: [], more: [], rectOf: new Map(), headerRectOf: new Map() };
  for (const block of blocks) {
    placement.headers.push(...block.headers);
    placement.cards.push(...block.cards);
    placement.more.push(...block.more);
    for (const card of block.cards) placement.rectOf.set(card.ref, card.rect);
    for (const header of block.headers) placement.headerRectOf.set(header.key, header.rect);
  }
  return placement;
}

/** The curve from one placed box's right edge to the next one's left. */
export function flowLink(from: Rect, to: Rect): string {
  const x1 = from.x + from.width, y1 = from.y + from.height / 2, x2 = to.x, y2 = to.y + to.height / 2;
  const bend = Math.max(8, (x2 - x1) * 0.45);
  return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
}
