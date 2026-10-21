/**
 * The pieces both App Flow graphs are built from: the context that carries the panel into a node,
 * the screenshot loader, and the pickers that jump the viewport to a screen or a UI state.
 *
 * These lived in `app-flow-graph.tsx` while there was one graph. The UI-states graph needs the
 * same node chrome and the same pickers, and importing them from the flow graph would have made
 * the two modules circular.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { countUiEvent } from "../telemetry.ts";
import type { ScreenOption, UiStateOption } from "./app-flow-layout.ts";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

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
/** One entry a jump picker can offer: what to show, and what the jump resolves to. */
export type JumpItem = { id: string; label: string; captured: boolean };

/**
 * The jump picker: a trigger that turns into a search box over the list it would have dropped down.
 *
 * A plain select was fine while a flow held a dozen screens. On a real app the list runs to
 * hundreds, every one of them a route name that reads like its neighbours, and picking from it
 * meant scrolling a menu with no way to say which one you meant. Opening into an input is the
 * cheapest fix that keeps the control in the same place and the same size.
 *
 * Deliberately not a combobox: the input filters, it never accepts free text as a value. Enter
 * takes the first match, which is what a one-of-N search does, and a match the list does not hold
 * is simply no match. That keeps the picker's output a node id — the only thing a jump can use.
 */
export function JumpPicker({ label, placeholder, items, value, emptyLabel, onPick }: {
  label: string; placeholder: string; items: JumpItem[]; value: string; emptyLabel: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter(item => item.label.toLowerCase().includes(needle)) : items;
  }, [items, query]);
  const selected = items.find(item => item.id === value);
  const choose = (id: string) => { setOpen(false); setQuery(""); onPick(id); };
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" aria-label={label} className="w-full min-w-0 justify-start font-normal">
        <span className="truncate">{selected ? selected.label : placeholder}</span></Button>
    </PopoverTrigger>
    <PopoverContent align="end" aria-label={label} className="w-64 max-w-[calc(100vw-16px)] p-1.5"
      onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
      <Input ref={input} className="h-8 text-xs" aria-label={`${label} search`} placeholder="Search routes…" value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          // Enter is "take the obvious one": with a filter applied there is usually exactly one
          // left, and reaching for the mouse to confirm a search that already narrowed to it is
          // the step this picker exists to remove.
          if (event.key === "Enter" && matches[0]) { event.preventDefault(); choose(matches[0].id); }
          if (event.key === "Escape") setOpen(false);
        }} />
      <div className="mt-1.5 max-h-64 overflow-y-auto" role="listbox" aria-label={`${label} options`}>
        {matches.length === 0 ? <div className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyLabel}</div>
          : matches.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === value}
            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent ${item.id === value ? "bg-accent" : ""}`}
            onClick={() => choose(item.id)}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.captured ? "bg-emerald-400" : "bg-slate-500"}`} />
            <span className="truncate">{item.label}</span></button>)}
      </div>
    </PopoverContent>
  </Popover>;
}

export function GraphFocusPanel({ view, viewOptions, onViewChange, screens, uiStates, uiStateFocusId, onPick }: {
  view: GraphView; viewOptions: GraphViewOption[]; onViewChange: (view: GraphView) => void;
  screens: ScreenOption[]; uiStates: UiStateOption[];
  uiStateFocusId: (option: UiStateOption) => string;
  onPick?: (pick: FocusPick) => void;
}) {
  const flow = useReactFlow();
  const [screenId, setScreenId] = useState("");
  const [uiStateId, setUiStateId] = useState("");
  /* One filter for both pickers rather than one each: it answers the same question on either
     canvas ("only the things that actually have a frame"), and the canvas picker above already
     decides which list is on screen, so a per-canvas filter would be a second switch for the same
     intent. A screen with no screenshot is still *in* the graph — this hides it from the jump
     list, it does not hide the node. */
  const [capturedOnly, setCapturedOnly] = useState(false);
  const jump = (id: string): boolean => {
    if (!flow.getNode(id)) return false;
    void flow.fitView({ nodes: [{ id }], ...FOCUS_VIEW_OPTIONS });
    return true;
  };
  const screenItems = useMemo(
    () => screens.filter(option => !capturedOnly || option.captured).map(option => ({ id: option.id, label: option.label, captured: option.captured })),
    [screens, capturedOnly]
  );
  const uiStateItems = useMemo(
    () => uiStates.filter(option => !capturedOnly || option.captured)
      .map(option => ({ id: option.id, label: option.captured ? option.label : `${option.label} (not captured)`, captured: option.captured })),
    [uiStates, capturedOnly]
  );
  const hasList = view === "flow" ? screens.length > 0 : uiStates.length > 0;
  return <Panel position="top-right" className="flex w-44 flex-col items-stretch gap-1.5 rounded-lg border bg-background/90 p-1.5 text-xs shadow-sm backdrop-blur">
    <GraphViewSelect view={view} viewOptions={viewOptions} onViewChange={onViewChange} />
    {view === "flow" && screens.length > 0 && <JumpPicker label="Jump to screen" placeholder="Jump to…" value={screenId}
      items={screenItems} emptyLabel={capturedOnly ? "No captured screens match" : "No screens match"}
      onPick={id => {
        setScreenId(id); setUiStateId("");
        if (!jump(id)) return;
        // One plain count. No route, node or file identity rides on it — see the gauge in the graph.
        countUiEvent("ui.app_flow.focus_screen");
        onPick?.({ kind: "screen", id });
      }} />}
    {view === "ui-states" && uiStates.length > 0 && <JumpPicker label="Jump to UI state" placeholder="Jump to…" value={uiStateId}
      items={uiStateItems} emptyLabel={capturedOnly ? "No captured UI states match" : "No UI states match"}
      onPick={id => {
        setUiStateId(id); setScreenId("");
        const option = uiStates.find(entry => entry.id === id);
        if (!option || !jump(uiStateFocusId(option))) return;
        countUiEvent("ui.app_flow.focus_ui_state");
        onPick?.({ kind: "ui-state", option });
      }} />}
    {/* A pressed toggle rather than a switch: it sits inside a canvas overlay that is already two
        controls tall, and it filters a list rather than changing what a run will do. */}
    {hasList && <button type="button" aria-label="Show captured routes only" aria-pressed={capturedOnly}
      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${capturedOnly ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300" : "border-border text-muted-foreground"}`}
      onClick={() => {
        const next = !capturedOnly;
        setCapturedOnly(next);
        /* A selection the filter just hid would leave the trigger naming a route the list no longer
           offers. The jump already happened and the viewport stays where it is; only the picker's
           own label is cleared. */
        if (!next) return;
        if (!screens.find(option => option.id === screenId)?.captured) setScreenId("");
        if (!uiStates.find(option => option.id === uiStateId)?.captured) setUiStateId("");
      }}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${capturedOnly ? "bg-emerald-400" : "bg-slate-500"}`} />Captured only</button>}
  </Panel>;
}
