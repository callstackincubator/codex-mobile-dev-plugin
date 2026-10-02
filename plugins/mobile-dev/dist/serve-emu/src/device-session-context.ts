import type { AccessibilitySnapshot } from "./accessibility.ts";
import { ControlInputQueue } from "./control-input-queue.ts";
import { FrameStatWindow } from "./frame-stat-window.ts";
import type { Screen } from "./input.ts";
import type { GeoFix } from "./location.ts";
import { LogcatHub } from "./logcat.ts";
import { RoutePlayback } from "./route-playback.ts";
import type { ScrcpySession } from "./scrcpy.ts";
import { SessionRecorder } from "./session-recorder.ts";
import { disposeReplayBefore } from "./session-replay-lifecycle.ts";
import type { SessionStatus } from "./session-status.ts";

const FRAME_STAT_WINDOW = 240;

export class SessionChangedError extends Error {
  readonly code = "session_changed";

  constructor(
    readonly expectedGeneration: number,
    readonly activeGeneration: number | null,
  ) {
    super(
      activeGeneration === null
        ? `device session ${expectedGeneration} is no longer active`
        : `device session changed from generation ${expectedGeneration} to ${activeGeneration}`,
    );
    this.name = "SessionChangedError";
  }
}

export type SessionClient = {
  ws: { close(code?: number, reason?: string): void };
};

type Cleanup = () => void | Promise<void>;

type ActiveDeviceSessionOpts<TClient extends SessionClient> = {
  serial: string;
  generation: number;
  scrcpy: ScrcpySession;
  applyLocation: (serial: string, fix: GeoFix, signal: AbortSignal) => Promise<void>;
  closeClient?: (client: TClient, code: number, reason: string) => void;
  inputQueue?: ControlInputQueue;
  now?: () => number;
};

export type DisposeDeviceSessionOpts = {
  status?: Exclude<SessionStatus, "streaming">;
  clientCode?: number;
};

/**
 * Everything whose lifetime is tied to one selected Android device.
 *
 * A context is never reused. Device switches publish a newly prepared context
 * and then dispose the previous generation. Async work may finish late, but it
 * can only see this context's state and its aborted signal, never the next one.
 */
export class ActiveDeviceSession<
  TClient extends SessionClient = SessionClient,
> {
  readonly serial: string;
  readonly generation: number;
  readonly scrcpy: ScrcpySession;
  readonly screen: Screen;
  readonly recorder = new SessionRecorder();
  readonly logcat: LogcatHub;
  readonly inputQueue: ControlInputQueue;
  readonly route: RoutePlayback;
  readonly clients = new Set<TClient>();
  readonly abortController = new AbortController();
  readonly frameStats = new FrameStatWindow(FRAME_STAT_WINDOW);

  status: SessionStatus = "streaming";
  terminalTransitionStarted = false;
  startedMs: number;
  startedAt: string;
  stoppedAt: string | null = null;
  lastError: string | null = null;
  lastErrorCode: string | null = null;
  lastErrorMeta: Record<string, string | number> | null = null;
  frameCount = 0;
  configPacketCount = 0;
  lastFrameMs = 0;
  totalDroppedFrames = 0;
  totalBackpressureEvents = 0;
  sourceFps = 0;
  lastFpsFrameCount = 0;
  videoResetRequests = 0;
  lastVideoResetAt: string | null = null;
  lastVideoResetReason: string | null = null;
  lastVideoResetMs = 0;
  lastLocation: (GeoFix & { appliedAt: string }) | null = null;
  cachedConfig: Buffer | null = null;
  watchdog: ReturnType<typeof setInterval> | null = null;

  #accessibilitySnapshotCache: {
    snapshot: AccessibilitySnapshot;
    expiresMs: number;
  } | null = null;
  #accessibilitySnapshotInFlight: Promise<AccessibilitySnapshot> | null = null;
  #closeClient: (client: TClient, code: number, reason: string) => void;
  #cleanup = new Set<Cleanup>();
  #cleanupTasks = new Set<Promise<unknown>>();
  #drains = new Set<Promise<unknown>>();
  #disposeTask: Promise<void> | null = null;
  #now: () => number;

  constructor(opts: ActiveDeviceSessionOpts<TClient>) {
    this.serial = opts.serial;
    this.logcat = new LogcatHub(opts.serial);
    this.generation = opts.generation;
    this.scrcpy = opts.scrcpy;
    this.screen = {
      width: opts.scrcpy.meta.width,
      height: opts.scrcpy.meta.height,
    };
    this.#now = opts.now ?? Date.now;
    this.startedMs = this.#now();
    this.startedAt = new Date(this.startedMs).toISOString();
    this.#closeClient =
      opts.closeClient ??
      ((client, code, reason) => {
        client.ws.close(code, reason);
      });
    this.inputQueue =
      opts.inputQueue ??
      (opts.scrcpy.controlSocket
        ? new ControlInputQueue({ socket: opts.scrcpy.controlSocket })
        : new ControlInputQueue({
            writer: {
              async write() {
                throw new Error("scrcpy control socket is unavailable");
              },
            },
          }));
    this.route = new RoutePlayback({
      applyLocation: async (fix, signal) => {
        this.assertUsable();
        await opts.applyLocation(this.serial, fix, signal);
        this.assertUsable();
      },
      onLocation: (fix) => {
        if (!this.signal.aborted) this.lastLocation = fix;
      },
    });
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get disposed(): boolean {
    return this.#disposeTask !== null;
  }

  get accessibilitySnapshotInFlight(): boolean {
    return this.#accessibilitySnapshotInFlight !== null;
  }

  assertUsable(activeGeneration: number | null = this.generation): void {
    if (this.signal.aborted || activeGeneration !== this.generation) {
      throw new SessionChangedError(this.generation, activeGeneration);
    }
  }

  readAccessibilitySnapshot(
    load: (serial: string, signal: AbortSignal) => Promise<AccessibilitySnapshot>,
    cacheMs = 2_500,
  ): Promise<AccessibilitySnapshot> {
    this.assertUsable();
    const now = this.#now();
    if (
      this.#accessibilitySnapshotCache &&
      this.#accessibilitySnapshotCache.expiresMs > now
    ) {
      return Promise.resolve(this.#accessibilitySnapshotCache.snapshot);
    }
    if (this.#accessibilitySnapshotInFlight) {
      return this.#accessibilitySnapshotInFlight;
    }

    const request = load(this.serial, this.signal)
      .then((snapshot) => {
        this.assertUsable();
        this.#accessibilitySnapshotCache = {
          snapshot,
          expiresMs: this.#now() + cacheMs,
        };
        return snapshot;
      })
      .finally(() => {
        if (this.#accessibilitySnapshotInFlight === request) {
          this.#accessibilitySnapshotInFlight = null;
        }
      });
    this.#accessibilitySnapshotInFlight = this.trackDrain(request);
    return this.#accessibilitySnapshotInFlight;
  }

  registerCleanup(cleanup: Cleanup): () => void {
    if (this.signal.aborted) {
      this.#startCleanup(cleanup);
      return () => {};
    }
    this.#cleanup.add(cleanup);
    return () => this.#cleanup.delete(cleanup);
  }

  trackDrain<T>(task: Promise<T>): Promise<T> {
    this.assertUsable();
    this.#drains.add(task);
    void task.finally(() => this.#drains.delete(task)).catch(() => {});
    return task;
  }

  /**
   * Tracks capability-bearing background work only until this generation is
   * revoked. The underlying legacy task may finish later, but every handler is
   * generation-guarded and disposal is never held by an uninterruptible wait.
   */
  trackUntilAbort(task: Promise<unknown>): Promise<void> {
    this.assertUsable();
    let onAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      onAbort = resolve;
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
    const guarded = Promise.race([task.then(() => {}), aborted]).finally(() => {
      this.signal.removeEventListener("abort", onAbort);
    });
    return this.trackDrain(guarded);
  }

  closeClients(code: number, reason: string): void {
    for (const client of this.clients) {
      try {
        this.#closeClient(client, code, reason);
      } catch {}
    }
    this.clients.clear();
  }

  setWatchdog(timer: ReturnType<typeof setInterval>): void {
    if (this.signal.aborted) {
      clearInterval(timer);
      return;
    }
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = timer;
  }

  /** Idempotent; every owner receives the exact same cleanup promise. */
  dispose(reason: string, opts: DisposeDeviceSessionOpts = {}): Promise<void> {
    if (this.#disposeTask) return this.#disposeTask;

    let finishDispose!: () => void;
    // Publish the shared promise before aborting or closing resources: either
    // action may synchronously invoke a listener that calls dispose() again.
    this.#disposeTask = new Promise<void>((resolve) => {
      finishDispose = resolve;
    });

    const nextStatus = opts.status ?? "stopped";
    this.status = nextStatus;
    this.lastError = reason;
    this.stoppedAt = new Date(this.#now()).toISOString();
    this.abortController.abort(new SessionChangedError(this.generation, null));
    this.inputQueue.close(new Error(reason));
    this.logcat.close(reason);
    const replayDisposed = disposeReplayBefore({
      recorder: this.recorder,
      stopRoute: () => {
        this.route.stop();
        this.route.close();
      },
      afterReplayStopped: () => {},
    });
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.closeClients(opts.clientCode ?? (nextStatus === "error" ? 1011 : 1000), reason);

    const cleanups = Array.from(this.#cleanup);
    this.#cleanup.clear();
    const drains = Array.from(this.#drains);

    void (async () => {
      for (const cleanup of cleanups) this.#startCleanup(cleanup);
      await replayDisposed;
      try {
        this.scrcpy.close();
      } catch {}
      await Promise.allSettled(drains);
      await this.#drainCleanups();
      // A route start that was awaiting its initial location can otherwise
      // create a timer after the first close(). Close again after draining it.
      this.route.stop();
      this.route.close();
    })().then(finishDispose, finishDispose);
    return this.#disposeTask;
  }

  #startCleanup(cleanup: Cleanup): void {
    const task = Promise.resolve().then(cleanup);
    this.#cleanupTasks.add(task);
    void task.finally(() => this.#cleanupTasks.delete(task)).catch(() => {});
  }

  async #drainCleanups(): Promise<void> {
    while (this.#cleanupTasks.size > 0) {
      await Promise.allSettled(Array.from(this.#cleanupTasks));
    }
  }
}

export type ManagedDeviceSession = {
  readonly serial: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  dispose(reason: string, opts?: DisposeDeviceSessionOpts): Promise<void>;
};

/** Serializes every transition and owns the single published active context. */
export class DeviceSessionManager<TContext extends ManagedDeviceSession> {
  #current: TContext;
  #tail: Promise<void> = Promise.resolve();
  #transitionController: AbortController | null = null;
  #closing = false;
  #closed = false;

  constructor(initial: TContext) {
    this.#current = initial;
  }

  get current(): TContext {
    return this.#current;
  }

  isCurrent(context: TContext): boolean {
    return this.#current === context && !context.signal.aborted;
  }

  isPublished(context: TContext): boolean {
    return this.#current === context;
  }

  assertCurrent(context: TContext): void {
    if (!this.isCurrent(context)) {
      throw new SessionChangedError(
        context.generation,
        this.#closed ||
          (this.#current === context && context.signal.aborted)
          ? null
          : this.#current.generation,
      );
    }
  }

  assertPublished(context: TContext): void {
    if (this.#closing || !this.isPublished(context)) {
      throw new SessionChangedError(
        context.generation,
        this.#closing ? null : this.#current.generation,
      );
    }
  }

  switch(
    serial: string,
    prepare: (
      serial: string,
      generation: number,
      signal: AbortSignal,
    ) => Promise<TContext>,
    activate?: (context: TContext) => void,
  ): Promise<TContext> {
    return this.#enqueue(async () => {
      if (this.#closing) throw new Error("device session manager is closed");
      const previous = this.#current;
      if (previous.serial === serial && !previous.signal.aborted) return previous;

      // Candidate startup happens while the old context remains published. A
      // failed preparation therefore leaves the working device untouched.
      const transition = new AbortController();
      this.#transitionController = transition;
      let next: TContext;
      try {
        next = await prepare(
          serial,
          previous.generation + 1,
          transition.signal,
        );
      } finally {
        if (this.#transitionController === transition) {
          this.#transitionController = null;
        }
      }
      if (this.#closing) {
        await next.dispose("server stopped during device switch");
        throw new Error("device session manager is closed");
      }

      // Publication is one synchronous assignment. From here on every health
      // and request capture observes the complete next generation.
      this.#current = next;
      try {
        activate?.(next);
      } catch (err) {
        this.#current = previous;
        await next.dispose("device session activation failed");
        throw err;
      }
      await previous.dispose("device switched", { clientCode: 1012 });
      return next;
    });
  }

  stop(
    context: TContext,
    reason: string,
    opts: DisposeDeviceSessionOpts = {},
  ): Promise<void> {
    return this.#enqueue(async () => {
      this.assertPublished(context);
      await context.dispose(reason, opts);
    });
  }

  close(reason: string): Promise<void> {
    this.#closing = true;
    this.#transitionController?.abort(
      new SessionChangedError(this.#current.generation, null),
    );
    const activeAtClose = this.#current;
    const immediateDispose = activeAtClose.dispose(reason, {
      clientCode: 1001,
    });
    return this.#enqueue(async () => {
      if (this.#closed) {
        await immediateDispose;
        return;
      }
      this.#closed = true;
      await immediateDispose;
      if (this.#current !== activeAtClose) {
        await this.#current.dispose(reason, { clientCode: 1001 });
      }
    });
  }

  #enqueue<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
