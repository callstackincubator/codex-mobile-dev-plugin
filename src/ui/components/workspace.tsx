import { ActivityIcon, DatabaseIcon, TerminalIcon, PanelsTopLeftIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { LogsPanel } from "../logs-panel.ts";
import type { PerformancePanel } from "../performance-panel.ts";
import type { StoragePanel } from "../storage-panel.ts";
import { PerformanceView } from "./performance-view";
import { SimulatorView } from "./simulator-view";
import { LogsView } from "./logs-view";
import { StorageView } from "./storage-view";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";
import { Button } from "./ui/button";

import { usePanelRef, useGroupRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { useMediaQuery } from "./use-media-query";
import { markUiSurfaceReady, setUiSurface, setUiTelemetryContext } from "../telemetry.ts";
import type { RecordingController } from "../recording-controller.ts";
import { RecordingCard } from "./recording-card";
import { PluginUpdateBanner } from "./plugin-update-banner";
import type { PluginUpdateController } from "../plugin-updates.ts";

import type { DeviceLayout } from "../device-layout.ts";
export type { DeviceLayout } from "../device-layout.ts";

// Menu item IDs stay literal so tests and the package smoke check can find them in the bundle.
const tools = {
  logs: { id: "tool-logs", label: "Logs", icon: TerminalIcon },
  performance: { id: "tool-performance", label: "Performance", icon: ActivityIcon },
  storage: { id: "tool-storage", label: "Storage", icon: DatabaseIcon },
};
type Tool = keyof typeof tools;
const isTool = (value: string): value is Tool => value in tools;

export function Workspace({ logs, performance, storage, recordingController, updates, displayModeControl, automaticLayout, onLayout }: { logs: LogsPanel; performance: PerformancePanel; storage: StoragePanel; recordingController: RecordingController; updates?: PluginUpdateController; displayModeControl?: ReactNode; automaticLayout?: DeviceLayout; onLayout: (layout: DeviceLayout, manual?: boolean) => void }) {
  const [tool, setTool] = useState<Tool>("logs");
  const [savedVisible, setSavedVisible] = useState(false);
  const [simulatorsCollapsed, setSimulatorsCollapsed] = useState(false);
  const [layout, setLayout] = useState<DeviceLayout>(automaticLayout ?? "none");
  const manualLayout = useRef(false);
  const recordingState = useSyncExternalStore(recordingController.subscribe, recordingController.getSnapshot);
  useEffect(() => {
    if (automaticLayout === undefined || manualLayout.current || recordingState.recording !== undefined) return;
    setLayout(automaticLayout);
    onLayout(automaticLayout);
  }, [automaticLayout]);
  useEffect(() => {
    if (recordingState.recording === undefined) return;
    manualLayout.current = true;
    setTool("performance");
    setSavedVisible(true);
    setLayout("none");
    onLayout("none");
    logs.hide();
    performance.hide();
    storage.hide();
  }, [recordingState.recording?.id]);
  const performanceState = useSyncExternalStore(performance.subscribe, performance.getSnapshot);
  const wide = useMediaQuery("(min-width: 900px)");
  const fullscreen = document.documentElement.dataset.view === "workspace";
  const split = wide && fullscreen;
  const collapsedToolSize = fullscreen ? (split ? 48 : 44) : 0;
  const logState = useSyncExternalStore(logs.subscribe, logs.getSnapshot);
  const storageState = useSyncExternalStore(storage.subscribe, storage.getSnapshot);
  // A saved recording shows in the performance tool, so it counts as that tool being open.
  const panels = { logs, performance, storage };
  const open = { logs: logState.open, performance: savedVisible || performanceState.open, storage: storageState.open }[tool];
  useEffect(() => { setUiSurface(open ? savedVisible ? "recording" : tool : "simulator"); }, [tool, open, savedVisible]);
  useEffect(() => {
    setUiTelemetryContext({ logs_open: logState.open, logs_paused: logState.paused, performance_running: performanceState.monitoring || performanceState.fpsMonitoring });
  }, [logState.open, logState.paused, performanceState.monitoring, performanceState.fpsMonitoring]);
  const isOpen = () => (tool === "performance" && savedVisible) || panels[tool].getSnapshot().open;
  const closeTools = () => {
    setSavedVisible(false);
    if (logs.getSnapshot().open) logs.toggle();
    performance.hide();
    storage.hide();
    void performance.disconnect();
  };
  const showTool = (next: Tool) => {
    const startedAt = globalThis.performance.now();
    if (next === tool && isOpen()) { closeTools(); return; }
    setUiSurface(next);
    setTool(next);
    setSavedVisible(false);
    for (const [name, panel] of Object.entries(panels)) if (name !== next) panel.hide();
    panels[next].show();
    markUiSurfaceReady(startedAt);
  };
  const logsRef = usePanelRef();
  const simulatorGroupRef = useGroupRef();
  const workspaceGroupRef = useGroupRef();
  useEffect(() => { if (open) logsRef.current?.expand(); else logsRef.current?.collapse(); }, [open, split, layout]);
  useEffect(() => {
    if (layout !== "none") simulatorGroupRef.current?.setLayout({ "ios-resizable": layout === "android" ? 0 : layout === "both" ? 50 : 100, "android-resizable": layout === "ios" ? 0 : layout === "both" ? 50 : 100 });
    workspaceGroupRef.current?.setLayout({ "tools-resizable": layout === "none" ? 100 : split ? 64 : 40, "simulators-resizable": layout === "none" ? 0 : split ? 36 : 60 });
    if (isOpen() === false) logsRef.current?.collapse();
  }, [layout, split, tool]);
  const toolPanel = <ResizablePanel key="tools" id="tools-resizable" panelRef={logsRef} defaultSize={split ? "64%" : "40%"} minSize={split ? "240px" : "25%"} maxSize="100%" collapsible collapsedSize={`${collapsedToolSize}px`} onResize={(size, _id, previous) => {
    if (!previous) return;
    if (size.inPixels <= collapsedToolSize + 1 && isOpen()) closeTools();
    else if (size.inPixels > 80 && isOpen() === false) showTool(tool);
  }}>{tool === "logs" && <LogsView panel={logs} />}{tool === "storage" && <StorageView panel={storage} />}{tool === "performance" && open && (savedVisible ? <div className="recording-workspace"><Button variant="outline" size="sm" onClick={() => { setSavedVisible(false); performance.show(); }}>Live performance</Button><RecordingCard controller={recordingController} detailed /></div> : <PerformanceView panel={performance} />)}</ResizablePanel>;
  // The sidebar keeps these controls under its simulators. Fullscreen, or no visible
  // platform, moves them above the tools.
  const bottomToolbar = !fullscreen && layout !== "none";
  const menuSide = bottomToolbar ? "top" : "bottom";
  const ToolIcon = tools[tool].icon;
  const toolbar = <nav className={`workspace-toolbar @container flex h-12 shrink-0 items-center justify-between gap-2 px-2 ${bottomToolbar ? "border-t" : "border-y"}`} aria-label="Developer tools">
    {displayModeControl}
    <Select items={[{ value: "none", label: "Tools" }, ...Object.entries(tools).map(([value, { label }]) => ({ value, label }))]} value={open ? tool : "none"} onValueChange={value => {
      if (value === "none") closeTools();
      else if (value && isTool(value)) showTool(value);
    }}>
      <SelectTrigger id="tool-select" size="sm" className="shrink-0" aria-label="Developer tools"><SelectValue>{open ? <ToolIcon /> : <PanelsTopLeftIcon />}<span className="@max-[600px]:sr-only">{open ? tools[tool].label : "Tools"}</span></SelectValue></SelectTrigger>
      <SelectContent side={menuSide} align="start" alignItemWithTrigger={false}><SelectGroup>
        <SelectItem id="tool-none" value="none">Hide tools</SelectItem>
        {Object.entries(tools).map(([value, { id, label, icon: Icon }]) => <SelectItem key={value} id={id} value={value}><Icon />{label}</SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
    <Select multiple items={[{ value: "ios", label: "iOS" }, { value: "android", label: "Android" }]} value={layout === "both" ? ["ios", "android"] : layout === "none" ? [] : [layout]} onValueChange={values => {
      const next: DeviceLayout = values.length === 0 ? "none" : values.length === 2 ? "both" : values[0] === "ios" ? "ios" : "android";
      manualLayout.current = true;
      setLayout(next); onLayout(next, true);
    }}>
      <SelectTrigger id="platform-select" size="sm" className="shrink-0" aria-label="Visible platforms"><SelectValue>{layout === "both" ? "Both" : layout === "none" ? "Platforms" : layout === "ios" ? "iOS" : "Android"}</SelectValue></SelectTrigger>
      <SelectContent side={menuSide} align="end" alignItemWithTrigger={false}><SelectGroup>
        <SelectItem id="platform-ios" value="ios">iOS</SelectItem>
        <SelectItem id="platform-android" value="android">Android</SelectItem>
      </SelectGroup></SelectContent>
    </Select>
  </nav>;
  const simulatorPanel = <ResizablePanel key="simulators" id="simulators-resizable" minSize="0%" maxSize="100%" collapsible collapsedSize="0px" defaultSize={split ? "36%" : "60%"} onResize={size => setSimulatorsCollapsed(size.inPixels < 1)}>
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup id="simulator-panels" groupRef={simulatorGroupRef} orientation="horizontal" className="min-h-0 flex-1" aria-label="Simulators">
        <ResizablePanel id="ios-resizable" defaultSize="100%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="ios" visible={layout === "ios" || layout === "both"} /></ResizablePanel>
        <ResizableHandle hidden={layout !== "both"} disabled={layout !== "both"} aria-label="Resize iOS and Android simulators" />
        <ResizablePanel id="android-resizable" defaultSize="0%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="android" visible={layout === "android" || layout === "both"} /></ResizablePanel>
      </ResizablePanelGroup>
      {bottomToolbar && toolbar}
    </div>
  </ResizablePanel>;
  // A collapsed simulator area would put the handle's line against the toolbar's border, doubling it.
  // The handle stays draggable so the simulators can be pulled back open.
  const divider = <ResizableHandle key="divider" hidden={layout === "none" || (!fullscreen && !open)} disabled={layout === "none" || (!fullscreen && !open)} className={simulatorsCollapsed ? "bg-transparent" : undefined} aria-label="Resize tools and simulators" />;
  return <main className="flex h-dvh flex-col">
    {updates && <PluginUpdateBanner controller={updates} />}
    {!bottomToolbar && toolbar}
    <ResizablePanelGroup id="workspace-panels" groupRef={workspaceGroupRef} orientation={split ? "horizontal" : "vertical"} className="min-h-0 flex-1" data-split={split}>
      {split ? [toolPanel, divider, simulatorPanel] : [simulatorPanel, divider, toolPanel]}
    </ResizablePanelGroup>
  </main>;
}
