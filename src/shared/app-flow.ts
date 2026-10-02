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
  required: string[];
  params?: FlowParams;
  status: FlowStatus;
  reason?: string;
  image?: string;
  captureMs?: number;
};
export type FlowEdge = { from: string; to: string; kind: "contains" | "navigation" };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; warnings: string[]; files: number; scanMs: number };
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

/** Place each occurrence in its navigator's column. Cross-links do not change containment. */
export function layoutFlow(graph: Pick<FlowGraph, "nodes" | "edges">) {
  const positions = new Map<string, { x: number; y: number }>();
  const children = new Map<string, FlowNode[]>();
  const parent = new Map<string, string>();
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.kind !== "contains" || parent.has(edge.to) || !byId.has(edge.from) || !byId.has(edge.to)) continue;
    parent.set(edge.to, edge.from);
    const list = children.get(edge.from) ?? []; list.push(byId.get(edge.to)!); children.set(edge.from, list);
  }
  let row = 0;
  const visit = (node: FlowNode, depth: number) => {
    if (positions.has(node.id)) return;
    positions.set(node.id, { x: 36 + depth * 244, y: 36 + row * 352 });
    const nested = children.get(node.id) ?? [];
    if (!nested.length) row++;
    else for (const child of nested) visit(child, depth + 1);
  };
  for (const node of graph.nodes) if (!parent.has(node.id)) visit(node, 0);
  for (const node of graph.nodes) if (!positions.has(node.id)) visit(node, 0);
  return { positions, width: Math.max(600, ...[...positions.values()].map(p => p.x + 240)), height: Math.max(420, row * 352 + 72) };
}
