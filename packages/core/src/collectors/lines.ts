import { StringDecoder } from "node:string_decoder";

/**
 * Splits a byte stream into UTF-8 lines without the newline. A line longer than
 * `maxLength` throws `oversized` when given; otherwise it is dropped up to its newline.
 */
export class LineSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private readonly maxLength: number;
  private readonly oversized?: string;
  private readonly line: (text: string, terminated: boolean) => void;
  private pending = "";
  private discarding = false;

  constructor(line: (text: string, terminated: boolean) => void, options: { maxLength: number; oversized?: string }) {
    this.line = line;
    this.maxLength = options.maxLength;
    this.oversized = options.oversized;
  }

  write(chunk: Buffer) {
    const text = this.decoder.write(chunk);
    let start = 0;
    let newline = text.indexOf("\n");
    while (newline >= 0) {
      this.append(text.slice(start, newline));
      const complete = this.pending;
      const dropped = this.discarding;
      this.pending = "";
      this.discarding = false;
      if (dropped === false) this.line(complete, true);
      start = newline + 1;
      newline = text.indexOf("\n", start);
    }
    this.append(text.slice(start));
  }

  /** Delivers an unterminated last line. */
  end() {
    this.append(this.decoder.end());
    const rest = this.pending;
    const dropped = this.discarding;
    this.pending = "";
    this.discarding = false;
    if (dropped === false && rest.length > 0) this.line(rest, false);
  }

  private append(text: string) {
    if (this.discarding) return;
    this.pending += text;
    if (this.pending.length <= this.maxLength) return;
    this.pending = "";
    if (this.oversized !== undefined) throw new Error(this.oversized);
    this.discarding = true;
  }
}
