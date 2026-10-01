import type { IosVideoBatch } from "../shared/ios-video.ts";
import { StopReconnectError } from "./reconnect.ts";

export function decodeVideoBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class PhysicalIosVideo {
  private decoder?: VideoDecoder;
  private generation = -1;
  private revision = -1;
  private sawKey = false;
  private closed = false;
  private lastReset = -Infinity;
  private failure?: Error;
  private readonly output: (frame: VideoFrame) => void;
  private readonly requestKey: () => void;

  constructor(output: (frame: VideoFrame) => void, requestKey: () => void) {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") throw new StopReconnectError("This host does not support HEVC screen mirroring through WebCodecs.");
    this.output = output;
    this.requestKey = requestKey;
  }

  private resetDecoder() {
    const decoder = this.decoder;
    this.decoder = undefined;
    this.sawKey = false;
    if (decoder && decoder.state !== "closed") decoder.close();
  }

  private recover(reason: string) {
    this.resetDecoder();
    const now = performance.now();
    if (this.closed || now - this.lastReset < 1000) return;
    this.lastReset = now;
    console.warn("[mobile-dev] Physical iOS decoder requested recovery", { reason, generation: this.generation });
    this.requestKey();
  }

  async accept(batch: IosVideoBatch) {
    if (this.closed) return;
    if (this.failure) throw this.failure;
    const configuration = batch.configuration;
    if (batch.generation !== this.generation && this.generation >= 0) {
      console.warn("[mobile-dev] Physical iOS video interrupted", { generation: batch.generation, dropped: batch.dropped });
    }
    const changed = batch.generation !== this.generation || configuration?.revision !== this.revision;
    if (changed) {
      this.resetDecoder();
      this.generation = batch.generation;
    }
    if (this.decoder === undefined && configuration) {
      const description = decodeVideoBytes(configuration.description);
      const config: VideoDecoderConfig = { codec: configuration.codec, description, codedWidth: configuration.width, codedHeight: configuration.height, optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" };
      const support = await VideoDecoder.isConfigSupported(config);
      if (this.closed) return;
      if (support.supported !== true) throw new StopReconnectError("This host cannot decode the iPhone's HEVC stream.");
      const decoder = new VideoDecoder({
        output: frame => {
          try { if (this.closed === false && this.decoder === decoder) this.output(frame); }
          finally { frame.close(); }
        },
        error: error => {
          console.error("[mobile-dev] Physical iOS HEVC decoding failed", error);
          this.failure = new StopReconnectError(`HEVC decoding failed: ${error.message}`);
        },
      });
      decoder.configure(config);
      this.decoder = decoder;
      this.revision = configuration.revision;
    }
    for (const frame of batch.frames) {
      if (this.closed) return;
      if (this.failure) throw this.failure;
      if (this.decoder === undefined || (this.sawKey === false && frame.key === false)) {
        const reason = this.decoder === undefined ? "Missing decoder configuration" : "Waiting for a keyframe";
        this.recover(reason);
        continue;
      }
      if (this.decoder.decodeQueueSize >= 8) { this.recover("HEVC decode queue reached eight frames"); return; }
      const bytes = decodeVideoBytes(frame.data);
      const chunk = new EncodedVideoChunk({ type: frame.key ? "key" : "delta", timestamp: frame.timestamp, data: bytes });
      try {
        this.decoder.decode(chunk);
        if (frame.key && this.sawKey === false && this.generation > 0) {
          console.info("[mobile-dev] Physical iOS recovery keyframe received", { generation: this.generation, timestamp: frame.timestamp });
        }
        this.sawKey = true;
      }
      catch (error) {
        const reason = error instanceof Error ? error.message : "HEVC decode rejected the frame";
        this.recover(reason);
        return;
      }
    }
  }

  close() { this.closed = true; this.resetDecoder(); }
}
