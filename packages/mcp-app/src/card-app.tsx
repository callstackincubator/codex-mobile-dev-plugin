import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Surface } from "@mobile-dev/shared/telemetry.ts";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { ErrorBoundary, captureUiError, setUiSurface, startUiTelemetry, stopUiTelemetry } from "@mobile-dev/ui/telemetry.ts";
import { runMcpView } from "./mcp-view.ts";

type CardController = { hostChanged(): void; accept(result: CallToolResult): void; dispose(): void };

/** Runs one chat card: a single controller fed by the tool call that rendered it. */
export function startCardApp<C extends CardController>(card: {
  name: string;
  /** The surface the card's telemetry measures. Cards without one, such as retired cards, measure nothing. */
  surface?: Surface & ("recording" | "comparison" | "tracesift");
  fallback: string;
  create(app: App): C;
  render(controller: C): ReactNode;
  hostChanged?(controller: C, host: ReturnType<App["getHostContext"]>): void;
  toolInput?(controller: C, input: Record<string, unknown> | undefined): void;
  connected?(controller: C): void;
}) {
  const { surface } = card;
  const app = new App({ name: card.name, version: PLUGIN_VERSION });
  if (surface) {
    startUiTelemetry(app);
    setUiSurface(surface);
  }
  const controller = card.create(app);
  const root = createRoot(document.getElementById("root")!);
  root.render(<ErrorBoundary fallback={<p role="alert">{card.fallback}</p>}>{card.render(controller)}</ErrorBoundary>);
  if (card.toolInput) app.ontoolinput = ({ arguments: input }) => card.toolInput!(controller, input);
  app.ontoolresult = result => {
    try { controller.accept(result); }
    catch (error) { captureUiError(error, `${surface}.result`); }
  };
  runMcpView({
    app,
    onHost: host => {
      controller.hostChanged();
      card.hostChanged?.(controller, host);
    },
    onConnect: () => card.connected?.(controller),
    connectFailed: error => captureUiError(error, `${surface}.connect`),
    dispose: () => {
      controller.dispose();
      root.unmount();
      if (surface) return stopUiTelemetry();
    },
  });
}

/** Card for a view saved by an earlier release that no longer exists; says so instead of failing, and measures nothing. */
export function startRetiredCard(message: string) {
  startCardApp({
    name: "mobile-dev-retired", fallback: message,
    create: () => ({ hostChanged() {}, accept() {}, dispose() {} }),
    render: () => <p className="p-3 text-sm text-muted-foreground">{message}</p>,
  });
}
