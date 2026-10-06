import { isolateRequestSignals } from "./request-signals.ts";
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { ComparisonController } from "./comparison-controller.ts";
import { ComparisonCard } from "./components/comparison-card.tsx";
import { ErrorBoundary, captureUiError, setUiSurface, startUiTelemetry, stopUiTelemetry } from "./telemetry.ts";
import { PLUGIN_VERSION } from "../shared/version.ts";

export function startComparisonApp() {
  const app = new App({ name: "mobile-dev-comparison", version: PLUGIN_VERSION });
  isolateRequestSignals(app);
  startUiTelemetry(app);
  setUiSurface("comparison");
  const controller = new ComparisonController(app);
  const root = createRoot(document.getElementById("root")!);
  root.render(<ErrorBoundary fallback={<p role="alert">This comparison could not render. Reopen it to try again.</p>}><ComparisonCard controller={controller} /></ErrorBoundary>);
  function hostChanged() {
    const host = app.getHostContext();
    if (host?.theme) applyDocumentTheme(host.theme);
    if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
    controller.hostChanged();
  }
  app.addEventListener("hostcontextchanged", hostChanged);
  app.ontoolresult = result => {
    try { controller.accept(result); }
    catch (error) { captureUiError(error, "comparison.result"); }
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
  void app.connect().then(hostChanged).catch(error => { captureUiError(error, "comparison.connect"); });
}
