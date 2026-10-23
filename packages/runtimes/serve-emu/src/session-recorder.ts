import { normalizeTextForControl, type Gesture } from "./input.ts";
import type { GeoFix } from "./location.ts";

export type RecordedEvent =
  | {
      id: number;
      at: string;
      delayMs: number;
      source: string;
      kind: "gesture";
      gesture: Gesture;
    }
  | {
      id: number;
      at: string;
      delayMs: number;
      source: string;
      kind: "location";
      location: GeoFix;
    };

export type SessionSnapshot = {
  events: RecordedEvent[];
  recording: boolean;
  replaying: boolean;
  replayStatus: "idle" | "running" | "completed" | "cancelled" | "error";
  replayStartedAt: string | null;
  replayCompletedAt: string | null;
  replayCancelledAt: string | null;
  lastError: string | null;
};

export type SessionSummary = {
  eventCount: number;
  retainedBytes: number;
  limits: { maxEvents: number; maxBytes: number };
  droppedEvents: number;
  oldestEventId: number | null;
  newestEventId: number | null;
  oldestEventAt: string | null;
  newestEventAt: string | null;
  recording: boolean;
  replaying: boolean;
  replayStartedAt: string | null;
  replayCompletedAt: string | null;
  lastError: string | null;
};

export type SessionPage = {
  session: SessionSummary;
  events: RecordedEvent[];
  nextBefore: number | null;
  hasMore: boolean;
};

export type SessionRecorderOptions = {
  maxEvents?: number;
  maxBytes?: number;
  clock?: SessionReplayClock;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export const DEFAULT_MAX_SESSION_EVENTS = 2_000;
export const DEFAULT_MAX_SESSION_BYTES = 1024 * 1024;

export type ReplayHandlers = {
  dispatchGesture: (
    gesture: Gesture,
    signal: AbortSignal,
  ) => Promise<void> | void;
  setLocation: (fix: GeoFix, signal: AbortSignal) => Promise<void> | void;
};

export type SessionReplayClock = {
  now: () => number;
  delay: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type SessionReplayRun = {
  snapshot: SessionSnapshot;
  completion: Promise<SessionSnapshot>;
};

export class SessionReplayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionReplayValidationError";
  }
}

export class SessionReplayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionReplayConflictError";
  }
}

export function sessionReplayErrorStatus(error: unknown): number {
  if (error instanceof SessionReplayValidationError) return 400;
  if (error instanceof SessionReplayConflictError) return 409;
  return 500;
}

export function parseSessionReplayMultiplier(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SessionReplayValidationError(
      "session replay payload must be an object",
    );
  }
  const raw = (value as Record<string, unknown>).multiplier;
  if (raw !== undefined && typeof raw !== "number") {
    throw new SessionReplayValidationError("multiplier must be a number");
  }
  const multiplier = raw ?? 1;
  validateMultiplier(multiplier);
  return multiplier;
}

type ActiveReplay = {
  id: number;
  controller: AbortController;
  completion: Promise<SessionSnapshot>;
};

const EMPTY_ARRAY_BYTES = 2;

function cloneGesture(gesture: Gesture): Gesture {
  return gesture.type === "text"
    ? { type: "text", text: normalizeTextForControl(gesture.text) }
    : { ...gesture };
}

function cloneEvent(event: RecordedEvent): RecordedEvent {
  return event.kind === "gesture"
    ? { ...event, gesture: cloneGesture(event.gesture) }
    : { ...event, location: { ...event.location } };
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("session replay cancelled", "AbortError");
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    const timeout = setTimeout(() => finish(resolve), Math.max(0, ms));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const SYSTEM_REPLAY_CLOCK: SessionReplayClock = {
  now: Date.now,
  delay: abortableDelay,
};

function validateMultiplier(multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
    throw new SessionReplayValidationError(
      "multiplier must be between 0 and 100",
    );
  }
}

export class SessionRecorder {
  #events: RecordedEvent[] = [];
  #retainedBytes = EMPTY_ARRAY_BYTES;
  #droppedEvents = 0;
  #maxEvents: number;
  #maxBytes: number;
  #nextId = 1;
  #lastEventMs: number | null = null;
  #recording = true;
  #replaying = false;
  #replayStatus: SessionSnapshot["replayStatus"] = "idle";
  #replayStartedAt: string | null = null;
  #replayCompletedAt: string | null = null;
  #replayCancelledAt: string | null = null;
  #lastError: string | null = null;
  #nextReplayId = 1;
  #activeReplay: ActiveReplay | null = null;
  #closed = false;
  #admissionEpoch = 0;
  #clock: SessionReplayClock;
  #legacySleep: (ms: number) => Promise<void>;
  #legacyStopReplay = false;

  constructor(
    clockOrOptions: SessionReplayClock | SessionRecorderOptions =
      SYSTEM_REPLAY_CLOCK,
  ) {
    const options =
      "delay" in clockOrOptions
        ? { clock: clockOrOptions }
        : clockOrOptions;
    this.#clock =
      options.clock ??
      (options.now || options.sleep
        ? {
            now: options.now ?? Date.now,
            delay: async (ms, signal) => {
              if (signal.aborted) throw abortReason(signal);
              await (options.sleep ?? ((value) => abortableDelay(value, signal)))(ms);
              if (signal.aborted) throw abortReason(signal);
            },
          }
        : SYSTEM_REPLAY_CLOCK);
    this.#legacySleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#maxEvents = options.maxEvents ?? DEFAULT_MAX_SESSION_EVENTS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_SESSION_BYTES;
    if (!Number.isSafeInteger(this.#maxEvents) || this.#maxEvents <= 0) {
      throw new Error("maxEvents must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 2) {
      throw new Error("maxBytes must be a safe integer of at least 2");
    }
  }

  get isReplaying(): boolean {
    return this.#replaying;
  }

  get replayAdmissionEpoch(): number {
    return this.#admissionEpoch;
  }

  recordGesture(gesture: Gesture, source: string): void {
    this.#record({ kind: "gesture", gesture, source });
  }

  recordLocation(location: GeoFix, source: string): void {
    this.#record({ kind: "location", location, source });
  }

  clear(): SessionSummary {
    if (this.#closed) {
      throw new SessionReplayConflictError("session recorder is closed");
    }
    if (this.#activeReplay) {
      throw new SessionReplayConflictError(
        "cannot clear session while replay is running",
      );
    }
    this.#admissionEpoch++;
    this.#events = [];
    this.#retainedBytes = EMPTY_ARRAY_BYTES;
    this.#droppedEvents = 0;
    this.#lastEventMs = null;
    if (!this.#replaying) {
      this.#replayStatus = "idle";
      this.#replayStartedAt = null;
      this.#replayCompletedAt = null;
      this.#replayCancelledAt = null;
    }
    this.#lastError = null;
    return this.summary();
  }

  async cancelAndWait(): Promise<SessionSnapshot> {
    this.#admissionEpoch++;
    return this.#cancelActiveReplay();
  }

  async dispose(): Promise<SessionSnapshot> {
    this.#admissionEpoch++;
    this.#closed = true;
    this.#recording = false;
    return this.#cancelActiveReplay();
  }

  async #cancelActiveReplay(): Promise<SessionSnapshot> {
    const replay = this.#activeReplay;
    if (!replay) return this.snapshot();
    replay.controller.abort();
    await replay.completion;
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    return {
      events: this.#events.map(cloneEvent),
      recording: this.#recording,
      replaying: this.#replaying,
      replayStatus: this.#replayStatus,
      replayStartedAt: this.#replayStartedAt,
      replayCompletedAt: this.#replayCompletedAt,
      replayCancelledAt: this.#replayCancelledAt,
      lastError: this.#lastError,
    };
  }

  summary(): SessionSummary {
    const events = this.#events;
    const oldest = events[0] ?? null;
    const newest = events.at(-1) ?? null;
    return {
      eventCount: events.length,
      retainedBytes: this.#retainedBytes,
      limits: { maxEvents: this.#maxEvents, maxBytes: this.#maxBytes },
      droppedEvents: this.#droppedEvents,
      oldestEventId: oldest?.id ?? null,
      newestEventId: newest?.id ?? null,
      oldestEventAt: oldest?.at ?? null,
      newestEventAt: newest?.at ?? null,
      recording: this.#recording,
      replaying: this.#replaying,
      replayStartedAt: this.#replayStartedAt,
      replayCompletedAt: this.#replayCompletedAt,
      lastError: this.#lastError,
    };
  }

  page({ limit, before }: { limit: number; before?: number }): SessionPage {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive safe integer");
    }
    if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) {
      throw new Error("before must be a positive safe integer");
    }
    const eligible = before === undefined
      ? this.#events
      : this.#events.filter((event) => event.id < before);
    const events = eligible.slice(-limit).map(cloneEvent);
    const hasMore = eligible.length > events.length;
    return {
      session: this.summary(),
      events,
      nextBefore: hasMore ? events[0]?.id ?? null : null,
      hasMore,
    };
  }

  export(): { session: SessionSummary; events: RecordedEvent[] } {
    return { session: this.summary(), events: this.#events.map(cloneEvent) };
  }

  async replay(
    handlers: {
      dispatchGesture: (gesture: Gesture) => Promise<void> | void;
      setLocation: (fix: GeoFix) => Promise<void> | void;
    },
    multiplier = 1,
  ): Promise<SessionSummary> {
    if (this.#closed) {
      throw new SessionReplayConflictError("session recorder is closed");
    }
    if (this.#replaying) {
      throw new SessionReplayConflictError("session replay is already running");
    }
    if (this.#events.length === 0) {
      throw new SessionReplayValidationError("session has no recorded events");
    }
    validateMultiplier(multiplier);
    const events = this.#events.map(cloneEvent);
    this.#replaying = true;
    this.#legacyStopReplay = false;
    this.#replayStartedAt = new Date(this.#clock.now()).toISOString();
    this.#replayCompletedAt = null;
    this.#lastError = null;
    let targetMs = this.#clock.now();
    try {
      for (const event of events) {
        targetMs += event.delayMs / multiplier;
        await this.#legacySleep(Math.max(0, targetMs - this.#clock.now()));
        if (this.#legacyStopReplay) break;
        if (event.kind === "gesture") {
          await handlers.dispatchGesture(cloneGesture(event.gesture));
        } else {
          await handlers.setLocation({ ...event.location });
        }
      }
      this.#replayCompletedAt = new Date(this.#clock.now()).toISOString();
      this.#replaying = false;
      return this.summary();
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.#replaying = false;
      this.#legacyStopReplay = false;
    }
  }

  stopReplay(): SessionSummary {
    this.#legacyStopReplay = true;
    this.#activeReplay?.controller.abort();
    return this.summary();
  }

  startReplay(handlers: ReplayHandlers, multiplier = 1): SessionReplayRun {
    if (this.#closed) {
      throw new SessionReplayConflictError("session recorder is closed");
    }
    if (this.#activeReplay) {
      throw new SessionReplayConflictError(
        "session replay is already running",
      );
    }
    if (this.#events.length === 0) {
      throw new SessionReplayValidationError(
        "session has no recorded events",
      );
    }
    validateMultiplier(multiplier);

    const events = this.#events.map(cloneEvent);
    const replay: ActiveReplay = {
      id: this.#nextReplayId++,
      controller: new AbortController(),
      completion: Promise.resolve(this.snapshot()),
    };
    this.#activeReplay = replay;
    this.#replaying = true;
    this.#replayStatus = "running";
    this.#replayStartedAt = new Date(this.#clock.now()).toISOString();
    this.#replayCompletedAt = null;
    this.#replayCancelledAt = null;
    this.#lastError = null;
    replay.completion = Promise.resolve().then(() =>
      this.#executeReplay(replay, events, handlers, multiplier),
    );
    return { snapshot: this.snapshot(), completion: replay.completion };
  }

  async #executeReplay(
    replay: ActiveReplay,
    events: RecordedEvent[],
    handlers: ReplayHandlers,
    multiplier: number,
  ): Promise<SessionSnapshot> {
    let outcome: "completed" | "cancelled" | "error" = "completed";
    let targetMs = this.#clock.now();
    try {
      for (const event of events) {
        this.#assertReplayActive(replay);
        targetMs += event.delayMs / multiplier;
        await this.#clock.delay(
          Math.max(0, targetMs - this.#clock.now()),
          replay.controller.signal,
        );
        this.#assertReplayActive(replay);
        if (event.kind === "gesture") {
          await handlers.dispatchGesture(
            event.gesture,
            replay.controller.signal,
          );
        } else {
          await handlers.setLocation(
            event.location,
            replay.controller.signal,
          );
        }
        this.#assertReplayActive(replay);
      }
    } catch (err) {
      if (
        replay.controller.signal.aborted ||
        this.#activeReplay?.id !== replay.id
      ) {
        outcome = "cancelled";
      } else {
        outcome = "error";
        this.#lastError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (this.#activeReplay?.id === replay.id) {
        const finishedAt = new Date(this.#clock.now()).toISOString();
        this.#replaying = false;
        this.#replayStatus = outcome;
        this.#replayCompletedAt =
          outcome === "completed" ? finishedAt : null;
        this.#replayCancelledAt =
          outcome === "cancelled" ? finishedAt : null;
        this.#activeReplay = null;
      }
    }
    return this.snapshot();
  }

  #assertReplayActive(replay: ActiveReplay): void {
    if (
      replay.controller.signal.aborted ||
      this.#activeReplay?.id !== replay.id
    ) {
      throw abortReason(replay.controller.signal);
    }
  }

  #record(
    event:
      | { kind: "gesture"; gesture: Gesture; source: string }
      | { kind: "location"; location: GeoFix; source: string },
  ): void {
    if (this.#closed || !this.#recording || this.#replaying) return;
    const now = this.#clock.now();
    const delayMs =
      this.#lastEventMs !== null
        ? Math.max(0, now - this.#lastEventMs)
        : 0;
    this.#lastEventMs = now;
    const base = {
      id: this.#nextId++,
      at: new Date(now).toISOString(),
      delayMs,
      source: event.source,
    };
    const recorded: RecordedEvent =
      event.kind === "gesture"
        ? { ...base, kind: "gesture", gesture: cloneGesture(event.gesture) }
        : { ...base, kind: "location", location: { ...event.location } };
    const bytes = Buffer.byteLength(JSON.stringify(recorded), "utf8");
    if (EMPTY_ARRAY_BYTES + bytes > this.#maxBytes) {
      this.#droppedEvents++;
      return;
    }
    this.#events.push(recorded);
    this.#retainedBytes += bytes + (this.#events.length > 1 ? 1 : 0);
    while (
      this.#events.length > this.#maxEvents ||
      this.#retainedBytes > this.#maxBytes
    ) {
      const removed = this.#events.shift()!;
      this.#retainedBytes -=
        Buffer.byteLength(JSON.stringify(removed), "utf8") +
        (this.#events.length > 0 ? 1 : 0);
      this.#droppedEvents++;
    }
  }
}
