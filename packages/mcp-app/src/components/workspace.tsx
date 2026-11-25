import { ActivityIcon, DatabaseIcon, GitForkIcon, TerminalIcon, PanelsTopLeftIcon, ChartNoAxesCombinedIcon, FlaskConicalIcon, NetworkIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ToolName, WorkspaceTools } from "@mobile-dev/ui/workspace-tools.ts";
import { PerformanceView } from "@mobile-dev/ui/components/performance-view.tsx";
import { DevicePanes } from "@mobile-dev/ui/components/device-panes.tsx";
import { DevicePicker, EmptyDeviceTabBar } from "@mobile-dev/ui/components/device-picker.tsx";
import { LogsView } from "@mobile-dev/ui/components/logs-view.tsx";
import { StorageView } from "@mobile-dev/ui/components/storage-view.tsx";
import { TraceSiftView } from "@mobile-dev/ui/components/tracesift-view.tsx";
import { AppIntelligenceView } from "@mobile-dev/ui/components/app-intelligence-view.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@mobile-dev/ui/components/ui/base-select.tsx";
import { Button } from "@mobile-dev/ui/components/ui/button.tsx";

import { usePanelRef, useGroupRef, type Layout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mobile-dev/ui/components/ui/resizable.tsx";
import { useMediaQuery } from "@mobile-dev/ui/components/use-media-query.ts";
import { setUiSurface, setUiTelemetryContext } from "@mobile-dev/ui/telemetry.ts";
import type { RecordingController } from "@mobile-dev/ui/recording-controller.ts";
import { RecordingCard } from "@mobile-dev/ui/components/recording-card.tsx";
import { AppFlowView } from "@mobile-dev/ui/components/app-flow-view.tsx";
import { TestingView } from "@mobile-dev/ui/components/testing-view.tsx";

import type { DeviceWorkspace } from "@mobile-dev/ui/device-workspace.ts";

// Menu item IDs stay literal so tests and the package smoke check can find them in the bundle.
const tools = {
  logs: { id: "tool-logs", label: "Logs", icon: TerminalIcon },
  performance: { id: "tool-performance", label: "Performance", icon: ActivityIcon },
  storage: { id: "tool-storage", label: "Storage", icon: DatabaseIcon },
  "app-intel": { id: "tool-app-intel", label: "App Intel", icon: NetworkIcon },
  tracesift: { id: "tool-tracesift", label: "TraceSift", icon: ChartNoAxesCombinedIcon },
  "app-flow": { id: "tool-app-flow", label: "App Flow", icon: GitForkIcon },
  testing: { id: "tool-testing", label: "Testing Studio", icon: FlaskConicalIcon },
};
type Tool = keyof typeof tools;
const isTool = (value: string): value is Tool => value in tools;

export function Workspace({ panels, recordingController, banner, displayModeControl, contextControl, automaticTool, automaticToolRevision = 0, devices }: { panels: WorkspaceTools; recordingController: RecordingController; banner?: ReactNode; displayModeControl?: ReactNode; contextControl?: ReactNode; automaticTool?: ToolName; automaticToolRevision?: number; devices: DeviceWorkspace }) {
  const { logs, performance, storage, tracesift } = panels;
  const appIntel = panels["app-intel"];
  const appFlow = panels["app-flow"];
  const testing = panels.testing;
  const [tool, setTool] = useState<Tool>("logs");
  const [savedVisible, setSavedVisible] = useState(false);
  const [simulatorsCollapsed, setSimulatorsCollapsed] = useState(false);
  const deviceState = useSyncExternalStore(devices.subscribe, devices.getSnapshot);
  const recordingState = useSyncExternalStore(recordingController.subscribe, recordingController.getSnapshot);
  useEffect(() => {
    if (recordingState.recording === undefined) return;
    setTool("performance");
    setSavedVisible(true);
    devices.clear();
    panels.hide();
  }, [recordingState.recording?.id]);
  // An agent recording opens the Testing Studio tab for the user: they asked their agent for a test, and
  // the steps appearing one at a time are the whole point. Which tool is on screen is this
  // component's own state, so the panel asks rather than reaches.
  useEffect(() => testing.onAgentRecordingStarted(() => {
    setTool("testing");
    setSavedVisible(false);
    panels.show("testing");
  }), [testing]);
  const performanceState = useSyncExternalStore(performance.subscribe, performance.getSnapshot);
  const wide = useMediaQuery("(min-width: 900px)");
  const fullscreen = document.documentElement.dataset.view === "workspace";
  const split = wide && fullscreen;
  const collapsedToolSize = fullscreen ? (split ? 48 : 44) : 0;
  const logState = useSyncExternalStore(logs.subscribe, logs.getSnapshot);
  const storageState = useSyncExternalStore(storage.subscribe, storage.getSnapshot);
  const traceSiftState = useSyncExternalStore(tracesift.subscribe, tracesift.getSnapshot);
  const appIntelState = useSyncExternalStore(appIntel.subscribe, appIntel.getSnapshot);
  const appFlowState = useSyncExternalStore(appFlow.subscribe, appFlow.getSnapshot);
  const testingState = useSyncExternalStore(testing.subscribe, testing.getSnapshot);
  // A saved recording shows in the performance tool, so it counts as that tool being open.
  const open = { logs: logState.open, performance: savedVisible || performanceState.open, storage: storageState.open, "app-intel": appIntelState.open, tracesift: traceSiftState.open, "app-flow": appFlowState.open, testing: testingState.open }[tool];
  useEffect(() => { setUiSurface(open ? savedVisible ? "recording" : tool : "simulator"); }, [tool, open, savedVisible]);
  useEffect(() => {
    setUiTelemetryContext({ logs_open: logState.open, logs_paused: logState.paused, performance_running: performanceState.monitoring || performanceState.fpsMonitoring });
  }, [logState.open, logState.paused, performanceState.monitoring, performanceState.fpsMonitoring]);
  const testingOpen = tool === "testing" && open === true;
  /**
   * The Testing Studio panel is read as three panes side by side — mirror, preview, steps — so it asks
   * for a horizontal workspace of its own rather than inheriting `split`.
   *
   * `split` is `wide && fullscreen`, and outside the fullscreen workspace it is false: the group
   * was then vertical, the mirror kept the 60% default meant for a tool stacked under it, and the
   * Testing Studio panel's own two panes were left with 40% of the height between them. Recording is done
   * by tapping the mirror and read back beside it, which only works as a row — so wherever there
   * is width for a row, that is what this panel gets.
   */
  const testingSplit = testingOpen && wide;
  const sideBySide = split || testingSplit;
  const isOpen = () => (tool === "performance" && savedVisible) || panels.panel(tool).getSnapshot().open;
  const closeTools = () => {
    setSavedVisible(false);
    panels.close();
  };
  const showTool = (next: Tool) => {
    if (next === tool && isOpen()) { closeTools(); return; }
    setTool(next);
    setSavedVisible(false);
    panels.show(next);
  };
  useEffect(() => { if (automaticTool) { setTool(automaticTool); setSavedVisible(false); panels.show(automaticTool); } }, [automaticTool, automaticToolRevision]);
  const logsRef = usePanelRef();
  const simulatorsRef = usePanelRef();
  const showDevices = deviceState.panes.length > 0 || !!deviceState.message || !open;
  const deviceShare = testingOpen ? 25 : split ? Math.min(80, 36 * Math.max(1, deviceState.visible.length)) : 60;
  const workspaceGroupRef = useGroupRef();
  const resizedLayout = useRef<Layout>(undefined);
  useEffect(() => { if (open) logsRef.current?.expand(); else logsRef.current?.collapse(); }, [open, split]);
  useEffect(() => {
    // Hidden hosts defer group initialization until the page becomes measurable.
    const container = document.getElementById("workspace-panels")!;
    let pending = true;
    resizedLayout.current = undefined;
    const applyLayout = () => {
      if (!container.clientWidth || !container.clientHeight) { pending = true; return; }
      if (!pending) return;
      const workspace = workspaceGroupRef.current;
      if (!workspace) return;
      const current = workspace.getLayout();
      if (Object.keys(current).length === 0) return;
      pending = false;
      const share = showDevices ? deviceShare : 0;
      workspace.setLayout(resizedLayout.current ?? { "tools-resizable": 100 - share, "simulators-resizable": share });
      if (showDevices) simulatorsRef.current?.expand();
      else simulatorsRef.current?.collapse();
      if (isOpen() === false) logsRef.current?.collapse();
    };
    const observer = new ResizeObserver(applyLayout);
    observer.observe(container);
    applyLayout();
    // Testing Studio changes the panel constraints during layout. Reapply the split once they settle.
    const frame = requestAnimationFrame(() => { pending = true; applyLayout(); });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [showDevices, sideBySide, testingOpen, tool, deviceShare]);
  const bottomToolbarClosed = !fullscreen && !open;
  const toolPanel = <ResizablePanel key="tools" id="tools-resizable" panelRef={logsRef} defaultSize={testingOpen ? "75%" : split ? "64%" : "40%"} minSize={bottomToolbarClosed ? "0px" : sideBySide ? "240px" : "25%"} maxSize={bottomToolbarClosed ? "0px" : "100%"} collapsible collapsedSize={`${collapsedToolSize}px`}>{tool === "logs" && <LogsView panel={logs} />}{tool === "storage" && <StorageView panel={storage} />}{tool === "app-intel" && <AppIntelligenceView panel={appIntel} />}{tool === "testing" && open && <TestingView panel={testing} deviceApps={panels.deviceApps} />}{tool === "tracesift" && <TraceSiftView panel={tracesift} />}{tool === "app-flow" && open && <AppFlowView panel={appFlow} />}{tool === "performance" && open && (savedVisible ? <div className="recording-workspace"><Button variant="outline" size="sm" onClick={() => { setSavedVisible(false); performance.show(); }}>Live performance</Button><RecordingCard controller={recordingController} detailed /></div> : <PerformanceView panel={performance} />)}</ResizablePanel>;
  const bottomToolbar = !fullscreen;
  const menuSide = bottomToolbar ? "top" : "bottom";
  const ToolIcon = tools[tool].icon;
  const toolbar = <nav className={`workspace-toolbar @container flex h-12 shrink-0 items-center justify-between gap-2 px-2 ${bottomToolbar ? "order-last border-t" : "border-y"}`} aria-label="Developer tools">
    {displayModeControl}
    <Select items={[{ value: "none", label: "Tools" }, ...Object.entries(tools).map(([value, { label }]) => ({ value, label }))]} value={open ? tool : "none"} onValueChange={value => {
      if (value === "none") closeTools();
      else if (value && isTool(value)) showTool(value);
    }}>
      <SelectTrigger id="tool-select" size="sm" className="shrink-0" aria-label="Developer tools"><SelectValue>{open ? <ToolIcon /> : <PanelsTopLeftIcon />}<span className="@max-[600px]:sr-only">{open ? tools[tool].label : "Tools"}</span></SelectValue></SelectTrigger>
      <SelectContent side={menuSide} align="start" alignItemWithTrigger={false} className="w-max min-w-(--anchor-width) max-w-(--available-width)"><SelectGroup>
        <SelectItem id="tool-none" value="none">Hide tools</SelectItem>
        {Object.entries(tools).map(([value, { id, label, icon: Icon }]) => <SelectItem key={value} id={id} value={value}><Icon />{label}</SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
  </nav>;
  const simulatorPanel = <ResizablePanel key="simulators" id="simulators-resizable" panelRef={simulatorsRef} minSize="0%" maxSize="100%" collapsible collapsedSize="0px" defaultSize={testingOpen ? "25%" : split ? "36%" : "60%"} onResize={size => setSimulatorsCollapsed(size.inPixels < 1)}>
    <DevicePanes workspace={devices} />
  </ResizablePanel>;
  // A collapsed simulator area would put the handle's line against the toolbar's border, doubling it.
  // The handle stays draggable so the simulators can be pulled back open.
  const divider = <ResizableHandle key="divider" hidden={!showDevices || (!fullscreen && !open)} disabled={!showDevices || (!fullscreen && !open)} className={simulatorsCollapsed ? "bg-transparent" : undefined} aria-label="Resize tools and simulators" />;
  return <DevicePicker workspace={devices}><main className="flex flex-col" style={{ height: "var(--workspace-height, 100dvh)", paddingBottom: "var(--workspace-bottom-inset, 0px)" }}>
    {banner}
    {contextControl}
    {toolbar}
    {deviceState.panes.length === 0 && <EmptyDeviceTabBar />}
    <ResizablePanelGroup id="workspace-panels" groupRef={workspaceGroupRef} orientation={sideBySide ? "horizontal" : "vertical"} className="min-h-0 flex-1" data-split={sideBySide} onLayoutChanged={(layout, meta) => {
      if (!meta.isUserInteraction) return;
      resizedLayout.current = meta.requestedLayout ?? layout;
      const collapsed = logsRef.current?.isCollapsed();
      if (collapsed && isOpen()) closeTools();
      else if (collapsed === false && !isOpen()) showTool(tool);
    }}>
      {sideBySide && !testingOpen ? [toolPanel, divider, simulatorPanel] : [simulatorPanel, divider, toolPanel]}
    </ResizablePanelGroup>
  </main></DevicePicker>;
}
