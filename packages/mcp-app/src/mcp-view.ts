import type { App } from "@modelcontextprotocol/ext-apps";
import { applyHostStyles } from "./host-styles.ts";
import { attributeHost } from "./host-telemetry.ts";

type HostContext = ReturnType<App["getHostContext"]>;

/**
 * Runs one MCP Apps view against its host: connects, applies the host's styles on
 * connect and on every context change, and disposes once when the page goes away or
 * the host tears the view down. Returns the close function those use.
 */
export function runMcpView({ app, onHost, onConnect, connectFailed, dispose }: {
  app: App;
  /** Runs after the host's styles apply: once connected, then on every context change. */
  onHost?(host: HostContext): void;
  onConnect?(): void | Promise<void>;
  connectFailed(error: unknown): void;
  dispose(): void | Promise<void>;
}) {
  let closing: Promise<void> | undefined;
  function hostChanged() {
    if (closing) return;
    const host = applyHostStyles(app);
    onHost?.(host);
  }
  function close() {
    return closing ??= (async () => {
      window.removeEventListener("pagehide", pageHide);
      app.removeEventListener("hostcontextchanged", hostChanged);
      await dispose();
    })();
  }
  function pageHide(event: PageTransitionEvent) { if (!event.persisted) void close(); }
  window.addEventListener("pagehide", pageHide);
  app.addEventListener("hostcontextchanged", hostChanged);
  app.onteardown = async () => { await close(); return {}; };
  void (async () => {
    try {
      await app.connect();
      attributeHost(app);
      // The initial context arrives with connect(), without a hostcontextchanged event.
      hostChanged();
      await onConnect?.();
    } catch (error) {
      connectFailed(error);
    }
  })();
  return close;
}
