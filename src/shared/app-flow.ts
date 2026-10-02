export type FlowParams = Record<string, unknown>;
export type FlowStatus = "pending" | "needs-data" | "capturing" | "captured" | "blocked" | "timed-out";
export type FlowNode = {
  id: string;
  name: string;
  kind: "navigator" | "screen";
  component?: string;
  definition?: string;
  sharedFrom?: string;
  file?: string;
  line?: number;
  path: string[];
  paths?: string[][];
  entry?: boolean;
  urls?: string[];
  required: string[];
  params?: FlowParams;
  status: FlowStatus;
  reason?: string;
  image?: string;
  captureMs?: number;
};
export type FlowEdge = { from: string; to: string; kind: "contains" | "navigation"; owner?: string; via?: "link" | "call"; guarded?: boolean };
export type FlowLink = { target: string; owner: string; params?: FlowParams; guarded: boolean };
export type FlowGraph = { links?: FlowLink[]; nodes: FlowNode[]; edges: FlowEdge[]; warnings: string[]; files: number; scanMs: number };
export type FlowRun = FlowGraph & {
  id: string;
  phase: "scanning" | "connecting" | "capturing" | "finishing" | "complete" | "stopped" | "failed";
  startedAt: number;
  finishedAt?: number;
  error?: string;
  revision: number;
  ai: "off" | "waiting" | "resolving" | "done" | "unavailable";
};
export type FlowResolution = { nodeId: string; params: FlowParams };
export const flowRunning = (run?: FlowRun) => !!run && ["scanning", "connecting", "capturing", "finishing"].includes(run.phase);
export function missingFlowParams(node: Pick<FlowNode, "required" | "params">): string[] {
  return node.required.filter(key => node.params?.[key] === undefined || node.params[key] === null || node.params[key] === "");
}

export const FLOW_CARD_WIDTH = 202;
export const FLOW_CARD_HEIGHT = 324;
const columnGap = 48, rowGap = 28;

/** Build a spanning forest from navigation links, then pack sibling branches in short columns. */
export function layoutFlow(graph: Pick<FlowGraph, "nodes" | "edges">) {
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>(), incoming = new Set<string>();
  const navigation = graph.edges.filter(edge => edge.kind === "navigation");
  for (const edge of navigation.length ? navigation : graph.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue;
    const list = outgoing.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    outgoing.set(edge.from, list); incoming.add(edge.to);
  }
  const children = new Map<string, string[]>(), assigned = new Set<string>(), roots: string[] = [];
  const treeEdges = new Set<string>();
  const grow = (root: string) => {
    roots.push(root); assigned.add(root);
    const queue = [root];
    for (let index = 0; index < queue.length; index++) for (const child of outgoing.get(queue[index]) ?? []) {
      if (assigned.has(child) || byId.get(child)?.entry) continue;
      assigned.add(child); queue.push(child);
      const list = children.get(queue[index]) ?? []; list.push(child); children.set(queue[index], list);
      treeEdges.add(`${queue[index]}:${child}`);
    }
  };
  for (const node of graph.nodes) if (node.entry || !incoming.has(node.id)) { if (!assigned.has(node.id)) grow(node.id); }
  for (const node of graph.nodes) if (!assigned.has(node.id)) grow(node.id);
  type Box = { width: number; height: number; items: { id: string; x: number; y: number }[] };
  const pack = (ids: string[], depth = 0): Box => {
    let x = 0, height = 0;
    const items: Box["items"] = [];
    const rows = depth === 0 ? 1 : 3;
    for (let offset = 0; offset < ids.length; offset += rows) {
      let y = 0, width = 0;
      for (const id of ids.slice(offset, offset + rows)) {
        const nested = pack(children.get(id) ?? [], depth + 1);
        items.push({ id, x, y });
        for (const item of nested.items) items.push({ ...item, x: item.x + x + FLOW_CARD_WIDTH + columnGap, y: item.y + y });
        width = Math.max(width, FLOW_CARD_WIDTH + (nested.width ? columnGap + nested.width : 0));
        y += Math.max(byId.get(id)?.kind === "navigator" ? 56 : FLOW_CARD_HEIGHT, nested.height) + rowGap;
      }
      height = Math.max(height, y - rowGap); x += width + columnGap;
    }
    return { width: Math.max(0, x - columnGap), height, items };
  };
  const box = pack(roots);
  for (const { id, x, y } of box.items) positions.set(id, { x: x + 36, y: y + 36 });
  return { positions, treeEdges, width: Math.max(600, box.width + 72), height: Math.max(420, box.height + 72) };
}

export type FlowViewport = { x: number; y: number; width: number; height: number };
export function visibleFlowNodes(positions: Map<string, { x: number; y: number }>, viewport: FlowViewport, margin = 180) {
  const visible = new Set<string>();
  for (const [id, point] of positions) if (point.x + FLOW_CARD_WIDTH >= viewport.x - margin && point.x <= viewport.x + viewport.width + margin && point.y + FLOW_CARD_HEIGHT >= viewport.y - margin && point.y <= viewport.y + viewport.height + margin) visible.add(id);
  return visible;
}
