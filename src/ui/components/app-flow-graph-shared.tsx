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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select.tsx";

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
 * Themed compact dropdown (base-select) used by every App Flow choice — the header toolbar and the
 * pickers over the canvas — so an open list matches the panel theme instead of the OS menu.
 */
export function ToolbarSelect<T extends string>({ label, value, items, disabled, describedBy, className, onChange }: { label: string; value: T; items: { value: T; label: string }[]; disabled?: boolean; describedBy?: string; className?: string; onChange: (value: T) => void }) {
  return <Select items={items} value={value} disabled={disabled} onValueChange={next => { if (next !== null) onChange(next as T); }}>
    <SelectTrigger size="sm" aria-label={label} aria-describedby={describedBy} className={`min-w-0 ${className ?? ""}`}><SelectValue /></SelectTrigger>
    <SelectContent align="start" alignItemWithTrigger={false} className="w-max min-w-(--anchor-width) max-w-(--available-width)"><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}

/** Which canvas the App Flow body draws. Lives here because both graphs and the view host share it. */
export type GraphView = "flow" | "ui-states";
export type GraphViewOption = { value: GraphView; label: string };

/** The canvas picker. Standalone so the UI-states graph can offer a way back out of its empty state. */
export function GraphViewSelect({ view, viewOptions, onViewChange }: { view: GraphView; viewOptions: GraphViewOption[]; onViewChange: (view: GraphView) => void }) {
  return <ToolbarSelect label="App Flow view" value={view} items={viewOptions} className="w-full" onChange={onViewChange} />;
}

/**
 * The canvas picker and, beneath it, the jump picker that belongs to the chosen canvas: screens on
 * the flow graph, UI states on the UI-states graph. Drawn over the canvas as one column.
 *
 * It must render *inside* `<ReactFlow>`: that is what puts it in React Flow's provider, so
 * `useReactFlow` resolves without wrapping the whole panel in a `ReactFlowProvider`.
 *
 * Which node a UI state jumps to differs per graph — its own card in the UI-states graph, the
 * screen that opened it in the flow graph, where it is a thumbnail rather than a node — so the
 * caller supplies that mapping and whatever selection it wants to make alongside the jump.
 */
export function GraphFocusPanel({ view, viewOptions, onViewChange, screens, uiStates, uiStateFocusId, onPick }: {
  view: GraphView; viewOptions: GraphViewOption[]; onViewChange: (view: GraphView) => void;
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
  return <Panel position="top-right" className="flex w-44 flex-col items-stretch gap-1.5 rounded-lg border bg-background/90 p-1.5 text-xs shadow-sm backdrop-blur">
    <GraphViewSelect view={view} viewOptions={viewOptions} onViewChange={onViewChange} />
    {view === "flow" && screens.length > 0 && <ToolbarSelect label="Jump to screen" value={screenId} className="w-full"
      items={[{ value: "", label: "Jump to…" }, ...screens.map(option => ({ value: option.id, label: option.label }))]}
      onChange={id => {
        setScreenId(id); setUiStateId("");
        if (!id || !jump(id)) return;
        // One plain count. No route, node or file identity rides on it — see the gauge in the graph.
        countUiEvent("ui.app_flow.focus_screen");
        onPick?.({ kind: "screen", id });
      }} />}
    {view === "ui-states" && uiStates.length > 0 && <ToolbarSelect label="Jump to UI state" value={uiStateId} className="w-full"
      items={[{ value: "", label: "Jump to…" }, ...uiStates.map(option => ({ value: option.id, label: option.captured ? option.label : `${option.label} (not captured)` }))]}
      onChange={id => {
        setUiStateId(id); setScreenId("");
        const option = uiStates.find(entry => entry.id === id);
        if (!option || !jump(uiStateFocusId(option))) return;
        countUiEvent("ui.app_flow.focus_ui_state");
        onPick?.({ kind: "ui-state", option });
      }} />}
  </Panel>;
}
