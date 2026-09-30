import { TerminalIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { LogsPanel } from "../logs-panel.ts";
import { SimulatorView } from "./simulator-view";
import { LogsView } from "./logs-view";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Toggle } from "./ui/toggle";

import { usePanelRef, useGroupRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { useMediaQuery } from "./use-media-query";

export type DeviceLayout = "both" | "ios" | "android" | "none";

export function Workspace({ logs, onLayout }: { logs: LogsPanel; onLayout: (layout: DeviceLayout) => void }) {
  const [layout, setLayout] = useState<DeviceLayout>("both");
  const wide = useMediaQuery("(min-width: 900px)");
  const split = wide && document.documentElement.dataset.view === "workspace";
  const logState = useSyncExternalStore(logs.subscribe, logs.getSnapshot);
  const logsRef = usePanelRef();
  const simulatorGroupRef = useGroupRef();
  const workspaceGroupRef = useGroupRef();
  useEffect(() => { if (logState.open) logsRef.current?.expand(); else logsRef.current?.collapse(); }, [logState.open, split, layout]);
  useEffect(() => {
    if (layout !== "none") simulatorGroupRef.current?.setLayout({ "ios-resizable": layout === "android" || layout === "none" ? 0 : layout === "both" ? 50 : 100, "android-resizable": layout === "ios" || layout === "none" ? 0 : layout === "both" ? 50 : 100 });
    workspaceGroupRef.current?.setLayout({ "tools-resizable": layout === "none" ? 100 : split ? 33 : 40, "simulators-resizable": layout === "none" ? 0 : split ? 67 : 60 });
    if (!logs.getSnapshot().open) logsRef.current?.collapse();
  }, [layout, split]);
  const toolPanel = <ResizablePanel key="tools" id="tools-resizable" panelRef={logsRef} defaultSize={split ? "33%" : "40%"} minSize={split ? "240px" : "25%"} maxSize="100%" collapsible collapsedSize={split ? "48px" : "44px"} onResize={(size, _id, previous) => {
    if (!previous) return;
    if (size.inPixels <= (split ? 49 : 45) && logs.getSnapshot().open) logs.toggle();
    else if (size.inPixels > 80 && !logs.getSnapshot().open) logs.show();
  }}><LogsView panel={logs} /></ResizablePanel>;
  const simulatorPanel = <ResizablePanel key="simulators" id="simulators-resizable" minSize="0%" maxSize="100%" collapsible collapsedSize="0px" defaultSize={split ? "67%" : "60%"}>
    <ResizablePanelGroup id="simulator-panels" groupRef={simulatorGroupRef} orientation="horizontal" aria-label="Simulators">
      <ResizablePanel id="ios-resizable" defaultSize="50%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="ios" /></ResizablePanel>
      <ResizableHandle hidden={layout !== "both"} disabled={layout !== "both"} aria-label="Resize iOS and Android simulators" />
      <ResizablePanel id="android-resizable" defaultSize="50%" minSize="0px" maxSize="100%" collapsible collapsedSize="0px"><SimulatorView platform="android" /></ResizablePanel>
    </ResizablePanelGroup>
  </ResizablePanel>;
  const divider = <ResizableHandle key="divider" hidden={layout === "none"} disabled={layout === "none"} aria-label="Resize logs and simulators" />;
  return <main className="flex h-dvh flex-col">
    <nav className="workspace-toolbar flex h-12 shrink-0 items-center gap-3 border-y px-4 max-[600px]:gap-1.5 max-[600px]:px-3" aria-label="Developer tools">
      <div className="mr-auto flex items-center gap-2" role="group" aria-label="Developer tool panels">
        <Toggle id="tool-logs" size="sm" pressed={logState.open} aria-controls="logs-drawer" aria-label="Show logs" onPressedChange={() => logs.toggle()} className="gap-2"><TerminalIcon />Logs</Toggle>
      </div>
      <ToggleGroup id="device-layout" size="sm" type="multiple" value={layout === "both" ? ["ios", "android"] : layout === "none" ? [] : [layout]} onValueChange={values => {
        const next: DeviceLayout = !values.length ? "none" : values.length === 2 ? "both" : values[0] === "ios" ? "ios" : "android";
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
