import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LogRecord, LogSourceStatus, NativeLogTarget } from "../shared/logs.ts";
import { errorMessage } from "../shared/protocol.ts";
import { parseIOSLog, parseLogcat } from "./log-parsers.ts";

const execute = promisify(execFile);
export type LogSink = { log: (log: LogRecord) => void; status: (status: LogSourceStatus) => void };
export type StopLogSource = () => Promise<void>;

export async function adbPath(): Promise<string> {
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk")]) {
    if (!root) continue;
    const path = join(root, "platform-tools/adb");
    try { await access(path); return path; } catch { /* Try the next SDK, then PATH. */ }
  }
  return "adb";
}

export async function listAndroidLogDevices(): Promise<{ id: string; name: string }[]> {
  const { stdout } = await execute(await adbPath(), ["devices", "-l"], { timeout: 5000, maxBuffer: 1024 * 1024 });
  return stdout.split("\n").flatMap(line => {
    const match = line.match(/^(\S+)\s+device(?:\s|$)(.*)/);
    return match ? [{ id: match[1], name: match[2].match(/model:(\S+)/)?.[1].replace(/_/g, " ") ?? match[1] }] : [];
  });
}

export function runLogProcess(command: string, args: string[], parse: (line: string) => LogRecord | undefined, sink: LogSink, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let discarding = false;
    let diagnostics = "";
    let stopping = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => { if (stopping) return; stopping = true; child.kill("SIGTERM"); killTimer = setTimeout(() => child.kill("SIGKILL"), 1000); killTimer.unref(); };
    signal.addEventListener("abort", stop, { once: true });
    child.once("spawn", () => { sink.status({ source: "native", state: "live" }); if (signal.aborted) stop(); });
    child.stdout.on("data", (chunk: Buffer) => {
      const text = decoder.write(chunk);
      for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
        const complete = part.endsWith("\n");
        if (!discarding) pending += part;
        if (pending.length > 65536) { pending = ""; discarding = true; }
        if (complete) {
          if (!discarding && !signal.aborted) { const record = parse(pending.trimEnd()); if (record) sink.log(record); }
          pending = ""; discarding = false;
        }
      }
    });
    child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-2048); });
    const cleanup = () => { signal.removeEventListener("abort", stop); clearTimeout(killTimer); };
    child.once("error", error => { cleanup(); signal.aborted ? resolve() : reject(error); });
    child.once("close", (code, exitSignal) => {
      cleanup();
      if (signal.aborted) resolve();
      else reject(new Error(diagnostics.trim() || `Log reader exited: ${code ?? exitSignal}.`));
    });
  });
}

export function startNativeLogs(target: NativeLogTarget, sink: LogSink): StopLogSource {
  const controller = new AbortController();
  const signal = controller.signal;
  const scopedSink: LogSink = { status: sink.status, log: log => sink.log({ ...log, deviceId: target.deviceId,
    process: log.process ?? (target.platform === "android" ? target.packageName : target.process) }) };
  const running = (async () => {
    const adb = target.platform === "android" ? await adbPath() : "";
    let failures = 0;
    while (!signal.aborted) {
      sink.status({ source: "native", state: failures ? "reconnecting" : "connecting" });
      try {
        if (target.platform === "ios") {
          if (process.platform !== "darwin") throw new Error("iOS logs require macOS and Xcode.");
          await runLogProcess("xcrun", ["simctl", "spawn", target.deviceId, "log", "stream", "--style", "ndjson", "--level", "debug",
            ...(target.process ? ["--process", target.process] : [])], parseIOSLog, scopedSink, signal);
        } else if (!target.packageName) {
          await runLogProcess(adb, ["-s", target.deviceId, "logcat", "-v", "threadtime", "-T", "1", "*:V"], parseLogcat, scopedSink, signal);
        } else {
          await streamAndroidPackage(adb, target, scopedSink, signal);
        }
      } catch (error) {
        if (signal.aborted) break;
        sink.status({ source: "native", state: "reconnecting", message: errorMessage(error) });
        failures++;
      }
      await delay(Math.min(500 * 2 ** Math.min(failures, 4), 10000), undefined, { signal }).catch(() => {});
    }
  })().catch(error => { if (!signal.aborted) sink.status({ source: "native", state: "error", message: errorMessage(error) }); });
  return async () => { controller.abort(); await running; };
}

async function streamAndroidPackage(adb: string, target: Extract<NativeLogTarget, { platform: "android" }>, sink: LogSink, signal: AbortSignal) {
  let currentPid = "";
  let reader: AbortController | undefined;
  let reading: Promise<void> | undefined;
  let failure: unknown;
  try {
    while (!signal.aborted) {
      if (failure) throw failure;
      const { stdout } = await execute(adb, ["-s", target.deviceId, "shell", "pidof", target.packageName!], { timeout: 4000, signal })
        .catch(error => { if ((error as { code?: string | number }).code === 1) return { stdout: "" }; throw error; });
      const pid = stdout.trim().split(/\s+/).find(value => /^\d+$/.test(value)) ?? "";
      if (pid !== currentPid || (pid && !reader)) {
        reader?.abort(); await reading;
        currentPid = pid; reader = undefined;
        if (pid) {
          reader = new AbortController();
          reading = runLogProcess(adb, ["-s", target.deviceId, "logcat", "-v", "threadtime", "-T", "1", `--pid=${pid}`, "*:V"], parseLogcat, sink, AbortSignal.any([signal, reader.signal]))
            .catch(error => { failure = error; });
        }
      }
      if (!pid) sink.status({ source: "native", state: "connecting", message: `Waiting for ${target.packageName} to run.` });
      await delay(1000, undefined, { signal });
    }
  } finally { reader?.abort(); await reading; }
}
