export function decodeVideoBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * The decoder lifecycle Android and physical iPhone video share: one WebCodecs decoder per
 * stream generation, frames held back until a keyframe, and keyframe requests limited to
 * one a second while the stream recovers.
 */
export abstract class WebCodecsVideo {
  protected decoder?: VideoDecoder;
  protected generation = -1;
  protected sawKey = false;
  protected closed = false;
  private lastKeyRequest = -Infinity;
  private readonly output: (frame: VideoFrame) => void;
  private readonly requestKeyframe: () => void;

  constructor(output: (frame: VideoFrame) => void, requestKeyframe: () => void, unsupported: () => Error) {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") throw unsupported();
    this.output = output;
    this.requestKeyframe = requestKeyframe;
  }

  /** Asks the server for a keyframe unless one was requested within the last second; `requesting` runs only when it asks. */
  protected requestKey(requesting?: () => void) {
    const now = performance.now();
    if (this.closed || now - this.lastKeyRequest < 1000) return;
    this.lastKeyRequest = now;
    requesting?.();
    this.requestKeyframe();
  }

  protected resetDecoder() {
    const decoder = this.decoder;
    this.decoder = undefined;
    this.sawKey = false;
    if (decoder && decoder.state !== "closed") decoder.close();
  }

  /** A new generation starts from a fresh decoder and waits for its keyframe. */
  protected startGeneration(generation: number) {
    this.resetDecoder();
    this.generation = generation;
  }

  /** A decoder whose frames reach `output` only while it is the current one. */
  protected createDecoder(failed: (error: DOMException) => void): VideoDecoder {
    const decoder = new VideoDecoder({
      output: frame => { try { if (!this.closed && this.decoder === decoder) this.output(frame); } finally { frame.close(); } },
      error: error => { if (this.decoder === decoder) failed(error); },
    });
    this.decoder = decoder;
    return decoder;
  }

  /** Decodes one frame on the current decoder; returns the decoder's rejection, if it threw one. */
  protected decode(key: boolean, timestamp: number, data: Uint8Array): { error: unknown } | undefined {
    try {
      this.decoder!.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp, data }));
      this.sawKey = true;
    } catch (error) { return { error }; }
  }

  close() { this.closed = true; this.resetDecoder(); }
}
