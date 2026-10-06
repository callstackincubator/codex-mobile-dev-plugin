import type { App } from "@modelcontextprotocol/ext-apps";
import { setUiGauge } from "./telemetry.ts";

/** Keep SDK request listeners from accumulating on a long-lived stream signal. */
export function isolateRequestSignals(app: App) {
  const request = app.request.bind(app);
  let pending = 0;
  app.request = (async (message, schema, options) => {
    const signal = options?.signal;
    if (!signal) return request(message, schema, options);
    signal.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    setUiGauge("ui.bridge.pending_signals", ++pending);
    try {
      return await request(message, schema, { ...options, signal: controller.signal });
    } finally {
      signal.removeEventListener("abort", cancel);
      setUiGauge("ui.bridge.pending_signals", --pending);
      // Do not abort a completed request: the SDK would send a cancellation.
      // Its listener lives only on this now-unreachable per-request signal.
    }
  }) as App["request"];
}
