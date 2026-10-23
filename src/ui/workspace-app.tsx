import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import "@fontsource-variable/inter";
import "./theme.css";
import "./style.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Workspace } from "./components/workspace";
import { DisplayModeButton } from "./components/display-mode-button";
import { ContextAttachments } from "./components/context-attachments";
import type { DeviceLayout } from "./device-layout.ts";
import { panelTargetSchema } from "../shared/panel-target.ts";
import { WorkspaceDevices } from "./workspace-devices.ts";
import { PanelContext } from "./model-context.ts";
import { LogsPanel } from "./logs-panel.ts";
import { DeviceAppsStore } from "./device-apps.ts";
import { PerformancePanel } from "./performance-panel.ts";
import { StoragePanel } from "./storage-panel.ts";
import { TraceSiftPanel } from "./tracesift-panel.ts";
import { createSimulatorPanel } from "./simulator-panel.ts";
import { startLiveReload } from "./live-reload.ts";
import { ErrorBoundary, captureUiError, startUiTelemetry, stopUiTelemetry, setUiTelemetryContext } from "./telemetry.ts";
import { PLUGIN_VERSION } from "../shared/version.ts";
import { RecordingController } from "./recording-controller.ts";
import { PluginUpdateController } from "./plugin-updates.ts";

const app = new App({ name: "mobile-dev-ui", version: PLUGIN_VERSION }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: false });
startUiTelemetry(app);
const extensions = new OpenAIExtensions(app);
const panelContext = new PanelContext(app, extensions);
const deviceApps = new DeviceAppsStore(app, document);
const performancePanel = new PerformancePanel(app, deviceApps);
const logsPanel = new LogsPanel(app, panelContext, deviceApps);
const storagePanel = new StoragePanel(app, deviceApps);
const traceSiftPanel = new TraceSiftPanel(app);
const recordingController = new RecordingController(app, extensions);
const updates = new PluginUpdateController(app);
const reactRoot = createRoot(document.getElementById("root")!);
function renderWorkspace(automaticLayout?: DeviceLayout) {
  const workspace = <ErrorBoundary fallback={<p role="alert">Mobile Dev could not render. Reopen the panel to try again.</p>}>
    <Workspace performance={performancePanel} logs={logsPanel} storage={storagePanel} tracesift={traceSiftPanel} recordingController={recordingController} updates={updates} displayModeControl={<DisplayModeButton app={app} />} contextControl={<ContextAttachments context={panelContext} />} automaticLayout={automaticLayout} onLayout={changeLayout} />
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
    app.removeEventListener("hostcontextchanged", hostContext);
    window.removeEventListener("focus", resumeContext);
    window.removeEventListener("pageshow", resumeContext);
    document.removeEventListener("visibilitychange", resumeContext);
    workspaceDevices.dispose();
    deviceApps.dispose();
    storagePanel.dispose();
    traceSiftPanel.dispose();
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

// MCP Apps sizing: fill fullscreen, a fixed container height, or a host that sends
// no dimensions. A container without a fixed height sizes to the app, so choose an
// inline height within its maxHeight and report it.
let reportedInlineHeight: number | undefined;
function fitContainer(host: ReturnType<App["getHostContext"]>) {
  const dimensions = host?.containerDimensions;
  const flexible = host?.displayMode !== "fullscreen" && !!dimensions && !("height" in dimensions);
  const maximum = flexible && "maxHeight" in dimensions ? dimensions.maxHeight : undefined;
  const height = flexible ? Math.min(600, typeof maximum === "number" && maximum > 0 ? maximum : 600) : undefined;
  const root = document.documentElement;
  root.style.setProperty("--workspace-height", height ? `${height}px` : "100dvh");
  root.style.setProperty("--workspace-bottom-inset", `${host?.safeAreaInsets?.bottom ?? 0}px`);
  if (height === reportedInlineHeight) return;
  reportedInlineHeight = height;
  if (height) void app.sendSizeChanged({ height }).catch(error => captureUiError(error, "workspace.resize"));
}
function hostContext() {
  if (disposingUI) return;
  const host = app.getHostContext();
  if (host?.theme) applyDocumentTheme(host.theme);
  if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
  if (host?.styles?.css?.fonts) applyHostFonts(host.styles.css.fonts);
  panelContext.hostChanged();
  recordingController.hostChanged();
  traceSiftPanel.hostChanged();
  panelContext.resume();
  for (const panel of panels) { panel.fitScreen(); panel.controls(); }
  // Initial context arrives with connect(), without a hostcontextchanged event.
  fitContainer(host);
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
  const message = error instanceof Error ? error.message : "Could not connect to the host.";
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
    traceSiftPanel.setAvailable(available);
    deviceApps.setAvailable(available);
    updates.setAvailable(available);
    for (const panel of panels) if (!available) panel.notice("This host cannot call the plugin's simulator tools.");
    if (available) {
      stopLiveReload = startLiveReload(app, disposeUI);
    }
    await workspaceDevices.setAvailable(available);
  } catch (error) {
    connectionFailed(error);
  }
})();
