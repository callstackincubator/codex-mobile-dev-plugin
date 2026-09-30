import { spawn } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import { createConnection, createServer as createControlServer } from "node:net";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { Socket } from "node:net";
import type { CertificateMaterial } from "./local-certificate.ts";

export const STREAM_PORT = 49321;
export const STREAM_ORIGIN = `wss://127.0.0.1:${STREAM_PORT}`;
const homeDirectory = homedir();
const serviceDirectory = join(homeDirectory, "Library", "Application Support", "Mobile Dev", "streaming-v1");
const serviceSocket = join(serviceDirectory, "control.sock");
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.discriminatedUnion("method", [
  z.object({ id: z.number().int(), method: z.literal("ready") }),
  z.object({ id: z.number().int(), method: z.literal("tls"), key: z.string(), cert: z.string() }),
  z.object({ id: z.number().int(), method: z.literal("publish"), token: tokenSchema, target: z.string().url() }),
  z.object({ id: z.number().int(), method: z.literal("close"), token: tokenSchema }),
]);
const responseSchema = z.object({ id: z.number().int(), error: z.string().optional() });
type Request = z.infer<typeof requestSchema>;
type Command = Request extends infer R ? R extends Request ? Omit<R, "id"> : never : never;
type Route = { owner: Socket; target: string; expires: number; alive: boolean; browser?: WebSocket; upstream?: WebSocket };

function readLines(socket: Socket, receive: (line: string) => void) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", chunk => {
    buffer += chunk;
    if (buffer.length > 128 * 1024) {
      const error = new Error("Streaming control message is too large.");
      socket.destroy(error);
      return;
    }
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      receive(line);
      end = buffer.indexOf("\n");
    }
  });
}

export interface SharedStreaming {
  readonly origin: string;
  configureTls(material: CertificateMaterial): Promise<void>;
  publish(token: string, target: string): Promise<string>;
  closeSession(token: string): Promise<void>;
  close(): Promise<void>;
}

export class SharedStreamService implements SharedStreaming {
  readonly origin: string;
  private readonly socketPath: string;
  private readonly launch: () => void;
  private socket?: Socket;
  private connecting?: Promise<void>;
  private nextId = 0;
  private disposed = false;
  private readonly pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(options: { socketPath?: string; origin?: string; launch?: () => void } = {}) {
    this.socketPath = options.socketPath ?? serviceSocket;
    this.origin = options.origin ?? STREAM_ORIGIN;
    this.launch = options.launch ?? (() => {
      const entrypointUrl = new URL("./server.mjs", import.meta.url);
      const entrypoint = fileURLToPath(entrypointUrl);
      const child = spawn(process.execPath, [entrypoint, "--stream-service"], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
    });
  }

  private async connect() {
    if (this.disposed) throw new Error("The streaming client has closed.");
    if (this.socket && this.socket.destroyed === false) return;
    if (this.connecting) return this.connecting;
    const operation = this.connectOnce();
    this.connecting = operation;
    try { await operation; } finally { this.connecting = undefined; }
  }

  private async connectOnce() {
    let launched = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const socket = createConnection(this.socketPath);
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        });
      } catch (error) {
        socket.destroy();
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
        if (launched === false) { this.launch(); launched = true; }
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      if (this.disposed) { socket.destroy(); throw new Error("The streaming client has closed."); }
      this.socket = socket;
      socket.on("error", () => {});
      socket.on("close", () => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          const error = new Error("The shared streaming service disconnected. Press Start to reconnect.");
          request.reject(error);
        }
        this.pending.clear();
      });
      readLines(socket, line => {
        try {
          const parsed = JSON.parse(line);
          const response = responseSchema.parse(parsed);
          const request = this.pending.get(response.id);
          if (request == null) return;
          this.pending.delete(response.id);
          clearTimeout(request.timer);
          if (response.error) {
            const error = new Error(response.error);
            request.reject(error);
          }
          else request.resolve();
        } catch {
          const error = new Error("Invalid streaming control response.");
          socket.destroy(error);
        }
      });
      await this.send({ method: "ready" });
      return;
    }
    throw new Error("The shared streaming service could not start. Its fixed loopback port 49321 may be occupied.");
  }

  private async send(command: Command) {
    const id = ++this.nextId;
    const encoded = JSON.stringify({ ...command, id });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error("The shared streaming service did not respond.");
        reject(error);
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(`${encoded}\n`);
    });
  }

  async configureTls(material: CertificateMaterial) {
    await this.connect();
    const key = material.key.toString();
    const cert = material.cert.toString();
    await this.send({ method: "tls", key, cert });
  }

  async publish(token: string, target: string) {
    await this.connect();
    await this.send({ method: "publish", token, target });
    return `${this.origin}/${token}`;
  }

  async closeSession(token: string) {
    if (this.socket == null || this.socket.destroyed) return;
    await this.send({ method: "close", token });
  }

  async close() { this.disposed = true; this.socket?.destroy(); }
}

export async function startStreamService(options: { socketPath?: string; port?: number; idleMs?: number } = {}) {
  const socketPath = options.socketPath ?? serviceSocket;
  const port = options.port ?? STREAM_PORT;
  const idleMs = options.idleMs ?? 30000;
  const directory = dirname(socketPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const routes = new Map<string, Route>();
  const owners = new Set<Socket>();
  const http = createHttpsServer({ minVersion: "TLSv1.2" }, (_request, response) => { response.writeHead(404).end(); });
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  let idle: NodeJS.Timeout | undefined;
  let closed = false;

  function drop(token: string) {
    const route = routes.get(token);
    if (route == null) return;
    routes.delete(token);
    route.browser?.terminate();
    route.upstream?.terminate();
  }

  http.on("upgrade", (request, socket, head) => {
    const token = request.url?.slice(1) ?? "";
    const route = routes.get(token);
    if (route == null || route.browser || route.expires < Date.now()) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    websocket.handleUpgrade(request, socket, head, browser => {
      route.browser = browser;
      browser.on("pong", () => { route.alive = true; });
      const upstream = new WebSocket(route.target, { handshakeTimeout: 5000, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false });
      route.upstream = upstream;
      browser.on("error", () => { drop(token); });
      browser.on("close", () => { drop(token); });
      upstream.on("error", () => { drop(token); });
      upstream.on("close", () => { drop(token); });
      browser.on("message", (data, binary) => {
        if (upstream.readyState !== WebSocket.OPEN) { drop(token); return; }
        if (upstream.bufferedAmount > 64 * 1024) { drop(token); return; }
        upstream.send(data, { binary });
      });
      upstream.on("message", (data, binary) => {
        if (browser.readyState !== WebSocket.OPEN) return;
        if (browser.bufferedAmount > 2 * 1024 * 1024) { drop(token); return; }
        browser.send(data, { binary });
      });
    });
  });
  const expiry = setInterval(() => {
    for (const [token, route] of routes) {
      if (route.browser == null) {
        if (route.expires < Date.now()) drop(token);
      } else if (route.alive) {
        route.alive = false;
        route.browser.ping();
      } else drop(token);
    }
  }, 10000);
  expiry.unref();
  const control = createControlServer(owner => {
    clearTimeout(idle);
    owners.add(owner);
    owner.on("error", () => {});
    owner.on("close", () => {
      owners.delete(owner);
      for (const [token, route] of routes) if (route.owner === owner) drop(token);
      if (owners.size === 0 && closed === false) idle = setTimeout(() => { void close(); }, idleMs);
    });
    readLines(owner, line => {
      let id = 0;
      try {
        const parsed = JSON.parse(line);
        const request = requestSchema.parse(parsed);
        id = request.id;
        if (request.method === "tls") http.setSecureContext({ key: request.key, cert: request.cert });
        if (request.method === "publish") {
          if (routes.size >= 64) throw new Error("Too many open simulator streams.");
          const target = new URL(request.target);
          if (target.protocol !== "ws:" || target.hostname !== "127.0.0.1" || target.pathname !== `/${request.token}` || target.username || target.password || target.search || target.hash) {
            throw new Error("Invalid local streaming target.");
          }
          if (routes.has(request.token)) throw new Error("This stream token is already registered.");
          routes.set(request.token, { owner, target: target.href, expires: Date.now() + 60000, alive: true });
        }
        if (request.method === "close") {
          const route = routes.get(request.token);
          if (route?.owner === owner) drop(request.token);
        }
        const response = JSON.stringify({ id });
        owner.write(`${response}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid streaming request.";
        const response = JSON.stringify({ id, error: message });
        owner.write(`${response}\n`);
      }
    });
  });

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(expiry);
    clearTimeout(idle);
    for (const token of routes.keys()) drop(token);
    for (const owner of owners) owner.destroy();
    http.closeAllConnections();
    await new Promise<void>(resolve => { websocket.close(() => { resolve(); }); });
    await new Promise<void>(resolve => { http.close(() => { resolve(); }); });
    await new Promise<void>(resolve => { control.close(() => { resolve(); }); });
  }

  try {
    // The TCP listener arbitrates concurrent launches before any process owns the control socket.
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, "127.0.0.1", () => { http.off("error", reject); resolve(); });
    });
    await unlink(socketPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await new Promise<void>((resolve, reject) => {
      control.once("error", reject);
      control.listen(socketPath, () => { control.off("error", reject); resolve(); });
    });
    await chmod(socketPath, 0o600);
    idle = setTimeout(() => { void close(); }, idleMs);
    const address = http.address();
    if (address == null || typeof address === "string") throw new Error("No local streaming address.");
    return { origin: `wss://127.0.0.1:${address.port}`, close };
  } catch (error) { await close(); throw error; }
}
