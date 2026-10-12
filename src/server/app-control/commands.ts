import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ExpectedOperationError, expectedOutcome } from "../../shared/error-reporting.ts";
import { adbPath } from "../native-logs.ts";

export type CommandOptions = { timeout: number; input?: string; maxBuffer?: number };
export type CommandRunner = (file: string, args: string[], options: CommandOptions) => Promise<string>;
export type BinaryRunner = (file: string, args: string[], options: { timeout: number }) => Promise<Buffer>;
export type Commands = { run: CommandRunner; readBinary: BinaryRunner; adb: () => Promise<string>; aapt2: () => Promise<string | null> };

const run: CommandRunner = (file, args, { timeout, input, maxBuffer = 8 * 1024 * 1024 }) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { encoding: "utf8", timeout, maxBuffer }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve(stdout);
  });
  if (input !== undefined) child.stdin?.end(input);
});

const readBinary: BinaryRunner = (file, args, { timeout }) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: "buffer", timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

let aapt2: Promise<string | null> | undefined;
// aapt2 ships with the Android SDK build tools; use the newest installed version.
function findAapt2(): Promise<string | null> {
  return aapt2 ??= (async () => {
    for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk")]) {
      if (!root) continue;
      const versions = await readdir(join(root, "build-tools")).catch(() => []);
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) {
        const path = join(root, "build-tools", version, "aapt2");
        if (await access(path).then(() => true, () => false)) return path;
      }
    }
    return null;
  })();
}

export const systemCommands: Commands = { run, readBinary, adb: adbPath, aapt2: findAapt2 };

export function commandOutput(error: unknown): string {
  if (error === null || typeof error !== "object") return String(error);
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
  return `${stderr}\n${stdout}`.trim();
}

const unavailable = /current state: Shutdown|not booted|Invalid device|device offline|device unauthorized|device '.*' not found|no devices\/emulators found/i;

// Keep only the readable simctl or adb lines; "Command failed: ..." repeats every argument.
export function commandError(error: unknown, action: string): Error {
  if (expectedOutcome(error) !== undefined) return error as Error;
  const output = commandOutput(error);
  const message = output.split("\n").map(line => line.trim()).filter(line => line && !/^Underlying error|^An error was encountered/.test(line)).slice(0, 3).join(" ");
  const text = `${action} failed${message ? `: ${message}` : "."}`;
  if (unavailable.test(output)) return new ExpectedOperationError("device_unavailable", text);
  if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return new ExpectedOperationError("unsupported_platform", `${action} needs ${process.platform === "darwin" ? "Xcode or the Android SDK" : "macOS and Xcode"}.`);
  return new Error(text, { cause: error });
}

export async function withTemporaryDirectory<T>(work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-app-"));
  try { return await work(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
