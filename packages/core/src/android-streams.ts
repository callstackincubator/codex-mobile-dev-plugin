import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { WebSocket } from "ws";
import { videoPacket } from "@mobile-dev/shared/android-video.ts";
import { inputSchema } from "@mobile-dev/shared/protocol.ts";
import type { ServeEmu, ServeEmuBackend } from "./serve-emu.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { SessionRegistry } from "./session-registry.ts";
import { Waiters } from "./revision-buffer.ts";
import { awaitOpen, closeGracefully } from "./ws-session.ts";

type Packet = { sequence: number; data: string };
type Session = {
  deviceId: string; backend: ServeEmuBackend; socket: WebSocket; packets: Packet[]; bytes: number; sequence: number;
  generation: number; waitingForKey: boolean; lastReset?: number; error?: string; waiters: Waiters; closed: boolean;
  /** Set when the user's backend turned out to stream another device. */
  switched?: SimulatorUnavailableError;
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
      throw new ExpectedOperationError("invalid_input", "This hardware button is not supported on Android.");
    }
    case "key": {
      const keys: Record<string, number> = { Enter: 66, Escape: 4, Backspace: 67, Tab: 61, Space: 62, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22 };
      const keycode = keys[input.code] ?? (input.code.startsWith("Key") ? input.code.charCodeAt(3) - 65 + 29 : input.code.startsWith("Digit") ? Number(input.code.slice(5)) + 7 : undefined);
      if (keycode === undefined) throw new ExpectedOperationError("invalid_input", "This key is not supported on Android.");
      const modifiers = input.modifiers ?? [];
      const metaState = (modifiers.includes("shift") ? 1 : 0) | (modifiers.includes("option") ? 2 : 0) | (modifiers.includes("control") || modifiers.includes("command") ? 4096 : 0);
      return { type: "key", keycode, metaState };
    }
  }
}

export class AndroidStreams {
  private readonly sessions = new SessionRegistry<Session>({
    limit: 8, name: "Android stream",
    limitMessage: "Too many Android streams. Close a panel and retry.",
    expiredMessage: "The Android stream expired or closed.",
    deviceId: session => session.deviceId,
    stop: session => { session.closed = true; session.waiters.wake(); closeGracefully(session.socket); },
  });
  private readonly backend: ServeEmu;

  constructor(backend: ServeEmu) { this.backend = backend; }

  private notify(session: Session) { session.waiters.wake(); }

  async open(deviceId: string) {
    let session!: Session;
    const id = await this.sessions.open(async () => {
      const backend = await this.backend.start(deviceId);
      const url = new URL("/ws?frame-meta=1", backend.url); url.protocol = "ws:";
      const socket = new WebSocket(url, { handshakeTimeout: 5000, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
      session = { deviceId, backend, socket, packets: [], bytes: 0, sequence: 0, generation: 0, waitingForKey: false, waiters: new Waiters(), closed: false };
      this.listen(session);
      return session;
    });
    try {
      await awaitOpen(session.socket, "The Android stream closed before connecting.");
      this.requestKey(session);
      return id;
    } catch (error) { void this.closeSession(id); throw error; }
  }

  private listen(session: Session) {
    const socket = session.socket;
    socket.on("message", (data, binary) => {
      if (session.closed) return;
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
          if (message.type === "video-session") {
            this.clearVideo(session); this.requestKey(session);
            void this.verifyDevice(session).then(() => { if (session.switched) this.notify(session); });
          }
          if (message.ok === false) session.error = message.error ?? "Android input failed.";
        } catch { session.error = "serve-emu returned an unreadable stream message."; }
      }
      this.notify(session);
    });
    socket.on("error", error => { session.error = error.message; this.notify(session); });
    socket.on("close", () => {
      void this.verifyDevice(session).then(() => { session.error ??= "The Android stream disconnected."; this.notify(session); });
    });
  }

  // A backend this server started streams its one device until it exits. One the user runs can be
  // pointed at another device, which a new video session or a dropped connection can mean.
  private async verifyDevice(session: Session) {
    if (session.backend.child !== undefined || session.closed) return;
    try { await this.backend.assertDevice(session.deviceId, session.backend); }
    catch (error) { if (error instanceof SimulatorUnavailableError) session.switched = error; }
  }

  /** Fails a request on a stream whose backend stopped or switched devices. */
  private assertBackend(session: Session) {
    if (session.switched) throw session.switched;
    if (!this.backend.current(session.deviceId, session.backend)) throw new ExpectedOperationError("device_unavailable", "The Android stream disconnected.");
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
    this.assertBackend(session);
    if (!this.sessions.current(id, session)) throw new ExpectedOperationError("session_closed", "The Android stream closed.");
    if (session.socket.readyState !== WebSocket.OPEN) throw new ExpectedOperationError("device_unavailable", "The Android stream disconnected.");
    if (session.error) throw new Error(session.error);
    this.resetVideo(session);
  }

  private session(id: string) { return this.sessions.get(id); }

  async batch(id: string, after: number, signal?: AbortSignal) {
    const session = this.session(id);
    this.assertBackend(session);
    signal?.throwIfAborted();
    if (!session.error && !session.packets.some(packet => packet.sequence > after)) await session.waiters.wait(1000, signal);
    signal?.throwIfAborted();
    if (!this.sessions.current(id, session)) throw new ExpectedOperationError("session_closed", "The Android stream closed.");
    this.assertBackend(session);
    if (session.error) throw new Error(session.error);
    if (session.waitingForKey) this.requestKey(session);
    const packets = session.packets.filter(packet => packet.sequence > after);
    session.packets = []; session.bytes = 0;
    return { generation: session.generation, packets, sequence: packets.at(-1)?.sequence ?? after };
  }

  async input(id: string, messages: unknown[]) {
    const session = this.session(id);
    this.assertBackend(session);
    if (!this.sessions.current(id, session)) throw new ExpectedOperationError("session_closed", "The Android stream closed.");
    if (session.error || session.socket.readyState !== WebSocket.OPEN) throw new Error(session.error ?? "The Android stream disconnected.");
    // Validate the full batch before sending any input.
    const validated = messages.map(androidInput);
    for (const message of validated) session.socket.send(JSON.stringify({ ...message, ack: false, record: false }));
    return validated.length;
  }

  closeDevice(deviceId: string) { return this.sessions.closeDevice(deviceId); }
  closeSession(id: string) { return this.sessions.closeSession(id); }
  close() { return this.sessions.close(); }
}
