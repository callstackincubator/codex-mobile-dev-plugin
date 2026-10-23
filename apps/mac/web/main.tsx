import "@fontsource-variable/inter";
import "@mobile-dev/ui/theme.css";
import "@mobile-dev/ui/style.css";
import "./mac.css";
import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { DeviceLayout } from "@mobile-dev/ui/device-layout.ts";
import { DeviceAppsStore } from "@mobile-dev/ui/device-apps.ts";
import { DeviceWorkspace } from "@mobile-dev/ui/device-workspace.ts";
import { LogsPanel } from "@mobile-dev/ui/logs-panel.ts";
import { PanelContext } from "@mobile-dev/ui/model-context.ts";
import { PerformancePanel } from "@mobile-dev/ui/performance-panel.ts";
import { StoragePanel } from "@mobile-dev/ui/storage-panel.ts";
import { TraceSiftPanel } from "@mobile-dev/ui/tracesift-panel.ts";
import { ErrorBoundary, captureUiError, markUiSurfaceReady, setUiSurface, startUiTelemetry, stopUiTelemetry } from "@mobile-dev/ui/telemetry.ts";
import { MacHostBridge, postToShell } from "./mac-bridge.ts";
import { MacWorkspace, type MacPanels, type MacTool } from "./mac-workspace.tsx";

const tools = ["logs", "performance", "storage", "tracesift"] as const;
const layouts = ["ios", "android", "both", "none"] as const;
const isTool = (value: unknown): value is MacTool => tools.includes(value as MacTool);
const isLayout = (value: unknown): value is DeviceLayout => layouts.includes(value as DeviceLayout);

const bridge = new MacHostBridge();
startUiTelemetry(bridge);
const panelContext = new PanelContext(bridge);
const deviceApps = new DeviceAppsStore(bridge, document);
const panels: MacPanels = {
  logs: new LogsPanel(bridge, panelContext, deviceApps),
  performance: new PerformancePanel(bridge, deviceApps),
  storage: new StoragePanel(bridge, deviceApps),
  tracesift: new TraceSiftPanel(bridge),
};
let tool: MacTool | undefined;
let layout: DeviceLayout = "none";
const reactRoot = createRoot(document.getElementById("root")!);
function render() {
  reactRoot.render(<ErrorBoundary fallback={<p role="alert">Mobile Dev could not render. Reload the window to try again.</p>}>
    <MacWorkspace panels={panels} tool={tool} layout={layout} />
  </ErrorBoundary>);
}
flushSync(render);

const devices = new DeviceWorkspace(bridge, panelContext, deviceApps, {
  onAutomaticLayout: next => {
    layout = next;
    render();
    postToShell({ type: "layout", layout: next });
  },
  connectionFailed,
});
panels.logs.setLayout(true);
devices.changeLayout("none");

function connectionFailed(error: unknown) {
  captureUiError(error, "host.connect");
  const message = error instanceof Error ? error.message : "Could not connect to the Mobile Dev server.";
  devices.notice(message);
  postToShell({ type: "error", message });
}

function selectTool(next: MacTool | undefined) {
  if (next === tool) return;
  const startedAt = performance.now();
  for (const name of tools) {
    if (name === next) continue;
    if (next === undefined && name === "logs") { if (panels.logs.getSnapshot().open) panels.logs.toggle(); }
    else panels[name].hide();
  }
  if (tool === "performance" && next !== "performance") void panels.performance.disconnect();
  tool = next;
  setUiSurface(next ?? "simulator");
  if (next) panels[next].show();
  render();
  markUiSurfaceReady(startedAt);
}

function selectLayout(next: DeviceLayout) {
  if (next === layout) return;
  layout = next;
  devices.changeLayout(next, true);
  render();
}

declare global {
  interface Window {
    /** The native sidebar drives the content area through these calls. */
    mobileDevShell?: { selectTool(tool: string | null): void; selectLayout(layout: string): void; setTitlebarInset(width: number, height: number): void };
  }
}
window.mobileDevShell = {
  selectTool: value => selectTool(isTool(value) ? value : undefined),
  selectLayout: value => { if (isLayout(value)) selectLayout(value); },
  setTitlebarInset: (width, height) => {
    document.documentElement.style.setProperty("--mac-titlebar-inset", `${Math.max(0, width)}px`);
    document.documentElement.style.setProperty("--mac-titlebar-height", `${Math.max(0, height)}px`);
  },
};

const dark = window.matchMedia("(prefers-color-scheme: dark)");
function hostChanged() {
  applyDocumentTheme(dark.matches ? "dark" : "light");
  document.documentElement.style.setProperty("--font-sans", '"Inter Variable", sans-serif');
  panelContext.hostChanged();
  panels.tracesift.hostChanged();
  panelContext.resume();
  devices.refit();
}
dark.addEventListener("change", hostChanged);
hostChanged();

window.addEventListener("pagehide", () => {
  devices.dispose();
  deviceApps.dispose();
  panels.storage.dispose();
  panels.tracesift.dispose();
  void Promise.allSettled([panels.logs.dispose(), panels.performance.dispose(), bridge.close(), stopUiTelemetry()]);
});

void (async () => {
  try {
    await bridge.connect();
    for (const panel of [panels.logs, panels.performance, panels.storage, panels.tracesift, deviceApps]) panel.setAvailable(true);
    await devices.setAvailable(true);
    postToShell({ type: "ready" });
    // Codex opens the panel through a tool call that names a target. The app has
    // none, so the panels restore or pick devices and choose the layout themselves
    // unless the sidebar changes it first.
    await devices.open({});
  } catch (error) {
    connectionFailed(error);
  }
})();
