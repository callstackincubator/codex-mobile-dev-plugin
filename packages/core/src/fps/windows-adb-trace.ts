/**
 * adb.exe shell -T keeps stdin and stderr separate but some versions expand stdout LF to
 * CRLF, including bytes in protobuf payloads. The Perfetto Trace.packet field always starts
 * with 0x0a, so its first byte distinguishes a binary pipe from a text-mode pipe.
 */
export class WindowsAdbTrace {
  private textMode?: boolean;
  private pendingCR = false;

  decode(chunk: Buffer): Buffer {
    if (!chunk.length) return chunk;
    this.textMode ??= chunk[0] === 13;
    if (!this.textMode) return chunk;

    const bytes = Buffer.allocUnsafe(chunk.length + Number(this.pendingCR));
    let length = 0;
    for (const byte of chunk) {
      if (this.pendingCR && byte !== 10) bytes[length++] = 13;
      this.pendingCR = byte === 13;
      if (!this.pendingCR) bytes[length++] = byte;
    }
    return bytes.subarray(0, length);
  }
}
