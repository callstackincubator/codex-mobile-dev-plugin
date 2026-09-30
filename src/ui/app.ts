import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import "@openai/mcp-extensions/app/styles.css";
import "./style.css";
import type { Status } from "../shared/protocol.ts";
import { PanelContext } from "./model-context.ts";
import { LogsPanel } from "./logs-panel.ts";
import { createSimulatorPanel } from "./simulator-panel.ts";

const app = new App({ name: "mobile-dev-ui", version: "0.1.20" }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const panelContext = new PanelContext(app, extensions);
const logsPanel = new LogsPanel(app, panelContext);
logsPanel.setLayout(document.documentElement.dataset.view === "workspace");
document.getElementById("tool-logs")!.addEventListener("click", () => logsPanel.show());

const container = document.getElementById("simulator-panels")!;
const template = document.getElementById("simulator-template") as HTMLTemplateElement;
const layout = document.getElementById("device-layout") as HTMLSelectElement;
let activePlatform: "ios" | "android" = "ios";
const panels = (["ios", "android"] as const).map(platform => {
  const root = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  root.dataset.platform = platform;
  root.setAttribute("aria-label", platform === "ios" ? "iOS simulator" : "Android emulator");
  for (const element of root.querySelectorAll<HTMLElement>("[data-element]")) element.id = `${platform}-${element.dataset.element}`;
  root.querySelector<HTMLLabelElement>('[data-label="devices"]')!.htmlFor = `${platform}-devices`;
  root.querySelector('[data-element="platform-label"]')!.textContent = platform === "ios" ? "iOS" : "Android";
  container.append(root);
  return createSimulatorPanel(app, root, platform, panelContext, (_device, active) => {
    if (active) activePlatform = platform;
    updateSelection();
  });
});
const [ios, android] = panels;

function updateSelection() {
  const visible = panels.filter(panel => !panel.root.hidden);
  const active = visible.find(panel => panel.platform === activePlatform) ?? visible[0];
  const selected = active?.selected;
  panelContext.selectSimulators(visible.flatMap(panel => panel.selected ? [panel.selected] : []), selected);
  logsPanel.selectSimulator(selected);
  for (const panel of panels) panel.root.dataset.active = String(panel === active);
}

layout.addEventListener("change", () => {
  for (const panel of panels) {
    panel.root.hidden = layout.value !== "both" && layout.value !== panel.platform;
    panel.fitScreen();
  }
  updateSelection();
});

window.addEventListener("pagehide", () => { for (const panel of panels) void panel.dispose(); void logsPanel.dispose(); });
app.onteardown = async () => { await Promise.all([...panels.map(panel => panel.dispose()), logsPanel.dispose()]); return {}; };

function hostContext() {
  const host = app.getHostContext();
  if (host?.theme) applyDocumentTheme(host.theme);
  if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
  document.documentElement.style.setProperty("--host-safe-bottom", `${Math.max(0, host?.safeAreaInsets?.bottom ?? 0)}px`);
  panelContext.hostChanged();
  for (const panel of panels) { panel.fitScreen(); panel.controls(); }
}
app.ontoolinput = () => { ios.empty("Loading simulators…"); };
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
    for (const panel of panels) {
      panel.setAvailable(available);
      if (!available) panel.notice("This host cannot call the plugin's simulator tools.");
    }
    if (available) await Promise.all([ios.resume(), android.load()]);
  } catch (error) {
    for (const panel of panels) panel.notice(error instanceof Error ? error.message : "Could not connect to Codex.");
  }
})();
