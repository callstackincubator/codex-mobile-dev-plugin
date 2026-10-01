import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const execute = promisify(execFile);
const number = z.number();
const integer = number.int();
const positive = integer.positive();
const bounded = positive.max(2147483647);
const pid = bounded.nullable();
const response = z.object({ pid });
const schema = response.strict();

export async function foregroundPhysicalPid(deviceId: string, signal?: AbortSignal,
  helper = new URL("./ios-fps/mobile-dev-ios-fps", import.meta.url)): Promise<number | null> {
  const path = fileURLToPath(helper);
  const result = await execute(path, ["foreground", deviceId], { encoding: "utf8", timeout: 20000, maxBuffer: 4096, signal });
  const decoded: unknown = JSON.parse(result.stdout);
  const foreground = schema.parse(decoded);
  return foreground.pid;
}
