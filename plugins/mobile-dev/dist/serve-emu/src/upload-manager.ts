export type UploadContext = {
  serial: string;
  generation: number;
};

export type UploadManagerErrorCode =
  | "queue-full"
  | "queue-timeout"
  | "upload-cancelled"
  | "device-session-changed"
  | "closed";

export class UploadManagerError extends Error {
  constructor(
    readonly code: UploadManagerErrorCode,
    message: string,
    readonly context?: UploadContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UploadManagerError";
  }
}

export type UploadManagerClock = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
};

export const SYSTEM_UPLOAD_MANAGER_CLOCK: UploadManagerClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) =>
    clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export type UploadManagerOptions = {
  maxActive?: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
  clock?: UploadManagerClock;
};

export type UploadRunOptions = {
  context: UploadContext;
  requestSignal?: AbortSignal;
  sessionSignal?: AbortSignal;
};

export type UploadOperationInput = {
  context: UploadContext;
  signal: AbortSignal;
};

export type UploadManagerSnapshot = {
  closed: boolean;
  active: number;
  queued: number;
  oldestQueuedAgeMs: number | null;
  limits: {
    active: number;
    queued: number;
    queueTimeoutMs: number;
  };
  totals: {
    accepted: number;
    started: number;
    completed: number;
    failed: number;
    cancelled: number;
    rejected: number;
    timedOut: number;
  };
};

type JobState = "queued" | "active" | "finished";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
};

type UploadJob<T> = {
  id: number;
  context: UploadContext;
  operation: (input: UploadOperationInput) => T | Promise<T>;
  controller: AbortController;
  deferred: Deferred<T>;
  enqueuedMs: number;
  state: JobState;
  queueTimer: unknown | null;
  cancellation: UploadManagerError | null;
  listenerCleanup: Array<() => void>;
  cleanup: Promise<void> | null;
};

const DEFAULT_MAX_ACTIVE = 2;
const DEFAULT_MAX_QUEUED = 4;
const DEFAULT_QUEUE_TIMEOUT_MS = 5_000;
export const MAX_UPLOAD_QUEUE_TIMEOUT_MS = 2_147_483_647;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function contextError(
  code: UploadManagerErrorCode,
  context: UploadContext,
  cause?: unknown,
): UploadManagerError {
  const message =
    code === "queue-full"
      ? "upload queue is full"
      : code === "queue-timeout"
        ? "upload queue deadline exceeded"
        : code === "upload-cancelled"
          ? "upload request was cancelled"
          : code === "device-session-changed"
            ? `device session ${context.generation} is no longer active`
            : "upload manager is closed";
  return new UploadManagerError(code, message, context, { cause });
}

function isUploadCleanupFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    error.code === "upload-cleanup-failed" ||
    error.code === "adb-cleanup-failed"
  );
}

/**
 * Bounds upload work and owns its cancellation/cleanup lifecycle.
 *
 * A slot is not released until the operation promise settles after an abort.
 * Callers should stop their I/O when `signal` aborts and resolve/reject only
 * after their temporary-file and subprocess cleanup has finished.
 */
export class UploadManager {
  readonly #maxActive: number;
  readonly #maxQueued: number;
  readonly #queueTimeoutMs: number;
  readonly #clock: UploadManagerClock;
  readonly #queue: Array<UploadJob<unknown>> = [];
  readonly #active = new Map<number, UploadJob<unknown>>();
  readonly #cancelledGenerations = new Set<number>();
  readonly #totals = {
    accepted: 0,
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    rejected: 0,
    timedOut: 0,
  };
  #nextId = 1;
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(options: UploadManagerOptions = {}) {
    this.#maxActive = positiveInteger(
      options.maxActive ?? DEFAULT_MAX_ACTIVE,
      "maxActive",
    );
    this.#maxQueued = nonNegativeInteger(
      options.maxQueued ?? DEFAULT_MAX_QUEUED,
      "maxQueued",
    );
    this.#queueTimeoutMs = nonNegativeInteger(
      options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
      "queueTimeoutMs",
    );
    if (this.#queueTimeoutMs > MAX_UPLOAD_QUEUE_TIMEOUT_MS) {
      throw new TypeError(
        `queueTimeoutMs must be at most ${MAX_UPLOAD_QUEUE_TIMEOUT_MS}`,
      );
    }
    this.#clock = options.clock ?? SYSTEM_UPLOAD_MANAGER_CLOCK;
  }

  run<T>(
    options: UploadRunOptions,
    operation: (input: UploadOperationInput) => T | Promise<T>,
  ): Promise<T> {
    const context = this.#copyContext(options.context);
    if (this.#closed) {
      return this.#rejectImmediately<T>(contextError("closed", context));
    }
    if (this.#cancelledGenerations.has(context.generation)) {
      return this.#rejectImmediately<T>(
        contextError("device-session-changed", context),
      );
    }
    if (options.sessionSignal?.aborted) {
      return this.#rejectImmediately<T>(
        contextError(
          "device-session-changed",
          context,
          options.sessionSignal.reason,
        ),
      );
    }
    if (options.requestSignal?.aborted) {
      return this.#rejectImmediately<T>(
        contextError(
          "upload-cancelled",
          context,
          options.requestSignal.reason,
        ),
      );
    }
    if (
      this.#active.size >= this.#maxActive &&
      this.#queue.length >= this.#maxQueued
    ) {
      return this.#rejectImmediately<T>(contextError("queue-full", context));
    }

    const job: UploadJob<T> = {
      id: this.#nextId++,
      context,
      operation,
      controller: new AbortController(),
      deferred: createDeferred<T>(),
      enqueuedMs: this.#clock.now(),
      state: "queued",
      queueTimer: null,
      cancellation: null,
      listenerCleanup: [],
      cleanup: null,
    };
    this.#totals.accepted++;
    this.#listenForAbort(
      job,
      options.requestSignal,
      "upload-cancelled",
    );
    this.#listenForAbort(
      job,
      options.sessionSignal,
      "device-session-changed",
    );

    if (job.cancellation) {
      this.#finishQueuedCancellation(job);
      return job.deferred.promise;
    }
    if (this.#active.size < this.#maxActive) {
      this.#start(job);
    } else {
      this.#queue.push(job as UploadJob<unknown>);
      const timer = this.#clock.setTimeout(() => {
        if (job.state !== "queued") return;
        this.#cancel(
          job,
          contextError("queue-timeout", job.context),
        );
      }, this.#queueTimeoutMs);
      if (job.state === "queued") job.queueTimer = timer;
      else this.#clock.clearTimeout(timer);
    }
    return job.deferred.promise;
  }

  async cancelGeneration(
    generation: number,
    cause?: unknown,
  ): Promise<void> {
    nonNegativeInteger(generation, "generation");
    this.#cancelledGenerations.add(generation);
    const cleanups: Promise<void>[] = [];

    for (const job of [...this.#queue]) {
      if (job.context.generation !== generation) continue;
      this.#cancel(
        job,
        contextError("device-session-changed", job.context, cause),
      );
    }
    for (const job of this.#active.values()) {
      if (job.context.generation !== generation) continue;
      this.#cancel(
        job,
        contextError("device-session-changed", job.context, cause),
      );
      if (job.cleanup) cleanups.push(job.cleanup);
    }

    await Promise.allSettled(cleanups);
  }

  close(cause?: unknown): Promise<void> {
    if (this.#closePromise) return this.#closePromise;

    let finish!: () => void;
    this.#closePromise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#closed = true;

    const cleanups: Promise<void>[] = [];
    for (const job of [...this.#queue]) {
      this.#cancel(job, contextError("closed", job.context, cause));
    }
    for (const job of this.#active.values()) {
      this.#cancel(job, contextError("closed", job.context, cause));
      if (job.cleanup) cleanups.push(job.cleanup);
    }
    void Promise.allSettled(cleanups).then(() => finish());
    return this.#closePromise;
  }

  snapshot(): UploadManagerSnapshot {
    const now = this.#clock.now();
    return {
      closed: this.#closed,
      active: this.#active.size,
      queued: this.#queue.length,
      oldestQueuedAgeMs:
        this.#queue.length === 0
          ? null
          : Math.max(0, now - this.#queue[0]!.enqueuedMs),
      limits: {
        active: this.#maxActive,
        queued: this.#maxQueued,
        queueTimeoutMs: this.#queueTimeoutMs,
      },
      totals: { ...this.#totals },
    };
  }

  #copyContext(context: UploadContext): UploadContext {
    if (typeof context.serial !== "string" || context.serial.length === 0) {
      throw new TypeError("context.serial must be a non-empty string");
    }
    nonNegativeInteger(context.generation, "context.generation");
    return { serial: context.serial, generation: context.generation };
  }

  #rejectImmediately<T>(error: UploadManagerError): Promise<T> {
    this.#totals.rejected++;
    return Promise.reject(error);
  }

  #listenForAbort<T>(
    job: UploadJob<T>,
    signal: AbortSignal | undefined,
    code: "upload-cancelled" | "device-session-changed",
  ): void {
    if (!signal) return;
    const onAbort = () => {
      this.#cancel(job, contextError(code, job.context, signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    job.listenerCleanup.push(() =>
      signal.removeEventListener("abort", onAbort),
    );
    if (signal.aborted) onAbort();
  }

  #start<T>(job: UploadJob<T>): void {
    if (job.state !== "queued") return;
    job.state = "active";
    this.#active.set(job.id, job as UploadJob<unknown>);
    this.#totals.started++;

    let value: T | undefined;
    let operationError: unknown;
    let operationFailed = false;
    const cleanup = Promise.resolve()
      .then(() => {
        if (job.cancellation) throw job.cancellation;
        return job.operation({
          context: job.context,
          signal: job.controller.signal,
        });
      })
      .then(
        (result) => {
          value = result;
        },
        (error) => {
          operationFailed = true;
          operationError = error;
        },
      )
      .then(() => {
        this.#finishActive(job, value as T, operationFailed, operationError);
      });
    job.cleanup = cleanup;
    this.#clearQueueTimer(job);
  }

  #finishActive<T>(
    job: UploadJob<T>,
    value: T,
    operationFailed: boolean,
    operationError: unknown,
  ): void {
    if (job.state !== "active") return;
    job.state = "finished";
    this.#active.delete(job.id);
    this.#disposeJob(job);

    if (operationFailed && isUploadCleanupFailure(operationError)) {
      // Cancellation normally wins races, but hiding a cleanup failure would
      // make a leaked staging directory invisible to the caller.
      this.#totals.failed++;
      job.deferred.reject(operationError);
    } else if (job.cancellation) {
      this.#recordCancellation(job.cancellation);
      job.deferred.reject(job.cancellation);
    } else if (operationFailed) {
      this.#totals.failed++;
      job.deferred.reject(operationError);
    } else {
      this.#totals.completed++;
      job.deferred.resolve(value);
    }
    this.#drain();
  }

  #cancel<T>(job: UploadJob<T>, error: UploadManagerError): void {
    if (job.state === "finished" || job.cancellation) return;
    job.cancellation = error;
    job.controller.abort(error);
    if (job.state === "queued") this.#finishQueuedCancellation(job);
  }

  #finishQueuedCancellation<T>(job: UploadJob<T>): void {
    if (job.state !== "queued" || !job.cancellation) return;
    job.state = "finished";
    const index = this.#queue.indexOf(job as UploadJob<unknown>);
    if (index >= 0) this.#queue.splice(index, 1);
    this.#disposeJob(job);
    this.#recordCancellation(job.cancellation);
    job.deferred.reject(job.cancellation);
    this.#drain();
  }

  #recordCancellation(error: UploadManagerError): void {
    if (error.code === "queue-timeout") this.#totals.timedOut++;
    else this.#totals.cancelled++;
  }

  #disposeJob<T>(job: UploadJob<T>): void {
    this.#clearQueueTimer(job);
    for (const cleanup of job.listenerCleanup.splice(0)) cleanup();
  }

  #clearQueueTimer<T>(job: UploadJob<T>): void {
    if (job.queueTimer === null) return;
    this.#clock.clearTimeout(job.queueTimer);
    job.queueTimer = null;
  }

  #drain(): void {
    if (this.#closed) return;
    while (this.#active.size < this.#maxActive) {
      const job = this.#queue.shift();
      if (!job) return;
      if (job.state !== "queued") continue;
      this.#start(job);
    }
  }
}
