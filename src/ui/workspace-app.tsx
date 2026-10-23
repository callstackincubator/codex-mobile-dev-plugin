import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import "@openai/mcp-extensions/app/styles.css";
import "@fontsource-variable/inter";
import "./theme.css";
import "./style.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Workspace } from "./components/workspace";
import type { DeviceLayout } from "./device-layout.ts";
import { panelTargetSchema } from "../shared/panel-target.ts";
import { WorkspaceDevices } from "./workspace-devices.ts";
import { PanelContext } from "./model-context.ts";
import { LogsPanel } from "./logs-panel.ts";
import { DeviceAppsStore } from "./device-apps.ts";
import { PerformancePanel } from "./performance-panel.ts";
import { StoragePanel } from "./storage-panel.ts";
import { createSimulatorPanel } from "./simulator-panel.ts";
import { startLiveReload } from "./live-reload.ts";
import { ErrorBoundary, captureUiError, startUiTelemetry, stopUiTelemetry, setUiTelemetryContext } from "./telemetry.ts";
import { PLUGIN_VERSION } from "../shared/version.ts";
import { RecordingController } from "./recording-controller.ts";
import { PluginUpdateController } from "./plugin-updates.ts";

const app = new App({ name: "mobile-dev-ui", version: PLUGIN_VERSION }, {}, { autoResize: false });
const claudeDesktop = document.documentElement.dataset.host === "claude-desktop";
startUiTelemetry(app);
const extensions = new OpenAIExtensions(app);
const panelContext = new PanelContext(app, extensions);
const deviceApps = new DeviceAppsStore(app, document);
const performancePanel = new PerformancePanel(app, deviceApps);
const logsPanel = new LogsPanel(app, panelContext, deviceApps);
const storagePanel = new StoragePanel(app, deviceApps);
const recordingController = new RecordingController(app, extensions);
const updates = new PluginUpdateController(app);
const reactRoot = createRoot(document.getElementById("root")!);
function renderWorkspace(automaticLayout?: DeviceLayout) {
  const workspace = <ErrorBoundary fallback={<p role="alert">Mobile Dev could not render. Reopen the panel to try again.</p>}>
    <Workspace performance={performancePanel} logs={logsPanel} storage={storagePanel} recordingController={recordingController} updates={updates} automaticLayout={automaticLayout} onLayout={changeLayout} />
  </ErrorBoundary>;
  reactRoot.render(workspace);
}
flushSync(() => { renderWorkspace(); });

let activePlatform: "ios" | "android" = "ios";
const panels = (["ios", "android"] as const).map(platform => {
  const root = document.getElementById(`${platform}-panel`)!;
  return createSimulatorPanel(app, root, platform, panelContext, (_device, active) => {
    if (active) activePlatform = platform;
    updateSelection();
  });
});
const [ios, android] = panels;
const workspaceDevices = new WorkspaceDevices([ios, android], layout => {
  changeLayout(layout);
  renderWorkspace(layout);
});
logsPanel.setLayout(document.documentElement.dataset.view === "workspace");
changeLayout("none");

function updateSelection() {
  const visible = panels.filter(panel => !panel.root.hidden);
  const active = visible.find(panel => panel.platform === activePlatform) ?? visible[0];
  const selected = active?.selected;
  const devicePlatform = selected ? active?.platform : undefined;
  const virtualKind = devicePlatform === "android" ? "emulator" : "simulator";
  const deviceKind = selected?.kind ?? (selected ? virtualKind : undefined);
  setUiTelemetryContext({ device_platform: devicePlatform, device_kind: deviceKind });
  panelContext.selectSimulators(visible.flatMap(panel => panel.selected ? [panel.selected] : []), selected);
  deviceApps.selectDevice(selected);
  for (const panel of panels) panel.root.dataset.active = String(panel === active);
}

function changeLayout(layout: DeviceLayout, manual = false) {
  if (manual) workspaceDevices.selectLayout();
  setUiTelemetryContext({ layout });
  if (layout === "ios" || layout === "android") activePlatform = layout;
  for (const panel of panels) {
    panel.root.hidden = layout !== "both" && layout !== panel.platform;
  }
  requestAnimationFrame(() => { for (const panel of panels) if (!panel.root.hidden) panel.fitScreen(); });
  updateSelection();
  if (manual) {
    for (const panel of panels) {
      if (panel.root.hidden === false) void panel.resume().catch(connectionFailed);
    }
  }
}

let stopLiveReload = () => {};
let disposingUI: Promise<void> | undefined;
function disposeUI() {
  return disposingUI ??= (async () => {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("focus", resumeContext);
    window.removeEventListener("pageshow", resumeContext);
    document.removeEventListener("visibilitychange", resumeContext);
    workspaceDevices.dispose();
    deviceApps.dispose();
    storagePanel.dispose();
    recordingController.dispose();
    updates.dispose();
    await Promise.allSettled([...panels.map(panel => panel.dispose()), logsPanel.dispose(), performancePanel.dispose()]);
    reactRoot.unmount();
    await stopUiTelemetry();
  })();
}
function onPageHide(event: PageTransitionEvent) { if (!event.persisted) { stopLiveReload(); void disposeUI(); } }
window.addEventListener("pagehide", onPageHide);
app.onteardown = async () => { stopLiveReload(); await disposeUI(); return {}; };

function hostContext() {
  const host = app.getHostContext();
  if (host?.theme) applyDocumentTheme(host.theme);
  if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
  document.documentElement.style.setProperty("--font-sans", '"Inter Variable", sans-serif');
  panelContext.hostChanged();
  recordingController.hostChanged();
  panelContext.resume();
  for (const panel of panels) { panel.fitScreen(); panel.controls(); }
}
function resumeContext() {
  if (document.visibilityState !== "hidden" && !disposingUI) {
    panelContext.hostChanged();
    panelContext.resume();
  }
}
window.addEventListener("focus", resumeContext);
window.addEventListener("pageshow", resumeContext);
document.addEventListener("visibilitychange", resumeContext);
function connectionFailed(error: unknown) {
  captureUiError(error, "host.connect");
  const message = error instanceof Error ? error.message : "Could not connect to Codex.";
  for (const panel of panels) panel.notice(message);
}
function openDevices(input: unknown) {
  const target = panelTargetSchema.safeParse(input);
  if (target.success === false) {
    const error = new Error("Mobile Dev received an invalid opening target.");
    connectionFailed(error);
    return;
  }
  void workspaceDevices.open(target.data).catch(connectionFailed);
}
app.ontoolinput = input => {
  if (input.arguments && "recordingId" in input.arguments) return;
  openDevices(input.arguments ?? {});
};
app.ontoolresult = result => {
  if (result.structuredContent?.recording !== undefined) {
    try { recordingController.accept(result); }
    catch (error) { captureUiError(error, "recording.workspace_result"); }
    return;
  }
  if (result.isError) {
    const message = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
    for (const panel of panels) panel.notice(message);
    return;
  }
  if (result.structuredContent && "panelTarget" in result.structuredContent) openDevices(result.structuredContent.panelTarget);
};
app.addEventListener("hostcontextchanged", hostContext);
void (async () => {
  try {
    await app.connect();
    hostContext();
    const capabilities = app.getHostCapabilities();
    const available = !!capabilities?.serverTools && !!capabilities?.serverResources;
    logsPanel.setAvailable(available);
    performancePanel.setAvailable(available);
    storagePanel.setAvailable(available);
    deviceApps.setAvailable(available);
    updates.setAvailable(available && !claudeDesktop);
    for (const panel of panels) if (!available) panel.notice("This host cannot call the plugin's simulator tools.");
    if (available) {
      stopLiveReload = startLiveReload(app, disposeUI);
    }
    await workspaceDevices.setAvailable(available);
  } catch (error) {
    connectionFailed(error);
  }
})();
