import { useEffect, useSyncExternalStore } from "react";
import { useGroupRef } from "react-resizable-panels";
import type { ToolName, WorkspaceTools } from "@mobile-dev/ui/workspace-tools.ts";
import type { DeviceWorkspace } from "@mobile-dev/ui/device-workspace.ts";
import { LogsView } from "@mobile-dev/ui/components/logs-view.tsx";
import { PerformanceView } from "@mobile-dev/ui/components/performance-view.tsx";
import { DevicePicker, EmptyDeviceTabBar } from "@mobile-dev/ui/components/device-picker.tsx";
import { DevicePanes } from "@mobile-dev/ui/components/device-panes.tsx";
import { StorageView } from "@mobile-dev/ui/components/storage-view.tsx";
import { TraceSiftView } from "@mobile-dev/ui/components/tracesift-view.tsx";
import { AppIntelligenceView } from "@mobile-dev/ui/components/app-intelligence-view.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mobile-dev/ui/components/ui/resizable.tsx";

export function MacWorkspace({ panels, tool, devices }: { panels: WorkspaceTools; tool?: ToolName; devices: DeviceWorkspace }) {
  const workspaceGroup = useGroupRef();
  const state = useSyncExternalStore(devices.subscribe, devices.getSnapshot);
  const hasDevices = state.panes.length > 0;
  const size = tool === undefined ? 100 : Math.min(80, state.visible.length * 40);
  useEffect(() => {
    workspaceGroup.current?.setLayout({ "mac-tools": 100 - size, "mac-devices": size });
  }, [size]);
  const toolView = tool === "logs" ? <LogsView panel={panels.logs} />
    : tool === "performance" ? <PerformanceView panel={panels.performance} />
    : tool === "storage" ? <StorageView panel={panels.storage} />
    : tool === "app-intel" ? <AppIntelligenceView panel={panels["app-intel"]} />
    : tool === "tracesift" ? <TraceSiftView panel={panels.tracesift} /> : null;
  return <DevicePicker workspace={devices}><main className="mac-workspace flex h-dvh flex-col">
    {!hasDevices && <EmptyDeviceTabBar />}
    <ResizablePanelGroup id="mac-workspace" groupRef={workspaceGroup} orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel id="mac-tools" defaultSize="60%" minSize="0px" collapsible collapsedSize="0px">{toolView}</ResizablePanel>
      <ResizableHandle hidden={!hasDevices || tool === undefined} aria-label="Resize tool and devices" />
      <ResizablePanel id="mac-devices" defaultSize="40%" minSize="0px" collapsible collapsedSize="0px"><DevicePanes workspace={devices} /></ResizablePanel>
    </ResizablePanelGroup>
  </main></DevicePicker>;
}
