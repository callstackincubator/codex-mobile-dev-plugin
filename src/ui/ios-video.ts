export class IosVideo {
  private closed = false;
  private failures = 0;
  private readonly abort = () => this.close();
  private readonly output: (bitmap: ImageBitmap) => void;
  private readonly recover: () => Promise<void>;
  private readonly signal?: AbortSignal;

  constructor(
    output: (bitmap: ImageBitmap) => void,
    recover: () => Promise<void>,
    signal?: AbortSignal,
  ) {
    this.output = output;
    this.recover = recover;
    this.signal = signal;
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.close();
  }

  async accept(data: string) {
    if (this.closed) return;
    let bitmap: ImageBitmap;
    try {
      const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
      bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    } catch {
      if (this.closed) return;
      if (++this.failures >= 3) throw new Error("iOS video could not decode three frames. Reconnecting.");
      await this.recover();
      return;
    }
    try {
      if (this.closed) return;
      this.output(bitmap);
      this.failures = 0;
    } finally { bitmap.close(); }
  }

  close() {
    this.closed = true;
    this.signal?.removeEventListener("abort", this.abort);
  }
}
