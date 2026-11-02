import { useEffect } from "react";
import { useGroupRef } from "react-resizable-panels";
import type { ToolName, WorkspaceTools } from "@mobile-dev/ui/workspace-tools.ts";
import type { DeviceLayout } from "@mobile-dev/ui/device-layout.ts";
import { LogsView } from "@mobile-dev/ui/components/logs-view.tsx";
import { PerformanceView } from "@mobile-dev/ui/components/performance-view.tsx";
import { SimulatorView } from "@mobile-dev/ui/components/simulator-view.tsx";
import { StorageView } from "@mobile-dev/ui/components/storage-view.tsx";
import { TraceSiftView } from "@mobile-dev/ui/components/tracesift-view.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@mobile-dev/ui/components/ui/resizable.tsx";


/**
 * The Mac app's content area. The native sidebar chooses the tool and the visible
 * platforms, so this view has no toolbar of its own: a tool on the left, the
 * device panels on the right. Both device panels stay mounted, because their
 * controllers attach to the DOM once.
 */
export function MacWorkspace({ panels, tool, layout }: { panels: WorkspaceTools; tool?: ToolName; layout: DeviceLayout }) {
  const workspaceGroup = useGroupRef();
  const deviceGroup = useGroupRef();
  useEffect(() => {
    const devices = layout === "none" ? 0 : tool === undefined ? 100 : 40;
    workspaceGroup.current?.setLayout({ "mac-tools": 100 - devices, "mac-devices": devices });
    if (layout !== "none") deviceGroup.current?.setLayout({ "mac-ios": layout === "android" ? 0 : layout === "both" ? 50 : 100, "mac-android": layout === "ios" ? 0 : layout === "both" ? 50 : 100 });
  }, [tool, layout]);
  const leading = tool !== undefined ? "tool" : layout === "android" ? "android" : "ios";
  const leadingClass = (panel: string) => panel === leading ? "mac-leading h-full" : "h-full";
  const toolView = tool === "logs" ? <LogsView panel={panels.logs} />
    : tool === "performance" ? <PerformanceView panel={panels.performance} />
    : tool === "storage" ? <StorageView panel={panels.storage} />
    : tool === "tracesift" ? <TraceSiftView panel={panels.tracesift} />
    : <EmptyTool layout={layout} />;
  return <main className="flex h-dvh flex-col">
    <ResizablePanelGroup id="mac-workspace" groupRef={workspaceGroup} orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel id="mac-tools" defaultSize="60%" minSize="0px" collapsible collapsedSize="0px"><div className={leadingClass("tool")}>{toolView}</div></ResizablePanel>
      <ResizableHandle hidden={layout === "none" || tool === undefined} aria-label="Resize tool and devices" />
      <ResizablePanel id="mac-devices" defaultSize="40%" minSize="0px" collapsible collapsedSize="0px">
        <ResizablePanelGroup id="mac-device-panels" groupRef={deviceGroup} orientation="horizontal" className="h-full" aria-label="Devices">
          <ResizablePanel id="mac-ios" defaultSize="100%" minSize="0px" collapsible collapsedSize="0px"><div className={leadingClass("ios")}><SimulatorView platform="ios" visible={layout === "ios" || layout === "both"} /></div></ResizablePanel>
          <ResizableHandle hidden={layout !== "both"} disabled={layout !== "both"} aria-label="Resize iOS and Android devices" />
          <ResizablePanel id="mac-android" defaultSize="0%" minSize="0px" collapsible collapsedSize="0px"><div className={leadingClass("android")}><SimulatorView platform="android" visible={layout === "android" || layout === "both"} /></div></ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  </main>;
}

function EmptyTool({ layout }: { layout: DeviceLayout }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
    {layout === "none" ? "Choose a device platform or a tool in the sidebar." : "Choose a tool in the sidebar."}
  </div>;
}
