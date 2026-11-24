export class FrameArrivals {
  private readonly arrivals = new Map<string, number>();

  record(message: unknown, arrivedAt: number) {
    if (message == null || typeof message !== "object" || !("jsonrpc" in message) || message.jsonrpc !== "2.0" || !("result" in message)) return;
    const result = message.result;
    if (result == null || typeof result !== "object" || !("contents" in result) || Array.isArray(result.contents) === false) return;
    for (const content of result.contents) {
      if (content == null || typeof content !== "object" || typeof content.uri !== "string" || content.uri.startsWith("mobile-frame://") === false) continue;
      const preparedAt = content._meta?.serverPreparedAt;
      if (typeof preparedAt !== "number" || Number.isFinite(preparedAt) === false || preparedAt <= 0) continue;
      const key = `${content.uri}|${preparedAt}`;
      if (this.arrivals.size === 128) {
        const oldest = this.arrivals.keys().next().value;
        if (oldest != null) this.arrivals.delete(oldest);
      }
      this.arrivals.set(key, arrivedAt);
    }
  }

  take(uri: string, serverPreparedAt: number): number | undefined {
    const key = `${uri}|${serverPreparedAt}`;
    const arrivedAt = this.arrivals.get(key);
    this.arrivals.delete(key);
    return arrivedAt;
  }

  clear() { this.arrivals.clear(); }
}

// MCP replies from all simulators arrive on the same host window. Each stream
// consumes only its own resource timestamps from this bounded collection.
export const frameArrivals = new FrameArrivals();
let observers = 0;
function observeFrame(event: MessageEvent) {
  if (event.source !== window.parent) return;
  const arrivedAt = performance.timeOrigin + performance.now();
  frameArrivals.record(event.data, arrivedAt);
}

export function observeFrameArrivals() {
  if (observers === 0) window.addEventListener("message", observeFrame);
  observers++;
  return () => {
    observers--;
    if (observers === 0) {
      window.removeEventListener("message", observeFrame);
      frameArrivals.clear();
    }
  };
}
