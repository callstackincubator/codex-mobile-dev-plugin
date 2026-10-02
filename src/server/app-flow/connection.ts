import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { installFlowRuntime } from "./runtime.js";

/** A reconnect can reuse the runtime lease and original navigation state. */
export class FlowConnection {
  private socket: WebSocket;
  private key: string;
  private binding: string;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;
  private closing?: Promise<void>;
  private ready: Promise<void>;
  private heartbeat?: NodeJS.Timeout;
  private heartbeatPending = false;
  private heartbeatFailures = 0;

  constructor(url: string, sessionId = randomUUID()) {
    this.key = `__mobile_flow_${sessionId.replaceAll("-", "")}`;
    this.binding = `${this.key}_reply_${randomUUID().replaceAll("-", "")}`;
    const origin = new URL(url); origin.protocol = "http:";
    this.socket = new WebSocket(url, { origin: origin.origin, handshakeTimeout: 3000, maxPayload: 2 * 1024 * 1024, followRedirects: false });
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("open", () => { resolve(); });
      this.socket.once("error", () => reject(new Error("Cannot connect to the selected Metro runtime.")));
      this.socket.once("close", () => reject(new Error("Metro closed the debugger connection.")));
    });
    this.socket.on("message", bytes => {
      try {
        const message = JSON.parse(bytes.toString());
        if (message.method === "Runtime.bindingCalled" && message.params?.name === this.binding) {
          const value = JSON.parse(message.params.payload); this.finish(value.id, value.result);
        } else if (message.id) {
          if (message.error || message.result?.exceptionDetails) this.finish(message.id, undefined, new Error("The React Native runtime rejected App Flow inspection."));
          else if (message.id > 0) this.finish(message.id, message.result);
        }
      } catch { this.fail(new Error("Metro returned an invalid App Flow response.")); }
    });
    this.socket.on("error", () => this.fail(new Error("Metro disconnected.")));
    this.socket.on("close", () => this.fail(new Error("Metro disconnected.")));
    this.ready = this.ready.then(async () => {
      await this.send("Runtime.addBinding", { name: this.binding }, 2000);
      // esbuild keepNames may introduce __name inside serialized functions.
      await this.send("Runtime.evaluate", { expression: `(()=>{const __name=(value)=>value;for(const name of Object.keys(globalThis))if(name.startsWith(${JSON.stringify(`${this.key}_reply_`)})&&name!==${JSON.stringify(this.binding)})delete globalThis[name];(${installFlowRuntime.toString()})(${JSON.stringify(this.key)},10000);})()`, silent: true, returnByValue: true, objectGroup: this.key }, 2000);
      if (!this.closing && !this.closed) {
        this.heartbeat = setInterval(() => {
          if (this.heartbeatPending) return;
          this.heartbeatPending = true;
          void this.invoke({ type: "heartbeat" }, 2500).then(() => { this.heartbeatFailures = 0; }).catch(() => { if (++this.heartbeatFailures >= 3) void this.close(); }).finally(() => { this.heartbeatPending = false; });
        }, 2000);
        this.heartbeat.unref();
      }
    });
    void this.ready.catch(() => {});
  }
  private finish(id: number, value?: unknown, error?: Error) {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.timer);
    if (error) pending.reject(error); else pending.resolve(value);
  }
  private fail(error: Error) { clearInterval(this.heartbeat); for (const id of this.pending.keys()) this.finish(id, undefined, error); }
  private send(method: string, params: unknown, timeout: number, id = ++this.sequence): Promise<any> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Metro connection is closed."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.finish(id, undefined, new Error("App Flow runtime timed out.")), timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), error => { if (error) this.finish(id, undefined, new Error("Metro disconnected.")); });
    });
  }
  async invoke(command: Record<string, unknown>, timeout = 1500): Promise<any> {
    await this.ready;
    const id = -(++this.sequence);
    const expression = `globalThis[${JSON.stringify(this.key)}]?.invoke(${JSON.stringify(command)},result=>globalThis[${JSON.stringify(this.binding)}](JSON.stringify({id:${id},result})))`;
    return this.send("Runtime.evaluate", { expression, silent: true, returnByValue: true, objectGroup: this.key }, timeout, id);
  }
  close(options?: { restore?: boolean }): Promise<void> { return this.closing ??= this.dispose(options?.restore !== false); }
  private async dispose(restore: boolean) {
    if (this.closed) return;
    clearInterval(this.heartbeat);
    if (restore) try { await Promise.race([this.invoke({ type: "restore" }, 200), new Promise<void>(resolve => { const timer = setTimeout(resolve, 250); timer.unref(); })]); } catch { /* Runtime watchdog also restores after disconnect. */ }
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ id: ++this.sequence, method: "Runtime.removeBinding", params: { name: this.binding } }));
      this.socket.send(JSON.stringify({ id: ++this.sequence, method: "Runtime.evaluate", params: { expression: `delete globalThis[${JSON.stringify(this.binding)}]`, silent: true, returnByValue: true } }));
      this.socket.send(JSON.stringify({ id: ++this.sequence, method: "Runtime.releaseObjectGroup", params: { objectGroup: this.key } }));
    }
    this.closed = true;
    this.fail(new Error("App Flow stopped."));
    this.socket.terminate();
  }
}
