import { decodeJpeg } from "./frame-stream.ts";

export class IosVideo {
  private closed = false;
  private failures = 0;
  private readonly abort = () => this.close();
  private readonly report: (phase: "jpegPrepare" | "bitmapDecode", elapsed: number, startedAt: number) => void;
  private readonly recover: () => Promise<void>;
  private readonly signal?: AbortSignal;

  constructor(
    recover: () => Promise<void>,
    signal?: AbortSignal,
    report: (phase: "jpegPrepare" | "bitmapDecode", elapsed: number, startedAt: number) => void = () => {},
  ) {
    this.report = report;
    this.recover = recover;
    this.signal = signal;
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.close();
  }

  async decode(data: string): Promise<ImageBitmap | undefined> {
    if (this.closed) return;
    let bitmap: ImageBitmap;
    try {
      bitmap = await decodeJpeg(data, this.report);
    } catch {
      if (this.closed) return;
      if (++this.failures >= 3) throw new Error("iOS video could not decode three frames. Reconnecting.");
      await this.recover();
      return;
    }
    if (this.closed) { bitmap.close(); return; }
    this.failures = 0;
    return bitmap;
  }

  close() {
    this.closed = true;
    this.signal?.removeEventListener("abort", this.abort);
  }
}
