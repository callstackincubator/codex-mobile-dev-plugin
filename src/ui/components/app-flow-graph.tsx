import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { AppFlowEdge, AppFlowNode } from "../../shared/app-flow.ts";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { recordUiTiming } from "../telemetry.ts";
import { BAND_COLUMNS, COL_GAP, NODE_HEIGHT, NODE_WIDTH, STRUCTURE_NODE_HEIGHT, layoutTopology, type NodePlacement, type ResolvedEdge } from "./app-flow-layout.ts";
import { ManualRecorderPanel } from "./manual-recorder-panel.tsx";

type Props = { nodes: AppFlowNode[]; edges: AppFlowEdge[]; runtimeEdges?: AppFlowEdge[]; entryScreenIds?: string[]; projectPath?: string; projectId: string; panel: AppFlowPanel };
type GraphContextValue = { panel: AppFlowPanel; projectPath: string | null; projectId: string };
const GraphContext = createContext<GraphContextValue | null>(null);
const EMPTY_NODE_TITLE_SOURCE = { title: "", urlPath: null };
const FIT_VIEW_OPTIONS = { padding: 0.12, minZoom: 0.7, maxZoom: 1 };

export function nodeTitle(node: Pick<AppFlowNode, "title" | "id" | "urlPath">): string {
  if (node.title) return node.title;
  const last = node.id.split("/").pop() ?? "";
  if (last === "index") return "index";
  const cleaned = last.replace(/^\[(?:\.\.\.)?/, "").replace(/\]$/, "").replace(/[-_]+/g, " ");
  return cleaned.replace(/\b[a-z]/g, character => character.toUpperCase()) || node.urlPath || node.id;
}
function isUpwardHref(raw: string) { return raw.split(/[?#]/)[0].split("/").includes(".."); }
function resolvedEdges(edges: AppFlowEdge[]): ResolvedEdge[] { return edges.filter((edge): edge is ResolvedEdge => Boolean(edge.to) && !isUpwardHref(edge.raw)); }
type CaptureTone = "good" | "warn" | "muted";
export function captureStatus(node: AppFlowNode): { label: string; tone: CaptureTone } | null {
  if (node.origin === "chrome") return null;
  const capture = node.capture;
  if (capture?.stale) return { label: "Previous capture", tone: "warn" };
  if (capture?.status === "unavailable") return { label: "Not in this build", tone: "muted" };
  if (capture?.replayVerified) return { label: "Verified replay", tone: "good" };
  if (capture?.pathCommands?.length) return { label: "Recorded path", tone: "good" };
  if (capture?.pathVerified === false && capture.replayable) return { label: "Inferred path", tone: "warn" };
  if (capture?.captureMethod === "deep-link") return { label: "Deep-link fallback", tone: "warn" };
  if (capture?.captureMethod === "rendered") return { label: "Rendered", tone: "warn" };
  if (capture?.captureMethod === "opportunistic") return { label: "Opportunistic", tone: "warn" };
  if (!capture && node.deepLinkRejection) return { label: `Deep link rejected: ${node.deepLinkRejection.reason}`, tone: "muted" };
  if (capture?.note) return { label: capture.note, tone: "muted" };
  return { label: "Replay unavailable", tone: "muted" };
}
const TONE_DOT: Record<CaptureTone, string> = { good: "bg-emerald-400", warn: "bg-amber-400", muted: "bg-slate-500" };
const TONE_TEXT: Record<CaptureTone, string> = { good: "text-emerald-600 dark:text-emerald-300/90", warn: "text-amber-600 dark:text-amber-300/90", muted: "text-muted-foreground" };

function Screenshot({ projectId, path, title, panel }: { projectId: string; path: string; title: string; panel: AppFlowPanel }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let active = true; void panel.screenshot(projectId, path).then(url => { if (active) setSrc(url); }, () => {}); return () => { active = false; }; }, [panel, projectId, path]);
  return src ? <img src={src} alt={title} className="min-h-0 flex-1 bg-black/10 object-contain" />
    : <div className="flex flex-1 items-center justify-center bg-muted/40 text-[10px] text-muted-foreground">Loading capture…</div>;
}
function ScreenNode({ data }: NodeProps) {
  const node = data.node as AppFlowNode;
  const graph = useContext(GraphContext)!;
  const title = nodeTitle(node); const status = captureStatus(node); const screenshot = node.capture?.screenshot;
  return <><Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-slate-400" />
    <div className="flex h-full flex-col overflow-hidden">
      {screenshot ? <Screenshot projectId={graph.projectId} path={screenshot} title={title} panel={graph.panel} />
        : <div className="flex flex-1 items-center bg-muted/40 px-3 py-2 text-[10px] leading-snug text-muted-foreground">
          {node.origin === "chrome" ? "Navigator surface — reachable from anywhere it is revealed" : node.origin === "runtime" ? "Discovered on device" : node.file ?? "Source component unresolved"}</div>}
      <div className="shrink-0 space-y-1 px-3 py-2.5"><div className="flex items-center gap-1.5 overflow-hidden">
        <div className="shrink-0 truncate text-[12px] font-medium">{title}</div><div className="truncate text-[10px] text-muted-foreground">
          {node.origin === "chrome" ? "Not a screen — nothing to capture" : node.urlPath ?? "In-app navigation only"}</div></div>
        {status && <div className={`flex items-center gap-1.5 text-[10px] ${TONE_TEXT[status.tone]}`} title={node.capture?.note ?? undefined}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} /><span className="truncate">{status.label}</span></div>}
        <NodeActions node={node} />
      </div>
    </div><Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-slate-400" /></>;
}
function NodeActions({ node }: { node: AppFlowNode }) {
  const graph = useContext(GraphContext)!;
  const recording = useSyncExternalStore(graph.panel.recording.subscribe, graph.panel.recording.getSnapshot);
  const [replaying, setReplaying] = useState(false); const [replayError, setReplayError] = useState<string | null>(null);
  if (!graph.projectPath || node.origin === "chrome") return null;
  const active = recording.nodeId === node.id; const otherRunning = recording.nodeId !== null && !active;
  const replayable = node.capture?.replayable ?? node.capture?.status === "ok"; const inferred = node.capture?.pathVerified === false;
  const selectors = node.capture?.pathContentSelectors ?? [];
  return <div className="mt-0.5 flex flex-col gap-1"><div className="flex items-center gap-1.5">
    <button type="button" className={`nodrag nopan flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium disabled:opacity-35 ${active ? "bg-rose-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
      disabled={otherRunning || replaying} onClick={event => { event.stopPropagation(); void (active ? graph.panel.recording.stop(graph.projectPath!) : graph.panel.recording.start(graph.projectPath!, node.id)); }}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "animate-pulse bg-white" : "bg-rose-400"}`} />{active ? "Stop" : "Record path"}</button>
    {replayable && <button type="button" title={`${inferred ? "Walk this screen’s inferred path" : "Launch the app and walk this screen’s recorded path"}${selectors.length ? `. Depends on visible text: ${selectors.join(", ")}` : ""}`}
      className={`nodrag nopan flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium disabled:opacity-35 ${inferred ? "border-amber-400/40 text-amber-600" : "border-border"}`}
      disabled={recording.nodeId !== null || replaying} onClick={event => { event.stopPropagation(); setReplayError(null); setReplaying(true);
        void graph.panel.replay(node.id).catch(error => setReplayError(error instanceof Error ? error.message : "Replay failed.")).finally(() => setReplaying(false)); }}>
      <span aria-hidden>▶</span>{replaying ? "Replaying…" : inferred ? "Try inferred" : "Replay"}</button>}
  </div>{replayError && <div className="text-[9px] leading-tight text-amber-600">{replayError}</div>}</div>;
}

const BAND_COPY: Record<Exclude<NodePlacement, "connected">, { title: string; detail: string }> = {
  "deep-link-only": { title: "Reached by deep link · no in-app route observed", detail: "These screens were captured, but no in-app route to them was observed." },
  uncaptured: { title: "Never captured", detail: "The sweep could not render these screens, so their connectivity is unknown." },
};
function BandHeading({ data }: NodeProps) { const value = data as { title: string; detail: string; count: number };
  return <div className="border-t border-dashed border-muted-foreground/40 pt-2"><div className="text-xs font-medium text-muted-foreground">{value.title} <span className="opacity-70">({value.count})</span></div>
    <div className="max-w-3xl text-[10px] leading-snug text-muted-foreground/70">{value.detail}</div></div>; }
const nodeTypes = { screen: ScreenNode, band: BandHeading };

export function AppFlowGraph({ nodes, edges, runtimeEdges, entryScreenIds, projectPath, projectId, panel }: Props) {
  const renderStartedAt = performance.now();
  const navigations = useMemo(() => resolvedEdges([...edges, ...(runtimeEdges ?? [])]), [edges, runtimeEdges]);
  const topology = useMemo(() => { const startedAt = performance.now(); const value = layoutTopology(nodes, navigations, entryScreenIds ?? []);
    recordUiTiming("ui.app_flow.graph_process", performance.now() - startedAt); return value; }, [nodes, navigations, entryScreenIds]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => setSelectedId(current => current === node.id ? null : node.id), []);
  const recording = useSyncExternalStore(panel.recording.subscribe, panel.recording.getSnapshot);
  const flowNodes = useMemo<Node[]>(() => {
    const screens = nodes.map(node => { const where = topology.placement.get(node.id) ?? "connected"; return { id: node.id, type: "screen", position: topology.positions.get(node.id) ?? { x: 0, y: 0 }, data: { node },
      style: { width: NODE_WIDTH, height: node.capture?.screenshot ? NODE_HEIGHT : STRUCTURE_NODE_HEIGHT, padding: 0, background: "var(--background)",
        border: node.id === selectedId ? "2px solid var(--foreground)" : where === "connected" ? "1px solid var(--border)" : "1px dashed var(--muted-foreground)",
        opacity: where === "connected" || node.id === selectedId ? 1 : 0.72, color: "var(--foreground)", borderRadius: 8 } }; });
    const headings = topology.bandHeadings.map(band => ({ id: `band:${band.placement}`, type: "band", position: { x: 0, y: band.y }, draggable: false, selectable: false,
      data: { ...BAND_COPY[band.placement], count: band.count }, style: { width: BAND_COLUMNS * NODE_WIDTH + (BAND_COLUMNS - 1) * COL_GAP, background: "none" } }));
    return [...headings, ...screens];
  }, [nodes, topology, selectedId]);
  const flowEdges = useMemo<Edge[]>(() => navigations.map((edge, index) => {
    const walked = edge.origin === "runtime-walk", guessed = edge.origin === "runtime-chrome", reveal = edge.kind === "reveal";
    const inward = selectedId !== null && edge.to === selectedId, outward = selectedId !== null && !inward && edge.from === selectedId, highlighted = inward || outward;
    return { id: `e-${index}`, source: edge.from, target: edge.to, label: highlighted ? edge.raw : undefined, animated: walked && highlighted, zIndex: highlighted ? 10 : 0,
      style: { stroke: inward ? "#3b82f6" : outward ? "#f97316" : reveal ? "#6b7280" : walked ? "#34d399" : guessed ? "#a78bfa" : "#9ca3af",
        strokeWidth: highlighted ? walked ? 3 : 2 : walked ? 2 : 1, strokeDasharray: reveal ? "2 4" : guessed ? "6 4" : undefined,
        opacity: selectedId === null ? 0.35 : highlighted ? 1 : 0.08 } };
  }), [navigations, selectedId]);
  useEffect(() => { recordUiTiming("ui.app_flow.graph_render", performance.now() - renderStartedAt); }, [flowNodes, flowEdges]);
  return <GraphContext.Provider value={{ panel, projectPath: projectPath ?? null, projectId }}><div className="relative h-full min-h-80 w-full">
    <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} onPaneClick={() => setSelectedId(null)} fitView fitViewOptions={FIT_VIEW_OPTIONS} colorMode="system">
      <Controls fitViewOptions={FIT_VIEW_OPTIONS} /><Background gap={16} size={1} />
    </ReactFlow>
    {projectPath && recording.nodeId && <ManualRecorderPanel projectPath={projectPath} store={panel.recording}
      title={nodeTitle(nodes.find(node => node.id === recording.nodeId) ?? { ...EMPTY_NODE_TITLE_SOURCE, id: recording.nodeId })} />}
  </div></GraphContext.Provider>;
}
