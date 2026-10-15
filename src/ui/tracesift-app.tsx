import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { PLUGIN_VERSION } from "../shared/version.ts";
import { TraceSiftCards } from "./components/tracesift-cards.tsx";
import { ErrorBoundary, captureUiError, setUiSurface, startUiTelemetry, stopUiTelemetry } from "./telemetry.ts";
import { TraceSiftController } from "./tracesift-controller.ts";
import { traceSiftProfileInputSchema } from "../shared/tracesift.ts";

export function startTraceSiftApp() {
  const app = new App({ name: "mobile-dev-tracesift", version: PLUGIN_VERSION });
  startUiTelemetry(app); setUiSurface("tracesift");
  const controller = new TraceSiftController(app);
  const root = createRoot(document.getElementById("root")!);
  root.render(<ErrorBoundary fallback={<p role="alert">This TraceSift analysis could not render. Reopen it to try again.</p>}><TraceSiftCards controller={controller} /></ErrorBoundary>);
  function hostChanged() {
    const host = app.getHostContext();
    if (host?.theme) applyDocumentTheme(host.theme);
    if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
    controller.hostChanged();
    const viewId = host?.toolInfo?.id;
    if (typeof viewId === "string" || typeof viewId === "number") controller.setViewId(viewId);
  }
  app.addEventListener("hostcontextchanged", hostChanged);
  app.ontoolinput = ({ arguments: input }) => {
    const parsed = traceSiftProfileInputSchema.safeParse(input);
    if (parsed.success) controller.setProfileInput(parsed.data.path, parsed.data.profileType);
  };
  app.ontoolresult = result => { try { controller.accept(result); } catch (error) { captureUiError(error, "tracesift.result"); } };
  let closing: Promise<void> | undefined;
  function close() {
    if (closing) return closing;
    controller.dispose(); root.unmount(); window.removeEventListener("pagehide", pageHide); app.removeEventListener("hostcontextchanged", hostChanged);
    return closing = stopUiTelemetry();
  }
  function pageHide(event: PageTransitionEvent) { if (!event.persisted) void close(); }
  window.addEventListener("pagehide", pageHide);
  app.onteardown = async () => { await close(); return {}; };
  void app.connect().then(() => {
    hostChanged();
  }).catch(error => captureUiError(error, "tracesift.connect"));
}
