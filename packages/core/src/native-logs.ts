import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { LogRecord, LogSourceStatus, NativeLogTarget } from "@mobile-dev/shared/logs.ts";
import { androidSdkRoots } from "./android-sdk.ts";
import { parseIOSLog, parseLogcat } from "./log-parsers.ts";
import { physicalIosLogCommand } from "./physical-ios-logs.ts";
import { IOSLogProcessingTelemetry } from "./telemetry.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { startCollector } from "./collectors/process.ts";
import type { CollectorProcess } from "./collectors/process.ts";

const execute = promisify(execFile);
export type LogSink = { log: (log: LogRecord) => void; status: (status: LogSourceStatus) => void };
export type StopLogSource = () => Promise<void>;

export async function adbPath(): Promise<string> {
  for (const root of androidSdkRoots()) {
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

/**
 * Streams a log reader until it exits; resolves only when `signal` stopped it. `helper`
 * readers speak the native helper protocol and are live once they report ready.
 */
export async function runLogProcess(command: string, args: string[], parse: (line: string) => LogRecord | undefined, sink: LogSink, signal: AbortSignal, helper = false): Promise<void> {
  if (signal.aborted) return;
  let reader: CollectorProcess;
  try {
    reader = await startCollector({
      command, args, signal, protocol: helper, readyTimeoutMs: helper ? 15000 : undefined, killMs: 1000,
      labels: {
        exited: status => `Log reader exited: ${status}.`,
        timeout: "The iPhone did not accept log streaming within 15 seconds. Unlock it and check the connection.",
      },
      output: { kind: "lines", maxLineLength: 256 * 1024, line(text) {
        if (signal.aborted) return;
        const record = parse(text.trimEnd());
        if (record) sink.log(record);
      } },
    });
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
  sink.status({ source: "native", state: "live" });
  const error = await reader.closed;
  await reader.stop();
  if (signal.aborted) return;
  throw error;
}

export function startNativeLogs(target: NativeLogTarget, sink: LogSink, physicalCommand = physicalIosLogCommand): StopLogSource {
  const controller = new AbortController();
  const signal = controller.signal;
  const hideSystemLogs = target.platform === "ios" && target.hideSystemLogs !== false;
  const telemetry = target.platform === "ios" ? new IOSLogProcessingTelemetry(target.kind ?? "simulator") : undefined;
  const parseIOS = (line: string) => {
    const started = performance.now();
    const record = parseIOSLog(line, hideSystemLogs);
    const duration = performance.now() - started;
    telemetry?.record(duration);
    return record;
  };
  const scopedSink: LogSink = { status: sink.status, log: log => {
    if (target.platform === "ios" && target.pid !== undefined && log.pid !== target.pid) return;
    const process = log.process ?? (target.platform === "android" ? target.packageName : target.process);
    const record = { ...log, deviceId: target.deviceId, process };
    sink.log(record);
  } };
  const running = (async () => {
    const adb = target.platform === "android" ? await adbPath() : "";
    let failures = 0;
    while (!signal.aborted) {
      sink.status({ source: "native", state: failures ? "reconnecting" : "connecting" });
      try {
        if (target.platform === "ios") {
          if (process.platform !== "darwin") throw new Error("iOS logs require macOS and Xcode.");
          if (target.kind === "physical") {
            const reader = await physicalCommand(target, signal);
            await runLogProcess(reader.command, reader.args, parseIOS, scopedSink, signal, true);
          } else {
            const processFilter = target.pid === undefined ? target.process : String(target.pid);
            await runLogProcess("xcrun", ["simctl", "spawn", target.deviceId, "log", "stream", "--style", "ndjson", "--level", "debug",
              ...(processFilter ? ["--process", processFilter] : [])], parseIOS, scopedSink, signal);
          }
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
  })().catch(error => { if (!signal.aborted) sink.status({ source: "native", state: "error", message: errorMessage(error) }); })
    .finally(() => telemetry?.close());
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
