import type { AppIntelSnapshot, IntelPlatform, IntelRef } from "@mobile-dev/shared/app-intelligence.ts";

/**
 * Pure geometry and aggregation for the App Intelligence views. Nothing here touches the DOM:
 * the panel measures once and passes width and height in, so every layout stays testable.
 */

export type NodePlatforms = "ios" | "android" | "both";
export type TrieLeaf = { path: string; kind: "source" | "asset" | "package"; reach: number; platforms: NodePlatforms };
export type Rect = { x: number; y: number; width: number; height: number };
export type TrieNode = { name: string; path: string; value: number; reach: number; kids: TrieNode[]; leaf: TrieLeaf | null; parent: TrieNode | null };
export type PlacedNode = { node: TrieNode; rect: Rect };

const PACKAGE_PREFIX = "node_modules/";

/** A file or package is platform-specific when every edge that reaches it names one platform. */
export function platformsFor(snapshot: AppIntelSnapshot, ref: IntelRef): NodePlatforms {
  const seen = new Set<IntelPlatform>();
  for (const index of snapshot.indexes.incoming[ref] ?? []) for (const platform of snapshot.edges[index].platforms ?? []) seen.add(platform);
  if (seen.size === 1) return seen.has("ios") ? "ios" : "android";
  return "both";
}

export function maxReach(snapshot: AppIntelSnapshot): number {
  let max = 1;
  for (const file of Object.values(snapshot.files)) max = Math.max(max, file.reach);
  for (const entry of Object.values(snapshot.packages)) max = Math.max(max, entry.reach);
  return max;
}

function emptyNode(name: string, path: string, parent: TrieNode | null): TrieNode {
  return { name, path, value: 0, reach: 0, kids: [], leaf: null, parent };
}

function insert(root: TrieNode, path: string, leaf: TrieLeaf) {
  const parts = path.split("/");
  let node = root;
  for (let index = 0; index < parts.length; index++) {
    const segment = parts[index], full = parts.slice(0, index + 1).join("/");
    let next = node.kids.find(kid => kid.name === segment);
    if (!next) { next = emptyNode(segment, full, node); node.kids.push(next); }
    node = next;
  }
  node.leaf = leaf;
  node.value = leaf.kind === "package" ? Math.max(1, leaf.reach > 0 ? Math.round(Math.log2(leaf.reach + 1)) : 1) : 1;
  node.reach = leaf.reach;
}

function roll(node: TrieNode): TrieNode {
  if (!node.kids.length) return node;
  let value = 0, weighted = 0;
  for (const kid of node.kids) { roll(kid); value += kid.value; weighted += kid.reach * kid.value; }
  node.value = value;
  node.reach = value ? weighted / value : 0;
  node.kids.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return node;
}

/**
 * Directory trie over the snapshot. Area comes from file count, colour from reach rolled up as a
 * value-weighted mean, so a directory reads as hot only when its bulk is hot.
 */
export function buildTrie(snapshot: AppIntelSnapshot, options: { withPackages: boolean }): TrieNode {
  const root = emptyNode("", "", null);
  for (const [path, file] of Object.entries(snapshot.files)) {
    insert(root, path, { path, kind: file.kind, reach: file.reach, platforms: platformsFor(snapshot, `file:${path}`) });
  }
  if (options.withPackages) for (const [name, entry] of Object.entries(snapshot.packages)) {
    insert(root, PACKAGE_PREFIX + name, { path: name, kind: "package", reach: entry.reach, platforms: platformsFor(snapshot, `package:${name}`) });
  }
  return roll(root);
}

export function findNode(root: TrieNode, path: string): TrieNode | null {
  if (!path) return root;
  for (const kid of root.kids) {
    if (kid.path === path) return kid;
    if (path.startsWith(kid.path + "/")) return findNode(kid, path);
  }
  return null;
}

export function leavesOf(node: TrieNode, into: TrieNode[] = []): TrieNode[] {
  if (node.leaf) into.push(node);
  for (const kid of node.kids) leavesOf(kid, into);
  return into;
}

export function ancestorsOf(node: TrieNode): TrieNode[] {
  const chain: TrieNode[] = [];
  for (let current = node.parent; current && current.path; current = current.parent) chain.unshift(current);
  return chain;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): pack rows along the shorter side, closing a row
 * as soon as adding the next item would make its worst aspect ratio worse.
 */
export function squarify(items: TrieNode[], rect: Rect): PlacedNode[] {
  const placed: PlacedNode[] = [];
  const pending = items.filter(item => item.value > 0);
  let remaining = pending.reduce((sum, item) => sum + item.value, 0);
  let box = { ...rect };
  while (pending.length && box.width > 0.5 && box.height > 0.5 && remaining > 0) {
    const vertical = box.width >= box.height;
    const side = vertical ? box.height : box.width;
    const area = box.width * box.height;
    const row: TrieNode[] = [];
    let sum = 0, best = Infinity;
    while (pending.length) {
      const candidate = pending[0];
      const next = sum + candidate.value;
      const thickness = (next * area / remaining) / side;
      let worst = 0;
      for (const member of [...row, candidate]) {
        const length = (member.value * area / remaining) / thickness;
        worst = Math.max(worst, Math.max(thickness / length, length / thickness));
      }
      if (!row.length || worst <= best) { row.push(pending.shift() as TrieNode); sum = next; best = worst; }
      else break;
    }
    const thickness = (sum * area / remaining) / side;
    let offset = vertical ? box.y : box.x;
    for (const member of row) {
      const length = (member.value * area / remaining) / thickness;
      placed.push({ node: member, rect: vertical ? { x: box.x, y: offset, width: thickness, height: length } : { x: offset, y: box.y, width: length, height: thickness } });
      offset += length;
    }
    if (vertical) { box = { ...box, x: box.x + thickness, width: box.width - thickness }; }
    else { box = { ...box, y: box.y + thickness, height: box.height - thickness }; }
    remaining -= sum;
  }
  return placed;
}

export type FlowGraph = { start: IntelRef; levels: IntelRef[][]; hidden: number[]; parent: Map<IntelRef, IntelRef> };

export const FLOW_CAPS = [1, 12, 18, 22];

/**
 * Breadth-first layering of one screen's dependencies, one level per import hop. Levels are capped
 * and the overflow counted rather than dropped, so a crowded depth still reports its real size.
 */
export function buildFlow(snapshot: AppIntelSnapshot, start: IntelRef, caps: number[] = FLOW_CAPS): FlowGraph {
  const levels: IntelRef[][] = [[start]];
  const hidden = [0, 0, 0, 0];
  const parent = new Map<IntelRef, IntelRef>();
  const visited = new Set<IntelRef>([start]);
  for (let depth = 0; depth < caps.length - 1; depth++) {
    const next: IntelRef[] = [];
    for (const ref of levels[depth]) for (const index of snapshot.indexes.outgoing[ref] ?? []) {
      const edge = snapshot.edges[index];
      if (!edge.to || edge.kind === "navigation" || visited.has(edge.to)) continue;
      visited.add(edge.to);
      parent.set(edge.to, ref);
      next.push(edge.to);
    }
    next.sort((a, b) => reachOf(snapshot, b) - reachOf(snapshot, a));
    const cap = caps[depth + 1];
    for (const ref of next.slice(cap)) parent.delete(ref);
    levels[depth + 1] = next.slice(0, cap);
    hidden[depth + 1] = Math.max(0, next.length - cap);
    levels[depth + 1].sort((a, b) => groupOf(a) === groupOf(b) ? reachOf(snapshot, b) - reachOf(snapshot, a) : groupOf(a).localeCompare(groupOf(b)));
  }
  return { start, levels, hidden, parent };
}

/** Walks incoming edges back to a screen that reaches this node, for "show me where this is used". */
export function ownerScreen(snapshot: AppIntelSnapshot, ref: IntelRef): string | null {
  const queue: IntelRef[] = [ref];
  const visited = new Set<IntelRef>(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) for (const index of snapshot.indexes.incoming[queue[cursor]] ?? []) {
    const from = snapshot.edges[index].from;
    if (from.startsWith("screen:")) return from.slice(7);
    if (visited.has(from)) continue;
    visited.add(from);
    queue.push(from);
  }
  return null;
}

export function reachOf(snapshot: AppIntelSnapshot, ref: IntelRef): number {
  if (ref.startsWith("file:")) return snapshot.files[ref.slice(5)]?.reach ?? 0;
  if (ref.startsWith("package:")) return snapshot.packages[ref.slice(8)]?.reach ?? 0;
  return 0;
}

/** Top two path segments, which is what clusters a column by the area of the app it belongs to. */
export function groupOf(ref: IntelRef): string {
  const path = ref.replace(/^(?:file|package|screen):/, "");
  return ref.startsWith("package:") ? PACKAGE_PREFIX : path.split("/").slice(0, 2).join("/");
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

/**
 * Where that node lives, in full. `groupOf` keeps two segments because it clusters a column;
 * a label needs the whole path, since several `index.tsx` differ by nothing else.
 */
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

const RAMP = ["#1d4a57", "#1f7d82", "#2fa37f", "#79b85a", "#d7c045", "#e09440", "#dc5440"] as const;

/**
 * Log-scaled, because most files are reached by a handful of screens: a linear ramp renders the
 * whole map cold and hides the difference between 2 screens and 20.
 */
export function heatT(reach: number, max: number): number {
  if (!(max > 0) || reach <= 0) return 0;
  return Math.min(1, Math.log1p(reach) / Math.log1p(max));
}

export function heat(reach: number, max: number): string {
  const position = heatT(reach, max) * (RAMP.length - 1);
  const index = Math.min(RAMP.length - 2, Math.floor(position));
  const fraction = Math.max(0, Math.min(1, position - index));
  const from = channels(RAMP[index]), to = channels(RAMP[index + 1]);
  return `rgb(${from.map((value, slot) => Math.round(value + (to[slot] - value) * fraction)).join(",")})`;
}

/** Text that stays legible on a heat cell in either theme, since the ramp ignores the theme. */
export function heatInk(reach: number, max: number): string {
  const [red, green, blue] = channels(RAMP[Math.round(heatT(reach, max) * (RAMP.length - 1))]);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 140 ? "#10151a" : "#e9eef3";
}

export const heatRamp = () => `linear-gradient(90deg, ${RAMP.join(",")})`;

function channels(value: string): [number, number, number] {
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}

/**
 * Nesting tints. The Flow used one muted card for every hop, which read as a grey ladder; one hue
 * per depth makes the hop a node sits at legible at a glance, in either theme.
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
