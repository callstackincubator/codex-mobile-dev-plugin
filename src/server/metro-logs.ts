import { WebSocket } from "ws";
import { setTimeout as delay } from "node:timers/promises";
import type { MetroLogTarget, MetroTarget } from "../shared/logs.ts";
import { parseBaseUrl, errorMessage } from "../shared/protocol.ts";
import { parseMetroEvent } from "./log-parsers.ts";
import type { LogSink, StopLogSource } from "./native-logs.ts";

type InspectorTarget = MetroTarget & { webSocketDebuggerUrl: string; supportsMultipleDebuggers: boolean };

export async function metroTargets(origin: string, signal?: AbortSignal): Promise<InspectorTarget[]> {
  const base = parseBaseUrl(origin, "Metro URL");
  let response: Response;
  try { response = await fetch(new URL("/json/list", base), { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Cannot reach Metro at ${base.origin}. Start Metro for your project or choose its running server.`, { cause: error });
  }
  if (!response.ok) throw new Error(`Metro returned HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > 1024 * 1024) throw new Error("Metro returned too many targets.");
  const payload = JSON.parse(body);
  if (!Array.isArray(payload)) throw new Error("Metro returned an invalid target list.");
  return payload.slice(0, 100).flatMap(item => {
    if (typeof item.id !== "string" || typeof item.webSocketDebuggerUrl !== "string") return [];
    const url = new URL(item.webSocketDebuggerUrl, base);
    if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.hash) return [];
    // An inspector may report localhost while discovery used 127.0.0.1.
    if (url.port !== base.port) return [];
    const string = (value: unknown) => typeof value === "string" ? value.slice(0, 512) : undefined;
    return [{ id: item.id, title: string(item.title) ?? item.id, appId: string(item.appId), deviceName: string(item.deviceName),
      deviceId: string(item.reactNative?.logicalDeviceId), webSocketDebuggerUrl: url.href,
      supportsMultipleDebuggers: item.reactNative?.capabilities?.supportsMultipleDebuggers === true }];
  });
}

export function startMetroLogs(target: MetroLogTarget, sink: LogSink): StopLogSource {
  const controller = new AbortController();
  const signal = controller.signal;
  const running = (async () => {
    let failures = 0;
    while (!signal.aborted) {
      sink.status({ source: "metro", state: failures ? "reconnecting" : "connecting" });
      try {
        const targets = await metroTargets(target.url, signal);
        const selected = targets.find(item => item.id === target.targetId);
        if (!selected) throw new Error("The selected app is absent from Metro. Refresh targets after restarting the app.");
        await receiveMetro(selected, sink, signal);
      } catch (error) {
        if (signal.aborted) break;
        sink.status({ source: "metro", state: "reconnecting", message: errorMessage(error) });
        failures++;
      }
      await delay(Math.min(500 * 2 ** Math.min(failures, 4), 10000), undefined, { signal }).catch(() => {});
    }
  })();
  return async () => { controller.abort(); await running; };
}

function receiveMetro(target: InspectorTarget, sink: LogSink, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const url = new URL(target.webSocketDebuggerUrl);
    const origin = new URL(url); origin.protocol = "http:";
    const socket = new WebSocket(url, { origin: origin.origin, handshakeTimeout: 5000, maxPayload: 1024 * 1024, followRedirects: false });
    let enabled = false;
    let settled = false;
    let alive = true;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); clearInterval(heartbeat); signal.removeEventListener("abort", stop);
      socket.terminate();
      signal.aborted || !error ? resolve() : reject(error);
    };
    const stop = () => finish();
    const timeout = setTimeout(() => finish(new Error("Metro did not enable console events.")), 10000);
    const heartbeat = setInterval(() => { if (!alive) finish(new Error("Metro stopped responding.")); else if (socket.readyState === WebSocket.OPEN) { alive = false; socket.ping(); } }, 10000);
    heartbeat.unref();
    signal.addEventListener("abort", stop, { once: true });
    socket.on("pong", () => { alive = true; });
    socket.once("open", () => { if (signal.aborted) stop(); else socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" })); });
    socket.on("message", raw => {
      if (settled || signal.aborted) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.id === 1) {
          if (message.error) { finish(new Error(message.error.message ?? "Metro refused Runtime.enable.")); return; }
          enabled = true; clearTimeout(timeout); sink.status({ source: "metro", state: "live" });
        }
        const log = parseMetroEvent(message);
        if (log) sink.log({ ...log, deviceId: target.deviceId ?? target.deviceName, process: target.appId ?? target.title, appId: target.appId });
      } catch { /* Ignore malformed inspector events. */ }
    });
    socket.once("error", error => finish(error));
    socket.once("close", () => finish(new Error(enabled ? "Metro disconnected. Waiting to reconnect." : "Could not connect to the selected Metro app.")));
  });
}
