export type RecoveryClientState = {
  awaitingKeyFrame: boolean;
  awaitingKeyFrameSinceMs: number | null;
  lastKeyFrameRequestMs: number | null;
};

export type RecoveryWatchdogClock = {
  now(): number;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(timer: unknown): void;
};

export const SYSTEM_RECOVERY_WATCHDOG_CLOCK: RecoveryWatchdogClock = {
  now: Date.now,
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (timer) =>
    clearInterval(timer as ReturnType<typeof setInterval>),
};

export type SessionRecoveryWatchdogOptions<
  TClient extends RecoveryClientState,
> = {
  clock?: RecoveryWatchdogClock;
  clients: () => Iterable<TClient>;
  requestReset: (reason: string, nowMs: number) => boolean;
  startedMs?: number;
  intervalMs?: number;
  sessionResetCooldownMs?: number;
  firstFrameResetMs?: number;
  sourceStallResetMs?: number;
  awaitingKeyFrameResetMs?: number;
};

export type SessionRecoverySnapshot = {
  sourceFps: number;
  lastFrameMs: number | null;
  sourceFrameAgeMs: number;
  awaitingClients: number;
  oldestAwaitingAgeMs: number | null;
  lastResetAttemptMs: number | null;
};

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_SESSION_RESET_COOLDOWN_MS = 500;
const DEFAULT_FIRST_FRAME_RESET_MS = 5_000;
const DEFAULT_SOURCE_STALL_RESET_MS = 2_500;
const DEFAULT_AWAITING_KEYFRAME_RESET_MS = 2_500;

/**
 * Owns the timer and recovery timing for exactly one scrcpy session.
 *
 * The reset callback is synchronous on purpose: `true` means the reset was
 * admitted to the active session's writer. Every attempt consumes the
 * session-level cooldown so a throwing writer cannot create a hot loop, while
 * only admitted requests update clients' last-request timestamps.
 */
export class SessionRecoveryWatchdog<TClient extends RecoveryClientState> {
  readonly startedMs: number;

  #clock: RecoveryWatchdogClock;
  #clients: () => Iterable<TClient>;
  #requestReset: (reason: string, nowMs: number) => boolean;
  #intervalMs: number;
  #sessionResetCooldownMs: number;
  #firstFrameResetMs: number;
  #sourceStallResetMs: number;
  #awaitingKeyFrameResetMs: number;
  #timer: unknown | null = null;
  #runEpoch = 0;
  #frameCount = 0;
  #lastFrameMs: number | null = null;
  #sourceFps = 0;
  #lastFpsFrameCount = 0;
  #lastFpsSampleMs: number;
  #lastSessionResetAttemptMs: number | null = null;

  constructor(options: SessionRecoveryWatchdogOptions<TClient>) {
    this.#clock = options.clock ?? SYSTEM_RECOVERY_WATCHDOG_CLOCK;
    this.#clients = options.clients;
    this.#requestReset = options.requestReset;
    this.startedMs = options.startedMs ?? this.#clock.now();
    this.#lastFpsSampleMs = this.startedMs;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#sessionResetCooldownMs =
      options.sessionResetCooldownMs ?? DEFAULT_SESSION_RESET_COOLDOWN_MS;
    this.#firstFrameResetMs =
      options.firstFrameResetMs ?? DEFAULT_FIRST_FRAME_RESET_MS;
    this.#sourceStallResetMs =
      options.sourceStallResetMs ?? DEFAULT_SOURCE_STALL_RESET_MS;
    this.#awaitingKeyFrameResetMs =
      options.awaitingKeyFrameResetMs ??
      DEFAULT_AWAITING_KEYFRAME_RESET_MS;
  }

  get running(): boolean {
    return this.#timer !== null;
  }

  start(): void {
    if (this.#timer !== null) return;
    const epoch = ++this.#runEpoch;
    this.#timer = this.#clock.setInterval(() => {
      if (this.#timer === null || epoch !== this.#runEpoch) return;
      this.tick();
    }, this.#intervalMs);
  }

  stop(): void {
    if (this.#timer === null) return;
    this.#runEpoch++;
    this.#clock.clearInterval(this.#timer);
    this.#timer = null;
  }

  recordFrame(): void {
    this.#frameCount++;
    this.#lastFrameMs = this.#clock.now();
  }

  markAwaiting(client: TClient): void {
    if (!client.awaitingKeyFrame) {
      client.awaitingKeyFrame = true;
      client.lastKeyFrameRequestMs = null;
    }
    if (client.awaitingKeyFrameSinceMs === null) {
      client.awaitingKeyFrameSinceMs = this.#clock.now();
    }
  }

  keyFrameAccepted(client: TClient): void {
    if (!client.awaitingKeyFrame) return;
    client.awaitingKeyFrame = false;
    client.awaitingKeyFrameSinceMs = null;
    client.lastKeyFrameRequestMs = null;
  }

  requestVideoReset(reason: string): boolean {
    const now = this.#clock.now();
    if (
      this.#lastSessionResetAttemptMs !== null &&
      now - this.#lastSessionResetAttemptMs < this.#sessionResetCooldownMs
    ) {
      return false;
    }

    this.#lastSessionResetAttemptMs = now;
    let admitted = false;
    try {
      admitted = this.#requestReset(reason, now);
    } catch {
      return false;
    }
    if (!admitted) return false;

    for (const client of this.#clients()) {
      if (client.awaitingKeyFrame) client.lastKeyFrameRequestMs = now;
    }
    return true;
  }

  tick(): void {
    const now = this.#clock.now();
    const elapsedMs = now - this.#lastFpsSampleMs;
    if (elapsedMs > 0) {
      const elapsedFrames = this.#frameCount - this.#lastFpsFrameCount;
      this.#sourceFps = (elapsedFrames * 1_000) / elapsedMs;
      this.#lastFpsFrameCount = this.#frameCount;
      this.#lastFpsSampleMs = now;
    }

    const clients = Array.from(this.#clients());
    if (clients.length === 0) return;

    if (
      this.#frameCount === 0 &&
      now - this.startedMs >= this.#firstFrameResetMs
    ) {
      this.requestVideoReset("first video frame not received");
    } else if (
      this.#lastFrameMs !== null &&
      now - this.#lastFrameMs >= this.#sourceStallResetMs
    ) {
      this.requestVideoReset("video source stalled");
    }

    const awaitingRetry = clients.some((client) => {
      if (
        !client.awaitingKeyFrame ||
        client.awaitingKeyFrameSinceMs === null
      ) {
        return false;
      }
      const retryFrom =
        client.lastKeyFrameRequestMs ?? client.awaitingKeyFrameSinceMs;
      return now - retryFrom >= this.#awaitingKeyFrameResetMs;
    });
    if (awaitingRetry) {
      this.requestVideoReset("client awaiting keyframe");
    }
  }

  snapshot(nowMs = this.#clock.now()): SessionRecoverySnapshot {
    let awaitingClients = 0;
    let oldestAwaitingAgeMs: number | null = null;
    for (const client of this.#clients()) {
      if (
        !client.awaitingKeyFrame ||
        client.awaitingKeyFrameSinceMs === null
      ) {
        continue;
      }
      awaitingClients++;
      const ageMs = Math.max(0, nowMs - client.awaitingKeyFrameSinceMs);
      oldestAwaitingAgeMs = Math.max(oldestAwaitingAgeMs ?? 0, ageMs);
    }

    return {
      sourceFps: this.#sourceFps,
      lastFrameMs: this.#lastFrameMs,
      sourceFrameAgeMs: Math.max(
        0,
        nowMs - (this.#lastFrameMs ?? this.startedMs),
      ),
      awaitingClients,
      oldestAwaitingAgeMs,
      lastResetAttemptMs: this.#lastSessionResetAttemptMs,
    };
  }
}
