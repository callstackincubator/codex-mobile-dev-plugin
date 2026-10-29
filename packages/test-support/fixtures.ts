import { createServer } from "node:http";
import { EventEmitter, once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { WebSocketServer } from "ws";
import type { InputStatus } from "../core/src/simulator-input.ts";
import { createPlugin } from "../core/src/plugin.ts";
import { Simctl } from "../core/src/simctl.ts";
import { Baguette } from "../core/src/baguette.ts";
import type { BaguetteLauncher, BaguetteOptions } from "../core/src/baguette.ts";

export const createTestPlugin = createPlugin;

export const UDID = "B5C969F6-58A4-4C31-AB12-FB9E56D681DE";
export const OTHER_UDID = "A17F4F36-7E21-4CA0-8ACD-BBB530887763";

/** simctl listing a booted iPhone (UDID) and a stopped iPad (OTHER_UDID), as the fake Baguette does. */
export function fakeSimctl() {
  return new Simctl(async () => JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
    { udid: UDID, name: "iPhone 17", state: "Booted", isAvailable: true },
    { udid: OTHER_UDID, name: "iPad", state: "Shutdown", isAvailable: true },
  ] } }));
}
export const SCREEN = { width: 393, height: 852 };
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

export function fakeSimulatorInput() {
  let state: InputStatus["state"] = "ready";
  const repairs: string[] = [];
  return {
    repairs,
    block() { state = "blocked"; },
    async status(): Promise<InputStatus> { return { state }; },
    async repair(udid: string): Promise<InputStatus> { repairs.push(udid); state = "ready"; return { state }; },
  };
}

/** A process that runs until it is killed, standing in for the bundled Baguette. */
export function fakeProcess(): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null, signalCode: null as NodeJS.Signals | null, stdout: null, stderr: null,
    kill(signal: NodeJS.Signals = "SIGTERM") {
      if (child.signalCode !== null) return false;
      child.signalCode = signal;
      queueMicrotask(() => { child.emit("exit", null, signal); child.emit("close", null, signal); });
      return true;
    },
  });
  return child as unknown as ChildProcess;
}

/** Starts Baguette by attaching to a fake backend at `url`, since tests cannot run the bundled one. */
export function attachBaguette(url: string): BaguetteLauncher {
  return async () => ({ child: fakeProcess(), url });
}

export function attachedBaguette(url: string, options: Omit<BaguetteOptions, "launchBackend"> = {}) {
  return new Baguette({ ...options, launchBackend: attachBaguette(url) });
}

export async function fakeBaguette() {
  let state = "Booted";
  let sendFrames = true;
  let lifecycleState: string | undefined;
  let lifecycleFails = false;
  const inputs: unknown[] = [];
  const settings = { appearance: "light", contentSize: "large", increaseContrast: "disabled" };
  const requests: { path: string; origin?: string }[] = [];
  const http = createServer(async (request, response) => {
    requests.push({ path: request.url!, origin: request.headers.origin });
    const path = new URL(request.url!, "http://localhost").pathname;
    response.setHeader("Content-Type", "application/json");
    if (path === "/simulators.json") {
      response.end(JSON.stringify({
        running: state === "Booted" ? [{ udid: UDID, name: "iPhone 17", state, runtime: "iOS 26.0" }] : [],
        available: [{ udid: UDID, name: "iPhone 17", state, runtime: "iOS 26.0" }, { udid: OTHER_UDID, name: "iPad", state: "Shutdown", runtime: "iOS 26.0" }],
      }));
    } else if (path.endsWith("/interface.json") || path.endsWith("/interface")) {
      if (request.method === "POST") { let body = ""; for await (const chunk of request) body += chunk; Object.assign(settings, JSON.parse(body)); }
      response.end(JSON.stringify(settings));
    } else if (path.endsWith("/definition.json")) {
      const definition = { identity: { udid: UDID, name: "iPhone 17", model: "iPhone 17" }, screen: { rect: SCREEN, maskImage: null } };
      const body = JSON.stringify(definition);
      response.end(body);
    } else if (path.endsWith("/boot")) {
      if (lifecycleFails) { response.end('{"ok":false,"error":"boot failed"}'); return; }
      state = lifecycleState ?? "Booted"; response.end('{"ok":true}');
    } else if (path.endsWith("/shutdown")) {
      state = "Shutdown"; response.end('{"ok":true}');
    } else if (path.endsWith("/describe-ui.json")) {
      response.end(JSON.stringify({ elements: [{ label: "Continue", frame: { x: 10, y: 20, width: 100, height: 40 } }] }));
    } else if (path.endsWith("/screenshot.png")) {
      response.setHeader("Content-Type", "image/png"); response.end(PNG);
    } else {
      response.writeHead(404).end('{"error":"not found"}');
    }
  });
  const websocket = new WebSocketServer({ server: http });
  websocket.on("connection", (socket, request) => {
    requests.push({ path: request.url!, origin: request.headers.origin });
    socket.on("message", data => {
      const message = JSON.parse(data.toString());
      inputs.push(message);
      if (message.type === "set_fps" && sendFrames) socket.send(PNG, { binary: true });
    });
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`, inputs, requests, websocket,
    setState(next: string) { state = next; },
    setFrames(enabled: boolean) { sendFrames = enabled; },
    setLifecycleState(next?: string) { lifecycleState = next; },
    setLifecycleFailure(enabled: boolean) { lifecycleFails = enabled; },
    async close() {
      for (const client of websocket.clients) client.terminate();
      await new Promise<void>(resolve => websocket.close(() => resolve()));
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}
