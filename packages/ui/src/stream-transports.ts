import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HostBridge } from "./host-bridge.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { isPhysicalIos } from "@mobile-dev/shared/devices.ts";
import { androidVideoBatchSchema } from "@mobile-dev/shared/android-video.ts";
import { iosVideoBatchSchema } from "@mobile-dev/shared/ios-video.ts";
import { AndroidVideo } from "./android-video.ts";
import { PhysicalIosVideo } from "./ios-mirror-video.ts";
import { IosVideo } from "./ios-video.ts";
import { FrameStream } from "./frame-stream.ts";
import { FrameArrivals } from "./frame-arrivals.ts";
import { readFrame } from "./read-frame.ts";
import { BrowserProfile } from "./browser-profile.ts";
import { readCursorBatches } from "./resource-session.ts";
import { StopReconnectError } from "./reconnect.ts";
import type { StreamInput, StreamMessage } from "./stream-input.ts";

/** How a device's screen reaches the panel: Baguette's JPEG frames, Android's H.264, or a paired iPhone's HEVC mirror. */
export type TransportKind = "ios-simulator" | "android" | "ios-physical";

/** A stream session the panel opened. */
export type PanelStream = {
  id: string; frameUri: string; epoch: number; transport: TransportKind;
  /** The mirror's video generation, which its input names. */
  generation?: number;
  controller: AbortController; input?: StreamInput; reader?: FrameStream<ImageBitmap>; closing?: Promise<void>;
};

/** What a transport's receive loop needs from the panel. */
export type StreamReceiver = {
  app: HostBridge;
  stream: PanelStream;
  signal: AbortSignal;
  /** False once the panel moved on from this session. */
  current(): boolean;
  draw(image: CanvasImageSource, width: number, height: number): void;
  /** Maps touches to the decoded video's size. */
  setScreen(size: { width: number; height: number }): void;
  /** Frames drawn since the session opened. */
  frames(): number;
  /**
   * Stops input until the next frame. `releaseTouch` lifts a held touch first, for a stream whose input
   * outlives the interruption; otherwise the touch is forgotten. A message replaces the notice.
   */
  interrupt(message: string | undefined, releaseTouch: boolean): void;
  /** Delivers queued input, such as that touch-up, before the stream resets. */
  flushInput(): Promise<void>;
  call(name: string, args: Record<string, unknown>, options: { signal?: AbortSignal; timeout: number }): Promise<CallToolResult>;
};

export type StreamTransport = {
  open: { tool: string; args(udid: string): Record<string, unknown> };
  close: string;
  input: { tool: string; args(stream: PanelStream, messages: StreamMessage[]): Record<string, unknown> };
  /** Asks for a fresh keyframe after the decoder lost its place. */
  reset: string;
  /** A device screenshot; a mirrored iPhone's is the frame on screen, which the panel sends as `image`. */
  screenshot: { tool: string; args(target: { device: SimulatorDevice; stream?: PanelStream; image?: string }): Record<string, unknown> };
  /** The units touches and annotations measure the screen in. */
  units: "points" | "pixels";
  /** The stream and screenshots go through the device backend, which a listing reports as connected. */
  backend: boolean;
  /** Takes touches and nothing else: no keys, pasted text, hardware buttons or accessibility tree. */
  touchOnly: boolean;
  /** A failure replaces the screen, since the device's last frame would look live. */
  failureOnScreen: boolean;
  receive(receiver: StreamReceiver): Promise<void>;
};

const session = (stream: PanelStream, messages: StreamMessage[]) => ({ sessionId: stream.id, messages });

async function receiveFrames({ app, stream, signal, current, draw, interrupt, flushInput, call }: StreamReceiver) {
  const uri = new URL(stream.frameUri);
  const arrivals = new FrameArrivals();
  const observe = (event: MessageEvent) => {
    if (event.source === window.parent) arrivals.record(event.data, performance.timeOrigin + performance.now());
  };
  window.addEventListener("message", observe);
  const browserProfile = new BrowserProfile();
  browserProfile.start();
  const decoder = new IosVideo(async () => {
    if (signal.aborted || !current()) return;
    stream.reader?.clearFrames();
    // Baguette's input outlives a decoder recovery, so a held touch is lifted before the stream resets.
    interrupt("Recovering iOS video…", true);
    await flushInput();
    if (signal.aborted || !current()) return;
    await call(streamTransports["ios-simulator"].reset, { sessionId: stream.id }, { signal, timeout: 5000 });
  }, signal, (phase, elapsed, startedAt) => {
    stream.reader?.decodeTiming(phase, elapsed);
    browserProfile.decode(phase, startedAt, elapsed);
  });
  const reader = new FrameStream<ImageBitmap>({
    async read(after, readSignal) {
      uri.searchParams.set("after", String(after));
      const resource = await app.readServerResource({ uri: uri.href }, { signal: readSignal, timeout: 15000 });
      const result = readFrame(resource);
      const browserArrivedAt = arrivals.take(uri.href, result.serverPreparedAt) ?? performance.timeOrigin + performance.now();
      browserProfile.response(result.serverPreparedAt, browserArrivedAt, result.frame?.sequence ?? null);
      if (result.connectionState === "reconnecting") {
        reader.clearFrames();
        // The simulator's stream is reconnecting, so input cannot reach it.
        interrupt("Reconnecting…", false);
      }
      return { ...result, browserArrivedAt };
    },
    decode: data => decoder.decode(data),
    paint(bitmap) { if (!signal.aborted && current()) draw(bitmap, bitmap.width, bitmap.height); },
    requestPaint: callback => requestAnimationFrame(callback),
    cancelPaint: id => cancelAnimationFrame(id),
  });
  stream.reader = reader;
  const stats = setInterval(() => {
    const diagnostics = JSON.stringify({ ...reader.stats(), browser: browserProfile.stats(document.visibilityState), logRenderingEnabled: true });
    console.info("[mobile-dev] Stream timings", diagnostics);
  }, 1000);
  try { await reader.run(signal); }
  finally {
    clearInterval(stats);
    browserProfile.stop();
    decoder.close();
    stream.reader = undefined;
    window.removeEventListener("message", observe);
    arrivals.clear();
  }
}

async function receiveAndroid({ app, stream, signal, current, draw, setScreen, frames, interrupt, call }: StreamReceiver) {
  const decoder = new AndroidVideo(image => {
    if (signal.aborted || !current()) return;
    setScreen({ width: image.displayWidth, height: image.displayHeight });
    draw(image, image.displayWidth, image.displayHeight);
  }, () => {
    if (signal.aborted || !current()) return;
    void call(streamTransports.android.reset, { sessionId: stream.id }, { timeout: 5000 }).catch(() => {});
  }, () => {
    // The device's control channel outlives a decoder recovery, so a held touch is lifted.
    if (!signal.aborted && current()) interrupt("Recovering Android video…", true);
  });
  let lastFrame = performance.now();
  let previousFrames = frames();
  let generation = -1;
  try {
    await readCursorBatches({
      app, uri: stream.frameUri, schema: androidVideoBatchSchema, invalid: () => new Error("The plugin returned an invalid Android video batch."),
      cursor: batch => batch.sequence, signal, timeout: 15000, active: current,
      async onBatch(batch) {
        // A new encoder generation keeps the control channel, so a held touch is lifted as for a recovery.
        if (generation !== batch.generation) { generation = batch.generation; interrupt(undefined, true); }
        await decoder.accept(batch);
        if (frames() !== previousFrames) { lastFrame = performance.now(); previousFrames = frames(); }
        if (performance.now() - lastFrame > 15000) throw new Error("Android video stopped producing frames. Reconnecting.");
      },
    });
  } finally { decoder.close(); }
}

async function receiveMirror({ app, stream, signal, current, draw, setScreen, frames, interrupt, call }: StreamReceiver) {
  const decoder = new PhysicalIosVideo(image => {
    if (signal.aborted || !current()) return;
    setScreen({ width: image.displayWidth, height: image.displayHeight });
    draw(image, image.displayWidth, image.displayHeight);
  }, () => {
    if (signal.aborted || !current()) return;
    // The mirror lifts a held touch itself when it resets, and rejects input for the old frames.
    interrupt("Recovering physical device video…", false);
    void call(streamTransports["ios-physical"].reset, { sessionId: stream.id }, { timeout: 5000 }).catch(error => {
      console.warn("[mobile-dev] Physical iOS keyframe request failed", error);
    });
  });
  const opened = performance.now();
  try {
    await readCursorBatches({
      app, uri: stream.frameUri, schema: iosVideoBatchSchema, invalid: () => new StopReconnectError("The plugin returned an invalid physical device video batch."),
      signal, timeout: 15000, active: current,
      async onBatch(batch) {
        // Likewise for a new generation: the mirror lifted the touch, and input names the generation it targets.
        if (stream.generation !== batch.generation) { stream.generation = batch.generation; interrupt(undefined, false); }
        await decoder.accept(batch);
        if (frames() === 0 && performance.now() - opened > 15000) throw new Error("The iPhone has not produced a screen frame. Unlock it and retry.");
      },
    });
  } finally { decoder.close(); }
}

export const streamTransports: Record<TransportKind, StreamTransport> = {
  "ios-simulator": {
    open: { tool: "mobile_stream_session", args: udid => ({ udid, fps: 60 }) },
    close: "mobile_stream_close",
    input: { tool: "mobile_stream_input", args: session },
    reset: "mobile_stream_reset",
    screenshot: { tool: "mobile_capture_screenshot", args: ({ device }) => ({ udid: device.udid }) },
    units: "points", backend: true, touchOnly: false, failureOnScreen: false,
    receive: receiveFrames,
  },
  android: {
    open: { tool: "mobile_android_stream_session", args: deviceId => ({ deviceId }) },
    close: "mobile_android_stream_close",
    input: { tool: "mobile_android_stream_input", args: session },
    reset: "mobile_android_stream_reset",
    screenshot: { tool: "mobile_android_capture_screenshot", args: ({ device }) => ({ deviceId: device.udid }) },
    units: "pixels", backend: true, touchOnly: false, failureOnScreen: false,
    receive: receiveAndroid,
  },
  "ios-physical": {
    open: { tool: "mobile_ios_mirror_session", args: udid => ({ udid }) },
    close: "mobile_ios_mirror_close",
    input: { tool: "mobile_ios_mirror_input", args: (stream, messages) => ({ ...session(stream, messages), generation: stream.generation }) },
    reset: "mobile_ios_mirror_reset",
    screenshot: { tool: "mobile_ios_mirror_capture_screenshot", args: ({ stream, image }) => ({ sessionId: stream?.id, image }) },
    units: "pixels", backend: false, touchOnly: true, failureOnScreen: true,
    receive: receiveMirror,
  },
};

/** The tools that open a stream; telemetry reports their repeated failures once per episode. */
export const streamOpenTools: ReadonlySet<string> = new Set(Object.values(streamTransports).map(transport => transport.open.tool));

export function transportFor(device: Pick<SimulatorDevice, "platform" | "kind">): TransportKind {
  if (isPhysicalIos(device)) return "ios-physical";
  return device.platform === "android" ? "android" : "ios-simulator";
}
