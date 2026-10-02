// Canonical control-message layout and upgrade checklist: ../docs/protocol.md
// ControlMessage type codes validated against the pinned scrcpy server.
const TYPE_INJECT_KEYCODE = 0;
const TYPE_INJECT_TEXT = 1;
const TYPE_INJECT_TOUCH = 2;
const TYPE_BACK_OR_SCREEN_ON = 4;
const TYPE_RESET_VIDEO = 17;

export function resetVideoPacket(): Buffer {
  return RESET_VIDEO_PACKET;
}

// Android KeyEvent action
const ACTION_DOWN = 0;
const ACTION_UP = 1;
const ACTION_MOVE = 2;

// Common Android keycodes
const KEY = {
  home: 3,
  recents: 187,
  power: 26,
} as const;

const PRIMARY_POINTER_ID = 0n;
const PRESSURE_FULL = 0xffff;
const BUTTON_PRIMARY = 1;
const RESET_VIDEO_PACKET = Buffer.from([TYPE_RESET_VIDEO]);

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

export const MAX_TEXT_BYTES = 300;

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

// Android KeyEvent meta state bitmask (AMETA_*), e.g. shift/ctrl/alt combos.
function optionalMetaState(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = finiteNumber(value, "metaState");
  if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) {
    throw new Error("metaState must be a non-negative 32-bit integer");
  }
  return n;
}

function textBytes(text: string): Buffer {
  const out: string[] = [];
  let total = 0;
  for (const char of text) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (total + bytes > MAX_TEXT_BYTES) break;
    out.push(char);
    total += bytes;
  }
  return Buffer.from(out.join(""), "utf8");
}

export function normalizeTextForControl(text: string): string {
  return textBytes(text).toString("utf8");
}

export function normalizeGesture(gesture: Gesture): Gesture {
  return parseGesture(gesture);
}

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
      return { type: "text", text: textBytes(value.text).toString("utf8") };
    case "back":
    case "home":
    case "recents":
    case "power":
      return { type: value.type };
    default:
      throw new Error(`unsupported gesture type: ${value.type}`);
  }
}

function touchPacket(
  action: number,
  x: number,
  y: number,
  screen: Screen,
  pointerId = PRIMARY_POINTER_ID,
): Buffer {
  const buf = Buffer.allocUnsafe(32);
  let o = 0;
  buf.writeUInt8(TYPE_INJECT_TOUCH, o); o += 1;
  buf.writeUInt8(action, o); o += 1;
  buf.writeBigUInt64BE(pointerId, o); o += 8;
  buf.writeInt32BE(Math.round(x), o); o += 4;
  buf.writeInt32BE(Math.round(y), o); o += 4;
  buf.writeUInt16BE(screen.width, o); o += 2;
  buf.writeUInt16BE(screen.height, o); o += 2;
  buf.writeUInt16BE(action === ACTION_UP ? 0 : PRESSURE_FULL, o); o += 2;
  buf.writeUInt32BE(BUTTON_PRIMARY, o); o += 4;
  buf.writeUInt32BE(action === ACTION_UP ? 0 : BUTTON_PRIMARY, o); o += 4;
  return buf;
}

function keyPacket(action: number, keycode: number, metaState = 0): Buffer {
  const buf = Buffer.allocUnsafe(14);
  let o = 0;
  buf.writeUInt8(TYPE_INJECT_KEYCODE, o); o += 1;
  buf.writeUInt8(action, o); o += 1;
  buf.writeInt32BE(keycode, o); o += 4;
  buf.writeInt32BE(0, o); o += 4; // repeat
  buf.writeInt32BE(metaState, o); o += 4;
  return buf;
}

function textPacket(text: string): Buffer {
  const bytes = textBytes(text);
  const len = bytes.length;
  const buf = Buffer.allocUnsafe(5 + len);
  buf.writeUInt8(TYPE_INJECT_TEXT, 0);
  buf.writeUInt32BE(len, 1);
  bytes.copy(buf, 5);
  return buf;
}

function backOrScreenOnPacket(action: number): Buffer {
  const buf = Buffer.allocUnsafe(2);
  buf.writeUInt8(TYPE_BACK_OR_SCREEN_ON, 0);
  buf.writeUInt8(action, 1);
  return buf;
}

function actionCode(a: "down" | "move" | "up"): number {
  return a === "down" ? ACTION_DOWN : a === "up" ? ACTION_UP : ACTION_MOVE;
}

export type ControlStep = {
  delayMs: number;
  packet: Buffer;
};

export type CompiledGesture = {
  gesture: Gesture;
  steps: ControlStep[];
  bytes: number;
};

function validateScreen(screen: Screen): Screen {
  if (
    !Number.isInteger(screen.width) ||
    !Number.isInteger(screen.height) ||
    screen.width <= 0 ||
    screen.height <= 0 ||
    screen.width > 0xffff ||
    screen.height > 0xffff
  ) {
    throw new Error("screen width and height must be integers between 1 and 65535");
  }
  return { width: screen.width, height: screen.height };
}

export function compileGesture(
  gesture: Gesture,
  screenValue: Screen,
): CompiledGesture {
  const normalized = normalizeGesture(gesture);
  const screen = validateScreen(screenValue);
  const px = (n: number) => n * screen.width;
  const py = (n: number) => n * screen.height;
  const steps: ControlStep[] = [];
  const append = (packet: Buffer, delayMs = 0) => {
    steps.push({ delayMs, packet });
  };

  switch (normalized.type) {
    case "tap": {
      append(
        touchPacket(
          ACTION_DOWN,
          px(normalized.x),
          py(normalized.y),
          screen,
        ),
      );
      append(
        touchPacket(
          ACTION_UP,
          px(normalized.x),
          py(normalized.y),
          screen,
        ),
        20,
      );
      break;
    }
    case "swipe": {
      const dur = Math.max(80, normalized.durationMs ?? 250);
      const stepCount = Math.max(8, Math.round(dur / 16));
      const stepDelayMs = dur / stepCount;
      append(
        touchPacket(
          ACTION_DOWN,
          px(normalized.x1),
          py(normalized.y1),
          screen,
        ),
      );
      for (let i = 1; i < stepCount; i++) {
        const t = i / stepCount;
        const x = px(normalized.x1 + (normalized.x2 - normalized.x1) * t);
        const y = py(normalized.y1 + (normalized.y2 - normalized.y1) * t);
        append(touchPacket(ACTION_MOVE, x, y, screen), stepDelayMs);
      }
      append(
        touchPacket(
          ACTION_UP,
          px(normalized.x2),
          py(normalized.y2),
          screen,
        ),
        stepDelayMs,
      );
      break;
    }
    case "touch": {
      append(
        touchPacket(
          actionCode(normalized.action),
          px(normalized.x),
          py(normalized.y),
          screen,
          BigInt(normalized.pointerId ?? 0),
        ),
      );
      break;
    }
    case "key": {
      const metaState = normalized.metaState ?? 0;
      if (normalized.action === "down") {
        append(keyPacket(ACTION_DOWN, normalized.keycode, metaState));
      } else if (normalized.action === "up") {
        append(keyPacket(ACTION_UP, normalized.keycode, metaState));
      } else {
        append(keyPacket(ACTION_DOWN, normalized.keycode, metaState));
        append(keyPacket(ACTION_UP, normalized.keycode, metaState));
      }
      break;
    }
    case "text":
      append(textPacket(normalized.text));
      break;
    case "back":
      append(backOrScreenOnPacket(ACTION_DOWN));
      append(backOrScreenOnPacket(ACTION_UP));
      break;
    case "home":
      append(keyPacket(ACTION_DOWN, KEY.home));
      append(keyPacket(ACTION_UP, KEY.home));
      break;
    case "recents":
      append(keyPacket(ACTION_DOWN, KEY.recents));
      append(keyPacket(ACTION_UP, KEY.recents));
      break;
    case "power":
      append(keyPacket(ACTION_DOWN, KEY.power));
      append(keyPacket(ACTION_UP, KEY.power));
      break;
  }

  return {
    gesture: normalized,
    steps,
    bytes: steps.reduce((total, step) => total + step.packet.length, 0),
  };
}

export async function dispatch(
  control: { write(packet: Buffer): unknown },
  gesture: Gesture,
  screen: Screen,
): Promise<void> {
  for (const step of compileGesture(gesture, screen).steps) {
    if (step.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }
    control.write(step.packet);
  }
}
