import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { streamMessageSchema } from "../shared/protocol.ts";
import type { FrameRead } from "../shared/stream.ts";
import { epochNow } from "../shared/stream.ts";
import type { Baguette } from "./baguette.ts";

type Session = {
  udid: string;
  expires: number;
  socket: WebSocket;
  sequence: number;
  latest?: { sequence: number; bytes: Buffer; receivedAt: number; data?: string };
  error?: Error;
  pingAt?: number;
  waiters: Set<() => void>;
  input: Promise<number>;
};

export class StreamSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly expiry: NodeJS.Timeout;
  private disposed = false;
  private readonly baguette: Baguette;

  constructor(baguette: Baguette) {
    this.baguette = baguette;
    this.expiry = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (session.expires < now) { this.closeSession(id); continue; }
        if (session.socket.readyState !== WebSocket.OPEN) continue;
        if (session.pingAt == null) {
          session.pingAt = now;
          session.socket.ping();
        } else if (now - session.pingAt >= 20000) {
          session.socket.terminate();
        }
      }
    }, 10000);
    this.expiry.unref();
  }

  async open(udid: string, fps: number): Promise<string> {
    this.checkCapacity();
    await this.baguette.device(udid, true);
    this.checkCapacity();
    const random = randomBytes(32);
    const id = random.toString("hex");
    const target = new URL(`/simulators/${udid}/stream?format=mjpeg`, this.baguette.baseUrl);
    target.protocol = "ws:";
    const socket = new WebSocket(target, { handshakeTimeout: 5000, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false });
    const session: Session = { udid, socket, expires: Date.now() + 300000, sequence: 0, waiters: new Set(), input: Promise.resolve(0) };
    this.sessions.set(id, session);
    socket.on("pong", () => { session.pingAt = undefined; });
    socket.on("message", (data, binary) => {
      if (this.sessions.get(id) !== session) return;
      if (binary) {
        let bytes: Buffer;
        if (Buffer.isBuffer(data)) bytes = data;
        else if (Array.isArray(data)) bytes = Buffer.concat(data);
        else bytes = Buffer.from(data);
        session.latest = { sequence: ++session.sequence, bytes, receivedAt: Date.now() };
      } else {
        try {
          const message = JSON.parse(data.toString());
          if (message.ok === false || message.error) {
            const error = new Error(message.error ?? "Baguette rejected the stream request.");
            this.fail(session, error);
          }
        } catch {
          const error = new Error("Baguette returned an unreadable stream message.");
          this.fail(session, error);
        }
      }
      this.notify(session);
    });
    socket.on("error", error => { this.fail(session, error); });
    socket.on("close", () => {
      const error = new Error("The simulator stream disconnected.");
      this.fail(session, error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { socket.off("open", opened); socket.off("error", failed); socket.off("close", closed); };
        const opened = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const closed = () => {
          const error = new Error("The simulator stream closed before connecting.");
          failed(error);
        };
        socket.once("open", opened);
        socket.once("error", failed);
        socket.once("close", closed);
      });
      this.session(id);
      for (const message of [{ type: "set_fps", fps }, { type: "set_scale", scale: 2 }]) {
        const encoded = JSON.stringify(message);
        socket.send(encoded);
      }
      return id;
    } catch (error) { this.closeSession(id); throw error; }
  }

  private checkCapacity() {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many open simulator streams. Close a panel and retry.");
  }

  private notify(session: Session) {
    for (const resolve of session.waiters) resolve();
    session.waiters.clear();
  }

  private fail(session: Session, error: Error) {
    session.error ??= error;
    session.latest = undefined;
    this.notify(session);
  }

  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (session == null || session.expires < Date.now()) {
      this.closeSession(id);
      throw new Error("The simulator stream expired or closed.");
    }
    session.expires = Date.now() + 300000;
    if (session.error) throw session.error;
    return session;
  }

  async frame(id: string, after: number, signal?: AbortSignal): Promise<FrameRead> {
    const serverStartedAt = epochNow();
    const started = performance.now();
    const session = this.session(id);
    if (session.latest == null || session.latest.sequence <= after) {
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          session.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, 1000);
        session.waiters.add(done);
        signal?.addEventListener("abort", done, { once: true });
        if (signal?.aborted) done();
      });
    }
    signal?.throwIfAborted();
    this.session(id);
    const serverWaitMs = performance.now() - started;
    const latest = session.latest;
    if (latest == null || latest.sequence <= after) {
      const serverPreparedAt = epochNow();
      return { serverWaitMs, serverStartedAt, serverPreparedAt };
    }
    latest.data ??= latest.bytes.toString("base64");
    const serverPreparedAt = epochNow();
    return { serverWaitMs, serverStartedAt, serverPreparedAt, frame: { sequence: latest.sequence, data: latest.data, receivedAt: latest.receivedAt, bytes: latest.bytes.length } };
  }

  deviceId(id: string): string { return this.session(id).udid; }

  input(id: string, messages: unknown[]): Promise<number> {
    const session = this.session(id);
    const validated = messages.map(message => streamMessageSchema.parse(message));
    const send = session.input.then(() => {
      this.session(id);
      if (session.socket.readyState !== WebSocket.OPEN) throw new Error("The simulator stream disconnected.");
      if (session.socket.bufferedAmount > 64 * 1024) throw new Error("Simulator input is backed up.");
      for (const message of validated) {
        const encoded = JSON.stringify(message);
        session.socket.send(encoded);
      }
      return validated.length;
    });
    session.input = send.catch(() => 0);
    return send;
  }

  closeDevice(udid: string) {
    for (const [id, session] of this.sessions) if (session.udid === udid) this.closeSession(id);
  }

  closeSession(id: string) {
    const session = this.sessions.get(id);
    if (session == null) return;
    this.sessions.delete(id);
    this.notify(session);
    session.socket.close();
    const timer = setTimeout(() => { session.socket.terminate(); }, 1000);
    timer.unref();
    session.socket.once("close", () => { clearTimeout(timer); });
  }

  close() {
    this.disposed = true;
    clearInterval(this.expiry);
    for (const id of this.sessions.keys()) this.closeSession(id);
  }
}
