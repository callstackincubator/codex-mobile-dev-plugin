/**
 * The UI-states graph: every screen that captured UI states, with those states as its children.
 *
 * The flow graph answers "how does a user get from screen to screen", and a UI state is not a
 * place a user navigates to (see `AppFlowUiState`), so adding these as nodes there would have put
 * non-places in a map of places and widened every column to make room. This is the other question
 * — "what did this screen's sheets and dialogs look like" — asked on its own canvas, where a state
 * can be a node because the only edge it needs is "this screen opened me".
 */
import { useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { AppFlowNode, AppFlowUiState } from "../../shared/app-flow.ts";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { recordUiTiming, setUiGauge } from "../telemetry.ts";
import { GraphContext, GraphFocusPanel, Screenshot, useGraphContext } from "./app-flow-graph-shared.tsx";
import { NODE_WIDTH, UI_STATE_NODE_HEIGHT, UI_STATE_NODE_WIDTH, hasUiStates, layoutUiStates, nodeTitle, screenOptions, uiStateOptions, uiStateCount } from "./app-flow-layout.ts";

type Props = { nodes: AppFlowNode[]; projectPath?: string; projectId: string; panel: AppFlowPanel };
const FIT_VIEW_OPTIONS = { padding: 0.12, minZoom: 0.3, maxZoom: 1 };
const OPENED_BY: Record<NonNullable<AppFlowUiState["openedBy"]>, string> = {
  state: "Opened by the screen’s own state setter",
  control: "Opened by the screen’s own controller",
  mount: "Projected from source, in isolation",
};

function ScreenParentNode({ data }: NodeProps) {
  const node = data.node as AppFlowNode;
  const count = data.count as number;
  const graph = useGraphContext();
  const title = nodeTitle(node);
  const screenshot = node.capture?.screenshot;
  return <><div className="flex h-full flex-col overflow-hidden">
    {screenshot ? <Screenshot projectId={graph.projectId} path={screenshot} title={title} panel={graph.panel} />
      : <div className="flex flex-1 items-center justify-center bg-muted/40 px-3 text-[10px] text-muted-foreground">No capture of the screen itself</div>}
    <div className="shrink-0 space-y-0.5 px-3 py-2">
      <div className="truncate text-[12px] font-medium">{title}</div>
      <div className="truncate text-[10px] text-muted-foreground">{count} UI state{count === 1 ? "" : "s"}{node.urlPath ? ` · ${node.urlPath}` : ""}</div>
    </div>
  </div><Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-slate-400" /></>;
}

function UiStateNode({ data }: NodeProps) {
  const state = data.state as AppFlowUiState;
  const graph = useGraphContext();
  const origin = state.openedBy ? OPENED_BY[state.openedBy] : undefined;
  return <><Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-slate-400" />
    <div className="flex h-full flex-col overflow-hidden">
      {state.screenshot
        ? <Screenshot projectId={graph.projectId} path={state.screenshot} title={state.name} panel={graph.panel} />
        // A variant the pass found in source and could not open keeps its card, with the reason on
        // it: dropping it would make a partly failed pass look like a smaller app.
        : <div className="flex flex-1 flex-col items-center justify-center gap-1 bg-muted/40 px-3 text-center text-[10px] leading-snug text-amber-600">
          <span aria-hidden className="text-sm">!</span><span>{state.error ?? "Not captured"}</span></div>}
      <div className="shrink-0 space-y-0.5 px-2.5 py-2">
        <div className="truncate text-[11px] font-medium" title={state.name}>{state.name}</div>
        <div className="truncate text-[9px] text-muted-foreground" title={`${state.file}:${state.line}`}>{state.file}:{state.line}</div>
        {origin && <div className="truncate text-[9px] text-muted-foreground" title={origin}>{origin}</div>}
      </div>
    </div></>;
}
const nodeTypes = { "ui-state-screen": ScreenParentNode, "ui-state": UiStateNode };

export function AppFlowUiStatesGraph({ nodes, projectPath, projectId, panel }: Props) {
  const renderStartedAt = performance.now();
  const topology = useMemo(() => { const startedAt = performance.now(); const value = layoutUiStates(nodes);
    recordUiTiming("ui.app_flow.ui_states_graph_process", performance.now() - startedAt); return value; }, [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Only the screens this canvas actually draws: jumping to a screen with no states would scroll
  // to a node that is not here.
  const screens = useMemo(() => screenOptions(nodes.filter(hasUiStates)), [nodes]);
  const states = useMemo(() => uiStateOptions(nodes), [nodes]);
  const flowNodes = useMemo<Node[]>(() => topology.placements.map(placement => {
    const childCount = placement.kind === "screen" ? topology.edges.filter(edge => edge.source === placement.id).length : 0;
    return { id: placement.id, type: placement.kind === "screen" ? "ui-state-screen" : "ui-state", position: placement.position,
      data: { node: placement.node, state: placement.state, count: childCount },
      style: { width: placement.kind === "screen" ? NODE_WIDTH : UI_STATE_NODE_WIDTH, height: UI_STATE_NODE_HEIGHT, padding: 0,
        background: "var(--background)", color: "var(--foreground)", borderRadius: 8,
        border: placement.id === selectedId ? "2px solid var(--foreground)" : "1px solid var(--border)" } };
  }), [topology, selectedId]);
  const flowEdges = useMemo<Edge[]>(() => topology.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
    style: { stroke: "#9ca3af", strokeWidth: edge.target === selectedId || edge.source === selectedId ? 2 : 1, opacity: selectedId === null ? 0.5 : edge.target === selectedId || edge.source === selectedId ? 1 : 0.15 } })), [topology, selectedId]);
  useEffect(() => { recordUiTiming("ui.app_flow.ui_states_graph_render", performance.now() - renderStartedAt); }, [flowNodes, flowEdges]);
  // How many state cards this canvas draws, one plain number per node-set change. Rows only: no
  // route, node, component or file identity is attached anywhere on this series.
  useEffect(() => { setUiGauge("ui.app_flow.ui_state_nodes", uiStateCount(nodes)); }, [nodes]);
  if (topology.placements.length === 0) {
    return <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 p-6 text-center">
      <h3 className="text-base font-medium">No UI states captured</h3>
      <p className="max-w-md text-sm text-muted-foreground">Turn on “Capture UI states” before a sweep and this map fills with each screen’s sheets, modals and dialogs.</p></div>;
  }
  return <GraphContext.Provider value={{ panel, projectPath: projectPath ?? null, projectId }}><div className="relative h-full min-h-80 w-full">
    <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} onNodeClick={(_, node) => setSelectedId(current => current === node.id ? null : node.id)}
      onPaneClick={() => setSelectedId(null)} fitView fitViewOptions={FIT_VIEW_OPTIONS} colorMode="system">
      <GraphFocusPanel screens={screens} uiStates={states} uiStateFocusId={option => option.id} onPick={pick => setSelectedId(pick.kind === "screen" ? pick.id : pick.option.id)} />
      <Controls fitViewOptions={FIT_VIEW_OPTIONS} /><Background gap={16} size={1} />
    </ReactFlow>
  </div></GraphContext.Provider>;
}
