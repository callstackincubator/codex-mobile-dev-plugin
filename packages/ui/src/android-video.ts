import { videoPacket } from "@mobile-dev/shared/android-video.ts";
import type { AndroidVideoBatch } from "@mobile-dev/shared/android-video.ts";
import { decodeVideoBytes, WebCodecsVideo } from "./webcodecs-video.ts";
export { videoPacket } from "@mobile-dev/shared/android-video.ts";
export type { AndroidVideoBatch } from "@mobile-dev/shared/android-video.ts";

export class AndroidVideo extends WebCodecsVideo {
  private readonly recovering: () => void;

  constructor(output: (frame: VideoFrame) => void, requestKeyframe: () => void, recovering = () => {}) {
    super(output, requestKeyframe, () => new Error("This host does not support Android H.264 video through WebCodecs."));
    this.recovering = recovering;
  }

  private recover() {
    if (this.closed) return;
    this.resetDecoder();
    this.recovering();
    this.requestKey();
  }

  private configure(codec: string) {
    const decoder = this.createDecoder(() => this.recover());
    try { decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "no-preference" }); }
    catch { this.recover(); }
  }

  async accept(batch: AndroidVideoBatch) {
    if (this.closed) return;
    if (batch.generation !== this.generation) this.startGeneration(batch.generation);
    for (const [index, packet] of batch.packets.entries()) {
      // MCP delivers packets in batches. Let the decoder drain between small groups.
      if (index > 0 && index % 4 === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (this.closed || this.generation !== batch.generation) return;
      }
      let frame: ReturnType<typeof videoPacket>;
      try { frame = videoPacket(decodeVideoBytes(packet.data)); }
      catch { this.recover(); continue; }
      if (!this.decoder && frame.codec) this.configure(frame.codec);
      if (!this.decoder || (!this.sawKey && !frame.key)) { this.requestKey(); continue; }
      if (this.decoder.decodeQueueSize > 8) { this.recover(); continue; }
      if (this.decode(frame.key, frame.timestamp ?? packet.sequence * 33333, frame.bytes)) this.recover();
    }
    if (!this.sawKey) this.requestKey();
  }
}
