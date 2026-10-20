/**
 * The pieces both App Flow graphs are built from: the context that carries the panel into a node,
 * the screenshot loader, and the pickers that jump the viewport to a screen or a UI state.
 *
 * These lived in `app-flow-graph.tsx` while there was one graph. The UI-states graph needs the
 * same node chrome and the same pickers, and importing them from the flow graph would have made
 * the two modules circular.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { countUiEvent } from "../telemetry.ts";
import type { ScreenOption, UiStateOption } from "./app-flow-layout.ts";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";

export type GraphContextValue = { panel: AppFlowPanel; projectPath: string | null; projectId: string };
export const GraphContext = createContext<GraphContextValue | null>(null);
export function useGraphContext(): GraphContextValue {
  const value = useContext(GraphContext);
  if (!value) throw new Error("A graph node rendered outside its GraphContext.");
  return value;
}

export function Screenshot({ projectId, path, title, panel, className = "min-h-0 flex-1 bg-black/10 object-contain", fallback }: { projectId: string; path: string; title: string; panel: AppFlowPanel; className?: string; fallback?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { setSrc(""); let active = true; void panel.screenshot(projectId, path).then(url => { if (active) setSrc(url); }, () => {}); return () => { active = false; }; }, [panel, projectId, path]);
  return src ? <img src={src} alt={title} className={className} />
    : fallback !== undefined ? <div className={`${className} flex items-center justify-center bg-muted/40 text-[8px] text-muted-foreground`}>{fallback}</div>
      : <div className="flex flex-1 items-center justify-center bg-muted/40 text-[10px] text-muted-foreground">Loading capture…</div>;
}

/** How tightly a jump frames its target. Looser than the mount fit, which frames the whole graph. */
const FOCUS_VIEW_OPTIONS = { duration: 400, padding: 0.35, minZoom: 0.4, maxZoom: 1 };

export type FocusPick = { kind: "screen"; id: string } | { kind: "ui-state"; option: UiStateOption };

/**
 * The two jump pickers, drawn over the canvas.
 *
 * It must render *inside* `<ReactFlow>`: that is what puts it in React Flow's provider, so
 * `useReactFlow` resolves without wrapping the whole panel in a `ReactFlowProvider`.
 *
 * Which node a UI state jumps to differs per graph — its own card in the UI-states graph, the
 * screen that opened it in the flow graph, where it is a thumbnail rather than a node — so the
 * caller supplies that mapping and whatever selection it wants to make alongside the jump.
 */
export function GraphFocusPanel({ screens, uiStates, uiStateFocusId, onPick }: {
  screens: ScreenOption[]; uiStates: UiStateOption[];
  uiStateFocusId: (option: UiStateOption) => string;
  onPick?: (pick: FocusPick) => void;
}) {
  const flow = useReactFlow();
  const [screenId, setScreenId] = useState("");
  const [uiStateId, setUiStateId] = useState("");
  const jump = (id: string): boolean => {
    if (!flow.getNode(id)) return false;
    void flow.fitView({ nodes: [{ id }], ...FOCUS_VIEW_OPTIONS });
    return true;
  };
  if (screens.length === 0 && uiStates.length === 0) return null;
  return <Panel position="top-right" className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background/90 p-1.5 text-xs shadow-sm backdrop-blur">
    {screens.length > 0 && <label className="flex items-center gap-1">Screen
      <NativeSelect size="sm" aria-label="Jump to screen" value={screenId} onChange={event => {
        const id = event.target.value; setScreenId(id); setUiStateId("");
        if (!id || !jump(id)) return;
        // One plain count. No route, node or file identity rides on it — see the gauge in the graph.
        countUiEvent("ui.app_flow.focus_screen");
        onPick?.({ kind: "screen", id });
      }}>
        <NativeSelectOption value="">Jump to…</NativeSelectOption>
        {screens.map(option => <NativeSelectOption key={option.id} value={option.id}>{option.label}</NativeSelectOption>)}
      </NativeSelect></label>}
    {uiStates.length > 0 && <label className="flex items-center gap-1">UI state
      <NativeSelect size="sm" aria-label="Jump to UI state" value={uiStateId} onChange={event => {
        const id = event.target.value; setUiStateId(id); setScreenId("");
        const option = uiStates.find(entry => entry.id === id);
        if (!option || !jump(uiStateFocusId(option))) return;
        countUiEvent("ui.app_flow.focus_ui_state");
        onPick?.({ kind: "ui-state", option });
      }}>
        <NativeSelectOption value="">Jump to…</NativeSelectOption>
        {uiStates.map(option => <NativeSelectOption key={option.id} value={option.id}>{option.captured ? option.label : `${option.label} (not captured)`}</NativeSelectOption>)}
      </NativeSelect></label>}
  </Panel>;
}
