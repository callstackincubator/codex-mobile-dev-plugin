import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { videoPacket } from "../shared/android-video.ts";
import { inputSchema } from "../shared/protocol.ts";
import type { ServeEmu } from "./serve-emu.ts";

type Packet = { sequence: number; data: string };
type Session = {
  deviceId: string; url: URL; socket: WebSocket; packets: Packet[]; bytes: number; sequence: number;
  generation: number; waitingForKey: boolean; lastReset?: number; expires: number; error?: string; waiters: Set<() => void>;
};

export function androidInput(value: unknown): Record<string, unknown> {
  const input = inputSchema.parse(value);
  const unit = (coordinate: number, size: number) => Math.max(0, Math.min(1, coordinate / size));
  switch (input.type) {
    case "tap": return { type: "tap", x: unit(input.x, input.width), y: unit(input.y, input.height) };
    case "swipe": return { type: "swipe", x1: unit(input.startX, input.width), y1: unit(input.startY, input.height), x2: unit(input.endX, input.width), y2: unit(input.endY, input.height), durationMs: (input.duration ?? .3) * 1000 };
    case "touch1-down": case "touch1-move": case "touch1-up":
      return { type: "touch", action: input.type.slice(7), x: unit(input.x, input.width), y: unit(input.y, input.height), pointerId: 0 };
    case "type": return { type: "text", text: input.text };
    case "button": {
      const buttons: Record<string, string> = { home: "home", back: "back", power: "power", lock: "power", "app-switcher": "recents" };
      const button = buttons[input.button];
      if (button) return { type: button };
      if (input.button === "volume-up" || input.button === "volume-down") return { type: "key", keycode: input.button === "volume-up" ? 24 : 25 };
      throw new Error("This hardware button is not supported on Android.");
    }
    case "key": {
      const keys: Record<string, number> = { Enter: 66, Escape: 4, Backspace: 67, Tab: 61, Space: 62, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22 };
      const keycode = keys[input.code] ?? (input.code.startsWith("Key") ? input.code.charCodeAt(3) - 65 + 29 : input.code.startsWith("Digit") ? Number(input.code.slice(5)) + 7 : undefined);
      if (keycode === undefined) throw new Error("This key is not supported on Android.");
      const modifiers = input.modifiers ?? [];
      const metaState = (modifiers.includes("shift") ? 1 : 0) | (modifiers.includes("option") ? 2 : 0) | (modifiers.includes("control") || modifiers.includes("command") ? 4096 : 0);
      return { type: "key", keycode, metaState };
    }
  }
}

export class AndroidStreams {
  private readonly sessions = new Map<string, Session>();
  private readonly backend: ServeEmu;
  private readonly expiry: NodeJS.Timeout;
  private disposed = false;

  constructor(backend: ServeEmu) {
    this.backend = backend;
    this.expiry = setInterval(() => {
      for (const [id, session] of this.sessions) if (session.expires < Date.now()) this.closeSession(id);
    }, 10000);
    this.expiry.unref();
  }

  private notify(session: Session) { for (const done of session.waiters) done(); session.waiters.clear(); }

  async open(deviceId: string) {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many Android streams. Close a panel and retry.");
    const backend = await this.backend.start(deviceId);
    if (this.disposed) throw new Error("The plugin server has closed.");
    const url = new URL("/ws?frame-meta=1", backend.url); url.protocol = "ws:";
    const socket = new WebSocket(url, { handshakeTimeout: 5000, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
    const id = randomBytes(32).toString("hex");
    const session: Session = { deviceId, url: backend.url, socket, packets: [], bytes: 0, sequence: 0, generation: 0, waitingForKey: false, expires: Date.now() + 300000, waiters: new Set() };
    this.sessions.set(id, session);
    socket.on("message", (data, binary) => {
      if (!this.sessions.has(id)) return;
      if (binary) {
        const packet = Buffer.from(data as Buffer);
        if (session.waitingForKey) {
          try { if (!videoPacket(packet).key) return; }
          catch { this.requestKey(session); return; }
          session.waitingForKey = false;
        }
        if (session.bytes + packet.length > 4 * 1024 * 1024 || session.packets.length >= 120) {
          this.resetVideo(session);
        } else {
          session.bytes += packet.length;
          session.packets.push({ sequence: ++session.sequence, data: packet.toString("base64") });
        }
      } else {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "video-session") { this.clearVideo(session); this.requestKey(session); }
          if (message.ok === false) session.error = message.error ?? "Android input failed.";
        } catch { session.error = "serve-emu returned an unreadable stream message."; }
      }
      this.notify(session);
    });
    socket.on("error", error => { session.error = error.message; this.notify(session); });
    socket.on("close", () => { session.error ??= "The Android stream disconnected."; this.notify(session); });
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { socket.off("open", opened); socket.off("error", failed); socket.off("close", closed); };
        const opened = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const closed = () => failed(new Error("The Android stream closed before connecting."));
        socket.once("open", opened); socket.once("error", failed); socket.once("close", closed);
      });
      this.requestKey(session);
      return id;
    } catch (error) { this.closeSession(id); throw error; }
  }

  private clearVideo(session: Session) {
    session.generation++;
    session.packets = []; session.bytes = 0; session.waitingForKey = true;
  }

  private requestKey(session: Session) {
    if (session.socket.readyState !== WebSocket.OPEN || (session.lastReset !== undefined && Date.now() - session.lastReset < 1000)) return;
    session.lastReset = Date.now();
    session.socket.send(JSON.stringify({ type: "reset-video", ack: false }));
  }

  private resetVideo(session: Session) {
    if (!session.waitingForKey) this.clearVideo(session);
    this.requestKey(session);
    this.notify(session);
  }

  async reset(id: string) {
    const session = this.session(id);
    await this.backend.assertDevice(session.deviceId, session.url);
    if (!this.sessions.has(id) || session.socket.readyState !== WebSocket.OPEN) throw new Error("The Android stream disconnected.");
    if (session.error) throw new Error(session.error);
    this.resetVideo(session);
  }

  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session || session.expires < Date.now()) { this.closeSession(id); throw new Error("The Android stream expired or closed."); }
    session.expires = Date.now() + 300000;
    return session;
  }

  async batch(id: string, after: number) {
    const session = this.session(id);
    await this.backend.assertDevice(session.deviceId, session.url);
    if (!session.error && !session.packets.some(packet => packet.sequence > after)) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); session.waiters.delete(done); resolve(); };
        const timer = setTimeout(done, 1000); session.waiters.add(done);
      });
    }
    if (!this.sessions.has(id)) throw new Error("The Android stream closed.");
    if (session.error) throw new Error(session.error);
    if (session.waitingForKey) this.requestKey(session);
    const packets = session.packets.filter(packet => packet.sequence > after);
    session.packets = []; session.bytes = 0;
    return { generation: session.generation, packets, sequence: packets.at(-1)?.sequence ?? after };
  }

  async input(id: string, messages: unknown[]) {
    const session = this.session(id);
    await this.backend.assertDevice(session.deviceId, session.url);
    if (!this.sessions.has(id)) throw new Error("The Android stream closed.");
    if (session.error || session.socket.readyState !== WebSocket.OPEN) throw new Error(session.error ?? "The Android stream disconnected.");
    // Validate the full batch before sending any input.
    const validated = messages.map(androidInput);
    for (const message of validated) session.socket.send(JSON.stringify({ ...message, ack: false, record: false }));
    return validated.length;
  }

  closeDevice(deviceId: string) { for (const [id, session] of this.sessions) if (session.deviceId === deviceId) this.closeSession(id); }
  closeSession(id: string) {
    const session = this.sessions.get(id); if (!session) return;
    this.sessions.delete(id); this.notify(session);
    if (session.socket.readyState === WebSocket.CONNECTING) session.socket.terminate();
    else session.socket.close();
    const timer = setTimeout(() => session.socket.terminate(), 1000); timer.unref();
    session.socket.once("close", () => clearTimeout(timer));
  }
  close() { this.disposed = true; clearInterval(this.expiry); for (const id of this.sessions.keys()) this.closeSession(id); }
}
