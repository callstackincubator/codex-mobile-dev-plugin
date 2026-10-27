/** Runtime-neutral control messages accepted by the REST and WebSocket APIs. */
export type Gesture =
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { type: "touch"; action: "down" | "move" | "up"; x: number; y: number; pointerId?: number }
  | { type: "key"; keycode: number; action?: "down" | "up"; metaState?: number }
  | { type: "text"; text: string }
  | { type: "back" }
  | { type: "home" }
  | { type: "recents" }
  | { type: "power" };

export type Screen = { width: number; height: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function unitNumber(value: unknown, name: string): number {
  const n = finiteNumber(value, name);
  if (n < 0 || n > 1) throw new Error(`${name} must be between 0 and 1`);
  return n;
}

function optionalDurationMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = finiteNumber(value, "durationMs");
  if (n < 0 || n > 10_000) throw new Error("durationMs must be between 0 and 10000");
  return n;
}

function optionalPointerId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = finiteNumber(value, "pointerId");
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new Error("pointerId must be a non-negative safe integer");
  }
  return n;
}

function keycode(value: unknown): number {
  const n = finiteNumber(value, "keycode");
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    throw new Error("keycode must be an integer between 0 and 10000");
  }
  return n;
}

function optionalKeyAction(value: unknown): "down" | "up" | undefined {
  if (value === undefined) return undefined;
  if (value !== "down" && value !== "up") throw new Error("key action must be down or up");
  return value;
}

function optionalMetaState(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = finiteNumber(value, "metaState");
  if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) {
    throw new Error("metaState must be a non-negative 32-bit integer");
  }
  return n;
}

/** Parse and bound every field before a gesture reaches a control socket. */
export function parseGesture(value: unknown): Gesture {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("message must be a gesture object");
  }

  switch (value.type) {
    case "tap":
      return { type: "tap", x: unitNumber(value.x, "x"), y: unitNumber(value.y, "y") };
    case "swipe":
      return {
        type: "swipe",
        x1: unitNumber(value.x1, "x1"),
        y1: unitNumber(value.y1, "y1"),
        x2: unitNumber(value.x2, "x2"),
        y2: unitNumber(value.y2, "y2"),
        durationMs: optionalDurationMs(value.durationMs),
      };
    case "touch": {
      if (value.action !== "down" && value.action !== "move" && value.action !== "up") {
        throw new Error("touch action must be down, move, or up");
      }
      return {
        type: "touch",
        action: value.action,
        x: unitNumber(value.x, "x"),
        y: unitNumber(value.y, "y"),
        pointerId: optionalPointerId(value.pointerId),
      };
    }
    case "key":
      return {
        type: "key",
        keycode: keycode(value.keycode),
        action: optionalKeyAction(value.action),
        metaState: optionalMetaState(value.metaState),
      };
    case "text":
      if (typeof value.text !== "string") throw new Error("text must be a string");
      return { type: "text", text: value.text };
    case "back":
    case "home":
    case "recents":
    case "power":
      return { type: value.type };
    default:
      throw new Error(`unsupported gesture type: ${value.type}`);
  }
}

export function isGesture(value: unknown): value is Gesture {
  try {
    parseGesture(value);
    return true;
  } catch {
    return false;
  }
}
