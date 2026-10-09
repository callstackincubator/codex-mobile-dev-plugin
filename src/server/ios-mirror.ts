import { ExpectedOperationError } from "../shared/error-reporting.ts";
import { randomBytes } from "node:crypto";
import type { IosVideoBatch } from "../shared/ios-video.ts";
import type { TouchInput } from "../shared/protocol.ts";
import { openSharedIosCapture } from "./ios-mirror-client.ts";
import type { IosCapture, NativeTouchSample } from "./ios-native-capture.ts";
export type { NativeCapture, NativeTouchSample } from "./ios-native-capture.ts";
export type OpenCapture = (udid: string) => Promise<IosCapture>;

type Session = { capture: IosCapture; udid: string; expires: number; reading: boolean; inputting: boolean; generation?: number; closed: boolean };

export class IosMirrorSessions {
  private readonly sessions = new Map<string, Session>();
  private opening = 0;
  private readonly openCapture: OpenCapture;
  private readonly expiry: NodeJS.Timeout;
  private disposed = false;

  constructor(open: OpenCapture = openSharedIosCapture) {
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
    if (this.sessions.size + this.opening >= 4) throw new Error("Too many physical device streams. Close another panel first.");
    this.opening++;
    try {
      const capture = await this.openCapture(udid);
      if (this.disposed) { await capture.close(); throw new Error("The plugin server has closed."); }
      const bytes = randomBytes(32);
      const id = bytes.toString("hex");
      this.sessions.set(id, { capture, udid, expires: Date.now() + 300000, reading: false, inputting: false, closed: false });
      return id;
    } finally { this.opening--; }
  }

  private session(id: string) {
    const session = this.sessions.get(id);
    if (session === undefined || session.expires < Date.now()) {
      void this.closeSession(id);
      throw new ExpectedOperationError("session_expired", "The physical device stream expired or closed.");
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
      if (session.closed) throw new ExpectedOperationError("session_closed", "The physical device stream closed.");
      if (session.generation !== batch.generation) session.generation = undefined;
      if (batch.frames.some(frame => frame.key)) session.generation = batch.generation;
      return batch;
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

  async reset(id: string) {
    const session = this.session(id);
    session.generation = undefined;
    await session.capture.reset();
  }

  deviceId(id: string) {
    return this.session(id).udid;
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
