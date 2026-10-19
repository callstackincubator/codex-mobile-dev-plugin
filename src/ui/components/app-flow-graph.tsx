import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { AppFlowEdge, AppFlowNode, AppFlowUiState } from "../../shared/app-flow.ts";
import { featureGateNotice } from "../../shared/app-flow.ts";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { recordUiTiming, setUiGauge } from "../telemetry.ts";
import { BAND_COLUMNS, COL_GAP, NODE_HEIGHT, NODE_WIDTH, STRUCTURE_NODE_HEIGHT, displayableUiStates, layoutTopology, uiStateCount, type NodePlacement, type ResolvedEdge } from "./app-flow-layout.ts";
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

function Screenshot({ projectId, path, title, panel, className = "min-h-0 flex-1 bg-black/10 object-contain", fallback }: { projectId: string; path: string; title: string; panel: AppFlowPanel; className?: string; fallback?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { setSrc(""); let active = true; void panel.screenshot(projectId, path).then(url => { if (active) setSrc(url); }, () => {}); return () => { active = false; }; }, [panel, projectId, path]);
  return src ? <img src={src} alt={title} className={className} />
    : fallback !== undefined ? <div className={`${className} flex items-center justify-center bg-muted/40 text-[8px] text-muted-foreground`}>{fallback}</div>
      : <div className="flex flex-1 items-center justify-center bg-muted/40 text-[10px] text-muted-foreground">Loading capture…</div>;
}

/**
 * The captured UI states of one screen: a strip that is collapsed at rest, so a dense graph looks
 * exactly as it did before the explore-UI pass existed. Selecting a thumbnail swaps the node's
 * MAIN image rather than growing the node, which is what keeps `NODE_HEIGHT` and the layout math
 * in `app-flow-layout.ts` untouched.
 */
function UiStateStrip({ node, title, variants, selectedId, onSelect }: { node: AppFlowNode; title: string; variants: AppFlowUiState[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const graph = useContext(GraphContext)!;
  const [expanded, setExpanded] = useState(false);
  const base = node.capture?.screenshot ?? null;
  const thumb = "h-14 w-9 shrink-0 rounded-sm object-cover";
  const frame = (pressed: boolean) => `nodrag nopan flex shrink-0 flex-col items-center gap-0.5 rounded-md border p-1 text-[9px] disabled:opacity-40 ${pressed ? "border-foreground bg-muted" : "border-border hover:bg-muted/60"}`;
  return <div className="mt-0.5">
    <button type="button" className="nodrag nopan flex w-full items-center gap-1.5 rounded-md bg-muted/40 px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/70"
      aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} ${variants.length} captured UI state${variants.length === 1 ? "" : "s"} of ${title}`}
      onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
      <span aria-hidden>{expanded ? "▾" : "▸"}</span><span className="truncate">UI states</span>
      <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[9px] tabular-nums">{variants.length}</span></button>
    {expanded && <div role="group" aria-label={`Captured UI states of ${title}`} className="nodrag nopan mt-1 flex gap-1.5 overflow-x-auto pb-1">
      {base && <button type="button" className={frame(selectedId === null)} aria-pressed={selectedId === null} title={`${title} — the screen as the sweep captured it`}
        onClick={event => { event.stopPropagation(); onSelect(null); }}>
        <Screenshot projectId={graph.projectId} path={base} title={`${title} — Base`} panel={graph.panel} className={thumb} fallback="…" />
        <span className="w-9 truncate text-center">Base</span></button>}
      {variants.map(variant => variant.screenshot
        // A variant the host could not open keeps its place, disabled, with the reason on hover:
        // it was found in the screen's own source, so dropping it would hide a real failure.
        ? <button key={variant.id} type="button" className={frame(selectedId === variant.id)} aria-pressed={selectedId === variant.id} title={variant.name}
          onClick={event => { event.stopPropagation(); onSelect(variant.id); }}>
          <Screenshot projectId={graph.projectId} path={variant.screenshot} title={`${title} — ${variant.name}`} panel={graph.panel} className={thumb} fallback="…" />
          <span className="w-9 truncate text-center">{variant.name}</span></button>
        : <button key={variant.id} type="button" disabled aria-pressed={false} className={frame(false)} title={`${variant.name} — not captured: ${variant.error ?? "unknown error"}`}
          onClick={event => event.stopPropagation()}>
          <span className={`${thumb} flex items-center justify-center bg-muted/40 text-amber-600`} aria-hidden>!</span>
          <span className="w-9 truncate text-center text-amber-600">{variant.name}</span></button>)}
    </div>}
  </div>;
}

function ScreenNode({ data }: NodeProps) {
  const node = data.node as AppFlowNode;
  const graph = useContext(GraphContext)!;
  const title = nodeTitle(node); const status = captureStatus(node); const screenshot = node.capture?.screenshot;
  const variants = displayableUiStates(node);
  const [variantId, setVariantId] = useState<string | null>(null);
  const shown = variants.find(variant => variant.id === variantId && variant.screenshot != null) ?? null;
  const shownPath = shown?.screenshot ?? screenshot;
  const shownTitle = shown ? `${title} — ${shown.name}` : title;
  // Read off the source, never off what this run rendered: see `featureGateNotice`.
  const gate = featureGateNotice(node.guard);
  return <><Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-slate-400" />
    <div className="flex h-full flex-col overflow-hidden">
      {shownPath ? <Screenshot projectId={graph.projectId} path={shownPath} title={shownTitle} panel={graph.panel} />
        : <div className="flex flex-1 items-center bg-muted/40 px-3 py-2 text-[10px] leading-snug text-muted-foreground">
          {node.origin === "chrome" ? "Navigator surface — reachable from anywhere it is revealed" : node.origin === "runtime" ? "Discovered on device" : node.file ?? "Source component unresolved"}</div>}
      <div className="shrink-0 space-y-1 px-3 py-2.5">
        {shown && <div className="truncate text-[10px] text-muted-foreground">Showing UI state: {shown.name}</div>}
        <div className="flex items-center gap-1.5 overflow-hidden">
        <div className="shrink-0 truncate text-[12px] font-medium">{title}</div><div className="truncate text-[10px] text-muted-foreground">
          {node.origin === "chrome" ? "Not a screen — nothing to capture" : node.urlPath ?? "In-app navigation only"}</div></div>
        {status && <div className={`flex items-center gap-1.5 text-[10px] ${TONE_TEXT[status.tone]}`} title={node.capture?.note ?? undefined}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} /><span className="truncate">{status.label}</span></div>}
        {gate && <div className="flex items-center gap-1.5 text-[10px] text-violet-600 dark:text-violet-300/90" title={gate.detail}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" /><span className="truncate">{gate.label}</span></div>}
        {variants.length > 0 && <UiStateStrip node={node} title={title} variants={variants} selectedId={shown?.id ?? null} onSelect={setVariantId} />}
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
  // How many UI-state rows this graph offers, one plain number per node-set change. Counts rows
  // only: no route, node, component or file identity is attached anywhere on this series.
  useEffect(() => { setUiGauge("ui.app_flow.ui_states_rendered", uiStateCount(nodes)); }, [nodes]);
  return <GraphContext.Provider value={{ panel, projectPath: projectPath ?? null, projectId }}><div className="relative h-full min-h-80 w-full">
    <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} onPaneClick={() => setSelectedId(null)} fitView fitViewOptions={FIT_VIEW_OPTIONS} colorMode="system">
      <Controls fitViewOptions={FIT_VIEW_OPTIONS} /><Background gap={16} size={1} />
    </ReactFlow>
    {projectPath && recording.nodeId && <ManualRecorderPanel projectPath={projectPath} store={panel.recording}
      title={nodeTitle(nodes.find(node => node.id === recording.nodeId) ?? { ...EMPTY_NODE_TITLE_SOURCE, id: recording.nodeId })} />}
  </div></GraphContext.Provider>;
}
