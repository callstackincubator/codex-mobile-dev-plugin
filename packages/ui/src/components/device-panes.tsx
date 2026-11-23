import { Fragment, useSyncExternalStore } from "react";
import { PanelsLeftRightIcon } from "lucide-react";
import type { DeviceWorkspace } from "../device-workspace";
import { SimulatorView } from "./simulator-view";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";

export function DevicePanes({ workspace }: { workspace: DeviceWorkspace }) {
  const { panes, active, message } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const multiple = panes.length > 1;
  return <div id="simulator-panels" className="group/devices h-full min-h-0 overflow-x-auto" data-multiple={multiple}>
    {panes.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-sm text-muted-foreground" role="status">
      <PanelsLeftRightIcon className="size-6" /><p>{message || "Choose devices to see their screens."}</p>
    </div> : <ResizablePanelGroup orientation="horizontal" aria-label="Device screens" style={{ minWidth: multiple ? panes.length * 240 : undefined }}>
      {panes.map((pane, index) => <Fragment key={pane.key}>
        {index > 0 && <ResizableHandle aria-label={`Resize ${pane.last.name} pane`} />}
        <ResizablePanel id={`device-pane-${pane.key}`} minSize={multiple ? "220px" : "0px"}>
          <SimulatorView workspace={workspace} paneKey={pane.key} platform={pane.platform} name={pane.last.name} active={active === pane.key} />
        </ResizablePanel>
      </Fragment>)}
    </ResizablePanelGroup>}
  </div>;
}
