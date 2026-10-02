import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { createRoot } from "react-dom/client";
import { RecordingController } from "./recording-controller.ts";
import { RecordingCard } from "./components/recording-card";
import { ErrorBoundary, captureUiError, setUiSurface, startUiTelemetry, stopUiTelemetry } from "./telemetry.ts";
import { PLUGIN_VERSION } from "../shared/version.ts";

export function startRecordingApp() {
  const app = new App({ name: "mobile-dev-recording", version: PLUGIN_VERSION });
  startUiTelemetry(app);
  setUiSurface("recording");
  const controller = new RecordingController(app, new OpenAIExtensions(app));
  const root = createRoot(document.getElementById("root")!);
  root.render(<ErrorBoundary fallback={<p role="alert">This recording could not render. Reopen it to try again.</p>}><RecordingCard controller={controller} /></ErrorBoundary>);
  function hostChanged() {
    const host = app.getHostContext();
    if (host?.theme) applyDocumentTheme(host.theme);
    if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
    controller.hostChanged();
  }
  app.addEventListener("hostcontextchanged", hostChanged);
  app.ontoolresult = result => {
    try { controller.accept(result); }
    catch (error) { captureUiError(error, "recording.result"); }
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
  void app.connect().then(hostChanged).catch(error => { captureUiError(error, "recording.connect"); });
}
