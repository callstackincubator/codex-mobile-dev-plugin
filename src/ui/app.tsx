import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import "@openai/mcp-extensions/app/styles.css";
import "@fontsource-variable/inter";
import "./theme.css";
import "./style.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Workspace } from "./components/workspace";
import type { DeviceLayout } from "./components/workspace";
import type { Status } from "../shared/protocol.ts";
import { PanelContext } from "./model-context.ts";
import { LogsPanel } from "./logs-panel.ts";
import { PerformancePanel } from "./performance-panel.ts";
import { createSimulatorPanel } from "./simulator-panel.ts";
import { startLiveReload } from "./live-reload.ts";

const app = new App({ name: "mobile-dev-ui", version: "0.1.43" }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const panelContext = new PanelContext(app, extensions);
const performancePanel = new PerformancePanel(app);
const logsPanel = new LogsPanel(app, panelContext);
const reactRoot = createRoot(document.getElementById("root")!);
flushSync(() => reactRoot.render(<Workspace performance={performancePanel} logs={logsPanel} onLayout={changeLayout} />));

let activePlatform: "ios" | "android" = "ios";
const panels = (["ios", "android"] as const).map(platform => {
  const root = document.getElementById(`${platform}-panel`)!;
  return createSimulatorPanel(app, root, platform, panelContext, (_device, active) => {
    if (active) activePlatform = platform;
    updateSelection();
  });
});
const [ios, android] = panels;
logsPanel.setLayout(document.documentElement.dataset.view === "workspace");

function updateSelection(updateToolSource = true) {
  const visible = panels.filter(panel => !panel.root.hidden);
  const active = visible.find(panel => panel.platform === activePlatform) ?? visible[0];
  const selected = active?.selected;
  panelContext.selectSimulators(visible.flatMap(panel => panel.selected ? [panel.selected] : []), selected);
  if (updateToolSource) {
    logsPanel.selectSimulator(selected);
    performancePanel.selectSimulator(selected);
  } else if (active) {
    performancePanel.selectSimulator(selected);
  }
  for (const panel of panels) panel.root.dataset.active = String(panel === active);
}

function changeLayout(layout: DeviceLayout) {
  if (layout === "ios" || layout === "android") activePlatform = layout;
  for (const panel of panels) {
    panel.root.hidden = layout !== "both" && layout !== panel.platform;
  }
  requestAnimationFrame(() => { for (const panel of panels) if (!panel.root.hidden) panel.fitScreen(); });
  updateSelection(false);
}

let stopLiveReload = () => {};
let disposingUI: Promise<void> | undefined;
function disposeUI() {
  return disposingUI ??= (async () => {
    window.removeEventListener("pagehide", onPageHide);
    await Promise.allSettled([...panels.map(panel => panel.dispose()), logsPanel.dispose(), performancePanel.dispose()]);
    reactRoot.unmount();
  })();
}
function onPageHide() { stopLiveReload(); void disposeUI(); }
window.addEventListener("pagehide", onPageHide);
app.onteardown = async () => { stopLiveReload(); await disposeUI(); return {}; };

function hostContext() {
  const host = app.getHostContext();
  if (host?.theme) applyDocumentTheme(host.theme);
  if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
  document.documentElement.style.setProperty("--font-sans", '"Inter Variable", sans-serif');
  panelContext.hostChanged();
  for (const panel of panels) { panel.fitScreen(); panel.controls(); }
}
app.ontoolinput = () => { if (!ios.selected) ios.empty("Loading simulators…", "Finding available iOS simulators."); };
app.ontoolresult = result => {
  if (result.isError) { ios.notice(result.content.filter(item => item.type === "text").map(item => item.text).join("\n")); return; }
  if (result.structuredContent && "devices" in result.structuredContent) ios.acceptStatus(result.structuredContent as Status);
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
    for (const panel of panels) {
      panel.setAvailable(available);
      if (!available) panel.notice("This host cannot call the plugin's simulator tools.");
    }
    if (available) {
      stopLiveReload = startLiveReload(app, disposeUI);
      await Promise.all([ios.load(), android.load()]);
    }
  } catch (error) {
    for (const panel of panels) panel.notice(error instanceof Error ? error.message : "Could not connect to Codex.");
  }
})();
