import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export const DEFAULT_MAX_LOGCAT_SUBSCRIBERS = 8;
export const DEFAULT_LOGCAT_BATCH_INTERVAL_MS = 75;
export const DEFAULT_LOGCAT_QUEUE_LINES = 256;
export const DEFAULT_LOGCAT_QUEUE_BYTES = 256 * 1024;
export const DEFAULT_LOGCAT_MAX_LINE_BYTES = 16 * 1024;
export const DEFAULT_LOGCAT_PID_REFRESH_MS = 5_000;
export const DEFAULT_LOGCAT_TERMINATION_GRACE_MS = 1_000;

const LOGCAT_PID_LOOKUP_TIMEOUT_MS = 2_000;
const LOGCAT_PID_LOOKUP_MAX_OUTPUT_BYTES = 64 * 1024;

export type LogcatLine = {
  line: string;
  at: string;
};

export type LogcatSubscriptionOptions = {
  packageName?: string;
  search?: string;
};

export type LogcatSnapshot = {
  serial: string;
  closed: boolean;
  childActive: boolean;
  childTerminating: boolean;
  childCount: number;
  subscribers: number;
  activePidLookups: number;
  queuedLines: number;
  queuedBytes: number;
  limits: {
    subscribers: number;
    queueLinesPerSubscriber: number;
    queueBytesPerSubscriber: number;
    sourceLineBytes: number;
    batchIntervalMs: number;
    terminationGraceMs: number;
  };
  totals: {
    childStarts: number;
    forcedKills: number;
    batches: number;
    deliveredLines: number;
    droppedLines: number;
    sourceDroppedLines: number;
  };
  lastError: string | null;
};

export type LogcatClock = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(timer: unknown): void;
};

type LogcatChild = ChildProcessByStdio<null, Readable, Readable>;

export type LogcatDependencies = {
  spawn?: (serial: string) => LogcatChild;
  resolvePackagePids?: (
    serial: string,
    packageName: string,
    signal: AbortSignal,
  ) => Promise<Set<string>>;
  now?: () => Date;
  clock?: LogcatClock;
};

export type LogcatHubOptions = {
  maxSubscribers?: number;
  batchIntervalMs?: number;
  maxQueueLines?: number;
  maxQueueBytes?: number;
  maxSourceLineBytes?: number;
  pidRefreshMs?: number;
  terminationGraceMs?: number;
  dependencies?: LogcatDependencies;
};

const SYSTEM_CLOCK: LogcatClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) =>
    clearTimeout(timer as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) =>
    clearInterval(timer as ReturnType<typeof setInterval>),
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

async function resolvePackagePids(
  serial: string,
  packageName: string,
  signal: AbortSignal,
): Promise<Set<string>> {
  if (!/^[A-Za-z0-9_.:-]+$/.test(packageName) || signal.aborted) {
    return new Set();
  }
  return new Promise((resolve) => {
    let child!: LogcatChild;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let outputBytes = 0;
    let failed = false;
    let killRequested = false;
    const stdoutChunks: Buffer[] = [];

    const kill = () => {
      failed = true;
      if (killRequested) return;
      killRequested = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    };
    const onAbort = () => kill();
    const collect = (target: "stdout" | "stderr", value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (chunk.byteLength > LOGCAT_PID_LOOKUP_MAX_OUTPUT_BYTES - outputBytes) {
        kill();
        return;
      }
      outputBytes += chunk.byteLength;
      if (target === "stdout") stdoutChunks.push(chunk);
    };
    const finish = (status: number | null) => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (failed || status !== 0) {
        resolve(new Set());
        return;
      }
      resolve(
        new Set(
          Buffer.concat(stdoutChunks)
            .toString("utf8")
            .trim()
            .split(/\s+/)
            .filter(Boolean),
        ),
      );
    };

    try {
      child = spawn(
        "adb",
        ["-s", serial, "shell", "pidof", packageName],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      resolve(new Set());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(kill, LOGCAT_PID_LOOKUP_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer | string) => {
      collect("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      collect("stderr", chunk);
    });
    child.once("error", () => {
      failed = true;
    });
    child.stdout.once("error", kill);
    child.stderr.once("error", kill);
    child.once("close", (status) => finish(status));
    if (signal.aborted) onAbort();
  });
}

function spawnLogcat(serial: string): LogcatChild {
  // Start at the live edge so reconnects do not replay the device ring buffer.
  return spawn(
    "adb",
    ["-s", serial, "logcat", "-T", "1", "-v", "threadtime"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

function encodeEvent(event: string, value: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
  );
}

class BoundedLineQueue {
  #entries: Array<{ value: LogcatLine; bytes: number }> = [];
  #head = 0;
  #bytes = 0;
  #droppedSinceFlush = 0;

  constructor(
    readonly maxLines: number,
    readonly maxBytes: number,
  ) {}

  get lineCount(): number {
    return this.#entries.length - this.#head;
  }

  get byteCount(): number {
    return this.#bytes;
  }

  push(value: LogcatLine): number {
    const bytes =
      Buffer.byteLength(value.line, "utf8") +
      Buffer.byteLength(value.at, "utf8");
    let dropped = 0;
    if (bytes > this.maxBytes) {
      this.#droppedSinceFlush++;
      return 1;
    }
    while (
      this.lineCount >= this.maxLines ||
      this.#bytes + bytes > this.maxBytes
    ) {
      const entry = this.#entries[this.#head++];
      if (!entry) break;
      this.#bytes -= entry.bytes;
      dropped++;
    }
    if (this.#head >= 64) {
      this.#entries = this.#entries.slice(this.#head);
      this.#head = 0;
    }
    this.#entries.push({ value, bytes });
    this.#bytes += bytes;
    this.#droppedSinceFlush += dropped;
    return dropped;
  }

  drain(): { lines: LogcatLine[]; dropped: number } {
    const lines = this.#entries
      .slice(this.#head)
      .map((entry) => entry.value);
    const dropped = this.#droppedSinceFlush;
    this.#entries = [];
    this.#head = 0;
    this.#bytes = 0;
    this.#droppedSinceFlush = 0;
    return { lines, dropped };
  }
}

type Subscriber = {
  id: number;
  active: boolean;
  packageName: string;
  search: string;
  pids: Set<string>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  queue: BoundedLineQueue;
  totalDropped: number;
  sourceDroppedReported: number;
  batchTimer: unknown | null;
  waitingForPull: boolean;
  pidTimer: unknown | null;
  pidRefresh: Promise<void> | null;
  pidAbort: AbortController | null;
  signal?: AbortSignal;
  abortListener: (() => void) | null;
};

/**
 * One logcat child per immutable device session with bounded server-side
 * fan-out. Slow consumers drop their oldest queued lines and receive the drop
 * count in the next batch rather than growing ReadableStream queues forever.
 */
export class LogcatHub {
  readonly serial: string;
  readonly #maxSubscribers: number;
  readonly #batchIntervalMs: number;
  readonly #maxQueueLines: number;
  readonly #maxQueueBytes: number;
  readonly #maxSourceLineBytes: number;
  readonly #pidRefreshMs: number;
  readonly #terminationGraceMs: number;
  readonly #spawn: (serial: string) => LogcatChild;
  readonly #resolvePackagePids: (
    serial: string,
    packageName: string,
    signal: AbortSignal,
  ) => Promise<Set<string>>;
  readonly #now: () => Date;
  readonly #clock: LogcatClock;
  readonly #subscribers = new Map<number, Subscriber>();
  #decoder = new StringDecoder("utf8");
  readonly #totals = {
    childStarts: 0,
    forcedKills: 0,
    batches: 0,
    deliveredLines: 0,
    droppedLines: 0,
    sourceDroppedLines: 0,
  };
  #nextSubscriberId = 1;
  #child: LogcatChild | null = null;
  #terminatingChild: LogcatChild | null = null;
  #terminationTimer: unknown | null = null;
  #lineBuffer = "";
  #discardingLongLine = false;
  #activePidLookups = 0;
  #closed = false;
  #lastError: string | null = null;

  constructor(serial: string, options: LogcatHubOptions = {}) {
    if (!serial) throw new TypeError("serial must not be empty");
    this.serial = serial;
    this.#maxSubscribers = positiveInteger(
      options.maxSubscribers ?? DEFAULT_MAX_LOGCAT_SUBSCRIBERS,
      "maxSubscribers",
    );
    this.#batchIntervalMs = positiveInteger(
      options.batchIntervalMs ?? DEFAULT_LOGCAT_BATCH_INTERVAL_MS,
      "batchIntervalMs",
    );
    this.#maxQueueLines = positiveInteger(
      options.maxQueueLines ?? DEFAULT_LOGCAT_QUEUE_LINES,
      "maxQueueLines",
    );
    this.#maxQueueBytes = positiveInteger(
      options.maxQueueBytes ?? DEFAULT_LOGCAT_QUEUE_BYTES,
      "maxQueueBytes",
    );
    this.#maxSourceLineBytes = positiveInteger(
      options.maxSourceLineBytes ?? DEFAULT_LOGCAT_MAX_LINE_BYTES,
      "maxSourceLineBytes",
    );
    this.#pidRefreshMs = positiveInteger(
      options.pidRefreshMs ?? DEFAULT_LOGCAT_PID_REFRESH_MS,
      "pidRefreshMs",
    );
    this.#terminationGraceMs = positiveInteger(
      options.terminationGraceMs ?? DEFAULT_LOGCAT_TERMINATION_GRACE_MS,
      "terminationGraceMs",
    );
    this.#spawn = options.dependencies?.spawn ?? spawnLogcat;
    this.#resolvePackagePids =
      options.dependencies?.resolvePackagePids ?? resolvePackagePids;
    this.#now = options.dependencies?.now ?? (() => new Date());
    this.#clock = options.dependencies?.clock ?? SYSTEM_CLOCK;
  }

  subscribe(
    options: LogcatSubscriptionOptions,
    signal?: AbortSignal,
  ): Response {
    if (this.#closed) {
      return Response.json(
        { ok: false, code: "logcat-session-closed", error: "logcat session is closed" },
        { status: 409 },
      );
    }
    if (signal?.aborted) {
      return Response.json(
        { ok: false, code: "logcat-request-aborted", error: "request was aborted" },
        { status: 499 },
      );
    }
    if (this.#subscribers.size >= this.#maxSubscribers) {
      return Response.json(
        {
          ok: false,
          code: "logcat-subscriber-limit",
          error: `logcat subscriber limit is ${this.#maxSubscribers}`,
        },
        { status: 429 },
      );
    }
    try {
      this.#ensureChild();
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: "logcat-start-failed",
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 502 },
      );
    }

    const packageName = (options.packageName ?? "").trim();
    const search = (options.search ?? "").trim().toLowerCase();
    let subscriber!: Subscriber;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = {
          id: this.#nextSubscriberId++,
          active: true,
          packageName,
          search,
          pids: new Set(),
          controller,
          queue: new BoundedLineQueue(
            this.#maxQueueLines,
            this.#maxQueueBytes,
          ),
          totalDropped: 0,
          sourceDroppedReported: this.#totals.sourceDroppedLines,
          batchTimer: null,
          waitingForPull: false,
          pidTimer: null,
          pidRefresh: null,
          pidAbort: null,
          signal,
          abortListener: null,
        };
        this.#subscribers.set(subscriber.id, subscriber);
        this.#sendControl(subscriber, "ready", {
          serial: this.serial,
          package: packageName || null,
          search: search || null,
          batchIntervalMs: this.#batchIntervalMs,
        });
        if (packageName) {
          this.#refreshPids(subscriber);
          subscriber.pidTimer = this.#clock.setInterval(
            () => this.#refreshPids(subscriber),
            this.#pidRefreshMs,
          );
        }
        if (signal) {
          const onAbort = () => this.#removeSubscriber(subscriber, true);
          subscriber.abortListener = onAbort;
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        }
      },
      pull: () => {
        if (!subscriber?.active) return;
        subscriber.waitingForPull = false;
        this.#flush(subscriber);
      },
      cancel: () => {
        if (subscriber) this.#removeSubscriber(subscriber);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  close(reason = "device session closed"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopChild();
    for (const subscriber of [...this.#subscribers.values()]) {
      this.#sendControl(subscriber, "close", { reason });
      this.#removeSubscriber(subscriber, true);
    }
  }

  snapshot(): LogcatSnapshot {
    let queuedLines = 0;
    let queuedBytes = 0;
    for (const subscriber of this.#subscribers.values()) {
      queuedLines += subscriber.queue.lineCount;
      queuedBytes += subscriber.queue.byteCount;
    }
    return {
      serial: this.serial,
      closed: this.#closed,
      childActive: this.#child !== null,
      childTerminating: this.#terminatingChild !== null,
      childCount:
        Number(this.#child !== null) +
        Number(this.#terminatingChild !== null),
      subscribers: this.#subscribers.size,
      activePidLookups: this.#activePidLookups,
      queuedLines,
      queuedBytes,
      limits: {
        subscribers: this.#maxSubscribers,
        queueLinesPerSubscriber: this.#maxQueueLines,
        queueBytesPerSubscriber: this.#maxQueueBytes,
        sourceLineBytes: this.#maxSourceLineBytes,
        batchIntervalMs: this.#batchIntervalMs,
        terminationGraceMs: this.#terminationGraceMs,
      },
      totals: { ...this.#totals },
      lastError: this.#lastError,
    };
  }

  #ensureChild(): void {
    if (this.#child || this.#terminatingChild) return;
    const child = this.#spawn(this.serial);
    this.#child = child;
    this.#decoder = new StringDecoder("utf8");
    this.#lineBuffer = "";
    this.#discardingLongLine = false;
    this.#totals.childStarts++;
    child.stdout.on("data", (chunk: Buffer | string) => {
      if (this.#child !== child) return;
      this.#consumeSource(chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      if (this.#child !== child) return;
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      const line = text.trim();
      if (!line) return;
      this.#lastError = line.slice(0, this.#maxSourceLineBytes);
      this.#dispatchLine(`[logcat stderr] ${this.#lastError}`);
    });
    child.once("error", (error) => {
      if (this.#child !== child) return;
      this.#lastError = error.message;
      for (const subscriber of this.#subscribers.values()) {
        this.#sendControl(subscriber, "error", {
          error: error.message,
          at: this.#now().toISOString(),
        });
      }
    });
    child.once("close", (code, signal) => {
      if (this.#terminatingChild === child) {
        this.#terminatingChild = null;
        if (this.#terminationTimer !== null) {
          this.#clock.clearTimeout(this.#terminationTimer);
          this.#terminationTimer = null;
        }
        if (!this.#closed && this.#subscribers.size > 0) {
          this.#startReplacementChild();
        }
        return;
      }
      if (this.#child !== child) return;
      this.#child = null;
      this.#decoder.end();
      this.#decoder = new StringDecoder("utf8");
      this.#lineBuffer = "";
      this.#discardingLongLine = false;
      for (const subscriber of [...this.#subscribers.values()]) {
        this.#sendControl(subscriber, "close", { code, signal });
        this.#removeSubscriber(subscriber, true);
      }
    });
  }

  #consumeSource(value: Buffer | string): void {
    let text = Buffer.isBuffer(value)
      ? this.#decoder.write(value)
      : value;
    if (this.#discardingLongLine) {
      const newline = text.indexOf("\n");
      if (newline === -1) return;
      text = text.slice(newline + 1);
      this.#discardingLongLine = false;
    }
    const lines = `${this.#lineBuffer}${text}`.split("\n");
    this.#lineBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      this.#acceptSourceLine(rawLine.replace(/\r$/, ""));
    }
    if (
      Buffer.byteLength(this.#lineBuffer, "utf8") >
      this.#maxSourceLineBytes
    ) {
      this.#lineBuffer = "";
      this.#discardingLongLine = true;
      this.#recordSourceDrop();
    }
  }

  #acceptSourceLine(line: string): void {
    if (!line) return;
    if (Buffer.byteLength(line, "utf8") > this.#maxSourceLineBytes) {
      this.#recordSourceDrop();
      return;
    }
    this.#dispatchLine(line);
  }

  #dispatchLine(line: string): void {
    const value = { line, at: this.#now().toISOString() };
    for (const subscriber of this.#subscribers.values()) {
      if (!this.#matches(subscriber, line)) continue;
      const dropped = subscriber.queue.push(value);
      if (dropped > 0) {
        subscriber.totalDropped += dropped;
        this.#totals.droppedLines += dropped;
      }
      this.#scheduleFlush(subscriber);
    }
  }

  #matches(subscriber: Subscriber, line: string): boolean {
    if (subscriber.search && !line.toLowerCase().includes(subscriber.search)) {
      return false;
    }
    if (!subscriber.packageName) return true;
    const pid = line.trim().split(/\s+/, 4)[2];
    return Boolean(
      (pid && subscriber.pids.has(pid)) ||
        line.includes(subscriber.packageName),
    );
  }

  #scheduleFlush(subscriber: Subscriber): void {
    if (
      !subscriber.active ||
      subscriber.batchTimer !== null ||
      subscriber.waitingForPull
    ) {
      return;
    }
    subscriber.batchTimer = this.#clock.setTimeout(() => {
      subscriber.batchTimer = null;
      this.#flush(subscriber);
    }, this.#batchIntervalMs);
  }

  #flush(subscriber: Subscriber): void {
    if (!subscriber.active) return;
    if (
      subscriber.controller.desiredSize !== null &&
      subscriber.controller.desiredSize <= 0
    ) {
      subscriber.waitingForPull = true;
      return;
    }
    const batch = subscriber.queue.drain();
    const sourceDropped = this.#totals.sourceDroppedLines;
    if (
      batch.lines.length === 0 &&
      batch.dropped === 0 &&
      sourceDropped === subscriber.sourceDroppedReported
    ) {
      return;
    }
    try {
      subscriber.controller.enqueue(
        encodeEvent("logs", {
          lines: batch.lines,
          dropped: batch.dropped,
          totalDropped: subscriber.totalDropped,
          sourceDropped,
        }),
      );
      subscriber.sourceDroppedReported = sourceDropped;
      this.#totals.batches++;
      this.#totals.deliveredLines += batch.lines.length;
    } catch {
      this.#removeSubscriber(subscriber);
    }
  }

  #sendControl(
    subscriber: Subscriber,
    event: string,
    value: unknown,
  ): void {
    if (!subscriber.active) return;
    try {
      subscriber.controller.enqueue(encodeEvent(event, value));
    } catch {
      this.#removeSubscriber(subscriber);
    }
  }

  #refreshPids(subscriber: Subscriber): void {
    if (
      !subscriber.active ||
      !subscriber.packageName ||
      subscriber.pidRefresh
    ) {
      return;
    }
    const abort = new AbortController();
    subscriber.pidAbort = abort;
    this.#activePidLookups++;
    const refresh = Promise.resolve()
      .then(() =>
        this.#resolvePackagePids(
          this.serial,
          subscriber.packageName,
          abort.signal,
        ),
      )
      .then((pids) => {
        if (subscriber.active) subscriber.pids = pids;
      })
      .catch((error) => {
        if (subscriber.active) {
          this.#lastError =
            error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        this.#activePidLookups--;
        if (subscriber.pidRefresh === refresh) {
          subscriber.pidRefresh = null;
        }
        if (subscriber.pidAbort === abort) subscriber.pidAbort = null;
      });
    subscriber.pidRefresh = refresh;
  }

  #removeSubscriber(subscriber: Subscriber, closeStream = false): void {
    if (!subscriber.active) return;
    subscriber.active = false;
    this.#subscribers.delete(subscriber.id);
    if (subscriber.batchTimer !== null) {
      this.#clock.clearTimeout(subscriber.batchTimer);
      subscriber.batchTimer = null;
    }
    if (subscriber.pidTimer !== null) {
      this.#clock.clearInterval(subscriber.pidTimer);
      subscriber.pidTimer = null;
    }
    if (subscriber.pidAbort) {
      const abort = subscriber.pidAbort;
      subscriber.pidAbort = null;
      abort.abort("logcat subscriber closed");
    }
    if (subscriber.abortListener && subscriber.signal) {
      subscriber.signal.removeEventListener(
        "abort",
        subscriber.abortListener,
      );
      subscriber.abortListener = null;
    }
    if (closeStream) {
      try {
        subscriber.controller.close();
      } catch {}
    }
    if (this.#subscribers.size === 0) this.#stopChild();
  }

  #recordSourceDrop(): void {
    this.#totals.sourceDroppedLines++;
    for (const subscriber of this.#subscribers.values()) {
      this.#scheduleFlush(subscriber);
    }
  }

  #startReplacementChild(): void {
    try {
      this.#ensureChild();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#lastError = message;
      for (const subscriber of [...this.#subscribers.values()]) {
        this.#sendControl(subscriber, "error", {
          error: message,
          at: this.#now().toISOString(),
        });
        this.#sendControl(subscriber, "close", {
          reason: "logcat restart failed",
        });
        this.#removeSubscriber(subscriber, true);
      }
    }
  }

  #stopChild(): void {
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    this.#terminatingChild = child;
    this.#lineBuffer = "";
    this.#discardingLongLine = false;
    this.#decoder.end();
    this.#decoder = new StringDecoder("utf8");
    this.#terminationTimer = this.#clock.setTimeout(() => {
      this.#terminationTimer = null;
      if (this.#terminatingChild !== child) return;
      this.#totals.forcedKills++;
      try {
        child.kill("SIGKILL");
      } catch (error) {
        this.#lastError =
          error instanceof Error ? error.message : String(error);
      }
    }, this.#terminationGraceMs);
    try {
      child.kill("SIGTERM");
    } catch (error) {
      this.#lastError =
        error instanceof Error ? error.message : String(error);
    }
  }
}
