export const DEFAULT_STREAM_WAITING_MS = 5_000;
export const DEFAULT_STREAM_STALL_MS = 5_000;
export const DEFAULT_PACKET_FRESH_MS = 2_000;

export type StreamPhase =
  | "connecting"
  | "awaiting-keyframe"
  | "decoding"
  | "rendered"
  | "recovering"
  | "disconnected"
  | "stopped";

export type StreamGenerationReason =
  | "initial"
  | "connect"
  | "reconnect"
  | "video-session"
  | "decoder-recovery"
  | "disconnect"
  | "stop";

export type StreamLifecycleState = {
  generation: number;
  phase: StreamPhase;
  reason: StreamGenerationReason;
  generationStartedAt: number;
  socketOpenedAt: number | null;
  lastPacketAt: number | null;
  lastRenderedAt: number | null;
  rendered: boolean;
  codec: string | null;
};

export type StreamLifecycleTransition =
  | { type: "socket-open"; generation: number; at: number }
  | { type: "packet-received"; generation: number; at: number }
  | { type: "decoder-configured"; generation: number; at: number; codec: string }
  | { type: "keyframe-submitted"; generation: number; at: number }
  | { type: "frame-rendered"; generation: number; at: number };

export type StreamStatusThresholds = {
  waitingMs?: number;
  stallMs?: number;
  packetFreshMs?: number;
};

export type StreamDisplayStatus =
  | "connecting"
  | "awaiting video"
  | "decoding video"
  | "streaming"
  | "waiting for video"
  | "stream stalled"
  | "recovering video"
  | "disconnected"
  | "stopped";

export type StreamFatalStatus =
  | "WebCodecs unsupported"
  | "canvas unavailable";

export type StreamEventGenerationDisposition =
  | "invalid"
  | "stale"
  | "current"
  | "new-generation"
  | "awaiting-boundary";

export type StreamEventGenerationGate = {
  currentGeneration: number;
  awaitingConnectBoundary: boolean;
};

type StreamGenerationStart = {
  phase: StreamPhase;
  reason: StreamGenerationReason;
  at: number;
};

function finiteTimestamp(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function transitionTimestamp(state: StreamLifecycleState, at: number): number {
  return Math.max(state.generationStartedAt, finiteTimestamp(at, "transition timestamp"));
}

function maxTimestamp(current: number | null, next: number): number {
  return current === null ? next : Math.max(current, next);
}

function freshState(
  generation: number,
  phase: StreamPhase,
  reason: StreamGenerationReason,
  at: number,
): StreamLifecycleState {
  return {
    generation,
    phase,
    reason,
    generationStartedAt: finiteTimestamp(at, "generation timestamp"),
    socketOpenedAt: null,
    lastPacketAt: null,
    lastRenderedAt: null,
    rendered: false,
    codec: null,
  };
}

export function createStreamLifecycle(
  at = 0,
  phase: StreamPhase = "connecting",
): StreamLifecycleState {
  return freshState(1, phase, "initial", at);
}

/**
 * Starts a new observable video generation and atomically drops all state that
 * could otherwise describe the previous decoder or WebSocket session.
 */
export function beginStreamGeneration(
  previous: StreamLifecycleState,
  start: StreamGenerationStart,
): StreamLifecycleState {
  if (!Number.isSafeInteger(previous.generation) || previous.generation < 1) {
    throw new Error("stream generation must be a positive safe integer");
  }
  if (previous.generation === Number.MAX_SAFE_INTEGER) {
    throw new Error("stream generation overflow");
  }
  return freshState(previous.generation + 1, start.phase, start.reason, start.at);
}

export function isCurrentStreamGeneration(
  state: StreamLifecycleState,
  generation: number,
): boolean {
  return generation === state.generation;
}

/** A per-effect command nonce prevents queued events from a reused worker. */
export function isCurrentStreamClientEpoch(
  currentClientEpoch: number,
  incomingClientEpoch: number,
): boolean {
  return (
    Number.isSafeInteger(currentClientEpoch) &&
    currentClientEpoch > 0 &&
    incomingClientEpoch === currentClientEpoch
  );
}

export function isStreamFatalStatus(status: string): status is StreamFatalStatus {
  return status === "WebCodecs unsupported" || status === "canvas unavailable";
}

/**
 * Classifies worker events for the main-thread hook. Only an atomic lifecycle
 * snapshot may advance the client generation; other newer events wait for that
 * boundary, and delayed older events are discarded.
 */
export function classifyStreamEventGeneration(
  currentGeneration: number,
  incomingGeneration: number,
  isLifecycleBoundary: boolean,
): StreamEventGenerationDisposition {
  if (
    !Number.isSafeInteger(currentGeneration) ||
    currentGeneration < 0 ||
    !Number.isSafeInteger(incomingGeneration) ||
    incomingGeneration < 1
  ) {
    return "invalid";
  }
  if (incomingGeneration < currentGeneration) return "stale";
  if (incomingGeneration === currentGeneration) return "current";
  return isLifecycleBoundary ? "new-generation" : "awaiting-boundary";
}

/**
 * Stateful wrapper used when a transferred canvas reuses its worker. Effect
 * cleanup posts `stop`, so a new listener may briefly see queued events from
 * that stopped generation. Reuse therefore stays closed until the worker
 * publishes a strictly newer lifecycle created by the new `connect` command.
 */
export function gateStreamEventGeneration(
  gate: StreamEventGenerationGate,
  incomingGeneration: number,
  boundaryReason: StreamGenerationReason | null,
): {
  gate: StreamEventGenerationGate;
  disposition: StreamEventGenerationDisposition;
} {
  const isLifecycleBoundary = boundaryReason !== null;
  const disposition = classifyStreamEventGeneration(
    gate.currentGeneration,
    incomingGeneration,
    isLifecycleBoundary,
  );

  if (disposition === "invalid" || disposition === "stale") {
    return { gate, disposition };
  }

  if (gate.awaitingConnectBoundary) {
    if (
      disposition !== "new-generation" ||
      boundaryReason !== "connect"
    ) {
      return { gate, disposition: "awaiting-boundary" };
    }
    return {
      gate: {
        currentGeneration: incomingGeneration,
        awaitingConnectBoundary: false,
      },
      disposition,
    };
  }

  if (disposition === "new-generation") {
    return {
      gate: { ...gate, currentGeneration: incomingGeneration },
      disposition,
    };
  }
  return { gate, disposition };
}

/**
 * Applies a current-generation worker transition. Delayed callbacks from an
 * older decoder/socket return the original object so callers can cheaply
 * detect and ignore them.
 */
export function reduceStreamLifecycle(
  state: StreamLifecycleState,
  transition: StreamLifecycleTransition,
): StreamLifecycleState {
  if (!isCurrentStreamGeneration(state, transition.generation)) return state;
  const at = transitionTimestamp(state, transition.at);

  switch (transition.type) {
    case "socket-open":
      return {
        ...state,
        phase: state.rendered ? state.phase : "awaiting-keyframe",
        socketOpenedAt: state.socketOpenedAt ?? at,
      };
    case "packet-received":
      return {
        ...state,
        lastPacketAt: maxTimestamp(state.lastPacketAt, at),
      };
    case "decoder-configured":
      return {
        ...state,
        codec: transition.codec,
      };
    case "keyframe-submitted":
      return {
        ...state,
        phase: state.rendered ? "rendered" : "decoding",
        lastPacketAt: maxTimestamp(state.lastPacketAt, at),
      };
    case "frame-rendered":
      return {
        ...state,
        phase: "rendered",
        rendered: true,
        lastRenderedAt: maxTimestamp(state.lastRenderedAt, at),
      };
  }
}

function nonNegativeThreshold(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return resolved;
}

function elapsed(now: number, since: number): number {
  return Math.max(0, now - since);
}

/**
 * Converts lifecycle evidence into the user-facing status. A static stream is
 * deliberately not considered stalled: stall requires packets newer than the
 * last presented frame and a recently active packet source.
 */
export function deriveStreamDisplayStatus(
  state: StreamLifecycleState,
  now: number,
  thresholds: StreamStatusThresholds = {},
): StreamDisplayStatus {
  const currentTime = finiteTimestamp(now, "status timestamp");
  const waitingMs = nonNegativeThreshold(
    thresholds.waitingMs,
    DEFAULT_STREAM_WAITING_MS,
    "waitingMs",
  );
  const stallMs = nonNegativeThreshold(
    thresholds.stallMs,
    DEFAULT_STREAM_STALL_MS,
    "stallMs",
  );
  const packetFreshMs = nonNegativeThreshold(
    thresholds.packetFreshMs,
    DEFAULT_PACKET_FRESH_MS,
    "packetFreshMs",
  );

  const packetIsFresh =
    state.lastPacketAt !== null && elapsed(currentTime, state.lastPacketAt) <= packetFreshMs;

  if (state.phase === "stopped") return "stopped";
  if (state.phase === "disconnected") return "disconnected";
  if (state.phase === "recovering") {
    if (elapsed(currentTime, state.generationStartedAt) < waitingMs) {
      return "recovering video";
    }
    return packetIsFresh ? "stream stalled" : "waiting for video";
  }
  if (state.phase === "connecting") return "connecting";

  if (!state.rendered || state.lastRenderedAt === null) {
    const waitingSince = state.socketOpenedAt ?? state.generationStartedAt;
    if (elapsed(currentTime, waitingSince) >= waitingMs) {
      return packetIsFresh ? "stream stalled" : "waiting for video";
    }
    return state.phase === "decoding" ? "decoding video" : "awaiting video";
  }

  if (
    state.lastPacketAt !== null &&
    state.lastPacketAt > state.lastRenderedAt &&
    elapsed(currentTime, state.lastRenderedAt) >= stallMs &&
    packetIsFresh
  ) {
    return "stream stalled";
  }
  return "streaming";
}

export type ClosableStreamFrame = {
  readonly timestamp: number;
  close(): void;
};

export type StreamResourceReset = {
  closedFrames: number;
  clearedTimings: number;
};

export type StreamSessionResourceOptions = {
  frameCapacity?: number;
  timingCapacity?: number;
};

function positiveCapacity(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return resolved;
}

/**
 * Generation-scoped decoded-frame queue and timestamp metadata. It is generic
 * so cleanup behavior can be tested without constructing browser VideoFrames.
 */
export class StreamSessionResources<
  Frame extends ClosableStreamFrame,
  Timing,
> {
  readonly #frameCapacity: number;
  readonly #timingCapacity: number;
  readonly #frames: (Frame | null)[];
  readonly #timings = new Map<number, Timing>();
  #frameHead = 0;
  #frameCount = 0;

  constructor(options: StreamSessionResourceOptions = {}) {
    this.#frameCapacity = positiveCapacity(options.frameCapacity, 3, "frameCapacity");
    this.#timingCapacity = positiveCapacity(options.timingCapacity, 256, "timingCapacity");
    this.#frames = new Array<Frame | null>(this.#frameCapacity).fill(null);
  }

  get queuedFrameCount(): number {
    return this.#frameCount;
  }

  get timingCount(): number {
    return this.#timings.size;
  }

  rememberTiming(timestamp: number, timing: Timing): void {
    finiteTimestamp(timestamp, "frame timestamp");
    if (this.#timings.has(timestamp)) this.#timings.delete(timestamp);
    while (this.#timings.size >= this.#timingCapacity) {
      const oldest = this.#timings.keys().next();
      if (oldest.done) break;
      this.#timings.delete(oldest.value);
    }
    this.#timings.set(timestamp, timing);
  }

  peekTiming(timestamp: number): Timing | undefined {
    return this.#timings.get(timestamp);
  }

  takeTiming(timestamp: number): Timing | undefined {
    const timing = this.#timings.get(timestamp);
    this.#timings.delete(timestamp);
    return timing;
  }

  /** Returns 1 when an overflow frame was closed, otherwise 0. */
  pushFrame(frame: Frame): number {
    finiteTimestamp(frame.timestamp, "frame timestamp");
    let closedFrames = 0;
    if (this.#frameCount >= this.#frameCapacity) {
      const oldest =
        (this.#frameHead - this.#frameCount + this.#frameCapacity) % this.#frameCapacity;
      const stale = this.#frames[oldest];
      if (stale) {
        this.#timings.delete(stale.timestamp);
        this.#safeClose(stale);
        closedFrames = 1;
      }
      this.#frames[oldest] = null;
      this.#frameCount -= 1;
    }
    this.#frames[this.#frameHead] = frame;
    this.#frameHead = (this.#frameHead + 1) % this.#frameCapacity;
    this.#frameCount += 1;
    return closedFrames;
  }

  /** Closes all superseded frames and transfers ownership of the newest one. */
  takeLatestFrame(): Frame | null {
    if (this.#frameCount === 0) return null;
    const newest = (this.#frameHead - 1 + this.#frameCapacity) % this.#frameCapacity;
    const latest = this.#frames[newest];
    for (let index = 0; index < this.#frames.length; index += 1) {
      const frame = this.#frames[index];
      if (frame && index !== newest) {
        this.#timings.delete(frame.timestamp);
        this.#safeClose(frame);
      }
      this.#frames[index] = null;
    }
    this.#frameHead = 0;
    this.#frameCount = 0;
    return latest;
  }

  reset(): StreamResourceReset {
    let closedFrames = 0;
    for (let index = 0; index < this.#frames.length; index += 1) {
      const frame = this.#frames[index];
      if (frame) {
        this.#safeClose(frame);
        closedFrames += 1;
      }
      this.#frames[index] = null;
    }
    const clearedTimings = this.#timings.size;
    this.#timings.clear();
    this.#frameHead = 0;
    this.#frameCount = 0;
    return { closedFrames, clearedTimings };
  }

  #safeClose(frame: Frame): void {
    try {
      frame.close();
    } catch {
      // One broken frame must never prevent the rest of a generation cleanup.
    }
  }
}
