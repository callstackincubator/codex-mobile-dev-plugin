export const DEFAULT_LOGCAT_MAX_LINES = 500;
export const DEFAULT_LOGCAT_MAX_BYTES = 512 * 1024;

const NEWLINE_BYTES = 1;
const textEncoder = new TextEncoder();

export type LogcatBufferOptions = {
  maxLines?: number;
  maxBytes?: number;
};

export type LogcatEntry = Readonly<{
  line: string;
  at: string;
}>;

export type LogcatAppendResult = {
  appended: number;
  dropped: number;
};

export type LogcatBufferSnapshot = Readonly<{
  lines: readonly LogcatEntry[];
  text: string;
  count: number;
  bytes: number;
  dropped: number;
}>;

type BufferedLogcatEntry = {
  value: LogcatEntry;
  bytes: number;
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * A mutable, fixed-capacity log buffer. Snapshots are immutable and cached until
 * the buffer changes, so React renders can reuse the already joined text.
 */
export class LogcatRingBuffer {
  readonly maxLines: number;
  readonly maxBytes: number;

  #entries: Array<BufferedLogcatEntry | undefined>;
  #start = 0;
  #count = 0;
  #bytes = 0;
  #dropped = 0;
  #cachedSnapshot: LogcatBufferSnapshot | null = null;

  constructor();
  constructor(maxLines: number, maxBytes?: number);
  constructor(options: LogcatBufferOptions);
  constructor(
    optionsOrMaxLines: LogcatBufferOptions | number = {},
    positionalMaxBytes = DEFAULT_LOGCAT_MAX_BYTES,
  ) {
    const options =
      typeof optionsOrMaxLines === "number"
        ? { maxLines: optionsOrMaxLines, maxBytes: positionalMaxBytes }
        : optionsOrMaxLines;
    this.maxLines = positiveInteger(
      options.maxLines ?? DEFAULT_LOGCAT_MAX_LINES,
      "maxLines",
    );
    this.maxBytes = positiveInteger(
      options.maxBytes ?? DEFAULT_LOGCAT_MAX_BYTES,
      "maxBytes",
    );
    this.#entries = new Array(this.maxLines);
  }

  append(entries: Iterable<LogcatEntry>): LogcatAppendResult {
    let appended = 0;
    let dropped = 0;

    for (const entry of entries) {
      const entryBytes =
        textEncoder.encode(entry.line).byteLength +
        textEncoder.encode(entry.at).byteLength;

      // A line that cannot fit by itself must not evict useful existing lines.
      if (entryBytes > this.maxBytes) {
        dropped++;
        this.#recordDrop();
        continue;
      }

      while (
        this.#count > 0 &&
        (this.#count >= this.maxLines ||
          this.#bytes + NEWLINE_BYTES + entryBytes > this.maxBytes)
      ) {
        this.#dropOldest();
        dropped++;
      }

      const index = (this.#start + this.#count) % this.maxLines;
      const value = Object.freeze({ line: entry.line, at: entry.at });
      this.#entries[index] = { value, bytes: entryBytes };
      if (this.#count > 0) this.#bytes += NEWLINE_BYTES;
      this.#bytes += entryBytes;
      this.#count++;
      appended++;
      this.#cachedSnapshot = null;
    }

    return { appended, dropped };
  }

  clear(): void {
    if (this.#count === 0) return;

    for (let offset = 0; offset < this.#count; offset++) {
      this.#entries[(this.#start + offset) % this.maxLines] = undefined;
    }
    this.#start = 0;
    this.#count = 0;
    this.#bytes = 0;
    this.#cachedSnapshot = null;
  }

  snapshot(): LogcatBufferSnapshot {
    if (this.#cachedSnapshot) return this.#cachedSnapshot;

    const lines = new Array<LogcatEntry>(this.#count);
    for (let offset = 0; offset < this.#count; offset++) {
      const entry = this.#entries[(this.#start + offset) % this.maxLines];
      if (entry) lines[offset] = entry.value;
    }

    Object.freeze(lines);
    this.#cachedSnapshot = Object.freeze({
      lines,
      text: lines.map((entry) => entry.line).join("\n"),
      count: this.#count,
      bytes: this.#bytes,
      dropped: this.#dropped,
    });
    return this.#cachedSnapshot;
  }

  #dropOldest(): void {
    const entry = this.#entries[this.#start];
    if (!entry || this.#count === 0) return;

    this.#entries[this.#start] = undefined;
    this.#start = (this.#start + 1) % this.maxLines;
    this.#count--;
    this.#bytes -= entry.bytes;
    if (this.#count > 0) this.#bytes -= NEWLINE_BYTES;
    if (this.#count === 0) this.#start = 0;
    this.#recordDrop();
  }

  #recordDrop(): void {
    if (this.#dropped < Number.MAX_SAFE_INTEGER) this.#dropped++;
    this.#cachedSnapshot = null;
  }
}

export type LogcatPublishScheduler<Handle = number> = (
  callback: () => void,
) => Handle;
export type LogcatPublishCanceler<Handle = number> = (handle: Handle) => void;

/** Coalesces any number of appends into at most one scheduled publication. */
export class LogcatBatchPublisher<Handle = number> {
  readonly buffer: LogcatRingBuffer;

  #publish: (snapshot: LogcatBufferSnapshot) => void;
  #schedule: LogcatPublishScheduler<Handle>;
  #cancel: LogcatPublishCanceler<Handle>;
  #scheduled: Handle | null = null;
  #disposed = false;

  constructor(
    buffer: LogcatRingBuffer,
    publish: (snapshot: LogcatBufferSnapshot) => void,
    schedule: LogcatPublishScheduler<Handle> = (callback) =>
      requestAnimationFrame(callback) as Handle,
    cancel: LogcatPublishCanceler<Handle> = (handle) =>
      cancelAnimationFrame(handle as number),
  ) {
    this.buffer = buffer;
    this.#publish = publish;
    this.#schedule = schedule;
    this.#cancel = cancel;
  }

  append(entries: Iterable<LogcatEntry>): LogcatAppendResult {
    if (this.#disposed) return { appended: 0, dropped: 0 };

    const result = this.buffer.append(entries);
    if (result.appended > 0 || result.dropped > 0) this.#requestPublish();
    return result;
  }

  clear(): void {
    if (this.#disposed) return;
    this.buffer.clear();
    this.#requestPublish();
  }

  flush(): void {
    if (this.#disposed) return;
    if (this.#scheduled !== null) {
      this.#cancel(this.#scheduled);
      this.#scheduled = null;
    }
    this.#publish(this.buffer.snapshot());
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#scheduled !== null) {
      this.#cancel(this.#scheduled);
      this.#scheduled = null;
    }
  }

  #requestPublish(): void {
    if (this.#scheduled !== null) return;
    this.#scheduled = this.#schedule(() => {
      this.#scheduled = null;
      if (!this.#disposed) this.#publish(this.buffer.snapshot());
    });
  }
}
