import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Surface } from "@mobile-dev/shared/telemetry.ts";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { ErrorBoundary, captureUiError, setUiSurface, startUiTelemetry, stopUiTelemetry } from "@mobile-dev/ui/telemetry.ts";
import { applyHostStyles } from "./host-styles.ts";
import { attributeHost } from "./host-telemetry.ts";

type CardController = { hostChanged(): void; accept(result: CallToolResult): void; dispose(): void };

/** Runs one chat card: a single controller fed by the tool call that rendered it. */
export function startCardApp<C extends CardController>(card: {
  name: string;
  surface: Surface & ("recording" | "comparison" | "tracesift");
  fallback: string;
  create(app: App): C;
  render(controller: C): ReactNode;
  hostChanged?(controller: C, host: ReturnType<App["getHostContext"]>): void;
  toolInput?(controller: C, input: Record<string, unknown> | undefined): void;
  connected?(controller: C): void;
}) {
  const app = new App({ name: card.name, version: PLUGIN_VERSION });
  startUiTelemetry(app);
  setUiSurface(card.surface);
  const controller = card.create(app);
  const root = createRoot(document.getElementById("root")!);
  root.render(<ErrorBoundary fallback={<p role="alert">{card.fallback}</p>}>{card.render(controller)}</ErrorBoundary>);
  function hostChanged() {
    const host = applyHostStyles(app);
    controller.hostChanged();
    card.hostChanged?.(controller, host);
  }
  app.addEventListener("hostcontextchanged", hostChanged);
  if (card.toolInput) app.ontoolinput = ({ arguments: input }) => card.toolInput!(controller, input);
  app.ontoolresult = result => {
    try { controller.accept(result); }
    catch (error) { captureUiError(error, `${card.surface}.result`); }
  };
  let closing: Promise<void> | undefined;
  function close() {
    if (closing) return closing;
    controller.dispose();
    root.unmount();
    window.removeEventListener("pagehide", pageHide);
    app.removeEventListener("hostcontextchanged", hostChanged);
    return closing = stopUiTelemetry();
  }
  function pageHide(event: PageTransitionEvent) { if (!event.persisted) void close(); }
  window.addEventListener("pagehide", pageHide);
  app.onteardown = async () => { await close(); return {}; };
  void app.connect().then(() => {
    attributeHost(app);
    hostChanged();
    card.connected?.(controller);
  }).catch(error => captureUiError(error, `${card.surface}.connect`));
}
