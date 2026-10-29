import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { bezelGeometrySchema } from "@mobile-dev/shared/bezel.ts";
import type { Bezel } from "@mobile-dev/shared/bezel.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { streamSessionMetaSchema, streamSessionResultSchema } from "@mobile-dev/shared/tool-results.ts";
import type { HostBridge } from "./host-bridge.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import { StreamInput } from "./stream-input.ts";
import type { StreamMessage } from "./stream-input.ts";
import { streamTransports, transportFor } from "./stream-transports.ts";
import type { PanelStream, StreamReceiver, TransportKind } from "./stream-transports.ts";
import { recordUiTiming } from "./telemetry.ts";
import { ToolCallError } from "./tool-call.ts";

type Call = (name: string, args: Record<string, unknown>, options: { signal?: AbortSignal; timeout: number }) => Promise<CallToolResult>;

/** What a device stream needs from its panel. */
export type StreamHost = {
  app: HostBridge;
  call: Call;
  /** The touch held on the canvas, if the canvas is attached. */
  pointer(): { release(): void; cancel(): void } | undefined;
  draw(image: CanvasImageSource, width: number, height: number): void;
  /** The session's device chrome, or none. */
  bezel(bezel: Bezel | undefined): void;
  /** Shows a message; none restores the panel's own notice. */
  notice(message?: string): void;
  /** The stream could not open or failed; the reconnect loop retries unless the error stops it. */
  failed(error: unknown): void;
  /** The link, its input state or the session changed. */
  changed(): void;
};

const pngData = (value: unknown): value is string => typeof value === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);

function sessionBezel(candidate: unknown): Bezel | undefined {
  const geometry = bezelGeometrySchema.safeParse(candidate);
  const art = candidate as { image?: unknown; mask?: unknown } | undefined;
  if (!geometry.success || !pngData(art?.image)) return;
  return { ...geometry.data, image: art.image, ...(pngData(art.mask) ? { mask: art.mask } : {}) };
}

/** A panel's device stream: it opens the selected device's session, keeps it open through failures, and carries its input. */
export class DeviceStream {
  readonly reconnect = new ReconnectLoop();
  stream?: PanelStream;
  /** Frames are arriving and input reaches the device. */
  live = false;
  /** The device rejects input until it is repaired; `repair` is the server's account of a repair. */
  blocked = false;
  repair = "";
  /** The screen size touches map to. */
  points = { width: 0, height: 0 };
  /** Frames drawn since the session opened. */
  frames = 0;
  private epoch = 0;
  private firstFrameStartedAt?: number;
  private readonly host: StreamHost;

  constructor(host: StreamHost) { this.host = host; }

  /** Opens the device's stream and reopens it after failures until `disconnect`. */
  start(device: SimulatorDevice) {
    const epoch = this.epoch;
    const transport = transportFor(device);
    this.reconnect.start(signal => this.openAndReceive(device.udid, transport, epoch, signal), this.host.failed, this.host.failed);
  }

  /** Lifts a held touch, closes the session after its queued input and stops reconnecting. */
  async disconnect() {
    this.host.pointer()?.release();
    const previous = this.stream;
    const closing = previous ? this.close(previous, true) : Promise.resolve();
    this.reconnect.stop();
    this.epoch++;
    this.stream = undefined;
    this.live = false;
    this.repair = "";
    if (this.blocked) { this.blocked = false; this.host.notice(); }
    this.host.changed();
    await closing;
  }

  send(message: StreamMessage) {
    if (!this.live || !this.stream || this.blocked) return;
    this.stream.input?.send(message);
  }

  /** Records a drawn frame. True when it was the first since opening or an interruption, which makes the stream live again. */
  framed(): boolean {
    if (this.firstFrameStartedAt !== undefined) {
      recordUiTiming("ui.video.first_frame", performance.now() - this.firstFrameStartedAt);
      this.firstFrameStartedAt = undefined;
    }
    this.frames++;
    if (this.live) return false;
    this.live = true;
    this.reconnect.connected();
    return true;
  }

  /**
   * Holds input until the next frame. `releaseTouch` lifts a held touch while the input can still deliver
   * it; otherwise the touch is forgotten, for input that is gone or that the device lifted itself.
   */
  private interrupt(stream: PanelStream, message: string | undefined, releaseTouch: boolean) {
    if (stream !== this.stream) return;
    stream.input?.clear();
    const pointer = this.host.pointer();
    if (releaseTouch) pointer?.release(); else pointer?.cancel();
    this.live = false;
    if (message !== undefined) this.host.notice(message);
    this.host.changed();
  }

  private async openAndReceive(udid: string, kind: TransportKind, epoch: number, signal: AbortSignal) {
    const startedAt = performance.now();
    const transport = streamTransports[kind];
    const result = await this.host.call(transport.open.tool, transport.open.args(udid), { signal, timeout: 45000 });
    const meta = streamSessionMetaSchema.safeParse(result._meta);
    if (!meta.success) throw new StopReconnectError("The plugin did not return a stream session.");
    const { sessionId: id, frameUri } = meta.data;
    if (signal.aborted || epoch !== this.epoch) { await this.host.call(transport.close, { sessionId: id }, { timeout: 3000 }).catch(() => {}); return; }
    const data = streamSessionResultSchema.safeParse(result.structuredContent).data;
    this.host.bezel(sessionBezel(meta.data.bezel));
    this.blocked = data?.inputStatus?.state === "blocked";
    this.repair = data?.inputRepairMessage ?? "";
    this.host.notice();
    // A mirrored iPhone has no definition; its touches map to the decoded video instead.
    if (data?.definition) this.points = { width: data.definition.screen.rect.width, height: data.definition.screen.rect.height };
    const stream: PanelStream = { id, frameUri, epoch, transport: kind, controller: new AbortController() };
    this.stream = stream;
    this.live = false;
    this.frames = 0;
    this.firstFrameStartedAt = startedAt;
    this.host.changed();
    stream.input = this.createInput(stream);
    try {
      await transport.receive(this.receiver(stream, AbortSignal.any([signal, stream.controller.signal])));
      if (stream.controller.signal.aborted) throw stream.controller.signal.reason;
    } finally { await this.close(stream); }
  }

  private receiver(stream: PanelStream, signal: AbortSignal): StreamReceiver {
    return {
      app: this.host.app, stream, signal,
      current: () => stream.epoch === this.epoch,
      draw: (image, width, height) => this.host.draw(image, width, height),
      setScreen: size => { this.points = size; },
      frames: () => this.frames,
      interrupt: (message, releaseTouch) => this.interrupt(stream, message, releaseTouch),
      flushInput: () => stream.input?.flush() ?? Promise.resolve(),
      call: this.host.call,
    };
  }

  private createInput(stream: PanelStream) {
    const transport = streamTransports[stream.transport];
    return new StreamInput(async messages => {
      const started = performance.now();
      try { await this.host.call(transport.input.tool, transport.input.args(stream, messages), { timeout: 5000 }); }
      catch (error) {
        // Another panel holds the device's touch. This touch never started, and the stream stays live.
        if (error instanceof ToolCallError && error.meta.inputBusy) {
          stream.input?.clear();
          this.host.pointer()?.cancel();
          this.host.notice(error.message);
          return;
        }
        throw error;
      } finally {
        const elapsed = performance.now() - started;
        stream.reader?.inputTiming(elapsed);
        recordUiTiming("ui.device_input.round_trip", elapsed);
      }
    }, error => {
      if (stream.epoch !== this.epoch) return;
      const failure = error instanceof ToolCallError ? error.meta : undefined;
      if (failure?.inputBlocked) this.blocked = true;
      // The input channel failed, so a held touch cannot be lifted through it.
      this.interrupt(stream, failure?.streamDisconnected ? "Reconnecting…" : error instanceof Error ? error.message : "Simulator input failed.", false);
      stream.reader?.fail(error);
      stream.controller.abort(error);
    });
  }

  /** Closes a session once, after its queued input when `graceful`. Idle streams also expire on the server, so a failed close is ignored. */
  close(stream: PanelStream, graceful = false): Promise<void> {
    stream.closing ??= (async () => {
      if (graceful) await stream.input?.flush();
      stream.input?.close();
      if (this.stream === stream) { this.host.pointer()?.cancel(); this.stream = undefined; this.live = false; this.host.changed(); }
      await this.host.call(streamTransports[stream.transport].close, { sessionId: stream.id }, { timeout: 3000 }).catch(() => {});
    })();
    return stream.closing;
  }
}
