import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SaxesParser } from "saxes";
import type { IosHitches } from "@mobile-dev/shared/ios-hitches.ts";
import { recordIosHitchOperation } from "../telemetry.ts";
import { readIosHitchEvents } from "./ios-hitch-events.ts";

const execute = promisify(execFile);
const tables = '/trace-toc/run[@number="1"]/data/table';
const query = `${tables}[@schema="time-info"] | ${tables}[@schema="kdebug" and contains(@codes,'"0x31,0xca"')][1]`;

function completed(child: ChildProcess) {
  return new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

function traceClock(xml: string) {
  const parser = new SaxesParser();
  let field = "";
  let text = "";
  let start = NaN;
  let duration = NaN;
  parser.on("opentag", tag => { field = tag.name; text = ""; });
  parser.on("text", value => { text += value; });
  parser.on("closetag", tag => {
    if (tag.name !== field) return;
    if (field === "start-date") start = Date.parse(text);
    if (field === "duration") duration = Number(text);
    field = "";
  });
  parser.write(xml);
  parser.close();
  if (Number.isFinite(start) === false || Number.isFinite(duration) === false || duration <= 0) throw new Error("Missing Instruments recording clock.");
  return { start, duration };
}

export async function exportIosHitches(path: string, pid: number, originMs: number, end: number, signal: AbortSignal): Promise<IosHitches> {
  const timeout = AbortSignal.timeout(180_000);
  const exportSignal = AbortSignal.any([signal, timeout]);
  const args = ["xctrace", "export", "--input", path];
  const toc = await execute("/usr/bin/xcrun", [...args, "--toc"], { signal: exportSignal, maxBuffer: 8 * 1024 * 1024 });
  const clock = traceClock(toc.stdout);
  const offset = (clock.start - originMs) / 1000;
  if (offset > 0.001) throw new Error("Instruments missed the beginning of the recording.");
  const coveredEnd = Math.min(end, offset + clock.duration);
  if (coveredEnd <= 0) throw new Error("Instruments did not cover the recording.");
  const child = spawn("/usr/bin/xcrun", [...args, "--xpath", query], { signal: exportSignal, stdio: ["ignore", "pipe", "ignore"] });
  const exit = completed(child);
  const xml = child.stdout.setEncoding("utf8");
  try {
    const results = await Promise.all([exit, readIosHitchEvents(xml, pid, offset, coveredEnd)]);
    if (results[0] !== 0) throw new Error("Xcode could not export Core Animation frame events.");
    return { status: "finished", end: coveredEnd, events: results[1] };
  } finally {
    child.kill("SIGKILL");
    await exit.catch(() => {});
  }
}

export async function startIosHitchTrace(deviceId: string, duration: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, "mobile-dev-hitches-");
  const directory = await mkdtemp(prefix);
  const trace = join(directory, "frames.trace");
  const id = randomUUID();
  const notification = `dev.mobile.hitches.${id}`;
  const listener = new AbortController();
  const timeout = AbortSignal.timeout(45_000);
  const readySignal = AbortSignal.any([listener.signal, timeout, signal]);
  const ready = execute("/usr/bin/notifyutil", ["-1", notification], { signal: readySignal });
  const child = spawn("/usr/bin/xcrun", ["xctrace", "record", "--instrument", "Frame Lifetimes", "--all-processes",
    "--device", deviceId, "--time-limit", `${duration + 90}s`, "--notify-tracing-started", notification,
    "--no-prompt", "--output", trace], { stdio: "ignore" });
  const exit = completed(child);
  const interrupt = () => { child.kill("SIGINT"); };
  signal.addEventListener("abort", interrupt, { once: true });
  async function close() {
    signal.removeEventListener("abort", interrupt);
    listener.abort();
    interrupt();
    const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try { await exit.catch(() => {}); }
    finally { clearTimeout(kill); }
    await rm(directory, { recursive: true, force: true });
  }
  const started = performance.now();
  try {
    const earlyExit = exit.then(() => { throw new Error("Xcode stopped before frame recording started."); });
    await Promise.race([ready, earlyExit]);
    signal.throwIfAborted();
    recordIosHitchOperation("connect", "success", performance.now() - started);
  } catch (error) {
    await close();
    recordIosHitchOperation("connect", "failed", performance.now() - started);
    throw error;
  }
  async function finish(pid: number, originMs: number, end: number) {
    const started = performance.now();
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 90_000);
    try {
      if (child.kill("SIGINT") === false) throw new Error("Instruments stopped during the recording.");
      const code = await exit;
      if (code !== 0) throw new Error("Instruments could not save the recording.");
      const result = await exportIosHitches(trace, pid, originMs, end, signal);
      recordIosHitchOperation("finish", "success", performance.now() - started);
      return result;
    } catch (error) {
      recordIosHitchOperation("finish", "failed", performance.now() - started);
      throw error;
    } finally { clearTimeout(watchdog); }
  }
  return { finish, close };
}
