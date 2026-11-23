import { DockviewReact, DockviewDefaultTab, type DockviewApi, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type DockviewTheme } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { PanelsLeftRightIcon } from "lucide-react";
import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DeviceWorkspace } from "../device-workspace";
import { AddDeviceButton } from "./device-picker";
import { SimulatorView } from "./simulator-view";

const WorkspaceContext = createContext<DeviceWorkspace | null>(null);
const theme: DockviewTheme = { name: "Mobile Dev", className: "dockview-theme-light device-dock", gap: 1 };

function DeviceScreen({ api }: IDockviewPanelProps) {
  const workspace = useContext(WorkspaceContext)!;
  const { panes, active } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const key = Number(api.id);
  const pane = panes.find(item => item.key === key);
  if (!pane) return null;
  return <SimulatorView workspace={workspace} paneKey={key} deviceId={pane.device?.udid} platform={pane.platform} name={pane.last.name} active={active === key} />;
}

function DeviceTab(props: IDockviewPanelHeaderProps) {
  const workspace = useContext(WorkspaceContext)!;
  const key = Number(props.api.id);
  const close = () => workspace.remove(key);
  return <DockviewDefaultTab {...props} title="Drag to group or split the view" closeActionOverride={close} />;
}

function GroupActions({ group }: IDockviewHeaderActionsProps) {
  function reference() {
    const panel = group.activePanel;
    if (panel) return Number(panel.id);
  }
  return <div className="flex h-full items-center"><AddDeviceButton reference={reference} /></div>;
}

const components = { device: DeviceScreen };

function DeviceDock({ workspace }: { workspace: DeviceWorkspace }) {
  const [dock, setDock] = useState<DockviewApi>();
  const container = useRef<HTMLDivElement>(null);
  const { panes, active } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);

  useLayoutEffect(() => {
    if (!dock) return;
    let pending = false;
    let disposed = false;
    // Moving a tab can momentarily empty its old group. Publish the settled layout
    // so a screen that stays visible keeps its decoder and input session.
    const scheduleSelection = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (disposed || !dock.activePanel) return;
        if (container.current) {
          container.current.style.minWidth = `${dock.minimumWidth}px`;
          container.current.style.minHeight = `${dock.minimumHeight}px`;
        }
        const visible: number[] = [];
        for (const group of dock.groups) {
          if (!group.activePanel) continue;
          const key = Number(group.activePanel.id);
          visible.push(key);
        }
        const active = Number(dock.activePanel.id);
        workspace.setDockSelection(visible, active);
      });
    };
    const selection = dock.onDidActivePanelChange(scheduleSelection);
    const layout = dock.onDidLayoutChange(scheduleSelection);
    return () => {
      disposed = true;
      selection.dispose();
      layout.dispose();
    };
  }, [dock, workspace]);

  useLayoutEffect(() => {
    if (!dock) return;
    const ids = new Set<string>();
    for (const pane of panes) {
      const id = String(pane.key);
      ids.add(id);
    }
    for (const panel of dock.panels) {
      if (!ids.has(panel.id)) dock.removePanel(panel);
    }
    for (const pane of panes) {
      const id = String(pane.key);
      const panel = dock.getPanel(id);
      if (panel) {
        if (panel.title !== pane.last.name) panel.api.setTitle(pane.last.name);
        continue;
      }
      const beside = String(pane.beside);
      const referencePanel = dock.getPanel(beside);
      const position = referencePanel ? { referencePanel, direction: "right" as const } : undefined;
      dock.addPanel({ id, component: "device", title: pane.last.name, minimumWidth: 220, minimumHeight: 180, position });
    }
  }, [dock, panes]);

  useLayoutEffect(() => {
    if (!dock || active === undefined) return;
    const id = String(active);
    if (dock.activePanel?.id !== id) dock.getPanel(id)?.api.setActive();
  }, [dock, active]);

  return <WorkspaceContext.Provider value={workspace}>
    <DockviewReact ref={container} components={components} defaultTabComponent={DeviceTab} leftHeaderActionsComponent={GroupActions} theme={theme} defaultRenderer="always"
      disableFloatingGroups dndStrategy="pointer" onReady={({ api }) => setDock(api)} />
  </WorkspaceContext.Provider>;
}

export function DevicePanes({ workspace }: { workspace: DeviceWorkspace }) {
  const { panes, message } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  return <div id="simulator-panels" className="h-full min-h-0 overflow-auto">
    {panes.length > 0 ? <DeviceDock workspace={workspace} /> : <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-sm text-muted-foreground" role="status">
      <PanelsLeftRightIcon className="size-6" /><p>{message || "Choose devices to see their screens."}</p>
    </div>}
  </div>;
}
