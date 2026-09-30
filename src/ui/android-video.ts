import { videoPacket } from "../shared/android-video.ts";
import type { AndroidVideoBatch } from "../shared/android-video.ts";
export { videoPacket } from "../shared/android-video.ts";
export type { AndroidVideoBatch } from "../shared/android-video.ts";

export class AndroidVideo {
  private decoder?: VideoDecoder;
  private generation = -1;
  private sawKey = false;
  private closed = false;
  private lastKeyRequest?: number;
  private readonly output: (frame: VideoFrame) => void;
  private readonly requestKeyframe: () => void;
  private readonly recovering: () => void;

  constructor(output: (frame: VideoFrame) => void, requestKeyframe: () => void, recovering = () => {}) {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") throw new Error("This host does not support Android H.264 video through WebCodecs.");
    this.output = output;
    this.requestKeyframe = requestKeyframe;
    this.recovering = recovering;
  }

  private requestKey() {
    const now = performance.now();
    if (this.closed || (this.lastKeyRequest !== undefined && now - this.lastKeyRequest < 1000)) return;
    this.lastKeyRequest = now;
    this.requestKeyframe();
  }

  private resetDecoder() {
    const previous = this.decoder;
    this.decoder = undefined;
    this.sawKey = false;
    if (previous && previous.state !== "closed") previous.close();
  }

  private recover() {
    if (this.closed) return;
    this.resetDecoder();
    this.recovering();
    this.requestKey();
  }

  private configure(codec: string) {
    const decoder = new VideoDecoder({
      output: frame => { try { if (!this.closed && this.decoder === decoder) this.output(frame); } finally { frame.close(); } },
      error: () => { if (this.decoder === decoder) this.recover(); },
    });
    this.decoder = decoder;
    try { decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "no-preference" }); }
    catch { this.recover(); }
  }

  async accept(batch: AndroidVideoBatch) {
    if (this.closed) return;
    if (batch.generation !== this.generation) {
      this.resetDecoder();
      this.generation = batch.generation;
    }
    for (const [index, packet] of batch.packets.entries()) {
      // MCP delivers packets in batches. Let the decoder drain between small groups.
      if (index > 0 && index % 4 === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (this.closed || this.generation !== batch.generation) return;
      }
      let frame: ReturnType<typeof videoPacket>;
      try { frame = videoPacket(Uint8Array.from(atob(packet.data), character => character.charCodeAt(0))); }
      catch { this.recover(); continue; }
      if (!this.decoder && frame.codec) this.configure(frame.codec);
      if (!this.decoder || (!this.sawKey && !frame.key)) { this.requestKey(); continue; }
      if (this.decoder.decodeQueueSize > 8) { this.recover(); continue; }
      try {
        this.decoder.decode(new EncodedVideoChunk({ type: frame.key ? "key" : "delta", timestamp: frame.timestamp ?? packet.sequence * 33333, data: frame.bytes }));
        this.sawKey = true;
      } catch { this.recover(); }
    }
    if (!this.sawKey) this.requestKey();
  }

  close() { this.closed = true; this.resetDecoder(); }
}
