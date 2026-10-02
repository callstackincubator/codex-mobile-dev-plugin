export type DeviceSize = { width: number; height: number };

export type StreamStats = {
  fps: number;
  decodeQueue: number;
  transitMs: number | null;
  e2eMs: number | null;
  codec: string | null;
  rendered: boolean;
};

export type StreamState = {
  status: string;
  fps: number;
  deviceSize: DeviceSize | null;
  stats: StreamStats | null;
};

export type StreamWorkerEvent =
  | { type: "status"; status: string }
  | { type: "session"; size: DeviceSize }
  | { type: "rendered" }
  | { type: "stats"; stats: StreamStats };

export type StreamHealth = {
  serial?: string;
  generation?: number;
  size: DeviceSize;
  status?: "streaming" | "stopped" | "error";
  lastFrameAt?: string | null;
  lastError?: string | null;
};

export const INITIAL_STREAM_STATE: StreamState = {
  status: "connecting…",
  fps: 0,
  deviceSize: null,
  stats: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSize(value: unknown): DeviceSize {
  if (!isRecord(value)) throw new Error("health size must be an object");
  if (
    typeof value.width !== "number" ||
    !Number.isFinite(value.width) ||
    typeof value.height !== "number" ||
    !Number.isFinite(value.height)
  ) {
    throw new Error("health size must contain finite dimensions");
  }
  return { width: value.width, height: value.height };
}

export function parseStreamHealth(value: unknown): StreamHealth {
  if (!isRecord(value)) throw new Error("health response must be an object");
  if (value.serial !== undefined && (typeof value.serial !== "string" || !value.serial)) {
    throw new Error("health serial is invalid");
  }
  if (value.generation !== undefined && (typeof value.generation !== "number" || !Number.isSafeInteger(value.generation) || value.generation < 0)) {
    throw new Error("health generation is invalid");
  }
  const status = value.status;
  if (
    status !== undefined &&
    status !== "streaming" &&
    status !== "stopped" &&
    status !== "error"
  ) {
    throw new Error("health status is invalid");
  }
  const lastFrameAt = value.lastFrameAt;
  if (
    lastFrameAt !== undefined &&
    lastFrameAt !== null &&
    typeof lastFrameAt !== "string"
  ) {
    throw new Error("health lastFrameAt is invalid");
  }
  const lastError = value.lastError;
  if (
    lastError !== undefined &&
    lastError !== null &&
    typeof lastError !== "string"
  ) {
    throw new Error("health lastError is invalid");
  }
  return {
    size: parseSize(value.size),
    ...(value.serial === undefined ? {} : { serial: value.serial as string }),
    ...(value.generation === undefined ? {} : { generation: value.generation as number }),
    ...(status === undefined ? {} : { status }),
    ...(lastFrameAt === undefined ? {} : { lastFrameAt }),
    ...(lastError === undefined ? {} : { lastError }),
  };
}

export function parseStreamWorkerEvent(
  value: unknown,
): StreamWorkerEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "rendered") return { type: "rendered" };
  if (value.type === "status") {
    return typeof value.status === "string"
      ? { type: "status", status: value.status }
      : null;
  }
  if (value.type === "session") {
    try {
      return { type: "session", size: parseSize(value.size) };
    } catch {
      return null;
    }
  }
  if (value.type !== "stats" || !isRecord(value.stats)) return null;
  const stats = value.stats;
  if (
    typeof stats.fps !== "number" ||
    !Number.isFinite(stats.fps) ||
    typeof stats.decodeQueue !== "number" ||
    !Number.isFinite(stats.decodeQueue) ||
    (stats.transitMs !== null && typeof stats.transitMs !== "number") ||
    (stats.e2eMs !== null && typeof stats.e2eMs !== "number") ||
    (stats.codec !== null && typeof stats.codec !== "string") ||
    typeof stats.rendered !== "boolean"
  ) {
    return null;
  }
  return {
    type: "stats",
    stats: {
      fps: stats.fps,
      decodeQueue: stats.decodeQueue,
      transitMs: stats.transitMs,
      e2eMs: stats.e2eMs,
      codec: stats.codec,
      rendered: stats.rendered,
    },
  };
}

export function applyWorkerEvent(
  state: StreamState,
  event: StreamWorkerEvent,
): StreamState {
  switch (event.type) {
    case "status":
      return state.status === event.status
        ? state
        : { ...state, status: event.status };
    case "session":
      return { ...state, deviceSize: event.size };
    case "stats":
      return {
        ...state,
        fps: event.stats.fps,
        stats: event.stats,
      };
    case "rendered":
      return state;
    default:
      return state;
  }
}

const RECOVERABLE_HEALTH_STATUSES = new Set([
  "metadata unavailable",
  "waiting for video",
]);

export function applyStreamHealth(
  state: StreamState,
  health: StreamHealth,
  options: { nowMs: number; hasRenderedFrame: boolean },
): StreamState {
  const lastFrameMs = health.lastFrameAt
    ? Date.parse(health.lastFrameAt)
    : Number.NaN;
  const lastFrameAgeMs = Number.isFinite(lastFrameMs)
    ? options.nowMs - lastFrameMs
    : Infinity;
  let status = state.status;
  if (health.status && health.status !== "streaming") {
    status = health.lastError || health.status;
  } else if (!options.hasRenderedFrame && lastFrameAgeMs > 5_000) {
    status = "waiting for video";
  } else if (RECOVERABLE_HEALTH_STATUSES.has(status)) {
    status = "streaming";
  }
  return { ...state, deviceSize: health.size, status };
}
