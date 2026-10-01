import { ActivityIcon, TerminalIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LogsPanel } from "../logs-panel.ts";
import type { PerformancePanel } from "../performance-panel.ts";
import { PerformanceView } from "./performance-view";
import { SimulatorView } from "./simulator-view";
import { LogsView } from "./logs-view";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Toggle } from "./ui/toggle";

import { usePanelRef, useGroupRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { useMediaQuery } from "./use-media-query";
import { markUiSurfaceReady, setUiSurface, setUiTelemetryContext } from "../telemetry.ts";

export type DeviceLayout = "both" | "ios" | "android" | "none";

export function Workspace({ logs, performance, onLayout }: { logs: LogsPanel; performance: PerformancePanel; onLayout: (layout: DeviceLayout) => void }) {
  const [tool, setTool] = useState<"logs" | "performance">("logs");
  const performanceState = useSyncExternalStore(performance.subscribe, performance.getSnapshot);
  const [layout, setLayout] = useState<DeviceLayout>("ios");
  const wide = useMediaQuery("(min-width: 900px)");
  const split = wide && document.documentElement.dataset.view === "workspace";
  const logState = useSyncExternalStore(logs.subscribe, logs.getSnapshot);
  const open = tool === "logs" ? logState.open : performanceState.open;
  useEffect(() => { setUiSurface(open ? tool : "simulator"); }, [tool, open]);
  useEffect(() => {
    setUiTelemetryContext({ logs_open: logState.open, logs_paused: logState.paused, performance_running: performanceState.monitoring || performanceState.fpsMonitoring });
  }, [logState.open, logState.paused, performanceState.monitoring, performanceState.fpsMonitoring]);
  const isOpen = () => tool === "logs" ? logs.getSnapshot().open : performance.getSnapshot().open;
  const closeTools = () => {
    if (logs.getSnapshot().open) logs.toggle();
    performance.hide();
    void performance.disconnect();
  };
  const showTool = (next: "logs" | "performance") => {
    const startedAt = globalThis.performance.now();
    if (next === tool && isOpen()) { closeTools(); return; }
    setTool(next);
    if (next === "logs") { performance.hide(); logs.show(); }
    else { logs.hide(); performance.show(); }
    setUiSurface(next);
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
  const toolPanel = <ResizablePanel key="tools" id="tools-resizable" panelRef={logsRef} defaultSize={split ? "64%" : "40%"} minSize={split ? "240px" : "25%"} maxSize="100%" collapsible collapsedSize={split ? "48px" : "44px"} onResize={(size, _id, previous) => {
    if (!previous) return;
    if (size.inPixels <= (split ? 49 : 45) && isOpen()) closeTools();
    else if (size.inPixels > 80 && isOpen() === false) showTool(tool);
  }}>{tool === "logs" && <LogsView panel={logs} />}{tool === "performance" && open && <PerformanceView panel={performance} />}</ResizablePanel>;
  const simulatorPanel = <ResizablePanel key="simulators" id="simulators-resizable" minSize="0%" maxSize="100%" collapsible collapsedSize="0px" defaultSize={split ? "36%" : "60%"}>
    <ResizablePanelGroup id="simulator-panels" groupRef={simulatorGroupRef} orientation="horizontal" aria-label="Simulators">
      <ResizablePanel id="ios-resizable" defaultSize="100%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="ios" /></ResizablePanel>
      <ResizableHandle hidden={layout !== "both"} disabled={layout !== "both"} aria-label="Resize iOS and Android simulators" />
      <ResizablePanel id="android-resizable" defaultSize="0%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="android" /></ResizablePanel>
    </ResizablePanelGroup>
  </ResizablePanel>;
  const divider = <ResizableHandle key="divider" hidden={layout === "none"} disabled={layout === "none"} aria-label="Resize tools and simulators" />;
  return <main className="flex h-dvh flex-col">
    <nav className="workspace-toolbar flex h-12 shrink-0 items-center gap-3 border-y px-4 max-[600px]:gap-1.5 max-[600px]:px-3" aria-label="Developer tools">
      <div className="mr-auto flex items-center gap-2" role="group" aria-label="Developer tool panels">
        <Toggle id="tool-logs" size="sm" pressed={tool === "logs" && open} aria-controls="logs-drawer" aria-label="Show logs" onPressedChange={() => showTool("logs")} className="gap-2"><TerminalIcon />Logs</Toggle>
        <Toggle id="tool-performance" size="sm" pressed={tool === "performance" && open} aria-controls="performance-drawer" aria-label="Show performance" onPressedChange={() => showTool("performance")} className="gap-2"><ActivityIcon />Performance</Toggle>
      </div>
      <ToggleGroup id="device-layout" size="sm" type="multiple" value={layout === "both" ? ["ios", "android"] : layout === "none" ? [] : [layout]} onValueChange={values => {
        const next: DeviceLayout = values.length === 0 ? "none" : values.length === 2 ? "both" : values[0] === "ios" ? "ios" : "android";
        setLayout(next); onLayout(next);
      }} aria-label="Visible platforms">
        <ToggleGroupItem value="ios" aria-label="Show iOS simulator">iOS</ToggleGroupItem>
        <ToggleGroupItem value="android" aria-label="Show Android simulator">Android</ToggleGroupItem>
      </ToggleGroup>
    </nav>
    <ResizablePanelGroup id="workspace-panels" groupRef={workspaceGroupRef} orientation={split ? "horizontal" : "vertical"} className="min-h-0 flex-1" data-split={split}>
      {split ? [toolPanel, divider, simulatorPanel] : [simulatorPanel, divider, toolPanel]}
    </ResizablePanelGroup>
  </main>;
}
