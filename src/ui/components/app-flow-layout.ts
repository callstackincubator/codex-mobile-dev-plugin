/** Pure topology layout for the App Flow graph. */
import type { AppFlowEdge, AppFlowNode, AppFlowSweepStatus, AppFlowUiState } from "../../shared/app-flow.ts";

export const NODE_WIDTH = 320;
export const NODE_HEIGHT = 760;
export const STRUCTURE_NODE_HEIGHT = 118;
export const COL_GAP = 84;
export const ROW_GAP = 72;

export type ResolvedEdge = AppFlowEdge & { to: string };
export type NodePlacement = "connected" | "deep-link-only" | "uncaptured";
export const BAND_COLUMNS = 6;
const BAND_GAP = NODE_HEIGHT * 1.5;

function isNestedRoute(parentId: string, childId: string): boolean {
  return childId.startsWith(`${parentId}/`);
}

function isTabLike(navigator: string | null): boolean {
  return navigator === "Tabs" || navigator === "NativeTabs" || navigator === "Drawer";
}

function isChildNavigation(from: AppFlowNode, to: AppFlowNode): boolean {
  if (from.id === to.id) return false;
  if (isNestedRoute(from.id, to.id)) return true;
  if (from.group === to.group && isTabLike(from.navigator)) return false;
  return true;
}

function nestedParentId(childId: string, ids: Set<string>): string | null {
  const segments = childId.split("/");
  if (segments.at(-1) === "index") segments.pop();
  if (segments.length <= 1) return null;
  segments.pop();
  const directory = segments.join("/");
  return ids.has(directory) ? directory : null;
}

function placementOf(node: AppFlowNode): Exclude<NodePlacement, "connected"> {
  const status = node.capture?.status;
  return status === "ok" || status === "empty-state" ? "deep-link-only" : "uncaptured";
}

export interface CaptureTally {
  /** Screens the sweep actually has a screenshot for. */
  captured: number;
  /** Screens the sweep attempted and gave up on — `recordUnreached` leaves a capture whose
   *  `screenshot` is null and whose `note` says why, so a bare capture is not evidence of one. */
  unableToCapture: number;
  /** Product screens, chrome excluded: chrome nodes are navigators, never a screen to capture. */
  total: number;
  /** Distinct `capture.note` reasons behind `unableToCapture`, in first-seen order. */
  reasons: string[];
}

/**
 * Counts what a finished sweep holds. The sweep summary's `completed` is the queue index — every
 * route the sweep *tried* — so it reports a full house even when routes failed with "Unresolved
 * route parameters" and no screenshot.
 */
export function captureTally(nodes: AppFlowNode[]): CaptureTally {
  const tally: CaptureTally = { captured: 0, unableToCapture: 0, total: 0, reasons: [] };
  for (const node of nodes) {
    if (node.origin === "chrome") continue;
    tally.total += 1;
    const capture = node.capture;
    if (capture?.screenshot != null) { tally.captured += 1; continue; }
    if (!capture) continue;
    tally.unableToCapture += 1;
    const note = capture.note?.trim();
    if (note && !tally.reasons.includes(note)) tally.reasons.push(note);
  }
  return tally;
}

/**
 * The UI states of one screen that are worth a row in its node's strip: every variant the
 * explore-UI pass persisted that either has a frame to show or says why it has none. A row with
 * neither is evidence of nothing, so it is dropped rather than rendered as an empty thumbnail.
 *
 * Failures are deliberately kept: `exploreUi` writes `screenshot: null` with an `error` precisely
 * so the user can see that a state was found in source and could not be opened. Hiding them would
 * make a partly failed pass indistinguishable from a smaller app.
 */
export function displayableUiStates(node: AppFlowNode): AppFlowUiState[] {
  return (node.capture?.uiStates ?? []).filter(state => state.screenshot != null || Boolean(state.error));
}

/** Whether a node should render a UI-state strip at all. */
export function hasUiStates(node: AppFlowNode): boolean {
  return displayableUiStates(node).length > 0;
}

/**
 * How many UI-state rows the whole node set renders. Reported as a gauge, never folded into
 * `captureTally`: that headline counts screens, and a variant is not a screen.
 */
export function uiStateCount(nodes: AppFlowNode[]): number {
  let total = 0;
  for (const node of nodes) total += displayableUiStates(node).length;
  return total;
}

export interface Topology {
  positions: Map<string, { x: number; y: number }>;
  placement: Map<string, NodePlacement>;
  bandHeadings: { placement: Exclude<NodePlacement, "connected">; y: number; count: number }[];
}

export function layoutTopology(nodes: AppFlowNode[], edges: ResolvedEdge[], entryScreenIds: string[]): Topology {
  const positions = new Map<string, { x: number; y: number }>();
  const placement = new Map<string, NodePlacement>();
  if (nodes.length === 0) return { positions, placement, bandHeadings: [] };

  const byId = new Map(nodes.map(node => [node.id, node]));
  const ids = new Set(byId.keys());
  const children = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) { children.set(node.id, []); indegree.set(node.id, 0); }

  const addChild = (fromId: string, toId: string): void => {
    const list = children.get(fromId);
    if (!list || fromId === toId || list.includes(toId)) return;
    list.push(toId);
    indegree.set(toId, (indegree.get(toId) ?? 0) + 1);
  };
  for (const node of nodes) {
    const parent = nestedParentId(node.id, ids);
    if (parent) addChild(parent, node.id);
  }
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from && to && isChildNavigation(from, to)) addChild(from.id, to.id);
  }

  const treeChildren = new Map<string, string[]>();
  const assigned = new Set<string>();
  const roots: string[] = [];
  for (const node of nodes) treeChildren.set(node.id, []);
  const grow = (startIds: string[]): void => {
    const queue = [...startIds];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) continue;
      for (const child of children.get(id) ?? []) {
        if (assigned.has(child)) continue;
        assigned.add(child);
        treeChildren.get(id)?.push(child);
        queue.push(child);
      }
    }
  };

  const chromeRootIds = nodes.filter(node => node.origin === "chrome").map(node => node.id);
  const reachable = new Set<string>([...chromeRootIds, ...entryScreenIds.filter(id => ids.has(id))]);
  const frontier = [...reachable];
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    const list = outgoing.get(edge.from);
    if (list) list.push(edge.to); else outgoing.set(edge.from, [edge.to]);
  }
  while (frontier.length > 0) {
    const id = frontier.pop();
    if (!id) continue;
    for (const next of outgoing.get(id) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      frontier.push(next);
    }
  }

  const seedWaves = reachable.size
    ? [chromeRootIds, entryScreenIds.filter(id => ids.has(id))]
    : [nodes.filter(node => (indegree.get(node.id) ?? 0) === 0).map(node => node.id)];
  if (seedWaves.every(wave => wave.length === 0) && nodes[0]) seedWaves.push([nodes[0].id]);
  for (const wave of seedWaves) {
    const added: string[] = [];
    for (const id of wave) {
      if (assigned.has(id)) continue;
      assigned.add(id); roots.push(id); added.push(id);
    }
    grow(added);
  }
  for (const node of nodes) {
    if (assigned.has(node.id) || (reachable.size > 0 && !reachable.has(node.id))) continue;
    assigned.add(node.id); roots.push(node.id); grow([node.id]);
  }
  for (const id of assigned) placement.set(id, "connected");

  const subtreeWidth = (id: string): number => {
    const kids = treeChildren.get(id) ?? [];
    if (kids.length === 0) return NODE_WIDTH;
    const width = kids.reduce((sum, kid, index) => sum + subtreeWidth(kid) + (index > 0 ? COL_GAP : 0), 0);
    return Math.max(NODE_WIDTH, width);
  };
  const place = (id: string, left: number, depth: number): void => {
    const width = subtreeWidth(id);
    positions.set(id, { x: left + (width - NODE_WIDTH) / 2, y: depth * (NODE_HEIGHT + ROW_GAP) });
    const kids = treeChildren.get(id) ?? [];
    const kidsWidth = kids.reduce((sum, kid, index) => sum + subtreeWidth(kid) + (index > 0 ? COL_GAP : 0), 0);
    let cursor = left + Math.max(0, (width - kidsWidth) / 2);
    for (const kid of kids) { const kidWidth = subtreeWidth(kid); place(kid, cursor, depth + 1); cursor += kidWidth + COL_GAP; }
  };
  let forestLeft = 0;
  for (const root of roots) { const width = subtreeWidth(root); place(root, forestLeft, 0); forestLeft += width + COL_GAP; }

  const deepest = Math.max(0, ...[...positions.values()].map(position => position.y));
  let bandTop = deepest + NODE_HEIGHT + BAND_GAP;
  const bandHeadings: Topology["bandHeadings"] = [];
  for (const band of ["deep-link-only", "uncaptured"] as const) {
    const members = nodes.filter(node => !assigned.has(node.id) && placementOf(node) === band);
    if (members.length === 0) continue;
    bandHeadings.push({ placement: band, y: bandTop, count: members.length });
    members.forEach((node, index) => {
      placement.set(node.id, band);
      positions.set(node.id, { x: (index % BAND_COLUMNS) * (NODE_WIDTH + COL_GAP), y: bandTop + NODE_HEIGHT * 0.9 + Math.floor(index / BAND_COLUMNS) * (NODE_HEIGHT + ROW_GAP) });
    });
    const rows = Math.ceil(members.length / BAND_COLUMNS);
    bandTop += NODE_HEIGHT * 0.9 + rows * (NODE_HEIGHT + ROW_GAP) + BAND_GAP;
  }
  return { positions, placement, bandHeadings };
}

/**
 * The human name of a node, the one the graph writes on it and the pickers list it by. Lives here
 * rather than in the graph component so the option builders below stay pure and testable.
 */
export function nodeTitle(node: Pick<AppFlowNode, "title" | "id" | "urlPath">): string {
  if (node.title) return node.title;
  const last = node.id.split("/").pop() ?? "";
  if (last === "index") return "index";
  const cleaned = last.replace(/^\[(?:\.\.\.)?/, "").replace(/\]$/, "").replace(/[-_]+/g, " ");
  return cleaned.replace(/\b[a-z]/g, character => character.toUpperCase()) || node.urlPath || node.id;
}

/** Width of a UI-state card in the UI-states graph. Narrower than a screen: it carries one frame. */
export const UI_STATE_NODE_WIDTH = 220;
/** Height of both a UI-state card and its parent screen card in the UI-states graph. */
export const UI_STATE_NODE_HEIGHT = 480;
/** Gap between sibling UI-state cards. */
export const UI_STATE_COL_GAP = 28;
/** Gap between a screen card and the row of its states. */
export const UI_STATE_ROW_GAP = 96;
/** Gap between one screen's family and the next. */
export const UI_STATE_FAMILY_GAP = 120;

/**
 * The React Flow id of a UI-state card. A state id is only unique within the screen that opened it
 * (`AppFlowPresentationAction.id` is per catalog site), so the screen is part of the key.
 */
export function uiStateNodeId(nodeId: string, stateId: string): string {
  return `${nodeId}::${stateId}`;
}

export interface UiStatePlacement {
  /** React Flow node id: the screen's own id for a parent, `uiStateNodeId` for a state. */
  id: string;
  kind: "screen" | "state";
  node: AppFlowNode;
  /** The variant this card shows; null on the parent screen card. */
  state: AppFlowUiState | null;
  position: { x: number; y: number };
}
export interface UiStateTopology {
  placements: UiStatePlacement[];
  edges: { id: string; source: string; target: string }[];
}

/**
 * The second graph: one row of screens that captured UI states, each with its own states hanging
 * beneath it.
 *
 * This is deliberately *not* `layoutTopology` with extra nodes. Nothing navigates to a UI state —
 * see `AppFlowUiState` — so a presentation has no place in the navigation tree, and splicing one in
 * would change every screen's column width and push the deep-link/uncaptured bands around. Keeping
 * it a separate forest means the flow graph is byte-for-byte what it was, and this view answers the
 * one question it is for: what did this screen's sheets and dialogs look like.
 *
 * Screens with no displayable state are left out entirely: an empty parent is a row of nothing.
 */
export function layoutUiStates(nodes: AppFlowNode[]): UiStateTopology {
  const placements: UiStatePlacement[] = [];
  const edges: UiStateTopology["edges"] = [];
  let left = 0;
  for (const node of nodes) {
    const states = displayableUiStates(node);
    if (states.length === 0) continue;
    const childrenWidth = states.length * UI_STATE_NODE_WIDTH + (states.length - 1) * UI_STATE_COL_GAP;
    const width = Math.max(NODE_WIDTH, childrenWidth);
    placements.push({ id: node.id, kind: "screen", node, state: null, position: { x: left + (width - NODE_WIDTH) / 2, y: 0 } });
    let cursor = left + Math.max(0, (width - childrenWidth) / 2);
    for (const state of states) {
      const id = uiStateNodeId(node.id, state.id);
      placements.push({ id, kind: "state", node, state, position: { x: cursor, y: UI_STATE_NODE_HEIGHT + UI_STATE_ROW_GAP } });
      edges.push({ id: `ui-${id}`, source: node.id, target: id });
      cursor += UI_STATE_NODE_WIDTH + UI_STATE_COL_GAP;
    }
    left += width + UI_STATE_FAMILY_GAP;
  }
  return { placements, edges };
}

export interface ScreenOption {
  id: string;
  label: string;
  /** Whether this screen has a screenshot — what the picker's "Captured only" filter keeps. */
  captured: boolean;
}
export interface UiStateOption {
  /** The UI-states graph's node id for this variant. */
  id: string;
  /** The screen that opened it — what the flow graph focuses instead. */
  nodeId: string;
  /** `AppFlowUiState.id`, which is what a node's own variant selection is keyed by. */
  stateId: string;
  label: string;
  /** False for a variant the pass found in source and could not open; it still gets a row. */
  captured: boolean;
}

/**
 * The screen picker's options. Navigator chrome is excluded: it is not a screen, so "jump to a
 * screen" listing it would be listing a thing the user cannot read a capture off.
 */
export function screenOptions(nodes: AppFlowNode[]): ScreenOption[] {
  return nodes.filter(node => node.origin !== "chrome")
    .map(node => ({ id: node.id, label: nodeTitle(node), captured: node.capture?.screenshot != null }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

/**
 * The UI-state picker's options, qualified by their screen because two screens may well have opened
 * a state of the same name. Order follows the screens, then discovery order within a screen, so the
 * list reads the way the graph is drawn rather than alphabetically across unrelated screens.
 */
export function uiStateOptions(nodes: AppFlowNode[]): UiStateOption[] {
  const options: UiStateOption[] = [];
  for (const node of nodes) {
    const title = nodeTitle(node);
    for (const state of displayableUiStates(node)) {
      options.push({ id: uiStateNodeId(node.id, state.id), nodeId: node.id, stateId: state.id,
        label: `${title} — ${state.name}`, captured: state.screenshot != null });
    }
  }
  return options;
}

export type CaptureTone = "good" | "warn" | "muted";
/**
 * How the sweep actually got to this screen, as the winning ladder rung recorded it in
 * `capture.captureMethod`.
 *
 * Its own badge rather than another branch in `captureStatus`, because the two answer different
 * questions and a node has both answers at once: `captureStatus` says how far to trust the
 * *replay* ("Recorded path", "Inferred path"), and those branches sit above the method ones, so a
 * `Deep Link + Fast` sweep could win by deep link and still show "Recorded path" — leaving no way
 * to tell which half of that mode did the work. `fromMethod` marks the statuses that already name
 * the method so the node does not print it twice.
 */
export function routeBadge(node: AppFlowNode): { label: string; detail: string } | null {
  switch (node.capture?.captureMethod) {
    case "deep-link": return { label: "Route: deep link", detail: "Reached by opening this screen's URL." };
    case "rendered": return { label: "Route: runtime navigator", detail: "Reached by dispatching navigation through the app's own navigator — no URL, no model." };
    case "saved-replay": return { label: "Route: saved replay", detail: "Reached by replaying a previously recorded journey." };
    case "manual": return { label: "Route: manual recording", detail: "Reached by replaying the journey you recorded by hand." };
    case "agent-navigation": return { label: "Route: model walk", detail: "Reached by the model exploring the UI." };
    case "opportunistic": return { label: "Route: opportunistic", detail: "Seen in passing while walking to a different screen, not by a journey to it." };
    default: return null;
  }
}
export function captureStatus(node: AppFlowNode): { label: string; tone: CaptureTone; fromMethod?: boolean } | null {
  if (node.origin === "chrome") return null;
  const capture = node.capture;
  if (capture?.stale) return { label: "Previous capture", tone: "warn" };
  if (capture?.status === "unavailable") return { label: "Not in this build", tone: "muted" };
  if (capture?.replayVerified) return { label: "Verified replay", tone: "good" };
  if (capture?.pathCommands?.length) return { label: "Recorded path", tone: "good" };
  if (capture?.pathVerified === false && capture.replayable) return { label: "Inferred path", tone: "warn" };
  if (capture?.captureMethod === "deep-link") return { label: "Deep-link fallback", tone: "warn", fromMethod: true };
  if (capture?.captureMethod === "rendered") return { label: "Rendered", tone: "warn", fromMethod: true };
  if (capture?.captureMethod === "opportunistic") return { label: "Opportunistic", tone: "warn", fromMethod: true };
  if (!capture && node.deepLinkRejection) return { label: `Deep link rejected: ${node.deepLinkRejection.reason}`, tone: "muted" };
  if (capture?.note) return { label: capture.note, tone: "muted" };
  return { label: "Replay unavailable", tone: "muted" };
}

/**
 * Whether a run that is no longer going still has screens nobody has tried.
 *
 * A sweep that stops or fails partway keeps its checkpoint (`sweep-progress.json`), and the next
 * start picks the remaining routes up rather than redoing the captured ones — so the button has to
 * say "Resume". It cannot read that off `sweepStatus`: that is `failed` both for a run that died
 * before the first screenshot and for one that died after thirty, and the second is the case where
 * "Regenerate" throws away work the user can see on the canvas. The tally is what tells them apart.
 *
 * `unableToCapture` counts toward the tried screens on purpose: a route the sweep reached and could
 * not capture ("Unresolved route parameters") is not waiting for a resume, and leaving it out would
 * pin a finished run to "Resume" forever.
 */
export function isResumable(sweepStatus: AppFlowSweepStatus | undefined, tally: CaptureTally | null): boolean {
  if (!tally || sweepStatus === "completed") return false;
  return tally.captured > 0 && tally.captured + tally.unableToCapture < tally.total;
}
