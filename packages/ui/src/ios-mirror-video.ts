import type { IosVideoBatch } from "@mobile-dev/shared/ios-video.ts";
import { StopReconnectError } from "./reconnect.ts";
import { decodeVideoBytes, WebCodecsVideo } from "./webcodecs-video.ts";

export class PhysicalIosVideo extends WebCodecsVideo {
  private revision = -1;
  private failure?: Error;

  constructor(output: (frame: VideoFrame) => void, requestKey: () => void) {
    super(output, requestKey, () => new StopReconnectError("This host does not support HEVC screen mirroring through WebCodecs."));
  }

  private recover(reason: string) {
    this.resetDecoder();
    this.requestKey(() => console.warn("[mobile-dev] Physical iOS decoder requested recovery", { reason, generation: this.generation }));
  }

  async accept(batch: IosVideoBatch) {
    if (this.closed) return;
    if (this.failure) throw this.failure;
    const configuration = batch.configuration;
    if (batch.generation !== this.generation && this.generation >= 0) {
      console.warn("[mobile-dev] Physical iOS video interrupted", { generation: batch.generation, dropped: batch.dropped });
    }
    if (batch.generation !== this.generation || configuration?.revision !== this.revision) this.startGeneration(batch.generation);
    if (this.decoder === undefined && configuration) {
      const description = decodeVideoBytes(configuration.description);
      const config: VideoDecoderConfig = { codec: configuration.codec, description, codedWidth: configuration.width, codedHeight: configuration.height, optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" };
      const support = await VideoDecoder.isConfigSupported(config);
      if (this.closed) return;
      if (support.supported !== true) throw new StopReconnectError("This host cannot decode the iPhone's HEVC stream.");
      const decoder = this.createDecoder(error => {
        console.error("[mobile-dev] Physical iOS HEVC decoding failed", error);
        this.failure = new StopReconnectError(`HEVC decoding failed: ${error.message}`);
      });
      decoder.configure(config);
      this.revision = configuration.revision;
    }
    for (const frame of batch.frames) {
      if (this.closed) return;
      if (this.failure) throw this.failure;
      if (this.decoder === undefined || (this.sawKey === false && frame.key === false)) {
        this.recover(this.decoder === undefined ? "Missing decoder configuration" : "Waiting for a keyframe");
        continue;
      }
      if (this.decoder.decodeQueueSize >= 8) { this.recover("HEVC decode queue reached eight frames"); return; }
      const recovered = frame.key && this.sawKey === false && this.generation > 0;
      const rejected = this.decode(frame.key, frame.timestamp, decodeVideoBytes(frame.data));
      if (rejected) {
        this.recover(rejected.error instanceof Error ? rejected.error.message : "HEVC decode rejected the frame");
        return;
      }
      if (recovered) console.info("[mobile-dev] Physical iOS recovery keyframe received", { generation: this.generation, timestamp: frame.timestamp });
    }
  }
}
