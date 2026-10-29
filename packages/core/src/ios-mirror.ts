import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { IosVideoBatch } from "@mobile-dev/shared/ios-video.ts";
import type { TouchInput } from "@mobile-dev/shared/protocol.ts";
import { openSharedIosCapture } from "./ios-mirror-client.ts";
import type { IosCapture, NativeTouchSample } from "./ios-native-capture.ts";
import { SessionRegistry } from "./session-registry.ts";
export type OpenCapture = (udid: string) => Promise<IosCapture>;

type Session = { capture: IosCapture; udid: string; inputting: boolean };

/** This server's panels' subscriptions to the shared capture, which gates reads and input by video generation. */
export class IosMirrorSessions {
  private readonly sessions = new SessionRegistry<Session>({
    limit: 4, name: "Physical iOS stream",
    limitMessage: "Too many physical device streams. Close another panel first.",
    expiredMessage: "The physical device stream expired or closed.",
    deviceId: session => session.udid,
    stop: session => session.capture.close(),
  });
  private readonly openCapture: OpenCapture;

  constructor(open: OpenCapture = openSharedIosCapture) { this.openCapture = open; }

  open(udid: string) {
    return this.sessions.open(async () => ({ capture: await this.openCapture(udid), udid, inputting: false }));
  }

  async batch(id: string): Promise<IosVideoBatch> { return this.sessions.get(id).capture.read(); }

  async input(id: string, messages: TouchInput[], generation: number) {
    const session = this.sessions.get(id);
    if (session.inputting) throw new ExpectedOperationError("resource_limit", "Physical iOS input is already pending.");
    session.inputting = true;
    try {
      const samples: NativeTouchSample[] = messages.map(message => {
        const phase = message.type === "touch1-down" ? 0 : message.type === "touch1-move" ? 1 : 2;
        return { phase, x: message.x, y: message.y, width: message.width, height: message.height };
      });
      await session.capture.touch(samples, generation);
    } finally { session.inputting = false; }
  }

  async reset(id: string) { await this.sessions.get(id).capture.reset(); }

  deviceId(id: string) { return this.sessions.get(id).udid; }

  closeSession(id: string) { return this.sessions.closeSession(id); }
  closeDevice(udid: string) { return this.sessions.closeDevice(udid); }
  close() { return this.sessions.close(); }
}
