import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import type { Readable } from "node:stream";

// Bun serves HTTP and pumps video on one JS thread. All short-lived adb and
// emulator commands go through this bounded executor so request bursts cannot
// create an unbounded promise queue or subprocess fan-out.

export const DEFAULT_EXEC_MAX_ACTIVE = 4;
export const DEFAULT_EXEC_MAX_QUEUED = 64;
export const DEFAULT_EXEC_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_EXEC_INTERACTIVE_ACTIVE_RESERVE = 1;
export const DEFAULT_EXEC_INTERACTIVE_QUEUE_RESERVE = 8;
export const MAX_EXEC_TIMEOUT_MS = 2_147_483_647;

export type ExecLane = "interactive" | "default" | "background";

export type ExecErrorCode =
  | "queue-full"
  | "deadline-exceeded"
  | "aborted"
  | "output-limit";

export class ExecError extends Error {
  constructor(
    readonly code: ExecErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExecError";
  }
}

export type ExecOpts = {
  /** Overall deadline, including time spent waiting for an executor slot. */
  timeout?: number;
  /** Combined stdout and stderr byte budget. */
  maxBuffer?: number;
  signal?: AbortSignal;
  lane?: ExecLane;
};

export type ExecResult<T extends string | Buffer> = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: T;
  stderr: string;
  timedOut: boolean;
  error: Error | null;
};

export type ExecSnapshot = {
  active: number;
  queued: number;
  oldestQueuedAgeMs: number | null;
  limits: {
    active: number;
    queued: number;
    outputBytes: number;
    interactiveActiveReserve: number;
    interactiveQueueReserve: number;
  };
  lanes: Record<ExecLane, { active: number; queued: number }>;
  totals: {
    submitted: number;
    started: number;
    settled: number;
    succeeded: number;
    failed: number;
    rejected: number;
    timedOut: number;
    aborted: number;
    outputLimited: number;
  };
};

export type ExecClock = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
};

export type ExecSpawner = (
  cmd: string,
  args: string[],
) => ExecChild;

export type ProcessExecutorOptions = {
  maxActive?: number;
  maxQueued?: number;
  defaultMaxBuffer?: number;
  interactiveActiveReserve?: number;
  interactiveQueueReserve?: number;
  spawn?: ExecSpawner;
  clock?: ExecClock;
};

const SYSTEM_CLOCK: ExecClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) =>
    clearTimeout(timer as ReturnType<typeof setTimeout>),
};

const LANE_PRIORITY: Record<ExecLane, number> = {
  interactive: 0,
  default: 1,
  background: 2,
};

type ExecEncoding = "utf8" | "buffer";
type ExecOutput = string | Buffer;
type JobState = "queued" | "active" | "settled";
type ExecChild = ChildProcessByStdio<null, Readable, Readable>;

type NormalizedExecOpts = {
  timeout: number;
  maxBuffer: number;
  signal?: AbortSignal;
  lane: ExecLane;
};

type ExecJob = {
  id: number;
  cmd: string;
  args: string[];
  opts: NormalizedExecOpts;
  encoding: ExecEncoding;
  state: JobState;
  submittedAt: number;
  resolve: (result: ExecResult<ExecOutput>) => void;
  deadlineTimer: unknown | null;
  abortListener: (() => void) | null;
  child: ExecChild | null;
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
  outputBytes: number;
  terminalError: Error | null;
  timedOut: boolean;
  killRequested: boolean;
};

function integer(
  value: number,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return value;
}

function normalizedOptions(
  options: ExecOpts,
  defaultMaxBuffer: number,
): NormalizedExecOpts {
  const timeout = integer(
    options.timeout ?? 0,
    "timeout",
    0,
    MAX_EXEC_TIMEOUT_MS,
  );
  const maxBuffer = integer(
    options.maxBuffer ?? defaultMaxBuffer,
    "maxBuffer",
    0,
  );
  const lane = options.lane ?? "default";
  if (
    lane !== "interactive" &&
    lane !== "default" &&
    lane !== "background"
  ) {
    throw new TypeError("lane must be interactive, default, or background");
  }
  return { timeout, maxBuffer, signal: options.signal, lane };
}

function abortError(signal: AbortSignal): ExecError {
  return new ExecError("aborted", "command was aborted", {
    cause: signal.reason,
  });
}

function emptyOutput(encoding: ExecEncoding): ExecOutput {
  return encoding === "buffer" ? Buffer.alloc(0) : "";
}

function emptyResult(
  encoding: ExecEncoding,
  error: Error,
  timedOut = false,
): ExecResult<ExecOutput> {
  return {
    status: null,
    signal: null,
    stdout: emptyOutput(encoding),
    stderr: "",
    timedOut,
    error,
  };
}

function isSettled(job: ExecJob): boolean {
  return job.state === "settled";
}

/**
 * Bounded, priority-aware executor for short-lived subprocesses.
 *
 * The command deadline begins before queue admission. Active permits are held
 * until the child emits `close`, including after SIGKILL for timeout, abort, or
 * output overflow.
 */
export class ProcessExecutor {
  readonly #maxActive: number;
  readonly #maxQueued: number;
  readonly #defaultMaxBuffer: number;
  readonly #interactiveActiveReserve: number;
  readonly #interactiveQueueReserve: number;
  readonly #spawn: ExecSpawner;
  readonly #clock: ExecClock;
  readonly #queue: ExecJob[] = [];
  readonly #active = new Map<number, ExecJob>();
  readonly #totals = {
    submitted: 0,
    started: 0,
    settled: 0,
    succeeded: 0,
    failed: 0,
    rejected: 0,
    timedOut: 0,
    aborted: 0,
    outputLimited: 0,
  };
  #nextId = 1;

  constructor(options: ProcessExecutorOptions = {}) {
    this.#maxActive = integer(
      options.maxActive ?? DEFAULT_EXEC_MAX_ACTIVE,
      "maxActive",
      1,
    );
    this.#maxQueued = integer(
      options.maxQueued ?? DEFAULT_EXEC_MAX_QUEUED,
      "maxQueued",
      0,
    );
    this.#defaultMaxBuffer = integer(
      options.defaultMaxBuffer ?? DEFAULT_EXEC_MAX_OUTPUT_BYTES,
      "defaultMaxBuffer",
      0,
    );
    this.#interactiveActiveReserve = integer(
      options.interactiveActiveReserve ??
        Math.min(
          DEFAULT_EXEC_INTERACTIVE_ACTIVE_RESERVE,
          this.#maxActive - 1,
        ),
      "interactiveActiveReserve",
      0,
      this.#maxActive - 1,
    );
    this.#interactiveQueueReserve = integer(
      options.interactiveQueueReserve ??
        Math.min(
          DEFAULT_EXEC_INTERACTIVE_QUEUE_RESERVE,
          Math.floor(this.#maxQueued / 4),
        ),
      "interactiveQueueReserve",
      0,
      this.#maxQueued,
    );
    this.#spawn =
      options.spawn ??
      ((cmd, args) =>
        spawn(cmd, args, {
          stdio: ["ignore", "pipe", "pipe"],
        }));
    this.#clock = options.clock ?? SYSTEM_CLOCK;
  }

  execText(
    cmd: string,
    args: string[],
    options: ExecOpts = {},
  ): Promise<ExecResult<string>> {
    return this.#submit(cmd, args, options, "utf8") as Promise<
      ExecResult<string>
    >;
  }

  execBuffer(
    cmd: string,
    args: string[],
    options: ExecOpts = {},
  ): Promise<ExecResult<Buffer>> {
    return this.#submit(cmd, args, options, "buffer") as Promise<
      ExecResult<Buffer>
    >;
  }

  snapshot(): ExecSnapshot {
    const lanes: ExecSnapshot["lanes"] = {
      interactive: { active: 0, queued: 0 },
      default: { active: 0, queued: 0 },
      background: { active: 0, queued: 0 },
    };
    for (const job of this.#active.values()) lanes[job.opts.lane].active++;
    for (const job of this.#queue) lanes[job.opts.lane].queued++;
    const now = this.#clock.now();
    return {
      active: this.#active.size,
      queued: this.#queue.length,
      oldestQueuedAgeMs:
        this.#queue.length === 0
          ? null
          : Math.max(
              0,
              now -
                Math.min(...this.#queue.map((job) => job.submittedAt)),
            ),
      limits: {
        active: this.#maxActive,
        queued: this.#maxQueued,
        outputBytes: this.#defaultMaxBuffer,
        interactiveActiveReserve: this.#interactiveActiveReserve,
        interactiveQueueReserve: this.#interactiveQueueReserve,
      },
      lanes,
      totals: { ...this.#totals },
    };
  }

  #submit(
    cmd: string,
    args: string[],
    options: ExecOpts,
    encoding: ExecEncoding,
  ): Promise<ExecResult<ExecOutput>> {
    if (!cmd) throw new TypeError("cmd must not be empty");
    const opts = normalizedOptions(options, this.#defaultMaxBuffer);
    this.#totals.submitted++;

    if (opts.signal?.aborted) {
      this.#totals.settled++;
      this.#totals.failed++;
      this.#totals.aborted++;
      return Promise.resolve(emptyResult(encoding, abortError(opts.signal)));
    }
    if (
      !this.#canStartLane(opts.lane) &&
      !this.#queueHasCapacity(opts.lane)
    ) {
      const error = new ExecError(
        "queue-full",
        `command queue has no capacity for ${opts.lane} work`,
      );
      this.#totals.settled++;
      this.#totals.failed++;
      this.#totals.rejected++;
      return Promise.resolve(emptyResult(encoding, error));
    }

    let resolve!: (result: ExecResult<ExecOutput>) => void;
    const promise = new Promise<ExecResult<ExecOutput>>((done) => {
      resolve = done;
    });
    const job: ExecJob = {
      id: this.#nextId++,
      cmd,
      args: [...args],
      opts,
      encoding,
      state: "queued",
      submittedAt: this.#clock.now(),
      resolve,
      deadlineTimer: null,
      abortListener: null,
      child: null,
      stdoutChunks: [],
      stderrChunks: [],
      outputBytes: 0,
      terminalError: null,
      timedOut: false,
      killRequested: false,
    };

    if (opts.signal) {
      const onAbort = () => this.#abort(job, abortError(opts.signal!));
      job.abortListener = onAbort;
      opts.signal.addEventListener("abort", onAbort, { once: true });
      if (opts.signal.aborted) onAbort();
    }
    if (isSettled(job)) return promise;

    if (opts.timeout > 0) {
      const timer = this.#clock.setTimeout(
        () => this.#expire(job),
        opts.timeout,
      );
      if (isSettled(job)) this.#clock.clearTimeout(timer);
      else job.deadlineTimer = timer;
    }
    if (isSettled(job)) return promise;

    if (this.#canStartLane(job.opts.lane)) this.#start(job);
    else this.#queue.push(job);
    return promise;
  }

  #start(job: ExecJob): void {
    if (job.state !== "queued") return;
    job.state = "active";
    this.#active.set(job.id, job);
    this.#totals.started++;

    let child: ExecChild;
    try {
      child = this.#spawn(job.cmd, job.args);
    } catch (error) {
      job.terminalError =
        error instanceof Error ? error : new Error(String(error));
      this.#finishActive(job, null, null);
      return;
    }
    job.child = child;
    child.stdout.on("data", (chunk: Buffer | string) => {
      this.#collect(job, "stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.#collect(job, "stderr", chunk);
    });
    child.once("error", (error) => {
      this.#processError(job, error);
    });
    child.stdout.once("error", (error) => this.#processError(job, error));
    child.stderr.once("error", (error) => this.#processError(job, error));
    child.once("close", (status, signal) => {
      this.#finishActive(job, status, signal);
    });

    // Cover an abort/deadline fired synchronously inside an injected spawner.
    if (job.terminalError) this.#kill(job);
  }

  #collect(
    job: ExecJob,
    target: "stdout" | "stderr",
    value: Buffer | string,
  ): void {
    if (job.state !== "active" || job.terminalError) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.byteLength > job.opts.maxBuffer - job.outputBytes) {
      job.terminalError = new ExecError(
        "output-limit",
        `combined stdout and stderr exceed ${job.opts.maxBuffer} bytes`,
      );
      this.#totals.outputLimited++;
      this.#kill(job);
      return;
    }
    job.outputBytes += chunk.byteLength;
    (target === "stdout" ? job.stdoutChunks : job.stderrChunks).push(chunk);
  }

  #processError(job: ExecJob, error: Error): void {
    if (job.state !== "active") return;
    job.terminalError ??= error;
    this.#kill(job);
  }

  #abort(job: ExecJob, error: ExecError): void {
    if (job.state === "settled") return;
    if (job.state === "queued") {
      this.#totals.aborted++;
      this.#finishQueued(job, error, false);
      return;
    }
    if (!job.terminalError) {
      job.terminalError = error;
      this.#totals.aborted++;
    }
    this.#kill(job);
  }

  #expire(job: ExecJob): void {
    if (job.state === "settled") return;
    const error = new ExecError(
      "deadline-exceeded",
      `command deadline exceeded after ${job.opts.timeout}ms`,
    );
    if (job.state === "queued") {
      job.timedOut = true;
      this.#totals.timedOut++;
      this.#finishQueued(job, error, true);
      return;
    }
    if (!job.terminalError) {
      job.timedOut = true;
      job.terminalError = error;
      this.#totals.timedOut++;
    }
    this.#kill(job);
  }

  #kill(job: ExecJob): void {
    if (job.state !== "active" || !job.child || job.killRequested) return;
    job.killRequested = true;
    try {
      job.child.kill("SIGKILL");
    } catch (error) {
      job.terminalError ??=
        error instanceof Error ? error : new Error(String(error));
    }
  }

  #finishQueued(job: ExecJob, error: Error, timedOut: boolean): void {
    if (job.state !== "queued") return;
    job.state = "settled";
    const index = this.#queue.indexOf(job);
    if (index >= 0) this.#queue.splice(index, 1);
    this.#dispose(job);
    this.#totals.settled++;
    this.#totals.failed++;
    job.resolve(emptyResult(job.encoding, error, timedOut));
    this.#drain();
  }

  #finishActive(
    job: ExecJob,
    status: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (job.state !== "active") return;
    job.state = "settled";
    this.#active.delete(job.id);
    this.#dispose(job);

    const stdoutBuffer = Buffer.concat(job.stdoutChunks);
    const result: ExecResult<ExecOutput> = {
      status,
      signal,
      stdout:
        job.encoding === "buffer"
          ? stdoutBuffer
          : stdoutBuffer.toString("utf8"),
      stderr: Buffer.concat(job.stderrChunks).toString("utf8"),
      timedOut: job.timedOut,
      error: job.terminalError,
    };
    const succeeded = status === 0 && !result.error;
    this.#totals.settled++;
    if (succeeded) this.#totals.succeeded++;
    else this.#totals.failed++;
    job.resolve(result);
    this.#drain();
  }

  #dispose(job: ExecJob): void {
    if (job.deadlineTimer !== null) {
      this.#clock.clearTimeout(job.deadlineTimer);
      job.deadlineTimer = null;
    }
    if (job.abortListener && job.opts.signal) {
      job.opts.signal.removeEventListener("abort", job.abortListener);
      job.abortListener = null;
    }
  }

  #canStartLane(lane: ExecLane): boolean {
    if (this.#active.size >= this.#maxActive) return false;
    if (lane === "background") {
      const activeInteractive = Array.from(this.#active.values()).reduce(
        (count, job) => count + (job.opts.lane === "interactive" ? 1 : 0),
        0,
      );
      const reserveNeeded = Math.max(
        0,
        this.#interactiveActiveReserve - activeInteractive,
      );
      if (this.#active.size >= this.#maxActive - reserveNeeded) return false;
    }
    return true;
  }

  #queueHasCapacity(lane: ExecLane): boolean {
    if (this.#queue.length >= this.#maxQueued) return false;
    if (lane === "interactive") return true;
    const nonInteractiveQueued = this.#queue.reduce(
      (count, job) => count + (job.opts.lane === "interactive" ? 0 : 1),
      0,
    );
    return (
      nonInteractiveQueued <
      this.#maxQueued - this.#interactiveQueueReserve
    );
  }

  #drain(): void {
    while (this.#active.size < this.#maxActive && this.#queue.length > 0) {
      let nextIndex = -1;
      for (let index = 0; index < this.#queue.length; index++) {
        const candidate = this.#queue[index]!;
        if (!this.#canStartLane(candidate.opts.lane)) continue;
        if (
          nextIndex === -1 ||
          LANE_PRIORITY[candidate.opts.lane] <
            LANE_PRIORITY[this.#queue[nextIndex]!.opts.lane]
        ) {
          nextIndex = index;
        }
      }
      if (nextIndex === -1) return;
      const [next] = this.#queue.splice(nextIndex, 1);
      if (next?.state === "queued") this.#start(next);
    }
  }
}

const defaultExecutor = new ProcessExecutor();

export function execText(
  cmd: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<ExecResult<string>> {
  return defaultExecutor.execText(cmd, args, opts);
}

export function execBuffer(
  cmd: string,
  args: string[],
  opts: ExecOpts = {},
): Promise<ExecResult<Buffer>> {
  return defaultExecutor.execBuffer(cmd, args, opts);
}

export function getExecSnapshot(): ExecSnapshot {
  return defaultExecutor.snapshot();
}
