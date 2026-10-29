import "@fontsource-variable/inter";
import "@mobile-dev/ui/theme.css";
import "@mobile-dev/ui/style.css";
import "./mac.css";
import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { DeviceLayout } from "@mobile-dev/ui/device-layout.ts";
import { DeviceWorkspace } from "@mobile-dev/ui/device-workspace.ts";
import { ErrorBoundary, captureUiError, startUiTelemetry, stopUiTelemetry } from "@mobile-dev/ui/telemetry.ts";
import { isToolName, WorkspaceTools, type ToolName } from "@mobile-dev/ui/workspace-tools.ts";
import { MacHostBridge, postToShell } from "./mac-bridge.ts";
import { MacWorkspace } from "./mac-workspace.tsx";

const layouts = ["ios", "android", "both", "none"] as const;
const isLayout = (value: unknown): value is DeviceLayout => layouts.includes(value as DeviceLayout);

const bridge = new MacHostBridge();
startUiTelemetry(bridge);
// The Mac app has no chat, so the panels have no host attachments.
const panels = WorkspaceTools.create(bridge);
let tool: ToolName | undefined;
let layout: DeviceLayout = "none";
const devices = new DeviceWorkspace(bridge, panels, {
  onAutomaticLayout: next => {
    layout = next;
    render();
    postToShell({ type: "layout", layout: next });
  },
  connectionFailed,
});
const reactRoot = createRoot(document.getElementById("root")!);
function render() {
  reactRoot.render(<ErrorBoundary fallback={<p role="alert">Mobile Dev could not render. Reload the window to try again.</p>}>
    <MacWorkspace panels={panels} devices={devices.panels} tool={tool} layout={layout} />
  </ErrorBoundary>);
}
flushSync(render);

panels.logs.setLayout(true);
devices.changeLayout("none");

function connectionFailed(error: unknown) {
  captureUiError(error, "host.connect");
  const message = error instanceof Error ? error.message : "Could not connect to the Mobile Dev server.";
  devices.notice(message);
  postToShell({ type: "error", message });
}

function selectTool(next: ToolName | undefined) {
  if (next === tool) return;
  tool = next;
  if (next) panels.show(next);
  else panels.close();
  render();
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
  selectTool: value => selectTool(isToolName(value) ? value : undefined),
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
  panels.hostChanged();
  devices.refit();
}
dark.addEventListener("change", hostChanged);
hostChanged();

window.addEventListener("pagehide", () => {
  void Promise.allSettled([devices.dispose(), panels.dispose(), bridge.close(), stopUiTelemetry()]);
});

void (async () => {
  try {
    await bridge.connect();
    panels.setAvailable(true);
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
