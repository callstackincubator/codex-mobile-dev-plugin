/** Pure topology layout for the App Flow graph. */
import type { AppFlowEdge, AppFlowNode } from "../../shared/app-flow.ts";

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
