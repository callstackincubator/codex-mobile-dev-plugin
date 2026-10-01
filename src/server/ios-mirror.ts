import { createRequire as createNativeRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IosVideoBatch } from "../shared/ios-video.ts";
import type { TouchInput } from "../shared/protocol.ts";

type NativeConfiguration = { revision: number; width: number; height: number; codec: string; description: Buffer };
type NativeBatch = { generation: number; frames: { data: Buffer; timestamp: number; key: boolean }[]; configuration?: NativeConfiguration; dropped: number };
export type NativeTouchSample = { phase: number; x: number; y: number; width: number; height: number };
export type NativeCapture = { read(): Promise<NativeBatch>; touch(samples: NativeTouchSample[], generation: number): Promise<void>; reset(): void; close(): Promise<void> };
type NativeAddon = { openDevice(udid: string): Promise<NativeCapture> };
export type OpenCapture = (udid: string) => Promise<NativeCapture>;

let addon: NativeAddon | undefined;
async function openCapture(udid: string) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Physical iOS mirroring requires an Apple Silicon Mac.");
  if (addon === undefined) {
    const root = import.meta.url.endsWith("/server.mjs") ? "./ios-mirror/" : "../../vendor/ios-mirror/";
    const url = new URL(`${root}darwin-arm64.node`, import.meta.url);
    const path = fileURLToPath(url);
    if (existsSync(path) === false) throw new Error("The physical iOS capture addon is missing. Run npm run rebuild:ios-mirror and rebuild the plugin.");
    const require = createNativeRequire(import.meta.url);
    const loaded: NativeAddon = require(path);
    addon = loaded;
  }
  return addon.openDevice(udid);
}

type Session = { capture: NativeCapture; udid: string; expires: number; sequence: number; reading: boolean; inputting: boolean; generation?: number; closed: boolean; configuration?: IosVideoBatch["configuration"] };

export class IosMirrorSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly opening = new Set<string>();
  private readonly openCapture: OpenCapture;
  private readonly expiry: NodeJS.Timeout;
  private disposed = false;

  constructor(open: OpenCapture = openCapture) {
    this.openCapture = open;
    this.expiry = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (session.expires < Date.now()) void this.closeSession(id);
      }
    }, 10000);
    this.expiry.unref();
  }

  async open(udid: string) {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.opening.has(udid) || [...this.sessions.values()].some(session => session.udid === udid)) throw new Error("This iPhone already has a mirroring session. Close its other panel first.");
    if (this.sessions.size + this.opening.size >= 4) throw new Error("Too many physical device streams. Close another panel first.");
    this.opening.add(udid);
    try {
      const capture = await this.openCapture(udid);
      if (this.disposed) { await capture.close(); throw new Error("The plugin server has closed."); }
      const bytes = randomBytes(32);
      const id = bytes.toString("hex");
      this.sessions.set(id, { capture, udid, expires: Date.now() + 300000, sequence: 0, reading: false, inputting: false, closed: false });
      return id;
    } finally { this.opening.delete(udid); }
  }

  private session(id: string) {
    const session = this.sessions.get(id);
    if (session === undefined || session.expires < Date.now()) {
      void this.closeSession(id);
      throw new Error("The physical device stream expired or closed.");
    }
    session.expires = Date.now() + 300000;
    return session;
  }

  async batch(id: string): Promise<IosVideoBatch> {
    const session = this.session(id);
    if (session.reading) throw new Error("A physical device video read is already pending.");
    session.reading = true;
    try {
      const batch = await session.capture.read();
      if (session.closed) throw new Error("The physical device stream closed.");
      if (session.generation !== batch.generation) session.generation = undefined;
      if (batch.frames.some(frame => frame.key)) session.generation = batch.generation;
      if (batch.configuration) {
        const { description, ...configuration } = batch.configuration;
        session.configuration = { ...configuration, description: description.toString("base64") };
      }
      const frames = batch.frames.map(frame => ({ sequence: ++session.sequence, timestamp: frame.timestamp, key: frame.key, data: frame.data.toString("base64") }));
      return { generation: batch.generation, sequence: session.sequence, dropped: batch.dropped, configuration: session.configuration, frames };
    } finally { session.reading = false; }
  }

  async input(id: string, messages: TouchInput[], generation: number) {
    const session = this.session(id);
    if (session.generation !== generation) throw new Error("Wait for a fresh physical iOS screen before sending input.");
    if (session.inputting) throw new Error("Physical iOS input is already pending.");
    session.inputting = true;
    try {
      const samples: NativeTouchSample[] = messages.map(message => {
        const phase = message.type === "touch1-down" ? 0 : message.type === "touch1-move" ? 1 : 2;
        return { phase, x: message.x, y: message.y, width: message.width, height: message.height };
      });
      await session.capture.touch(samples, generation);
    } finally { session.inputting = false; }
  }

  reset(id: string) {
    const session = this.session(id);
    session.generation = undefined;
    session.capture.reset();
  }

  async closeSession(id: string) {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    this.sessions.delete(id);
    session.closed = true;
    await session.capture.close();
  }

  async close() {
    this.disposed = true;
    clearInterval(this.expiry);
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map(id => this.closeSession(id)));
  }
}
