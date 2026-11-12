import { ActivityIcon, DatabaseIcon, GitForkIcon, TerminalIcon, PanelsTopLeftIcon, ChartNoAxesCombinedIcon, FlaskConicalIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { WorkspaceTools } from "@mobile-dev/ui/workspace-tools.ts";
import { PerformanceView } from "@mobile-dev/ui/components/performance-view.tsx";
import { SimulatorView } from "@mobile-dev/ui/components/simulator-view.tsx";
import { LogsView } from "@mobile-dev/ui/components/logs-view.tsx";
import { StorageView } from "@mobile-dev/ui/components/storage-view.tsx";
import { TraceSiftView } from "@mobile-dev/ui/components/tracesift-view.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@mobile-dev/ui/components/ui/base-select.tsx";
import { Button } from "@mobile-dev/ui/components/ui/button.tsx";

import { usePanelRef, useGroupRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mobile-dev/ui/components/ui/resizable.tsx";
import { useMediaQuery } from "@mobile-dev/ui/components/use-media-query.ts";
import { setUiSurface, setUiTelemetryContext } from "@mobile-dev/ui/telemetry.ts";
import type { RecordingController } from "@mobile-dev/ui/recording-controller.ts";
import { RecordingCard } from "@mobile-dev/ui/components/recording-card.tsx";
import { AppFlowView } from "@mobile-dev/ui/components/app-flow-view.tsx";
import { TestingView } from "@mobile-dev/ui/components/testing-view.tsx";

import type { DeviceLayout } from "@mobile-dev/ui/device-layout.ts";
export type { DeviceLayout } from "@mobile-dev/ui/device-layout.ts";

// Menu item IDs stay literal so tests and the package smoke check can find them in the bundle.
const tools = {
  logs: { id: "tool-logs", label: "Logs", icon: TerminalIcon },
  performance: { id: "tool-performance", label: "Performance", icon: ActivityIcon },
  storage: { id: "tool-storage", label: "Storage", icon: DatabaseIcon },
  tracesift: { id: "tool-tracesift", label: "TraceSift", icon: ChartNoAxesCombinedIcon },
  "app-flow": { id: "tool-app-flow", label: "App Flow", icon: GitForkIcon },
  testing: { id: "tool-testing", label: "Testing", icon: FlaskConicalIcon },
};
type Tool = keyof typeof tools;
const isTool = (value: string): value is Tool => value in tools;

export function Workspace({ panels, recordingController, banner, displayModeControl, contextControl, automaticLayout, onLayout }: { panels: WorkspaceTools; recordingController: RecordingController; banner?: ReactNode; displayModeControl?: ReactNode; contextControl?: ReactNode; automaticLayout?: DeviceLayout; onLayout: (layout: DeviceLayout, manual?: boolean) => void }) {
  const { logs, performance, storage, tracesift } = panels;
  const appFlow = panels["app-flow"];
  const testing = panels.testing;
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
    panels.hide();
  }, [recordingState.recording?.id]);
  // An agent recording opens the Testing tab for the user: they asked their agent for a test, and
  // the steps appearing one at a time are the whole point. Which tool is on screen is this
  // component's own state, so the panel asks rather than reaches.
  useEffect(() => testing.onAgentRecordingStarted(() => {
    manualLayout.current = true;
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
  const appFlowState = useSyncExternalStore(appFlow.subscribe, appFlow.getSnapshot);
  const testingState = useSyncExternalStore(testing.subscribe, testing.getSnapshot);
  // A saved recording shows in the performance tool, so it counts as that tool being open.
  const open = { logs: logState.open, performance: savedVisible || performanceState.open, storage: storageState.open, tracesift: traceSiftState.open, "app-flow": appFlowState.open, testing: testingState.open }[tool];
  useEffect(() => { setUiSurface(open ? savedVisible ? "recording" : tool : "simulator"); }, [tool, open, savedVisible]);
  useEffect(() => {
    setUiTelemetryContext({ logs_open: logState.open, logs_paused: logState.paused, performance_running: performanceState.monitoring || performanceState.fpsMonitoring });
  }, [logState.open, logState.paused, performanceState.monitoring, performanceState.fpsMonitoring]);
  const testingOpen = tool === "testing" && open === true;
  /**
   * The Testing panel is read as three panes side by side — mirror, preview, steps — so it asks
   * for a horizontal workspace of its own rather than inheriting `split`.
   *
   * `split` is `wide && fullscreen`, and outside the fullscreen workspace it is false: the group
   * was then vertical, the mirror kept the 60% default meant for a tool stacked under it, and the
   * Testing panel's own two panes were left with 40% of the height between them. Recording is done
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
  const logsRef = usePanelRef();
  const simulatorsRef = usePanelRef();
  const simulatorGroupRef = useGroupRef();
  const workspaceGroupRef = useGroupRef();
  useEffect(() => { if (open) logsRef.current?.expand(); else logsRef.current?.collapse(); }, [open, split, layout]);
  useEffect(() => {
    let simulatorsPending = layout !== "none";
    let workspacePending = true;
    // Hidden hosts defer group initialization; retain the request until the groups are measurable.
    const applyLayout = () => {
      const simulators = simulatorGroupRef.current;
      if (simulatorsPending && simulators) {
        const current = simulators.getLayout();
        const panelIds = Object.keys(current);
        if (panelIds.length > 0) {
          simulatorsPending = false;
          simulators.setLayout({ "ios-resizable": layout === "android" ? 0 : layout === "both" ? 50 : 100, "android-resizable": layout === "ios" ? 0 : layout === "both" ? 50 : 100 });
        }
      }
      const workspace = workspaceGroupRef.current;
      if (workspacePending && workspace) {
        const current = workspace.getLayout();
        const panelIds = Object.keys(current);
        if (panelIds.length > 0) {
          workspacePending = false;
          // The Testing panel is read as three panes — mirror, preview, steps — and the preview
          // and the steps split the tools pane 60/40 of their own accord. A quarter of the
          // workspace for the mirror is what makes those 45% and 30%: the mirror is tapped, while
          // the two beside it are read, and reading a generated file needs the room.
          const toolsShare = testingOpen ? 75 : split ? 64 : 40;
          workspace.setLayout({ "tools-resizable": toolsShare, "simulators-resizable": 100 - toolsShare });
          // No visible platform is the panel being collapsed, not a share of 0. A share is the
          // group's last *requested* layout, which it re-applies whenever a panel's constraints
          // change — and the Testing panel changes them as it opens. A 0 requested while nothing
          // was bootable therefore outlived the device: discovery selected a simulator, the
          // platform selector read "iOS", and the mirror stayed shut until the user toggled the
          // platform off and on again. Collapsing says the same thing in the group's own terms,
          // so expanding it is all that finding a device has to do.
          if (layout === "none") simulatorsRef.current?.collapse();
          else simulatorsRef.current?.expand();
          if (isOpen() === false) logsRef.current?.collapse();
        }
      }
      if (simulatorsPending === false && workspacePending === false) observer.disconnect();
    };
    const observer = new ResizeObserver(applyLayout);
    observer.observe(document.getElementById("simulator-panels")!);
    observer.observe(document.getElementById("workspace-panels")!);
    applyLayout();
    // And again on the next frame, because the group re-derives its own layout from the panels'
    // defaults when their constraints change — which is what opening the Testing panel does, since
    // its mirror and its tools declare sizes of their own. Asking during the commit is asking
    // before that, so the answer was thrown away; the frame after it is when it sticks.
    const frame = requestAnimationFrame(() => { workspacePending = true; simulatorsPending = layout !== "none"; applyLayout(); });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [layout, split, sideBySide, tool, testingOpen]);
  const toolPanel = <ResizablePanel key="tools" id="tools-resizable" panelRef={logsRef} defaultSize={testingOpen ? "75%" : split ? "64%" : "40%"} minSize={sideBySide ? "240px" : "25%"} maxSize="100%" collapsible collapsedSize={`${collapsedToolSize}px`} onResize={(size, _id, previous) => {
    if (!previous) return;
    if (size.inPixels <= collapsedToolSize + 1 && isOpen()) closeTools();
    else if (size.inPixels > 80 && isOpen() === false) showTool(tool);
  }}>{tool === "logs" && <LogsView panel={logs} />}{tool === "storage" && <StorageView panel={storage} />}{tool === "tracesift" && <TraceSiftView panel={tracesift} />}{tool === "app-flow" && open && <AppFlowView panel={appFlow} />}{tool === "testing" && open && <TestingView panel={testing} deviceApps={panels.deviceApps} />}{tool === "performance" && open && (savedVisible ? <div className="recording-workspace"><Button variant="outline" size="sm" onClick={() => { setSavedVisible(false); performance.show(); }}>Live performance</Button><RecordingCard controller={recordingController} detailed /></div> : <PerformanceView panel={performance} />)}</ResizablePanel>;
  // The sidebar keeps these controls under its simulators. Fullscreen, or no visible
  // platform, moves them above the tools.
  const bottomToolbar = !fullscreen && layout !== "none";
  const menuSide = bottomToolbar ? "top" : "bottom";
  const ToolIcon = tools[tool].icon;
  // The Testing panel records by tapping the mirror and reads the test it emits beside it, so the
  // mirror leads and the preview follows it — the reading order of the thing being done. Every
  // other tool is a readout the simulator is secondary to, and keeps the simulator on the right.
  // Only side by side: stacked, "left" is the top panel, which the simulator already is.
  const mirrorFirst = testingOpen && sideBySide;
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
  const simulatorPanel = <ResizablePanel key="simulators" id="simulators-resizable" panelRef={simulatorsRef} minSize="0%" maxSize="100%" collapsible collapsedSize="0px" defaultSize={testingOpen ? "25%" : split ? "36%" : "60%"} onResize={size => setSimulatorsCollapsed(size.inPixels < 1)}>
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
  return <main className="flex flex-col" style={{ height: "var(--workspace-height, 100dvh)", paddingBottom: "var(--workspace-bottom-inset, 0px)" }}>
    {banner}
    {contextControl}
    {!bottomToolbar && toolbar}
    <ResizablePanelGroup id="workspace-panels" groupRef={workspaceGroupRef} orientation={sideBySide ? "horizontal" : "vertical"} className="min-h-0 flex-1" data-split={sideBySide}>
      {sideBySide ? (mirrorFirst ? [simulatorPanel, divider, toolPanel] : [toolPanel, divider, simulatorPanel]) : [simulatorPanel, divider, toolPanel]}
    </ResizablePanelGroup>
  </main>;
}
