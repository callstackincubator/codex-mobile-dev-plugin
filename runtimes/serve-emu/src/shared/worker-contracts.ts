import type { DeviceSize } from "./api-contracts";

export type StreamStats = {
  fps: number;
  decodeQueue: number;
  transitMs: number | null;
  e2eMs: number | null;
  codec: string | null;
  rendered: boolean;
};

/** Canvas is generic so this contract does not require DOM or WebWorker types. */
export type WorkerCommand<Canvas = unknown> =
  | { type: "init"; canvas: Canvas; url: string }
  | { type: "connect" }
  | { type: "send"; text: string }
  | { type: "stop" };

export type WorkerEvent =
  | { type: "status"; status: string }
  | { type: "session"; size: DeviceSize }
  | { type: "rendered" }
  | { type: "stats"; stats: StreamStats };

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function nullableFinite(value: unknown, name: string): number | null {
  return value === null ? null : finite(value, name);
}

function size(value: unknown): DeviceSize {
  const item = record(value, "worker session size");
  const width = finite(item.width, "worker session width");
  const height = finite(item.height, "worker session height");
  if (width <= 0 || height <= 0) throw new TypeError("worker session dimensions must be positive");
  return { width, height };
}

function stats(value: unknown): StreamStats {
  const item = record(value, "worker stats");
  const codec = item.codec;
  if (codec !== null && typeof codec !== "string") {
    throw new TypeError("worker stats codec must be a string or null");
  }
  if (typeof item.rendered !== "boolean") {
    throw new TypeError("worker stats rendered must be a boolean");
  }
  return {
    fps: finite(item.fps, "worker stats fps"),
    decodeQueue: finite(item.decodeQueue, "worker stats decodeQueue"),
    transitMs: nullableFinite(item.transitMs, "worker stats transitMs"),
    e2eMs: nullableFinite(item.e2eMs, "worker stats e2eMs"),
    codec,
    rendered: item.rendered,
  };
}

export function parseWorkerCommand<Canvas = unknown>(
  value: unknown,
  isCanvas: (value: unknown) => value is Canvas = ((value): value is Canvas =>
    typeof value === "object" && value !== null),
): WorkerCommand<Canvas> {
  const item = record(value, "worker command");
  switch (item.type) {
    case "init":
      if (!isCanvas(item.canvas)) throw new TypeError("worker init canvas is invalid");
      if (typeof item.url !== "string" || !item.url) {
        throw new TypeError("worker init url must be a non-empty string");
      }
      return { type: "init", canvas: item.canvas, url: item.url };
    case "connect":
      return { type: "connect" };
    case "send":
      if (typeof item.text !== "string") throw new TypeError("worker send text must be a string");
      return { type: "send", text: item.text };
    case "stop":
      return { type: "stop" };
    default:
      throw new TypeError("unsupported worker command");
  }
}

export function isWorkerCommand<Canvas = unknown>(
  value: unknown,
  isCanvas?: (value: unknown) => value is Canvas,
): value is WorkerCommand<Canvas> {
  try {
    parseWorkerCommand(value, isCanvas);
    return true;
  } catch {
    return false;
  }
}

export function parseWorkerEvent(value: unknown): WorkerEvent {
  const item = record(value, "worker event");
  switch (item.type) {
    case "status":
      if (typeof item.status !== "string") throw new TypeError("worker status must be a string");
      return { type: "status", status: item.status };
    case "session":
      return { type: "session", size: size(item.size) };
    case "rendered":
      return { type: "rendered" };
    case "stats":
      return { type: "stats", stats: stats(item.stats) };
    default:
      throw new TypeError("unsupported worker event");
  }
}

export function isWorkerEvent(value: unknown): value is WorkerEvent {
  try {
    parseWorkerEvent(value);
    return true;
  } catch {
    return false;
  }
}
