import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { errorMessage, streamMessageSchema } from "../shared/protocol.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import type { Baguette } from "./baguette.ts";

type Frame = { sequence: number; data: string };
type Session = {
  udid: string;
  fps: number;
  socket?: WebSocket;
  connecting?: Promise<void>;
  expires: number;
  sequence: number;
  frame?: Frame;
  error?: string;
  closed: boolean;
  failures: number;
  retryAt: number;
  pingAt?: number;
  openedAt?: number;
  resetAt?: number;
  waiters: Set<() => void>;
};

export class StreamSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly baguette: Baguette;
  private readonly expiry: NodeJS.Timeout;
  private readonly retryDelays: readonly number[];
  private disposed = false;
  private readonly idleTimeout = 5 * 60 * 1000;
  private readonly firstFrameTimeout: number;

  constructor(baguette: Baguette, retryDelays: readonly number[] = [500, 1000, 2000, 5000, 10000], firstFrameTimeout = 10000) {
    this.baguette = baguette;
    this.retryDelays = retryDelays;
    this.firstFrameTimeout = firstFrameTimeout;
    this.expiry = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (session.expires < Date.now()) { this.closeSession(id); continue; }
        this.checkFirstFrame(session);
        if (session.socket?.readyState !== WebSocket.OPEN) continue;
        if (session.pingAt && Date.now() - session.pingAt >= 20000) session.socket.terminate();
        else if (!session.pingAt) { session.pingAt = Date.now(); session.socket.ping(); }
      }
    }, 10000);
    this.expiry.unref();
  }

  private notify(session: Session) {
    for (const resolve of session.waiters) resolve();
    session.waiters.clear();
  }

  async open(udid: string, fps: number): Promise<string> {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many open simulator streams. Close a panel and retry.");
    const id = randomBytes(32).toString("hex");
    const session: Session = {
      udid, fps, expires: Date.now() + this.idleTimeout, sequence: 0, closed: false,
      failures: 0, retryAt: 0, waiters: new Set(),
    };
    this.sessions.set(id, session);
    try { await this.connect(session); return id; }
    catch (error) { this.closeSession(id); throw error; }
  }

  private async connect(session: Session) {
    await this.baguette.device(session.udid, true);
    if (session.closed || this.disposed) return;
    const target = new URL(`/simulators/${session.udid}/stream?format=mjpeg`, this.baguette.baseUrl);
    target.protocol = "ws:";
    const socket = new WebSocket(target, { handshakeTimeout: 5000, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false });
    session.socket = socket;
    session.frame = undefined;
    session.pingAt = undefined;
    socket.on("pong", () => { if (session.socket === socket) session.pingAt = undefined; });
    socket.on("message", (data, binary) => {
      if (session.closed || session.socket !== socket) return;
      if (binary) {
        session.frame = { sequence: ++session.sequence, data: Buffer.from(data as Buffer).toString("base64") };
        session.failures = 0;
      } else {
        try {
          const message = JSON.parse(data.toString());
          if (message.ok === false || message.error) session.error = message.error ?? "Baguette rejected the stream request.";
        } catch { session.error = "Baguette returned an unreadable stream message."; }
      }
      this.notify(session);
    });
    socket.on("error", error => {
      if (!session.closed && session.socket === socket) process.stderr.write(`[mobile-dev] Stream ${session.udid}: ${error.message}\n`);
      this.notify(session);
    });
    socket.on("close", (code, reason) => {
      if (session.closed || session.socket !== socket) return;
      session.socket = undefined;
      session.frame = undefined;
      session.openedAt = undefined;
      session.pingAt = undefined;
      process.stderr.write(`[mobile-dev] Stream ${session.udid} closed: code=${code} reason=${reason.toString() || "none"}. Reconnecting on the next read.\n`);
      this.notify(session);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const opened = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const closed = () => failed(new Error("The simulator stream closed before connecting."));
        const cleanup = () => { socket.off("open", opened); socket.off("error", failed); socket.off("close", closed); };
        socket.once("open", opened); socket.once("error", failed); socket.once("close", closed);
      });
      if (session.closed || this.disposed) { socket.close(); return; }
      session.openedAt = Date.now();
      socket.send(JSON.stringify({ type: "set_fps", fps: session.fps }));
      this.notify(session);
    } catch (error) { socket.terminate(); throw error; }
  }

  private reconnect(session: Session) {
    if (session.closed || session.error || session.connecting || session.socket?.readyState === WebSocket.OPEN || Date.now() < session.retryAt) return;
    this.invalidate(session);
    session.connecting = this.connect(session).catch(error => {
      if (session.closed) return;
      if (error instanceof SimulatorUnavailableError) session.error = error.message;
      else {
        const wait = this.retryDelays[Math.min(session.failures++, this.retryDelays.length - 1)] ?? 10000;
        session.retryAt = Date.now() + wait;
        process.stderr.write(`[mobile-dev] Stream ${session.udid} reconnect failed: ${errorMessage(error)} Retry in ${wait}ms.\n`);
      }
      this.notify(session);
    }).finally(() => { session.connecting = undefined; this.notify(session); });
  }

  private invalidate(session: Session) {
    const socket = session.socket;
    session.socket = undefined;
    session.frame = undefined;
    session.pingAt = undefined;
    session.openedAt = undefined;
    socket?.terminate();
    this.notify(session);
  }

  private checkFirstFrame(session: Session) {
    // MJPEG emits only changed pixels. A quiet screen after the first frame is healthy.
    if (session.frame || session.openedAt === undefined || Date.now() - session.openedAt < this.firstFrameTimeout) return;
    this.invalidate(session);
    const wait = this.retryDelays[Math.min(session.failures++, this.retryDelays.length - 1)] ?? 10000;
    session.retryAt = Date.now() + wait;
  }

  reset(id: string) {
    const session = this.session(id);
    if (session.error) throw new Error(session.error);
    if (session.socket && !session.connecting) {
      this.invalidate(session);
      session.retryAt = Math.max(Date.now(), (session.resetAt ?? 0) + 1000);
      session.resetAt = session.retryAt;
    }
    this.reconnect(session);
  }

  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.expires < Date.now()) {
      if (session) this.closeSession(id);
      throw new Error("The simulator stream expired or closed.");
    }
    session.expires = Date.now() + this.idleTimeout;
    this.checkFirstFrame(session);
    return session;
  }

  connectionState(id: string): "connected" | "reconnecting" {
    const session = this.session(id);
    return session.socket?.readyState === WebSocket.OPEN && !session.connecting && session.frame ? "connected" : "reconnecting";
  }

  async frame(id: string, after: number): Promise<Frame | undefined> {
    const session = this.session(id);
    if (session.error) throw new Error(session.error);
    this.reconnect(session);
    if (!session.error && (!session.frame || session.frame.sequence <= after)) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); session.waiters.delete(done); resolve(); };
        const timer = setTimeout(done, 1000);
        session.waiters.add(done);
      });
    }
    if (session.error) throw new Error(session.error);
    if (this.sessions.get(id) !== session) throw new Error("The simulator stream closed.");
    return session.socket?.readyState === WebSocket.OPEN && session.frame && session.frame.sequence > after ? session.frame : undefined;
  }

  input(id: string, messages: unknown[]): number {
    const session = this.session(id);
    if (session.error) throw new Error(session.error);
    if (session.socket?.readyState !== WebSocket.OPEN || session.connecting || !session.frame) throw new Error("The simulator stream is reconnecting.");
    const validated = messages.map(message => streamMessageSchema.parse(message));
    for (const message of validated) session.socket.send(JSON.stringify(message));
    return validated.length;
  }

  deviceId(id: string): string { return this.session(id).udid; }

  closeDevice(udid: string) {
    for (const [id, session] of this.sessions) if (session.udid === udid) this.closeSession(id);
  }

  closeSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.closed = true;
    this.notify(session);
    const socket = session.socket;
    if (!socket) return;
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close();
    const deadline = setTimeout(() => socket.terminate(), 1000);
    deadline.unref();
    socket.once("close", () => clearTimeout(deadline));
  }

  close() {
    this.disposed = true;
    clearInterval(this.expiry);
    for (const id of this.sessions.keys()) this.closeSession(id);
  }
}
