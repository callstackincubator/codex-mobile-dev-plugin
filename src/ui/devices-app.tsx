import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { DevicesController } from "./devices-controller.ts";
import { DevicesCard } from "./components/devices-card.tsx";
import { ErrorBoundary, captureUiError, setUiSurface, startUiTelemetry, stopUiTelemetry } from "./telemetry.ts";
import { PLUGIN_VERSION } from "../shared/version.ts";

export function startDevicesApp() {
  const app = new App({ name: "mobile-dev-devices", version: PLUGIN_VERSION });
  startUiTelemetry(app);
  setUiSurface("devices");
  const controller = new DevicesController(app);
  const root = createRoot(document.getElementById("root")!);
  root.render(<ErrorBoundary fallback={<p role="alert">These devices could not render. Ask again to list them.</p>}><DevicesCard controller={controller} /></ErrorBoundary>);
  function hostChanged() {
    const host = app.getHostContext();
    if (host?.theme) applyDocumentTheme(host.theme);
    if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
    if (host?.styles?.css?.fonts) applyHostFonts(host.styles.css.fonts);
    controller.hostChanged();
  }
  app.addEventListener("hostcontextchanged", hostChanged);
  app.ontoolresult = result => {
    try { controller.accept(result); }
    catch (error) { captureUiError(error, "devices.result"); }
  };
  let closing: Promise<void> | undefined;
  function close() {
    if (closing) return closing;
    controller.dispose();
    root.unmount();
    window.removeEventListener("pagehide", pageHide);
    app.removeEventListener("hostcontextchanged", hostChanged);
    closing = stopUiTelemetry();
    return closing;
  }
  function pageHide(event: PageTransitionEvent) { if (event.persisted === false) void close(); }
  window.addEventListener("pagehide", pageHide);
  app.onteardown = async () => { await close(); return {}; };
  void app.connect().then(hostChanged).catch(error => { captureUiError(error, "devices.connect"); });
}
