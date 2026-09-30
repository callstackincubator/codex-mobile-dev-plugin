import { z } from "zod";

export const udidSchema = z.uuid();
const point = z.number().finite().min(0).max(10000);
const size = z.number().finite().positive().max(10000);
const duration = z.number().finite().min(0).max(5);
const dimensions = { width: size, height: size };
const edge = z.enum(["left", "top", "right", "bottom"]).optional();

export const inputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tap"), x: point, y: point, ...dimensions, duration: duration.optional() }).strict(),
  z.object({ type: z.literal("swipe"), startX: point, startY: point, endX: point, endY: point, ...dimensions, duration: duration.optional() }).strict(),
  ...(["touch1-down", "touch1-move", "touch1-up"] as const).map(type =>
    z.object({ type: z.literal(type), x: point, y: point, ...dimensions, edge }).strict()),
  z.object({
    type: z.literal("button"),
    button: z.enum(["home", "back", "power", "lock", "volume-up", "volume-down", "action", "app-switcher"]),
    duration: duration.optional(),
  }).strict(),
  z.object({ type: z.literal("type"), text: z.string().max(4096).regex(/^[\x20-\x7e]*$/, "Use printable US-ASCII text.") }).strict(),
  z.object({
    type: z.literal("key"), code: z.string().regex(/^(Key[A-Z]|Digit[0-9]|Enter|Escape|Backspace|Tab|Space|Arrow(Up|Down|Left|Right))$/),
    modifiers: z.array(z.enum(["shift", "control", "option", "command"])).max(4).optional(),
  }).strict(),
]);

export const streamMessageSchema = z.union([
  inputSchema,
  z.object({ type: z.literal("set_fps"), fps: z.number().int().min(1).max(60) }).strict(),
  z.object({ type: z.literal("set_scale"), scale: z.number().int().min(1).max(4) }).strict(),
]);

export type SimulatorDevice = { udid: string; name: string; state: string; runtime: string; platform?: "ios" | "android" };
export type DeviceList = { running: unknown[]; available: unknown[] };
export type Status = {
  connected: boolean;
  managed: boolean;
  baseUrl: string;
  devices: SimulatorDevice[];
  error?: string;
};

export function normalizeDevices(payload: unknown): SimulatorDevice[] {
  const parsed = z.object({ running: z.array(z.unknown()), available: z.array(z.unknown()) }).parse(payload);
  const devices = new Map<string, SimulatorDevice>();
  for (const [list, fallback] of [[parsed.available, "Shutdown"], [parsed.running, "Booted"]] as const) {
    for (const item of list) {
      const device = z.object({ udid: udidSchema, name: z.string(), state: z.string().optional(), runtime: z.string().optional() }).parse(item);
      devices.set(device.udid, { ...device, state: device.state ?? fallback, runtime: device.runtime ?? "" });
    }
  }
  return [...devices.values()].sort((a, b) => Number(b.state === "Booted") - Number(a.state === "Booted") || a.name.localeCompare(b.name));
}

export function parseBaseUrl(value: string, label = "BAGUETTE_URL"): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be a loopback HTTP origin, such as http://127.0.0.1:8421.`);
  }
  return url;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
