import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import type { InputStatus } from "../src/server/simulator-input.ts";

export const UDID = "B5C969F6-58A4-4C31-AB12-FB9E56D681DE";
export const OTHER_UDID = "A17F4F36-7E21-4CA0-8ACD-BBB530887763";
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

export async function fakeBaguette() {
  let state = "Booted";
  let inputFails = false;
  const inputs: unknown[] = [];
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
    } else if (path.endsWith("/definition.json")) {
      response.end(JSON.stringify({ identity: { udid: UDID, name: "iPhone 17", model: "iPhone 17" }, screen: { rect: SCREEN } }));
    } else if (path.endsWith("/boot")) {
      state = "Booted"; response.end('{"ok":true}');
    } else if (path.endsWith("/shutdown")) {
      state = "Shutdown"; response.end('{"ok":true}');
    } else if (path.endsWith("/input")) {
      let body = "";
      for await (const chunk of request) body += chunk;
      inputs.push(JSON.parse(body));
      response.end(inputFails ? '{"ok":false,"error":"input rejected"}' : '{"ok":true}');
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
      if (message.type === "set_fps") socket.send(PNG, { binary: true });
    });
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`, inputs, requests, websocket,
    setState(next: string) { state = next; },
    setInputFailure() { inputFails = true; },
    async close() {
      for (const client of websocket.clients) client.terminate();
      await new Promise<void>(resolve => websocket.close(() => resolve()));
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}

export async function fakeCertificate() {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execute = promisify(execFile);
  const root = tmpdir();
  const prefix = join(root, "mobile-dev-test-cert-");
  const directory = await mkdtemp(prefix);
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  try {
    await execute("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyPath, "-out", certPath]);
    const key = await readFile(keyPath);
    const cert = await readFile(certPath);
    let state: "ready" | "missing" = "ready";
    let setups = 0;
    return {
      key, cert,
      get setups() { return setups; },
      missing() { state = "missing"; },
      async status() { return { state }; },
      async material() { return state === "ready" ? { key, cert } : undefined; },
      async setup() { setups++; state = "ready"; return { state }; },
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function fakeStreamingService() {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { startStreamService, SharedStreamService } = await import("../src/server/shared-stream-service.ts");
  const root = tmpdir();
  const prefix = join(root, "mobile-stream-service-");
  const directory = await mkdtemp(prefix);
  const socketPath = join(directory, "control.sock");
  const service = await startStreamService({ socketPath, port: 0 });
  return {
    origin: service.origin,
    socketPath,
    client() { return new SharedStreamService({ socketPath, origin: service.origin, launch() { throw new Error("The test streaming service stopped unexpectedly."); } }); },
    async close() { await service.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
