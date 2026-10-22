import { execFile } from "node:child_process";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CrashWatchTarget, LogRecord, NativeLogTarget } from "../shared/logs.ts";
import { parseLogcat } from "./log-parsers.ts";
import { adbPath, keepReading, runLogProcess } from "./native-logs.ts";
import type { StopLogSource } from "./native-logs.ts";
import { recordCrash } from "./telemetry.ts";

const execute = promisify(execFile);
export const iosCrashReportDirectory = join(homedir(), "Library/Logs/DiagnosticReports");
const frameLimit = 60;
type Emit = (crash: LogRecord) => void;

/** Watch one device for app crashes. Records carry kind "crash", a short reason and, when known, a stack. */
export function startCrashWatch(target: CrashWatchTarget, emit: Emit): StopLogSource {
  const controller = new AbortController();
  const signal = controller.signal;
  const scoped: Emit = crash => emit({ ...crash, deviceId: target.deviceId });
  let running: Promise<void> | undefined;
  if (target.platform === "android") running = watchAndroidCrashes(target.deviceId, scoped, signal);
  else if (process.platform === "darwin") running = watchIosSimulatorCrashes(target.deviceId, scoped, signal);
  return async () => { controller.abort(); await running; };
}

/** Crash watching for a native log session, limited to the app or process that session follows. */
export function crashWatchFor(native: NativeLogTarget): { target: CrashWatchTarget; includes: (crash: LogRecord) => boolean } | undefined {
  if (native.platform === "android") {
    return { target: { platform: "android", deviceId: native.deviceId }, includes: crash => native.packageName === undefined || crash.appId === native.packageName };
  }
  // Physical iPhones keep their crash reports until the device syncs.
  if (native.kind === "physical") return;
  return { target: { platform: "ios", deviceId: native.deviceId }, includes: crash => (native.pid === undefined || crash.pid === native.pid)
    && (native.process === undefined || crash.process === native.process) };
}

// ---- iOS simulator ----------------------------------------------------------------------------
// A crash surfaces three times: SpringBoard logs the exit at once, the app's own last log lines are
// readable about a second later, and ReportCrash writes the full .ips report 30-45 seconds after that.

function watchIosSimulatorCrashes(deviceId: string, emit: Emit, signal: AbortSignal): Promise<void> {
  watchIosCrashReports(deviceId, emit, signal);
  const executables = new Map<string, Promise<string | undefined>>();
  const executable = (bundleId: string) => {
    let name = executables.get(bundleId);
    if (!name) {
      name = execute("xcrun", ["simctl", "appinfo", deviceId, bundleId], { timeout: 1500, maxBuffer: 1024 * 1024 })
        .then(({ stdout }) => /^\s*CFBundleExecutable = "?([^";\n]+)"?;/m.exec(stdout)?.[1], () => undefined);
      executables.set(bundleId, name);
    }
    return name;
  };
  const exited = async (exit: IosAppExit) => {
    const process = await executable(exit.appId);
    if (signal.aborted) return;
    const crash: LogRecord = { timestamp: exit.timestamp, level: "error", source: "native", origin: "ios", kind: "crash", appId: exit.appId, pid: exit.pid,
      process, reason: exit.signal, message: `${process ?? exit.appId} crashed: ${exit.signal}` };
    recordCrash("ios_exit");
    emit(crash);
    const { stdout } = await execute("xcrun", ["simctl", "spawn", deviceId, "log", "show", "--style", "ndjson", "--last", "20s", "--predicate", iosCrashLogPredicate(exit.pid)],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal });
    const lastWords = parseIosCrashLog(stdout);
    if (!lastWords || signal.aborted) return;
    recordCrash("ios_log");
    emit({ ...crash, reason: lastWords.reason, message: `${crash.message} · ${lastWords.reason}`, stack: lastWords.stack });
  };
  const exits = { status() {}, log: (exit: IosAppExit) => void exited(exit).catch(() => {}) };
  return keepReading(() => runLogProcess("xcrun", ["simctl", "spawn", deviceId, "log", "stream", "--style", "ndjson", "--predicate", iosAppExitPredicate],
    parseIosAppExit, exits, signal), signal);
}

export const iosAppExitPredicate = 'process == "SpringBoard" AND category == "Workspace" AND eventMessage BEGINSWITH "Process exited"';
const crashSignals = new Set(["SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGTRAP", "SIGFPE", "SIGSYS", "SIGQUIT"]);
export type IosAppExit = { appId: string; pid: number; signal: string; timestamp: string };

/** Parse a SpringBoard app exit from `log stream --style ndjson`, keeping only crash signals. */
export function parseIosAppExit(line: string): IosAppExit | undefined {
  let data: { eventMessage?: unknown; timestamp?: unknown };
  try { data = JSON.parse(line); } catch { return; }
  if (typeof data.eventMessage !== "string") return;
  const match = /^Process exited: <FBApplicationProcess: [^;]*; app<([^>]+)>:(\d+)[^>]*> -> <RBSProcessExitContext\|[^<]*status:<RBSProcessExitStatus\| domain:signal\(\d+\) code:(\w+)\(\d+\)>/.exec(data.eventMessage);
  if (!match || !crashSignals.has(match[3])) return;
  return { appId: match[1], pid: Number(match[2]), signal: match[3], timestamp: reportTimestamp(data.timestamp) };
}

const crashLogPhrases = ["Terminating app due to uncaught exception", "Unhandled JS Exception", "RCTFatal", "Fatal error", "Precondition failed",
  "Assertion failed", "Unexpectedly found nil", "libc++abi: terminating", "abort() called"];
const mentionsCrash = (text: string) => crashLogPhrases.some(phrase => text.toLowerCase().includes(phrase.toLowerCase()));

/** Predicate for the crashed process's own last words in the unified log. */
export function iosCrashLogPredicate(pid: number) {
  return `processID == ${pid} AND (${crashLogPhrases.map(phrase => `eventMessage CONTAINS[c] ${JSON.stringify(phrase)}`).join(" OR ")})`;
}

/** Turn `log show --style ndjson` output into a crash reason and the app's logged stack. */
export function parseIosCrashLog(output: string): { reason: string; stack: string } | undefined {
  const messages = new Set<string>();
  for (const line of output.split("\n")) {
    let data: { eventMessage?: unknown };
    try { data = JSON.parse(line); } catch { continue; }
    if (typeof data.eventMessage === "string" && mentionsCrash(data.eventMessage)) messages.add(data.eventMessage.trim());
  }
  const [first] = messages;
  if (first === undefined) return;
  const reason = (first.split("\n").find(mentionsCrash) ?? first).replace(/^\*+\s*/, "").replace(/\s+/g, " ").trim().slice(0, 300);
  return { reason, stack: ["App log before exit:", ...[...messages].slice(-8)].join("\n\n").slice(0, 16000) };
}

type Frame = { imageIndex?: number; imageOffset?: number; symbol?: string; symbolLocation?: number; sourceFile?: string; sourceLine?: number };
type Thread = { triggered?: boolean; name?: string; queue?: string; frames?: Frame[] };
type Image = { name?: string; base?: number };
type IpsHeader = { bundleID?: unknown; timestamp?: unknown };
type IpsReport = {
  procPath?: unknown; procName?: unknown; pid?: unknown; captureTime?: unknown; bundleInfo?: { CFBundleIdentifier?: unknown };
  exception?: { type?: string; signal?: string; subtype?: string }; termination?: { indicator?: string }; asi?: unknown;
  faultingThread?: unknown; threads?: unknown; usedImages?: unknown; lastExceptionBacktrace?: unknown;
};

function splitReport(text: string): { header: IpsHeader; report: IpsReport } | undefined {
  const newline = text.indexOf("\n");
  if (newline < 0) return;
  try { return { header: JSON.parse(text.slice(0, newline)), report: JSON.parse(text.slice(newline + 1)) }; }
  catch { return; }
}

function formatFrames(frames: Frame[] | undefined, images: Image[]): string[] {
  return (frames ?? []).slice(0, frameLimit).map((frame, index) => {
    const image = images[frame.imageIndex ?? -1];
    const address = image?.base !== undefined && frame.imageOffset !== undefined ? `0x${(image.base + frame.imageOffset).toString(16)}` : "???";
    const symbol = frame.symbol ? `${frame.symbol} + ${frame.symbolLocation ?? 0}` : address;
    const source = frame.sourceFile ? ` (${frame.sourceFile}${frame.sourceLine ? `:${frame.sourceLine}` : ""})` : "";
    return `${String(index).padEnd(3)} ${(image?.name ?? "???").padEnd(30)} ${symbol}${source}`;
  });
}

// Application-specific info holds abort messages and uncaught exception reasons.
function applicationReason(asi: unknown): string | undefined {
  if (!asi || typeof asi !== "object") return;
  for (const value of Object.values(asi)) {
    const lines = Array.isArray(value) ? value.filter(line => typeof line === "string") : [];
    const reason = lines.find(line => /reason:|exception|fatal|error/i.test(line)) ?? lines[0];
    if (reason) return reason.replace(/\s+/g, " ").trim().slice(0, 500);
  }
}

/** Parse an .ips crash report, keeping only crashes from the given simulator. */
export function parseIosCrashReport(text: string, deviceId: string): LogRecord | undefined {
  const parts = splitReport(text);
  if (!parts) return;
  const { header, report } = parts;
  if (typeof report.procPath !== "string" || !report.procPath.includes(`/CoreSimulator/Devices/${deviceId}/`)) return;
  const process = typeof report.procName === "string" ? report.procName : report.procPath.split("/").at(-1);
  const bundleId = report.bundleInfo?.CFBundleIdentifier ?? header.bundleID;
  const exception = report.exception ?? {};
  const kind = [exception.type, exception.signal && `(${exception.signal})`].filter(Boolean).join(" ") || report.termination?.indicator || "Unknown exception";
  const detail = applicationReason(report.asi);
  const images: Image[] = Array.isArray(report.usedImages) ? report.usedImages : [];
  const threads: Thread[] = Array.isArray(report.threads) ? report.threads : [];
  const faulting = typeof report.faultingThread === "number" ? report.faultingThread : threads.findIndex(thread => thread.triggered);
  const thread = threads[faulting];
  const sections: string[] = [];
  if (Array.isArray(report.lastExceptionBacktrace) && report.lastExceptionBacktrace.length) {
    sections.push(["Last exception backtrace:", ...formatFrames(report.lastExceptionBacktrace, images)].join("\n"));
  }
  if (thread) {
    const label = [thread.name, thread.queue && `queue ${thread.queue}`].filter(Boolean).join(", ");
    sections.push([`Thread ${faulting} crashed${label ? ` (${label})` : ""}:`, ...formatFrames(thread.frames, images)].join("\n"));
  }
  return {
    timestamp: reportTimestamp(report.captureTime ?? header.timestamp), level: "error", source: "native", origin: "ios", kind: "crash",
    reason: detail ?? kind, message: [`${process} crashed: ${kind}`, exception.subtype, detail].filter(Boolean).join(" · "),
    process, pid: typeof report.pid === "number" && Number.isSafeInteger(report.pid) ? report.pid : undefined,
    appId: typeof bundleId === "string" ? bundleId : undefined, stack: sections.join("\n\n") || undefined,
  };
}

/** Watch the host's diagnostic reports for crashes of apps on one iOS simulator. */
export function watchIosCrashReports(deviceId: string, emit: Emit, signal: AbortSignal, directory = iosCrashReportDirectory) {
  const startedAt = Date.now();
  const seen = new Set<string>();
  const pending = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher | undefined;
  let retry: NodeJS.Timeout | undefined;
  // ReportCrash may still be writing when the first event arrives; retry until the JSON is complete.
  const read = async (name: string, attempt: number) => {
    pending.delete(name);
    if (signal.aborted || seen.has(name)) return;
    const path = join(directory, name);
    try {
      if ((await stat(path)).mtimeMs < startedAt - 1000) { seen.add(name); return; }
      const text = await readFile(path, "utf8");
      if (!splitReport(text) && attempt < 5) { schedule(name, attempt + 1); return; }
      const started = performance.now();
      const crash = parseIosCrashReport(text, deviceId);
      seen.add(name);
      if (!crash || signal.aborted) return;
      recordCrash("ios_report", performance.now() - started);
      emit(crash);
    } catch { if (attempt < 5) schedule(name, attempt + 1); }
  };
  const schedule = (name: string, attempt = 0) => {
    if (signal.aborted || pending.has(name)) return;
    const timer = setTimeout(() => void read(name, attempt), attempt ? 300 : 150);
    timer.unref();
    pending.set(name, timer);
  };
  const start = () => {
    retry = undefined;
    if (signal.aborted) return;
    try {
      watcher = watch(directory, { persistent: false }, (_event, name) => { if (name?.endsWith(".ips")) schedule(name); });
      watcher.on("error", () => { watcher?.close(); watcher = undefined; restart(); });
    } catch { restart(); }
  };
  const restart = () => { if (!signal.aborted && !retry) { retry = setTimeout(start, 10000); retry.unref(); } };
  signal.addEventListener("abort", () => {
    watcher?.close(); clearTimeout(retry);
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  }, { once: true });
  start();
}

// Crash reports and unified logs write timestamps like "2026-10-13 16:27:23.00 +0200".
function reportTimestamp(value: unknown): string {
  const match = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)? ?([+-]\d{2}):?(\d{2})$/.exec(value) : null;
  const date = match ? new Date(`${match[1]}T${match[2]}${(match[3] ?? "").slice(0, 4)}${match[4]}:${match[5]}`) : new Date(NaN);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// ---- Android ----------------------------------------------------------------------------------

async function watchAndroidCrashes(deviceId: string, emit: Emit, signal: AbortSignal) {
  const crashes = new AndroidCrashCollector(crash => { recordCrash("android_logcat"); emit(crash); });
  const sink = { status() {}, log: (log: LogRecord) => crashes.push(log) };
  const adb = await adbPath();
  try {
    await keepReading(() => runLogProcess(adb, ["-s", deviceId, "logcat", "-v", "threadtime", "-T", "1", "AndroidRuntime:E", "libc:F", "*:S"], parseLogcat, sink, signal), signal);
  } finally { crashes.flush(); }
}

// "java.lang.IllegalStateException: boom" reads as "IllegalStateException: boom".
const exceptionName = (line: string) => line.trim().replace(/^(?:[a-z_]\w*\.)+(?:\w+\$)?(?=\w+(?:Exception|Error)\b)/, "");

/**
 * Collect Android "FATAL EXCEPTION" logcat blocks and libc fatal signals into
 * one crash record each.
 */
export class AndroidCrashCollector {
  private current?: { first: LogRecord; thread: string; appId?: string; lines: string[] };
  private timer?: NodeJS.Timeout;
  private readonly emit: Emit;
  private readonly idleMs: number;

  constructor(emit: Emit, idleMs = 250) { this.emit = emit; this.idleMs = idleMs; }

  push(record: LogRecord) {
    const fatal = record.tag === "AndroidRuntime" ? /^FATAL EXCEPTION:\s*(.*)$/.exec(record.message) : null;
    if (this.current && (fatal || record.pid !== this.current.first.pid || record.tag !== "AndroidRuntime")) this.flush();
    if (fatal) {
      this.current = { first: record, thread: fatal[1].trim(), lines: [] };
      this.arm();
    } else if (this.current) {
      const processLine = /^Process:\s*([^,\s]+)(?:,\s*PID:\s*\d+)?\s*$/.exec(record.message);
      if (processLine && !this.current.appId && !this.current.lines.length) this.current.appId = processLine[1];
      else this.current.lines.push(record.message);
      this.arm();
    } else {
      const signal = record.tag === "libc" ? /^Fatal signal \d+ \((\w+)\).*?pid \d+ \(([^)]+)\)/.exec(record.message) : null;
      if (signal) this.emit({ ...record, level: "error", kind: "crash", process: signal[2], appId: signal[2], reason: signal[1], message: `${signal[2]} crashed: ${signal[1]} · ${record.message}` });
    }
  }

  flush() {
    clearTimeout(this.timer);
    const current = this.current;
    this.current = undefined;
    if (!current) return;
    const summary = current.lines.find(line => line.trim())?.trim() ?? "Unknown exception";
    const process = current.appId ?? current.first.process;
    this.emit({
      ...current.first, level: "error", kind: "crash", process, appId: current.appId, reason: exceptionName(summary),
      message: `${process ?? "App"} crashed${current.thread ? ` on thread ${current.thread}` : ""}: ${summary}`,
      stack: current.lines.join("\n") || undefined,
    });
  }

  private arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.idleMs);
    this.timer.unref();
  }
}
