import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { errorMessage, streamMessageSchema } from "../shared/protocol.ts";
import type { Baguette } from "./baguette.ts";
import type { SimulatorInput } from "./simulator-input.ts";

type Session = {
  udid: string;
  fps: number;
  expires: number;
  browser?: WebSocket;
  upstream?: WebSocket;
  alive: boolean;
  input: Promise<void>;
};

export class StreamSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly baguette: Baguette;
  private readonly simulatorInput: SimulatorInput;
  private readonly http = createServer( (_request, response) => { response.writeHead(404).end(); });
  private readonly websocket = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  private readonly expiry: NodeJS.Timeout;
  private origin = "";
  private disposed = false;

  constructor(baguette: Baguette, simulatorInput: SimulatorInput) {
    this.baguette = baguette;
    this.simulatorInput = simulatorInput;
    this.http.on("upgrade", (request, socket, head) => {
      const id = request.url?.slice(1);
      const session = id ? this.sessions.get(id) : undefined;
      if (session == null || session.browser || session.expires < Date.now()) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      this.websocket.handleUpgrade(request, socket, head, browser => {
        session.browser = browser;
        browser.on("error", error => { process.stderr.write(`[mobile-dev] Panel socket: ${error.message}\n`); });
        browser.on("close", () => { this.closeSession(id!); });
        browser.on("pong", () => { session.alive = true; });
        browser.on("message", (data, binary) => {
          session.input = session.input.then(async () => {
            if (binary) throw new Error("Panel input must be JSON.");
            const parsed = JSON.parse(data.toString());
            const message = streamMessageSchema.parse(parsed);
            if (session.upstream?.readyState !== WebSocket.OPEN) throw new Error("The simulator stream is reconnecting.");
            const status = await this.simulatorInput.status(session.udid);
            if (status.state === "blocked") {
              browser.send(JSON.stringify({ type: "error", error: "Device Hub blocks simulator input.", inputBlocked: true }));
              return;
            }
            if (this.sessions.get(id!) !== session || session.upstream.readyState !== WebSocket.OPEN) return;
            const encoded = JSON.stringify(message);
            session.upstream.send(encoded);
          }).catch(error => {
            if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify({ type: "error", error: errorMessage(error) }));
          });
        });
        void this.connect(session).catch(error => {
          if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify({ type: "error", error: errorMessage(error) }));
          this.closeSession(id!);
        });
      });
    });
    this.expiry = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (session.browser == null) {
          if (session.expires < Date.now()) this.closeSession(id);
        } else if (session.alive) {
          session.alive = false;
          session.browser.ping();
        } else {
          this.closeSession(id);
        }
      }
    }, 10000);
    this.expiry.unref();
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(0, "127.0.0.1", () => { this.http.off("error", reject); resolve(); });
    });
    const address = this.http.address();
    if (address == null || typeof address === "string") throw new Error("Could not start the local video endpoint.");
    this.origin = `ws://127.0.0.1:${address.port}`;
    return this.origin;
  }

  async open(udid: string, fps: number): Promise<{ id: string; url: string }> {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many open simulator streams. Close a panel and retry.");
    await this.baguette.device(udid, true);
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many open simulator streams. Close a panel and retry.");
    const bytes = randomBytes(32);
    const id = bytes.toString("hex");
    this.sessions.set(id, { udid, fps, expires: Date.now() + 60000, alive: true, input: Promise.resolve() });
    return { id, url: `${this.origin}/${id}` };
  }

  private async connect(session: Session) {
    const target = new URL(`/simulators/${session.udid}/stream?format=avcc`, this.baguette.baseUrl);
    target.protocol = "ws:";
    const upstream = new WebSocket(target, { handshakeTimeout: 5000, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false });
    session.upstream = upstream;
    upstream.on("open", () => {
      for (const message of [{ type: "set_fps", fps: session.fps }, { type: "set_scale", scale: 2 }, { type: "set_bitrate", bps: 4_000_000 }]) {
        const encoded = JSON.stringify(message);
        upstream.send(encoded);
      }
    });
    upstream.on("message", (data, binary) => {
      const browser = session.browser;
      if (browser?.readyState !== WebSocket.OPEN) return;
      if (browser.bufferedAmount > 2 * 1024 * 1024) { browser.close(1013, "Video receiver is behind"); return; }
      browser.send(data, { binary });
    });
    upstream.on("error", error => {
      process.stderr.write(`[mobile-dev] Video ${session.udid}: ${error.message}\n`);
      session.browser?.close(1011, "Simulator stream disconnected");
    });
    upstream.on("close", () => { session.browser?.close(1011, "Simulator stream disconnected"); });
  }

  closeDevice(udid: string) {
    for (const [id, session] of this.sessions) if (session.udid === udid) this.closeSession(id);
  }

  closeSession(id: string) {
    const session = this.sessions.get(id);
    if (session == null) return;
    this.sessions.delete(id);
    for (const socket of [session.browser, session.upstream]) {
      if (socket == null) continue;
      socket.close();
      const timer = setTimeout(() => { socket.terminate(); }, 1000);
      timer.unref();
      socket.once("close", () => { clearTimeout(timer); });
    }
  }

  async close() {
    this.disposed = true;
    clearInterval(this.expiry);
    for (const id of this.sessions.keys()) this.closeSession(id);
    await new Promise<void>(resolve => { this.websocket.close(() => { resolve(); }); });
    this.http.closeAllConnections();
    await new Promise<void>(resolve => { this.http.close(() => { resolve(); }); });
  }
}
