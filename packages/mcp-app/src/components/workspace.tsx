import { ActivityIcon, DatabaseIcon, TerminalIcon, PanelsTopLeftIcon, ChartNoAxesCombinedIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { toolNames, type ToolName, type WorkspaceTools } from "@mobile-dev/ui/workspace-tools.ts";
import { PerformanceView } from "@mobile-dev/ui/components/performance-view.tsx";
import { SimulatorView } from "@mobile-dev/ui/components/simulator-view.tsx";
import { LogsView } from "@mobile-dev/ui/components/logs-view.tsx";
import { StorageView } from "@mobile-dev/ui/components/storage-view.tsx";
import { TraceSiftView } from "@mobile-dev/ui/components/tracesift-view.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@mobile-dev/ui/components/ui/base-select.tsx";
import { OptionSelect, type SelectOption } from "@mobile-dev/ui/components/ui/option-select.tsx";
import { Button } from "@mobile-dev/ui/components/ui/button.tsx";

import { usePanelRef, useGroupRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mobile-dev/ui/components/ui/resizable.tsx";
import { useMediaQuery } from "@mobile-dev/ui/components/use-media-query.ts";
import { setUiSurface, setUiTelemetryContext } from "@mobile-dev/ui/telemetry.ts";
import type { RecordingController } from "@mobile-dev/ui/recording-controller.ts";
import type { SimulatorPanel } from "@mobile-dev/ui/simulator-panel.ts";
import { RecordingCard } from "@mobile-dev/ui/components/recording-card.tsx";

import type { DeviceLayout } from "@mobile-dev/ui/device-layout.ts";
export type { DeviceLayout } from "@mobile-dev/ui/device-layout.ts";

// Menu item IDs stay literal so tests and the package smoke check can find them in the bundle.
const tools: Record<ToolName, { id: string; label: string; icon: LucideIcon }> = {
  logs: { id: "tool-logs", label: "Logs", icon: TerminalIcon },
  performance: { id: "tool-performance", label: "Performance", icon: ActivityIcon },
  storage: { id: "tool-storage", label: "Storage", icon: DatabaseIcon },
  tracesift: { id: "tool-tracesift", label: "TraceSift", icon: ChartNoAxesCombinedIcon },
};
const toolOptions: SelectOption<ToolName | "none">[] = [{ value: "none", label: "Hide tools", id: "tool-none" }, ...toolNames.map(name => ({ value: name, label: tools[name].label, id: tools[name].id }))];

/** `fullscreen` is the workspace page that fills the host, rather than the panel beside the chat. */
export function Workspace({ panels, devices: [ios, android], recordingController, banner, displayModeControl, contextControl, fullscreen }: { panels: WorkspaceTools; devices: readonly [SimulatorPanel, SimulatorPanel]; recordingController: RecordingController; banner?: ReactNode; displayModeControl?: ReactNode; contextControl?: ReactNode; fullscreen: boolean }) {
  const { logs, performance, storage, tracesift } = panels;
  const { layout, tool, open, savedRecordingVisible } = useSyncExternalStore(panels.subscribe, panels.getSnapshot);
  const [simulatorsCollapsed, setSimulatorsCollapsed] = useState(false);
  const recordingId = useSyncExternalStore(recordingController.subscribe, () => recordingController.getSnapshot().recording?.id);
  useEffect(() => { if (recordingId !== undefined) panels.showSavedRecording(); }, [panels, recordingId]);
  const performanceState = useSyncExternalStore(performance.subscribe, performance.getSnapshot);
  const wide = useMediaQuery("(min-width: 900px)");
  const split = wide && fullscreen;
  const collapsedToolSize = fullscreen ? (split ? 48 : 44) : 0;
  const logState = useSyncExternalStore(logs.subscribe, logs.getSnapshot);
  useEffect(() => { setUiSurface(open ? savedRecordingVisible ? "recording" : tool : "simulator"); }, [tool, open, savedRecordingVisible]);
  useEffect(() => {
    setUiTelemetryContext({ logs_open: logState.open, logs_paused: logState.paused, performance_running: performanceState.running });
  }, [logState.open, logState.paused, performanceState.running]);
  const logsRef = usePanelRef();
  const simulatorGroupRef = useGroupRef();
  const workspaceGroupRef = useGroupRef();
  useEffect(() => { if (open) logsRef.current?.expand(); else logsRef.current?.collapse(); }, [logsRef, open, split, layout]);
  // Sizes reset when the layout or tool changes, not when a tool opens or closes.
  useEffect(() => {
    if (layout !== "none") simulatorGroupRef.current?.setLayout({ "ios-resizable": layout === "android" ? 0 : layout === "both" ? 50 : 100, "android-resizable": layout === "ios" ? 0 : layout === "both" ? 50 : 100 });
    workspaceGroupRef.current?.setLayout({ "tools-resizable": layout === "none" ? 100 : split ? 64 : 40, "simulators-resizable": layout === "none" ? 0 : split ? 36 : 60 });
    if (panels.getSnapshot().open === false) logsRef.current?.collapse();
  }, [panels, logsRef, simulatorGroupRef, workspaceGroupRef, layout, split, tool]);
  const toolPanel = <ResizablePanel key="tools" id="tools-resizable" panelRef={logsRef} defaultSize={split ? "64%" : "40%"} minSize={split ? "240px" : "25%"} maxSize="100%" collapsible collapsedSize={`${collapsedToolSize}px`} onResize={(size, _id, previous) => {
    if (!previous) return;
    const current = panels.getSnapshot();
    if (size.inPixels <= collapsedToolSize + 1 && current.open) panels.close();
    else if (size.inPixels > 80 && current.open === false) panels.show(current.tool);
  }}>{tool === "logs" && <LogsView panel={logs} fullscreen={fullscreen} />}{tool === "storage" && <StorageView panel={storage} />}{tool === "tracesift" && <TraceSiftView panel={tracesift} />}{tool === "performance" && open && (savedRecordingVisible ? <div className="recording-workspace"><Button variant="outline" size="sm" onClick={() => panels.showLivePerformance()}>Live performance</Button><RecordingCard controller={recordingController} detailed /></div> : <PerformanceView panel={performance} />)}</ResizablePanel>;
  // The sidebar keeps these controls under its simulators. Fullscreen, or no visible
  // platform, moves them above the tools.
  const bottomToolbar = !fullscreen && layout !== "none";
  const menuSide = bottomToolbar ? "top" : "bottom";
  const ToolIcon = tools[tool].icon;
  const toolbar = <nav className={`workspace-toolbar @container flex h-12 shrink-0 items-center justify-between gap-2 px-2 ${bottomToolbar ? "border-t" : "border-y"}`} aria-label="Developer tools">
    {displayModeControl}
    <OptionSelect id="tool-select" size="sm" className="shrink-0" aria-label="Developer tools" side={menuSide} items={toolOptions} value={open ? tool : "none"} onChange={value => {
      if (value === "none") panels.close();
      else panels.toggle(value);
    }} renderItem={item => { const Icon = item.value === "none" ? undefined : tools[item.value].icon; return <>{Icon && <Icon />}{item.label}</>; }}>
      <SelectValue>{open ? <ToolIcon /> : <PanelsTopLeftIcon />}<span className="@max-[600px]:sr-only">{open ? tools[tool].label : "Tools"}</span></SelectValue>
    </OptionSelect>
    <Select multiple items={[{ value: "ios", label: "iOS" }, { value: "android", label: "Android" }]} value={layout === "both" ? ["ios", "android"] : layout === "none" ? [] : [layout]} onValueChange={values => {
      const next: DeviceLayout = values.length === 0 ? "none" : values.length === 2 ? "both" : values[0] === "ios" ? "ios" : "android";
      panels.setLayout(next, { manual: true });
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
        <ResizablePanel id="ios-resizable" defaultSize="100%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView panel={ios} visible={layout === "ios" || layout === "both"} fullscreen={fullscreen} /></ResizablePanel>
        <ResizableHandle hidden={layout !== "both"} disabled={layout !== "both"} aria-label="Resize iOS and Android simulators" />
        <ResizablePanel id="android-resizable" defaultSize="0%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView panel={android} visible={layout === "android" || layout === "both"} fullscreen={fullscreen} /></ResizablePanel>
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
    <ResizablePanelGroup id="workspace-panels" groupRef={workspaceGroupRef} orientation={split ? "horizontal" : "vertical"} className="min-h-0 flex-1" data-split={split}>
      {split ? [toolPanel, divider, simulatorPanel] : [simulatorPanel, divider, toolPanel]}
    </ResizablePanelGroup>
  </main>;
}
