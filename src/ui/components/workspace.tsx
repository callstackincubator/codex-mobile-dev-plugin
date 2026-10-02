import { ActivityIcon, TerminalIcon, PanelsTopLeftIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LogsPanel } from "../logs-panel.ts";
import type { PerformancePanel } from "../performance-panel.ts";
import { PerformanceView } from "./performance-view";
import { SimulatorView } from "./simulator-view";
import { LogsView } from "./logs-view";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";
import { Button } from "./ui/button";

import { usePanelRef, useGroupRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { useMediaQuery } from "./use-media-query";
import { markUiSurfaceReady, setUiSurface, setUiTelemetryContext } from "../telemetry.ts";
import type { RecordingController } from "../recording-controller.ts";
import { RecordingCard } from "./recording-card";

export type DeviceLayout = "both" | "ios" | "android" | "none";

export function Workspace({ logs, performance, recordingController, onLayout }: { logs: LogsPanel; performance: PerformancePanel; recordingController: RecordingController; onLayout: (layout: DeviceLayout) => void }) {
  const [tool, setTool] = useState<"logs" | "performance">("logs");
  const [savedVisible, setSavedVisible] = useState(false);
  const [layout, setLayout] = useState<DeviceLayout>("ios");
  const recordingState = useSyncExternalStore(recordingController.subscribe, recordingController.getSnapshot);
  useEffect(() => {
    if (recordingState.recording === undefined) return;
    setTool("performance");
    setSavedVisible(true);
    setLayout("none");
    onLayout("none");
    logs.hide();
    performance.hide();
  }, [recordingState.recording?.id]);
  const performanceState = useSyncExternalStore(performance.subscribe, performance.getSnapshot);
  const wide = useMediaQuery("(min-width: 900px)");
  const fullscreen = document.documentElement.dataset.view === "workspace";
  const split = wide && fullscreen;
  const collapsedToolSize = fullscreen ? (split ? 48 : 44) : 0;
  const logState = useSyncExternalStore(logs.subscribe, logs.getSnapshot);
  const open = tool === "logs" ? logState.open : savedVisible || performanceState.open;
  useEffect(() => { setUiSurface(open ? savedVisible ? "recording" : tool : "simulator"); }, [tool, open, savedVisible]);
  useEffect(() => {
    setUiTelemetryContext({ logs_open: logState.open, logs_paused: logState.paused, performance_running: performanceState.monitoring || performanceState.fpsMonitoring });
  }, [logState.open, logState.paused, performanceState.monitoring, performanceState.fpsMonitoring]);
  const isOpen = () => tool === "logs" ? logs.getSnapshot().open : savedVisible || performance.getSnapshot().open;
  const closeTools = () => {
    setSavedVisible(false);
    if (logs.getSnapshot().open) logs.toggle();
    performance.hide();
    void performance.disconnect();
  };
  const showTool = (next: "logs" | "performance") => {
    const startedAt = globalThis.performance.now();
    if (next === tool && isOpen()) { closeTools(); return; }
    setUiSurface(next);
    setTool(next);
    setSavedVisible(false);
    if (next === "logs") { performance.hide(); logs.show(); }
    else { logs.hide(); performance.show(); }
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
  }}>{tool === "logs" && <LogsView panel={logs} />}{tool === "performance" && open && (savedVisible ? <div className="recording-workspace"><Button variant="outline" size="sm" onClick={() => { setSavedVisible(false); performance.show(); }}>Live performance</Button><RecordingCard controller={recordingController} detailed /></div> : <PerformanceView panel={performance} />)}</ResizablePanel>;
  const toolbar = <>
    <Select items={[{ value: "none", label: "Tools" }, { value: "logs", label: "Logs" }, { value: "performance", label: "Performance" }]} value={open ? tool : "none"} onValueChange={value => {
      if (value === "none") closeTools();
      else if (value === "logs" || value === "performance") showTool(value);
    }}>
      <SelectTrigger id="tool-select" size="sm" className="shrink-0" aria-label="Developer tools"><SelectValue>{open ? tool === "logs" ? <TerminalIcon /> : <ActivityIcon /> : <PanelsTopLeftIcon />}<span className="@max-[600px]:sr-only">{open ? tool === "logs" ? "Logs" : "Performance" : "Tools"}</span></SelectValue></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}><SelectGroup>
        <SelectItem id="tool-none" value="none">Hide tools</SelectItem>
        <SelectItem id="tool-logs" value="logs"><TerminalIcon />Logs</SelectItem>
        <SelectItem id="tool-performance" value="performance"><ActivityIcon />Performance</SelectItem>
      </SelectGroup></SelectContent>
    </Select>
    <Select multiple items={[{ value: "ios", label: "iOS" }, { value: "android", label: "Android" }]} value={layout === "both" ? ["ios", "android"] : layout === "none" ? [] : [layout]} onValueChange={values => {
      const next: DeviceLayout = values.length === 0 ? "none" : values.length === 2 ? "both" : values[0] === "ios" ? "ios" : "android";
      setLayout(next); onLayout(next);
    }}>
      <SelectTrigger id="platform-select" size="sm" className={fullscreen || layout === "none" ? "ml-auto shrink-0" : "shrink-0"} aria-label="Visible platforms"><SelectValue>{layout === "both" ? "Both" : layout === "none" ? "Platforms" : layout === "ios" ? "iOS" : "Android"}</SelectValue></SelectTrigger>
      <SelectContent align={fullscreen || layout === "none" ? "end" : "start"} alignItemWithTrigger={false}><SelectGroup>
        <SelectItem id="platform-ios" value="ios">iOS</SelectItem>
        <SelectItem id="platform-android" value="android">Android</SelectItem>
      </SelectGroup></SelectContent>
    </Select>
  </>;
  const simulatorPanel = <ResizablePanel key="simulators" id="simulators-resizable" minSize="0%" maxSize="100%" collapsible collapsedSize="0px" defaultSize={split ? "36%" : "60%"}>
    <ResizablePanelGroup id="simulator-panels" groupRef={simulatorGroupRef} orientation="horizontal" aria-label="Simulators">
      <ResizablePanel id="ios-resizable" defaultSize="100%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="ios" toolbar={!fullscreen && (layout === "ios" || layout === "both") ? toolbar : undefined} /></ResizablePanel>
      <ResizableHandle hidden={layout !== "both"} disabled={layout !== "both"} aria-label="Resize iOS and Android simulators" />
      <ResizablePanel id="android-resizable" defaultSize="0%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="android" toolbar={!fullscreen && layout === "android" ? toolbar : undefined} /></ResizablePanel>
    </ResizablePanelGroup>
  </ResizablePanel>;
  const divider = <ResizableHandle key="divider" hidden={layout === "none" || (!fullscreen && !open)} disabled={layout === "none" || (!fullscreen && !open)} aria-label="Resize tools and simulators" />;
  return <main className="flex h-dvh flex-col">
    {(fullscreen || layout === "none") && <nav className="workspace-toolbar @container flex h-12 shrink-0 items-center gap-2 border-y px-2" aria-label="Developer tools">{toolbar}</nav>}
    <ResizablePanelGroup id="workspace-panels" groupRef={workspaceGroupRef} orientation={split ? "horizontal" : "vertical"} className="min-h-0 flex-1" data-split={split}>
      {split ? [toolPanel, divider, simulatorPanel] : [simulatorPanel, divider, toolPanel]}
    </ResizablePanelGroup>
  </main>;
}
