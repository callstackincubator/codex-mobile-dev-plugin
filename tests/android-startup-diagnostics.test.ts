import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { StartupDiagnostics, adbStartupOutcome } from "../runtimes/serve-emu/src/startup-diagnostics.ts";
import type { StartupMessage } from "../runtimes/serve-emu/src/startup-diagnostics.ts";
import type { ScrcpyDependencies } from "../runtimes/serve-emu/src/scrcpy.ts";
import { androidStartupMessageSchema, androidDeviceState, setAndroidStartupDiagnostic, androidStartupDiagnosticTags } from "../src/shared/android-startup-diagnostics.ts";
import type { AndroidStartupContext } from "../src/shared/android-startup-diagnostics.ts";

let directory: string;
let startScrcpy: typeof import("../runtimes/serve-emu/src/scrcpy.ts").startScrcpy;
let ProcessExecutor: typeof import("../runtimes/serve-emu/src/exec.ts").ProcessExecutor;
before(async () => {
  const prefix = join(tmpdir(), "android-startup-diagnostics-");
  directory = await mkdtemp(prefix);
  const output = join(directory, "runtime.mjs");
  const sourceDirectory = new URL("../runtimes/serve-emu/src", import.meta.url);
  await build({
    stdin: { contents: 'export { startScrcpy } from "./scrcpy.ts"; export { ProcessExecutor } from "./exec.ts";', resolveDir: sourceDirectory.pathname, loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", target: "node22.18",
  });
  const url = pathToFileURL(output);
  const runtime = await import(url.href);
  startScrcpy = runtime.startScrcpy;
  ProcessExecutor = runtime.ProcessExecutor;
});
after(() => rm(directory, { recursive: true, force: true }));

function fixture(overrides: ScrcpyDependencies = {}) {
  const messages: StartupMessage[] = [];
  const commands: string[][] = [];
  const proc = new ChildProcess();
  proc.kill = () => { queueMicrotask(() => proc.emit("exit", 0, "SIGTERM")); return true; };
  const video = new Socket();
  const control = new Socket();
  let connections = 0;
  const dependencies: ScrcpyDependencies = {
    ensureServer: async () => "/private/scrcpy.jar", serverFingerprint: async () => "a".repeat(64),
    randomScid: () => "12345678", spawnAdb: () => proc,
    async runAdb(_serial, args) {
      commands.push(args);
      const stdout = args[0] === "forward" && args[1] === "tcp:0" ? "28000" : args[1] === "cat" ? "@scrcpy_12345678" : "";
      return { status: 0, stdout, stderr: "", timing: { queueMs: 3, executionMs: 7, spawned: true } };
    },
    async connect() {
      connections++;
      if (connections === 1) return video;
      const preamble = Buffer.alloc(81);
      preamble.write("Private device name", 1);
      preamble.writeUInt32BE(0x68323634, 65);
      preamble.writeUInt32BE(0x80000000, 69);
      preamble.writeUInt32BE(1080, 73);
      preamble.writeUInt32BE(1920, 77);
      setTimeout(() => video.emit("data", preamble), 5);
      return control;
    },
    ...overrides,
  };
  return { messages, commands, proc, dependencies, report: (message: StartupMessage) => { messages.push(message); } };
}

function completion(messages: StartupMessage[]) {
  const message = messages.find(value => value.type === "mobile-dev/android-startup-complete");
  assert.ok(message);
  assert.equal(message.type, "mobile-dev/android-startup-complete");
  return message;
}

test("successful startup aggregates stage timings and emits no content or per-poll events", async () => {
  const f = fixture();
  const session = await startScrcpy({ serial: "private-device-id", onStartupDiagnostics: f.report }, f.dependencies);
  const summary = completion(f.messages);
  assert.equal(summary.outcome, "ready");
  const poll = summary.stages.find(value => value.stage === "socket-poll");
  assert.equal(poll?.timedSamples, 1);
  assert.equal(poll?.queueMs, 3);
  assert.equal(poll?.executionMs, 7);
  assert.equal(poll?.spawnedSamples, 1);
  const parsed = androidStartupMessageSchema.safeParse(summary);
  assert.equal(parsed.success, true);
  const serialized = JSON.stringify(f.messages);
  for (const content of ["private-device-id", "/private", "12345678", "Private device name", "@scrcpy", "28000"]) {
    const included = serialized.includes(content);
    assert.equal(included, false);
  }
  const count = f.messages.length;
  await session.close();
  assert.equal(f.messages.length, count, "Later session cleanup is outside startup diagnostics.");
});

test("a delayed poll preserves its failed stage, execution timing, and cleanup outcome", async () => {
  const f = fixture({ timeouts: { socketPollMs: 10 } });
  const run = f.dependencies.runAdb!;
  f.dependencies.runAdb = async (serial, args, options) => {
    if (args[1] !== "cat") return run(serial, args, options);
    await new Promise<void>(resolve => options.signal.addEventListener("abort", () => resolve(), { once: true }));
    return { status: null, stdout: "", stderr: "", error: new Error("aborted"), timing: { queueMs: 0, executionMs: 10, spawned: true } };
  };
  const startup = startScrcpy({ serial: "private-device-id", onStartupDiagnostics: f.report }, f.dependencies);
  await assert.rejects(startup, /cat .* timed out after 10ms/);
  const summary = completion(f.messages);
  assert.equal(summary.failedStage, "socket-poll");
  assert.equal(summary.failure, "timeout");
  const poll = summary.stages.find(value => value.stage === "socket-poll");
  assert.equal(poll?.outcomes.timeout, 1);
  assert.equal(poll?.executionMs, 10);
  const cleanup = summary.stages.find(value => value.stage === "cleanup");
  assert.equal(cleanup?.outcomes.ok, 1);
  const failureIndex = f.messages.findIndex(value => value.type === "mobile-dev/android-startup-failure");
  const cleanupIndex = f.messages.findIndex(value => value.type === "mobile-dev/android-startup" && value.stage === "cleanup");
  assert.ok(failureIndex < cleanupIndex, "The parent learns the cause before cleanup can exceed readiness.");
  const removedForward = f.commands.some(args => args[0] === "forward" && args[1] === "--remove");
  assert.equal(removedForward, true);
});

test("device disappearance during copy is classified without exposing ADB output", async () => {
  const f = fixture();
  const run = f.dependencies.runAdb!;
  f.dependencies.runAdb = async (serial, args, options) => {
    if (args[1] !== "cp") return run(serial, args, options);
    return { status: 1, stdout: "", stderr: "device private-device-id not found" };
  };
  const startup = startScrcpy({ serial: "private-device-id", onStartupDiagnostics: f.report }, f.dependencies);
  await assert.rejects(startup, /not found/);
  const summary = completion(f.messages);
  assert.equal(summary.failedStage, "copy-server");
  assert.equal(summary.failure, "missing");
  const serialized = JSON.stringify(summary);
  const included = serialized.includes("private-device-id");
  assert.equal(included, false);
});

test("startup cancellation records abortion and finishes cleanup once", async () => {
  const controller = new AbortController();
  const f = fixture();
  const run = f.dependencies.runAdb!;
  f.dependencies.runAdb = async (serial, args, options) => {
    if (args[1] !== "cat") return run(serial, args, options);
    controller.abort(new Error("private cancellation details"));
    return { status: null, stdout: "", stderr: "", timing: { queueMs: 0, executionMs: 1, spawned: true } };
  };
  const startup = startScrcpy({ serial: "private-device-id", signal: controller.signal, onStartupDiagnostics: f.report }, f.dependencies);
  await assert.rejects(startup, /private cancellation details/);
  const summary = completion(f.messages);
  assert.equal(summary.failure, "aborted");
  assert.equal(summary.failedStage, "socket-poll");
  const cleanup = summary.stages.find(value => value.stage === "cleanup");
  assert.equal(cleanup?.outcomes.ok, 1);
  const completions = f.messages.filter(value => value.type === "mobile-dev/android-startup-complete");
  assert.equal(completions.length, 1);
});

test("thousands of polls produce one progress event and one bounded summary", async () => {
  const messages: StartupMessage[] = [];
  const diagnostics = new StartupDiagnostics(message => messages.push(message));
  for (let index = 0; index < 1000; index++) await diagnostics.measure("socket-poll", async () => undefined);
  diagnostics.finish("ready");
  diagnostics.finish("ready");
  assert.equal(messages.length, 2);
  const summary = completion(messages);
  assert.equal(summary.stages.length, 1);
  assert.equal(summary.stages[0].samples, 1000);
});

test("IPC validation rejects raw fields, unknown categories and inconsistent aggregates", () => {
  const summary = { type: "mobile-dev/android-startup-complete", outcome: "failed", failedStage: "socket-poll", failure: "timeout", stages: [{ stage: "socket-poll", samples: 1, totalMs: 20, maxMs: 20, timedSamples: 1, spawnedSamples: 1, queueMs: 0, executionMs: 20, outcomes: { timeout: 1 } }] };
  const parsed = androidStartupMessageSchema.safeParse(summary);
  assert.equal(parsed.success, true);
  for (const invalid of [
    { ...summary, rawOutput: "private" }, { ...summary, failure: "private" },
    { ...summary, stages: [{ ...summary.stages[0], rawOutput: "private" }] },
    { ...summary, stages: [{ ...summary.stages[0], timedSamples: 2 }] },
    { ...summary, stages: [{ ...summary.stages[0], queueMs: Infinity }] },
    { ...summary, stages: [summary.stages[0], summary.stages[0]] },
  ]) {
    const parsed = androidStartupMessageSchema.safeParse(invalid);
    assert.equal(parsed.success, false);
  }
});

test("device state parsing and error attribution retain only product categories", () => {
  const successfulSocketList = adbStartupOutcome({ status: 0, stdout: "@private-closed-socket", stderr: "" });
  assert.equal(successfulSocketList, "ok");
  const cases = [["List of devices attached\nprivate-id device product:private\n", "online"], ["private-id offline", "offline"], ["private-id unauthorized", "unauthorized"], ["other-id device", "missing"]];
  for (const [output, expected] of cases) {
    const state = androidDeviceState(output, "private-id");
    assert.equal(state, expected);
  }
  const error = new Error("Original startup message");
  const stack = error.stack;
  const context: AndroidStartupContext = { deviceKind: "physical", transport: "localNetwork", stateBefore: "online", activeBackends: 1, startingBackends: 1, stoppingBackends: 1 };
  setAndroidStartupDiagnostic(error, { stage: "socket-poll", outcome: "timeout" }, context);
  const tags = androidStartupDiagnosticTags(error);
  assert.equal(tags.android_cleanup_overlap, "yes");
  assert.equal(tags.device_platform, "android");
  assert.equal(tags.device_kind, "physical");
  assert.equal(error.stack, stack);
});

test("executor timings distinguish queue delay from process execution and queued cancellation", async () => {
  const executor = new ProcessExecutor({ maxActive: 1 });
  const active = executor.execText(process.execPath, ["-e", "setTimeout(()=>{},100)"], { measureTiming: true });
  const queued = executor.execText(process.execPath, ["-e", ""], { measureTiming: true });
  const controller = new AbortController();
  const cancelled = executor.execText(process.execPath, ["-e", ""], { measureTiming: true, signal: controller.signal });
  controller.abort();
  const cancelledResult = await cancelled;
  assert.equal(cancelledResult.timing?.spawned, false);
  assert.equal(cancelledResult.timing?.executionMs, 0);
  const [activeResult, queuedResult] = await Promise.all([active, queued]);
  assert.equal(activeResult.timing?.spawned, true);
  assert.ok((activeResult.timing?.executionMs ?? 0) >= 100);
  assert.ok((queuedResult.timing?.queueMs ?? 0) >= 100);
  assert.equal(queuedResult.timing?.spawned, true);
});

test("synchronous launch failure and cleanup failure retain the original startup cause", async () => {
  const launchError = new Error("private executable path");
  Object.assign(launchError, { code: "ENOENT" });
  const launch = fixture({ spawnAdb() { throw launchError; } });
  const failedLaunch = startScrcpy({ serial: "private-device-id", onStartupDiagnostics: launch.report }, launch.dependencies);
  await assert.rejects(failedLaunch, launchError);
  const launchSummary = completion(launch.messages);
  assert.equal(launchSummary.failedStage, "launch-server");
  assert.equal(launchSummary.failure, "spawn-error");

  const failedCleanup = fixture({ timeouts: { socketPollMs: 10 } });
  const run = failedCleanup.dependencies.runAdb!;
  failedCleanup.dependencies.runAdb = async (serial, args, options) => {
    if (args[1] === "cat") {
      await new Promise<void>(resolve => options.signal.addEventListener("abort", () => resolve(), { once: true }));
      return { status: null, stdout: "", stderr: "" };
    }
    if (args[1] === "rm") return { status: 1, stdout: "", stderr: "private cleanup failure" };
    return run(serial, args, options);
  };
  const startup = startScrcpy({ serial: "private-device-id", onStartupDiagnostics: failedCleanup.report }, failedCleanup.dependencies);
  await assert.rejects(startup, /cat .* timed out after 10ms/);
  const summary = completion(failedCleanup.messages);
  assert.equal(summary.failedStage, "socket-poll");
  assert.equal(summary.failure, "timeout");
  const cleanup = summary.stages.find(stage => stage.stage === "cleanup");
  assert.equal(cleanup?.outcomes.error, 1);
});
