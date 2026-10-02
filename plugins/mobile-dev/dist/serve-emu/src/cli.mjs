#!/usr/bin/env node

// runtimes/serve-emu/src/cli.ts
import { parseArgs } from "node:util";
import { randomBytes as randomBytes2 } from "node:crypto";

// runtimes/serve-emu/src/exec.ts
import {
  spawn
} from "node:child_process";
var DEFAULT_EXEC_MAX_ACTIVE = 4;
var DEFAULT_EXEC_MAX_QUEUED = 64;
var DEFAULT_EXEC_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
var DEFAULT_EXEC_INTERACTIVE_ACTIVE_RESERVE = 1;
var DEFAULT_EXEC_INTERACTIVE_QUEUE_RESERVE = 8;
var MAX_EXEC_TIMEOUT_MS = 2147483647;
var ExecError = class extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
    this.name = "ExecError";
  }
  code;
};
var SYSTEM_CLOCK = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer)
};
var LANE_PRIORITY = {
  interactive: 0,
  default: 1,
  background: 2
};
function integer(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${name} must be an integer from ${minimum} through ${maximum}`
    );
  }
  return value;
}
function normalizedOptions(options, defaultMaxBuffer) {
  const timeout = integer(
    options.timeout ?? 0,
    "timeout",
    0,
    MAX_EXEC_TIMEOUT_MS
  );
  const maxBuffer = integer(
    options.maxBuffer ?? defaultMaxBuffer,
    "maxBuffer",
    0
  );
  const lane = options.lane ?? "default";
  if (lane !== "interactive" && lane !== "default" && lane !== "background") {
    throw new TypeError("lane must be interactive, default, or background");
  }
  return { timeout, maxBuffer, signal: options.signal, lane };
}
function abortError(signal) {
  return new ExecError("aborted", "command was aborted", {
    cause: signal.reason
  });
}
function emptyOutput(encoding) {
  return encoding === "buffer" ? Buffer.alloc(0) : "";
}
function emptyResult(encoding, error, timedOut = false) {
  return {
    status: null,
    signal: null,
    stdout: emptyOutput(encoding),
    stderr: "",
    timedOut,
    error
  };
}
function isSettled(job) {
  return job.state === "settled";
}
var ProcessExecutor = class {
  #maxActive;
  #maxQueued;
  #defaultMaxBuffer;
  #interactiveActiveReserve;
  #interactiveQueueReserve;
  #spawn;
  #clock;
  #queue = [];
  #active = /* @__PURE__ */ new Map();
  #totals = {
    submitted: 0,
    started: 0,
    settled: 0,
    succeeded: 0,
    failed: 0,
    rejected: 0,
    timedOut: 0,
    aborted: 0,
    outputLimited: 0
  };
  #nextId = 1;
  constructor(options = {}) {
    this.#maxActive = integer(
      options.maxActive ?? DEFAULT_EXEC_MAX_ACTIVE,
      "maxActive",
      1
    );
    this.#maxQueued = integer(
      options.maxQueued ?? DEFAULT_EXEC_MAX_QUEUED,
      "maxQueued",
      0
    );
    this.#defaultMaxBuffer = integer(
      options.defaultMaxBuffer ?? DEFAULT_EXEC_MAX_OUTPUT_BYTES,
      "defaultMaxBuffer",
      0
    );
    this.#interactiveActiveReserve = integer(
      options.interactiveActiveReserve ?? Math.min(
        DEFAULT_EXEC_INTERACTIVE_ACTIVE_RESERVE,
        this.#maxActive - 1
      ),
      "interactiveActiveReserve",
      0,
      this.#maxActive - 1
    );
    this.#interactiveQueueReserve = integer(
      options.interactiveQueueReserve ?? Math.min(
        DEFAULT_EXEC_INTERACTIVE_QUEUE_RESERVE,
        Math.floor(this.#maxQueued / 4)
      ),
      "interactiveQueueReserve",
      0,
      this.#maxQueued
    );
    this.#spawn = options.spawn ?? ((cmd, args) => spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"]
    }));
    this.#clock = options.clock ?? SYSTEM_CLOCK;
  }
  execText(cmd, args, options = {}) {
    return this.#submit(cmd, args, options, "utf8");
  }
  execBuffer(cmd, args, options = {}) {
    return this.#submit(cmd, args, options, "buffer");
  }
  snapshot() {
    const lanes = {
      interactive: { active: 0, queued: 0 },
      default: { active: 0, queued: 0 },
      background: { active: 0, queued: 0 }
    };
    for (const job of this.#active.values()) lanes[job.opts.lane].active++;
    for (const job of this.#queue) lanes[job.opts.lane].queued++;
    const now = this.#clock.now();
    return {
      active: this.#active.size,
      queued: this.#queue.length,
      oldestQueuedAgeMs: this.#queue.length === 0 ? null : Math.max(
        0,
        now - Math.min(...this.#queue.map((job) => job.submittedAt))
      ),
      limits: {
        active: this.#maxActive,
        queued: this.#maxQueued,
        outputBytes: this.#defaultMaxBuffer,
        interactiveActiveReserve: this.#interactiveActiveReserve,
        interactiveQueueReserve: this.#interactiveQueueReserve
      },
      lanes,
      totals: { ...this.#totals }
    };
  }
  #submit(cmd, args, options, encoding) {
    if (!cmd) throw new TypeError("cmd must not be empty");
    const opts = normalizedOptions(options, this.#defaultMaxBuffer);
    this.#totals.submitted++;
    if (opts.signal?.aborted) {
      this.#totals.settled++;
      this.#totals.failed++;
      this.#totals.aborted++;
      return Promise.resolve(emptyResult(encoding, abortError(opts.signal)));
    }
    if (!this.#canStartLane(opts.lane) && !this.#queueHasCapacity(opts.lane)) {
      const error = new ExecError(
        "queue-full",
        `command queue has no capacity for ${opts.lane} work`
      );
      this.#totals.settled++;
      this.#totals.failed++;
      this.#totals.rejected++;
      return Promise.resolve(emptyResult(encoding, error));
    }
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    const job = {
      id: this.#nextId++,
      cmd,
      args: [...args],
      opts,
      encoding,
      state: "queued",
      submittedAt: this.#clock.now(),
      resolve,
      deadlineTimer: null,
      abortListener: null,
      child: null,
      stdoutChunks: [],
      stderrChunks: [],
      outputBytes: 0,
      terminalError: null,
      timedOut: false,
      killRequested: false
    };
    if (opts.signal) {
      const onAbort = () => this.#abort(job, abortError(opts.signal));
      job.abortListener = onAbort;
      opts.signal.addEventListener("abort", onAbort, { once: true });
      if (opts.signal.aborted) onAbort();
    }
    if (isSettled(job)) return promise;
    if (opts.timeout > 0) {
      const timer = this.#clock.setTimeout(
        () => this.#expire(job),
        opts.timeout
      );
      if (isSettled(job)) this.#clock.clearTimeout(timer);
      else job.deadlineTimer = timer;
    }
    if (isSettled(job)) return promise;
    if (this.#canStartLane(job.opts.lane)) this.#start(job);
    else this.#queue.push(job);
    return promise;
  }
  #start(job) {
    if (job.state !== "queued") return;
    job.state = "active";
    this.#active.set(job.id, job);
    this.#totals.started++;
    let child;
    try {
      child = this.#spawn(job.cmd, job.args);
    } catch (error) {
      job.terminalError = error instanceof Error ? error : new Error(String(error));
      this.#finishActive(job, null, null);
      return;
    }
    job.child = child;
    child.stdout.on("data", (chunk) => {
      this.#collect(job, "stdout", chunk);
    });
    child.stderr.on("data", (chunk) => {
      this.#collect(job, "stderr", chunk);
    });
    child.once("error", (error) => {
      this.#processError(job, error);
    });
    child.stdout.once("error", (error) => this.#processError(job, error));
    child.stderr.once("error", (error) => this.#processError(job, error));
    child.once("close", (status, signal) => {
      this.#finishActive(job, status, signal);
    });
    if (job.terminalError) this.#kill(job);
  }
  #collect(job, target, value) {
    if (job.state !== "active" || job.terminalError) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.byteLength > job.opts.maxBuffer - job.outputBytes) {
      job.terminalError = new ExecError(
        "output-limit",
        `combined stdout and stderr exceed ${job.opts.maxBuffer} bytes`
      );
      this.#totals.outputLimited++;
      this.#kill(job);
      return;
    }
    job.outputBytes += chunk.byteLength;
    (target === "stdout" ? job.stdoutChunks : job.stderrChunks).push(chunk);
  }
  #processError(job, error) {
    if (job.state !== "active") return;
    job.terminalError ??= error;
    this.#kill(job);
  }
  #abort(job, error) {
    if (job.state === "settled") return;
    if (job.state === "queued") {
      this.#totals.aborted++;
      this.#finishQueued(job, error, false);
      return;
    }
    if (!job.terminalError) {
      job.terminalError = error;
      this.#totals.aborted++;
    }
    this.#kill(job);
  }
  #expire(job) {
    if (job.state === "settled") return;
    const error = new ExecError(
      "deadline-exceeded",
      `command deadline exceeded after ${job.opts.timeout}ms`
    );
    if (job.state === "queued") {
      job.timedOut = true;
      this.#totals.timedOut++;
      this.#finishQueued(job, error, true);
      return;
    }
    if (!job.terminalError) {
      job.timedOut = true;
      job.terminalError = error;
      this.#totals.timedOut++;
    }
    this.#kill(job);
  }
  #kill(job) {
    if (job.state !== "active" || !job.child || job.killRequested) return;
    job.killRequested = true;
    try {
      job.child.kill("SIGKILL");
    } catch (error) {
      job.terminalError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  #finishQueued(job, error, timedOut) {
    if (job.state !== "queued") return;
    job.state = "settled";
    const index = this.#queue.indexOf(job);
    if (index >= 0) this.#queue.splice(index, 1);
    this.#dispose(job);
    this.#totals.settled++;
    this.#totals.failed++;
    job.resolve(emptyResult(job.encoding, error, timedOut));
    this.#drain();
  }
  #finishActive(job, status, signal) {
    if (job.state !== "active") return;
    job.state = "settled";
    this.#active.delete(job.id);
    this.#dispose(job);
    const stdoutBuffer = Buffer.concat(job.stdoutChunks);
    const result = {
      status,
      signal,
      stdout: job.encoding === "buffer" ? stdoutBuffer : stdoutBuffer.toString("utf8"),
      stderr: Buffer.concat(job.stderrChunks).toString("utf8"),
      timedOut: job.timedOut,
      error: job.terminalError
    };
    const succeeded = status === 0 && !result.error;
    this.#totals.settled++;
    if (succeeded) this.#totals.succeeded++;
    else this.#totals.failed++;
    job.resolve(result);
    this.#drain();
  }
  #dispose(job) {
    if (job.deadlineTimer !== null) {
      this.#clock.clearTimeout(job.deadlineTimer);
      job.deadlineTimer = null;
    }
    if (job.abortListener && job.opts.signal) {
      job.opts.signal.removeEventListener("abort", job.abortListener);
      job.abortListener = null;
    }
  }
  #canStartLane(lane) {
    if (this.#active.size >= this.#maxActive) return false;
    if (lane === "background") {
      const activeInteractive = Array.from(this.#active.values()).reduce(
        (count, job) => count + (job.opts.lane === "interactive" ? 1 : 0),
        0
      );
      const reserveNeeded = Math.max(
        0,
        this.#interactiveActiveReserve - activeInteractive
      );
      if (this.#active.size >= this.#maxActive - reserveNeeded) return false;
    }
    return true;
  }
  #queueHasCapacity(lane) {
    if (this.#queue.length >= this.#maxQueued) return false;
    if (lane === "interactive") return true;
    const nonInteractiveQueued = this.#queue.reduce(
      (count, job) => count + (job.opts.lane === "interactive" ? 0 : 1),
      0
    );
    return nonInteractiveQueued < this.#maxQueued - this.#interactiveQueueReserve;
  }
  #drain() {
    while (this.#active.size < this.#maxActive && this.#queue.length > 0) {
      let nextIndex = -1;
      for (let index = 0; index < this.#queue.length; index++) {
        const candidate = this.#queue[index];
        if (!this.#canStartLane(candidate.opts.lane)) continue;
        if (nextIndex === -1 || LANE_PRIORITY[candidate.opts.lane] < LANE_PRIORITY[this.#queue[nextIndex].opts.lane]) {
          nextIndex = index;
        }
      }
      if (nextIndex === -1) return;
      const [next] = this.#queue.splice(nextIndex, 1);
      if (next?.state === "queued") this.#start(next);
    }
  }
};
var defaultExecutor = new ProcessExecutor();
function execText(cmd, args, opts = {}) {
  return defaultExecutor.execText(cmd, args, opts);
}
function execBuffer(cmd, args, opts = {}) {
  return defaultExecutor.execBuffer(cmd, args, opts);
}
function getExecSnapshot() {
  return defaultExecutor.snapshot();
}

// runtimes/serve-emu/src/adb.ts
var ADB_QUERY_TIMEOUT_MS = 2e3;
var ADB_MUTATION_TIMEOUT_MS = 5e3;
var ADB_SCREENSHOT_TIMEOUT_MS = 8e3;
function execFailed(result) {
  return result.status !== 0 || result.error !== null;
}
function execFailure(result) {
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return result.stderr.trim() || result.error?.message || stdout || "unknown error";
}
async function listAllDevices(runExec = execText) {
  const r = await runExec("adb", ["devices"], { timeout: ADB_QUERY_TIMEOUT_MS });
  if (execFailed(r)) throw new Error(`adb devices failed: ${execFailure(r)}`);
  return r.stdout.split("\n").slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [serial, state] = l.split(/\s+/);
    return { serial, state };
  });
}
async function listDevices(runExec = execText) {
  return (await listAllDevices(runExec)).filter((d) => d.state === "device");
}
async function pickDevice(explicit, runExec = execText) {
  if (explicit) return explicit;
  const devices = await listDevices(runExec);
  if (devices.length === 0) throw new Error("No booted Android device found. Start an emulator or attach a device.");
  if (devices.length > 1)
    throw new Error(
      `Multiple devices online (${devices.map((d) => d.serial).join(", ")}). Pass -s <serial>.`
    );
  return devices[0].serial;
}
async function screencapPng(serial, runExec = execBuffer) {
  const r = await runExec("adb", ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: ADB_SCREENSHOT_TIMEOUT_MS
  });
  if (execFailed(r)) throw new Error(`screencap failed: ${execFailure(r)}`);
  return r.stdout;
}
function orientationFromRotation(mode, rotation) {
  if (mode === "free") return "auto";
  if (rotation === 0 || rotation === 2) return "portrait";
  if (rotation === 1 || rotation === 3) return "landscape";
  return "unknown";
}
async function getUserRotation(serial, runExec = execText) {
  const r = await runExec("adb", ["-s", serial, "shell", "cmd", "window", "user-rotation"], {
    timeout: ADB_QUERY_TIMEOUT_MS
  });
  if (execFailed(r)) {
    throw new Error(
      `cmd window user-rotation failed: ${execFailure(r)}`
    );
  }
  const raw = r.stdout.trim();
  const match = raw.match(/^(free|lock)(?:\s+(\d+))?$/);
  if (!match) {
    return { mode: "unknown", rotation: null, orientation: "unknown", raw };
  }
  const mode = match[1];
  const rotation = match[2] === void 0 ? null : Number(match[2]);
  return { mode, rotation, orientation: orientationFromRotation(mode, rotation), raw };
}
async function setUserRotation(serial, orientation, runExec = execText) {
  const args = orientation === "auto" ? ["cmd", "window", "user-rotation", "free"] : ["cmd", "window", "user-rotation", "lock", orientation === "portrait" ? "0" : "1"];
  const r = await runExec("adb", ["-s", serial, "shell", ...args], {
    timeout: ADB_MUTATION_TIMEOUT_MS
  });
  if (execFailed(r)) {
    throw new Error(
      `adb shell ${args.join(" ")} failed: ${execFailure(r)}`
    );
  }
  return getUserRotation(serial, runExec);
}
async function getFontScale(serial, runExec = execText) {
  const r = await runExec("adb", ["-s", serial, "shell", "settings", "get", "system", "font_scale"], {
    timeout: ADB_QUERY_TIMEOUT_MS
  });
  if (execFailed(r)) {
    throw new Error(
      `settings get system font_scale failed: ${execFailure(r)}`
    );
  }
  const raw = r.stdout.trim();
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Could not parse font_scale output: ${r.stdout}`);
  }
  return { scale, raw };
}
async function setFontScale(serial, scale, runExec = execText) {
  if (!Number.isFinite(scale) || scale < 0.7 || scale > 2) {
    throw new Error("font scale must be between 0.7 and 2.0");
  }
  const normalized = scale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const args = ["settings", "put", "system", "font_scale", normalized];
  const r = await runExec("adb", ["-s", serial, "shell", ...args], {
    timeout: ADB_MUTATION_TIMEOUT_MS
  });
  if (execFailed(r)) {
    throw new Error(
      `adb shell ${args.join(" ")} failed: ${execFailure(r)}`
    );
  }
  return getFontScale(serial, runExec);
}
function nightModeFromRaw(raw) {
  const match = raw.match(/Night mode:\s*(\S+)/i);
  const value = (match?.[1] ?? raw).trim().toLowerCase();
  if (value === "yes") return "dark";
  if (value === "no") return "light";
  if (value === "auto") return "auto";
  return "unknown";
}
async function getNightMode(serial, runExec = execText) {
  const r = await runExec("adb", ["-s", serial, "shell", "cmd", "uimode", "night"], {
    timeout: ADB_QUERY_TIMEOUT_MS
  });
  if (execFailed(r)) {
    throw new Error(`cmd uimode night failed: ${execFailure(r)}`);
  }
  const raw = r.stdout.trim();
  return { mode: nightModeFromRaw(raw), raw };
}
async function setNightMode(serial, mode, runExec = execText) {
  const value = mode === "dark" ? "yes" : mode === "light" ? "no" : "auto";
  const args = ["cmd", "uimode", "night", value];
  const r = await runExec("adb", ["-s", serial, "shell", ...args], {
    timeout: ADB_MUTATION_TIMEOUT_MS
  });
  if (execFailed(r)) {
    throw new Error(
      `adb shell ${args.join(" ")} failed: ${execFailure(r)}`
    );
  }
  return getNightMode(serial, runExec);
}
async function globalSetting(serial, name, runExec = execText) {
  const r = await runExec(
    "adb",
    ["-s", serial, "shell", "settings", "get", "global", name],
    {
      timeout: ADB_QUERY_TIMEOUT_MS
    }
  );
  if (execFailed(r)) {
    throw new Error(
      `settings get global ${name} failed: ${execFailure(r)}`,
      { cause: r.error ?? void 0 }
    );
  }
  return r.stdout.trim();
}
function radioStatusFromSetting(raw) {
  if (raw === "1") return "enabled";
  if (raw === "0") return "disabled";
  return "unknown";
}
async function getNetworkStatus(serial, runExec = execText) {
  const [wifiRaw, mobileDataRaw] = await Promise.all([
    globalSetting(serial, "wifi_on", runExec),
    globalSetting(serial, "mobile_data", runExec)
  ]);
  const wifi = radioStatusFromSetting(wifiRaw);
  const mobileData = radioStatusFromSetting(mobileDataRaw);
  const radios = [wifi, mobileData];
  const knownRadios = radios.filter((radio) => radio !== "unknown");
  const enabled = knownRadios.length === 0 ? null : knownRadios.some((radio) => radio === "enabled");
  return {
    enabled,
    wifi,
    mobileData,
    raw: {
      wifi: wifiRaw,
      mobileData: mobileDataRaw
    }
  };
}
async function setNetworkEnabled(serial, enabled, runExec = execText) {
  const action = enabled ? "enable" : "disable";
  for (const service of ["wifi", "data"]) {
    const args = ["svc", service, action];
    const r = await runExec("adb", ["-s", serial, "shell", ...args], {
      timeout: ADB_MUTATION_TIMEOUT_MS
    });
    if (execFailed(r)) {
      throw new Error(
        `adb shell ${args.join(" ")} failed: ${execFailure(r)}`
      );
    }
  }
  return getNetworkStatus(serial, runExec);
}

// runtimes/serve-emu/src/emulator.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
function execSucceeded(result) {
  return result.status === 0 && result.error === null;
}
function execFailure2(result) {
  return result.stderr.trim() || result.error?.message || result.stdout.trim() || "unknown error";
}
var emulatorResolutionCache = null;
function sdkEmulatorCandidates(env) {
  const roots = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    env.HOME ? join(env.HOME, "Library", "Android", "sdk") : void 0
  ].filter((v) => Boolean(v));
  return [...new Set(roots)].flatMap((root) => [
    join(root, "emulator", "emulator"),
    join(root, "tools", "emulator")
  ]);
}
function emulatorEnvironmentKey(env) {
  return [
    env.PATH ?? "",
    env.ANDROID_HOME ?? "",
    env.ANDROID_SDK_ROOT ?? "",
    env.HOME ?? ""
  ].join("\0");
}
async function resolveEmulator(explicit, dependencies = {}) {
  if (explicit) return explicit;
  const env = dependencies.env ?? process.env;
  const cacheKey = dependencies.cacheKey ?? emulatorEnvironmentKey(env);
  if (emulatorResolutionCache?.key === cacheKey) {
    return emulatorResolutionCache.resolution;
  }
  const runExec = dependencies.execText ?? execText;
  const pathExists = dependencies.existsSync ?? existsSync;
  const resolution = (async () => {
    const pathProbe = await runExec("emulator", ["-version"], {
      timeout: 5e3,
      maxBuffer: 64 * 1024
    });
    if (pathProbe.status === 0 && !pathProbe.error || pathProbe.error?.message.includes("EPIPE")) {
      return "emulator";
    }
    for (const candidate of sdkEmulatorCandidates(env)) {
      if (pathExists(candidate)) return candidate;
    }
    throw new Error(
      "Could not find Android Emulator. Put `emulator` on PATH or set ANDROID_HOME / ANDROID_SDK_ROOT.",
      { cause: pathProbe.error ?? void 0 }
    );
  })();
  emulatorResolutionCache = { key: cacheKey, resolution };
  try {
    return await resolution;
  } catch (error) {
    if (emulatorResolutionCache?.resolution === resolution) {
      emulatorResolutionCache = null;
    }
    throw error;
  }
}
async function listAvdsWithEmulator(emulator, runExec = execText) {
  const r = await runExec(emulator, ["-list-avds"], {
    timeout: 5e3,
    maxBuffer: 1024 * 1024
  });
  if (!execSucceeded(r)) {
    throw new Error(
      `emulator -list-avds failed: ${execFailure2(r)}`,
      { cause: r.error ?? void 0 }
    );
  }
  return r.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
async function listAvds(emulatorPath, dependencies = {}) {
  return listAvdsWithEmulator(
    await resolveEmulator(emulatorPath, dependencies),
    dependencies.execText
  );
}
function avdName(avd) {
  return avd.startsWith("@") ? avd.slice(1) : avd;
}
function emulatorAvdArg(avd) {
  return avd.startsWith("@") ? avd : `@${avd}`;
}
async function usedEmulatorPorts(readDevices = listAllDevices) {
  const ports = /* @__PURE__ */ new Set();
  for (const device of await readDevices()) {
    const match = device.serial.match(/^emulator-(\d+)$/);
    if (match) ports.add(Number(match[1]));
  }
  return ports;
}
async function pickEmulatorPort(readDevices = listAllDevices) {
  const used = await usedEmulatorPorts(readDevices);
  for (let port = 5554; port <= 5682; port += 2) {
    if (!used.has(port)) return port;
  }
  throw new Error("No available emulator console ports in the 5554-5682 range.");
}
function validateEmulatorPort(port) {
  if (!Number.isInteger(port) || port < 5554 || port > 5682 || port % 2 !== 0) {
    throw new Error("--emulator-port must be an even integer from 5554 through 5682.");
  }
}
function adb(serial, args, runExec = execText) {
  return runExec("adb", ["-s", serial, ...args], { timeout: 5e3 });
}
function parseEmuAvdName(stdout) {
  return stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== "OK" && !line.startsWith("KO:")) ?? null;
}
async function runningAvdName(serial, runExec = execText) {
  const fromConsole = await adb(serial, ["emu", "avd", "name"], runExec);
  if (execSucceeded(fromConsole)) {
    const name = parseEmuAvdName(fromConsole.stdout);
    if (name) return name;
  }
  const fromProp = await adb(
    serial,
    ["shell", "getprop", "ro.boot.qemu.avd_name"],
    runExec
  );
  if (execSucceeded(fromProp)) {
    const name = fromProp.stdout.trim();
    if (name) return name;
  }
  return null;
}
async function resolveRunningAvds(devices, runExec = execText) {
  const emulators = devices.filter(
    (device) => /^emulator-\d+$/.test(device.serial)
  );
  const named = await Promise.all(
    emulators.map(async (device) => {
      const avd = await runningAvdName(device.serial, runExec);
      return avd ? { serial: device.serial, avd, state: device.state } : null;
    })
  );
  return named.filter((entry) => entry !== null);
}
async function listRunningAvds(devices, dependencies = {}) {
  const snapshot = devices ?? await (dependencies.listAllDevices ?? listAllDevices)();
  return resolveRunningAvds(snapshot, dependencies.execText);
}
async function findRunningAvd(name, dependencies = {}) {
  return (await listRunningAvds(void 0, dependencies)).find(
    (running) => running.avd === name
  ) ?? null;
}
async function stopEmulator(serial, runExec = execText) {
  const r = await adb(serial, ["emu", "kill"], runExec);
  if (!execSucceeded(r)) {
    throw new Error(`Failed to stop ${serial}: ${execFailure2(r)}`);
  }
}
async function waitForEmulatorExit(serial, timeoutMs = 3e4, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const pause = dependencies.sleep ?? sleep;
  const readDevices = dependencies.listAllDevices ?? listAllDevices;
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    if (!(await readDevices()).some((device) => device.serial === serial)) return;
    await pause(500);
  }
  throw new Error(`Timed out waiting for ${serial} to stop.`);
}
async function waitForBoot(serial, proc, timeoutMs, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const pause = dependencies.sleep ?? sleep;
  const runExec = dependencies.execText ?? execText;
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`emulator exited before boot completed (code ${proc.exitCode ?? "null"})`);
    }
    const state = await adb(serial, ["get-state"], runExec);
    if (execSucceeded(state) && state.stdout.trim() === "device") {
      const boot = await adb(
        serial,
        ["shell", "getprop", "sys.boot_completed"],
        runExec
      );
      if (execSucceeded(boot) && boot.stdout.trim() === "1") return;
    }
    await pause(1e3);
  }
  throw new Error(`Timed out waiting for ${serial} to boot.`);
}
async function startEmulator(opts, dependencies = {}) {
  const runExec = dependencies.execText ?? execText;
  const emulator = await resolveEmulator(opts.emulatorPath, dependencies);
  const name = avdName(opts.avd);
  const avds = await listAvdsWithEmulator(emulator, runExec);
  if (!avds.includes(name)) {
    const available = avds.length ? avds.join(", ") : "(none)";
    throw new Error(`Unknown AVD "${name}". Available AVDs: ${available}`);
  }
  const running = await findRunningAvd(name, dependencies);
  if (running) {
    if (!opts.restartAvd) {
      return { serial: running.serial, proc: null, ownsProcess: false, stop: () => {
      } };
    }
    await stopEmulator(running.serial, runExec);
    await waitForEmulatorExit(running.serial, 3e4, dependencies);
  }
  const port = opts.port ?? await pickEmulatorPort(dependencies.listAllDevices);
  validateEmulatorPort(port);
  const args = [emulatorAvdArg(name), "-port", String(port)];
  if (opts.gpu) args.push("-gpu", opts.gpu);
  const proc = (dependencies.spawn ?? spawn2)(emulator, args, {
    stdio: ["ignore", "inherit", "inherit"]
  });
  const spawnError = new Promise((_, reject) => {
    proc.once("error", reject);
  });
  const serial = `emulator-${port}`;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    adb(serial, ["emu", "kill"], runExec).catch(() => {
    });
    try {
      proc.kill("SIGTERM");
    } catch {
    }
  };
  try {
    await Promise.race([
      waitForBoot(
        serial,
        proc,
        opts.bootTimeoutMs ?? 12e4,
        dependencies
      ),
      spawnError
    ]);
    return { serial, proc, ownsProcess: true, stop };
  } catch (err) {
    stop();
    throw err;
  }
}

// runtimes/serve-emu/src/scrcpy.ts
import { spawn as spawn3 } from "node:child_process";
import { createConnection } from "node:net";
import { setTimeout as sleep2 } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// runtimes/serve-emu/scripts/fetch-scrcpy.ts
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join as join2 } from "node:path";
var SCRCPY_VERSION = "4.0";
var __dirname = dirname(fileURLToPath(import.meta.url));
var VENDOR_DIR = join2(__dirname, "..", "vendor");
var SCRCPY_SERVER_PATH = join2(VENDOR_DIR, `scrcpy-server-v${SCRCPY_VERSION}`);
async function ensureScrcpyServer() {
  await access(SCRCPY_SERVER_PATH);
  return SCRCPY_SERVER_PATH;
}

// runtimes/serve-emu/src/scrcpy.ts
var DEVICE_JAR_CACHE_PATH = `/data/local/tmp/serve-emu-scrcpy-server-v${SCRCPY_VERSION}.jar`;
var DEFAULT_TIMEOUTS = {
  pushMs: 3e4,
  copyMs: 5e3,
  forwardMs: 5e3,
  socketPollMs: 2e3,
  socketReadyMs: 3e4,
  connectMs: 3e3,
  preambleMs: 1e4,
  processExitMs: 1e3,
  cleanupMs: 3e3
};
var ADB_CANCELLATION_SETTLE_MS = 1100;
var SCRCPY_DEFAULTS = {
  maxFps: 60,
  bitRate: 8e6,
  // The emulator has no hardware video encoder; its software H.264 encoder
  // (c2.android.avc.encoder) only sustains 60fps below roughly a megapixel,
  // so cap the longest edge at 1280 unless the caller overrides it.
  maxSize: 1280,
  // Late joiners get keyframes on demand via reset-video, so a long interval
  // avoids periodic keyframe bursts.
  keyFrameInterval: 10,
  repeatFrameMs: 0
};
function pickPort() {
  return 27200 + Math.floor(Math.random() * 2e3);
}
function randomScid() {
  return Math.floor(Math.random() * 2147483647).toString(16).padStart(8, "0");
}
function abortError2(signal, fallback) {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
}
function throwIfAborted(signal, fallback) {
  if (signal.aborted) throw abortError2(signal, fallback);
}
function runtimeFor(deps) {
  return {
    ensureServer: deps.ensureServer ?? ensureScrcpyServer,
    serverFingerprint: deps.serverFingerprint ?? (async (path) => createHash("sha256").update(await readFile(path)).digest("hex")),
    runAdb: deps.runAdb ?? (async (serial, args, opts) => execText("adb", ["-s", serial, ...args], {
      timeout: opts.timeoutMs,
      signal: opts.signal
    })),
    spawnAdb: deps.spawnAdb ?? ((serial, args) => spawn3("adb", ["-s", serial, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    })),
    connect: deps.connect ?? connectOnce,
    sleep: deps.sleep ?? ((ms, signal) => sleep2(ms, void 0, { signal })),
    randomScid: deps.randomScid ?? randomScid,
    pickPort: deps.pickPort ?? pickPort,
    setTimer: deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms)),
    clearTimer: deps.clearTimer ?? ((timer) => clearTimeout(timer))
  };
}
async function withDeadline(runtime, parentSignal, timeoutMs, label, operation, settleAfterAbortMs = 0) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(abortError2(parentSignal, `${label} aborted`));
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (parentSignal?.aborted) abortFromParent();
  const timer = runtime.setTimer(
    () => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  try {
    throwIfAborted(controller.signal, `${label} aborted`);
    const operationPromise = Promise.resolve().then(
      () => operation(controller.signal)
    );
    const aborted2 = new Promise((_resolve, reject) => {
      const onAbort = () => reject(abortError2(controller.signal, `${label} aborted`));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      operationPromise.then(
        () => controller.signal.removeEventListener("abort", onAbort),
        () => controller.signal.removeEventListener("abort", onAbort)
      );
      if (controller.signal.aborted) onAbort();
    });
    try {
      return await Promise.race([operationPromise, aborted2]);
    } catch (err) {
      if (controller.signal.aborted && settleAfterAbortMs > 0) {
        let settleTimer = null;
        await Promise.race([
          operationPromise.then(
            () => void 0,
            () => void 0
          ),
          new Promise((resolve) => {
            settleTimer = runtime.setTimer(resolve, settleAfterAbortMs);
          })
        ]);
        if (settleTimer) runtime.clearTimer(settleTimer);
        throw abortError2(controller.signal, `${label} aborted`);
      }
      throw err;
    }
  } finally {
    runtime.clearTimer(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}
function commandFailure(serial, args, result) {
  const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message || (result.timedOut ? "timed out" : `status ${result.status}`);
  return new Error(`adb -s ${serial} ${args.join(" ")} failed: ${detail}`);
}
function deviceUnavailable(result) {
  const detail = `${result.stderr ?? ""} ${result.stdout ?? ""}`;
  return /\b(?:device offline|device .* not found|no devices?|closed)\b/i.test(
    detail
  );
}
async function runAdbRaw(runtime, serial, args, timeoutMs, signal) {
  return withDeadline(
    runtime,
    signal,
    timeoutMs,
    `adb ${args.join(" ")}`,
    (commandSignal) => runtime.runAdb(serial, args, { timeoutMs, signal: commandSignal }),
    ADB_CANCELLATION_SETTLE_MS
  );
}
async function runAdbChecked(runtime, serial, args, timeoutMs, signal) {
  const result = await runAdbRaw(runtime, serial, args, timeoutMs, signal);
  if (result.status !== 0) throw commandFailure(serial, args, result);
  return result.stdout;
}
function forwardedPorts(output2, serial, target) {
  const ports = [];
  for (const line of output2.split("\n")) {
    const match = line.match(/^(\S+)\s+tcp:(\d+)\s+(.+)$/);
    if (match?.[1] === serial && match[3] === target) {
      ports.push(Number(match[2]));
    }
  }
  return ports;
}
async function forwardAbstractSocket(runtime, timeouts, serial, target, signal) {
  const dynamicArgs = ["forward", "tcp:0", target];
  const dynamic = await runAdbRaw(
    runtime,
    serial,
    dynamicArgs,
    timeouts.forwardMs,
    signal
  );
  if (dynamic.status === 0) {
    const direct = Number(dynamic.stdout.trim());
    if (Number.isInteger(direct) && direct > 0) return direct;
    const listed = await runAdbRaw(
      runtime,
      serial,
      ["forward", "--list"],
      timeouts.forwardMs,
      signal
    );
    if (listed.status === 0) {
      const [port] = forwardedPorts(listed.stdout, serial, target);
      if (port) return port;
    }
  }
  let lastError = dynamic.stderr?.trim() || dynamic.error?.message || "adb did not return a forwarded port";
  for (let attempt = 0; attempt < 5; attempt++) {
    throwIfAborted(signal, "adb forward aborted");
    const port = runtime.pickPort();
    const fixedArgs = [
      "forward",
      "--no-rebind",
      `tcp:${port}`,
      target
    ];
    const fixed = await runAdbRaw(
      runtime,
      serial,
      fixedArgs,
      timeouts.forwardMs,
      signal
    );
    if (fixed.status === 0) return port;
    lastError = fixed.stderr?.trim() || fixed.error?.message || lastError;
  }
  throw new Error(`Failed to create adb forward for ${target}: ${lastError}`);
}
async function removeForwards(runtime, timeouts, serial, target, knownPort) {
  const cleanupController = new AbortController();
  const ports = new Set(knownPort === null ? [] : [knownPort]);
  const errors = [];
  try {
    const listed = await runAdbRaw(
      runtime,
      serial,
      ["forward", "--list"],
      timeouts.cleanupMs,
      cleanupController.signal
    );
    if (listed.status === 0) {
      for (const port of forwardedPorts(listed.stdout, serial, target)) {
        ports.add(port);
      }
    } else if (!deviceUnavailable(listed)) {
      errors.push(
        commandFailure(serial, ["forward", "--list"], listed)
      );
    }
  } catch (err) {
    errors.push(err);
  }
  const removals = await Promise.allSettled(
    Array.from(ports, async (port) => {
      const args = ["forward", "--remove", `tcp:${port}`];
      const result = await runAdbRaw(
        runtime,
        serial,
        args,
        timeouts.cleanupMs,
        cleanupController.signal
      );
      if (result.status !== 0 && !deviceUnavailable(result) && !/(?:cannot remove listener|listener .* not found)/i.test(
        result.stderr ?? ""
      )) {
        throw commandFailure(serial, args, result);
      }
    })
  );
  for (const removal of removals) {
    if (removal.status === "rejected") errors.push(removal.reason);
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Failed to remove adb forwards for ${target}`
    );
  }
}
async function prepareDeviceServerJar(runtime, timeouts, serial, localJar, paths, signal) {
  const probe = await runAdbRaw(
    runtime,
    serial,
    ["shell", "test", "-f", paths.cache],
    timeouts.copyMs,
    signal
  );
  if (probe.status !== 0) {
    await runAdbChecked(
      runtime,
      serial,
      ["push", localJar, paths.temporary],
      timeouts.pushMs,
      signal
    );
    await runAdbChecked(
      runtime,
      serial,
      ["shell", "mv", paths.temporary, paths.cache],
      timeouts.copyMs,
      signal
    );
  }
  await runAdbChecked(
    runtime,
    serial,
    ["shell", "cp", paths.cache, paths.working],
    timeouts.copyMs,
    signal
  );
}
async function removeWorkingJars(runtime, timeouts, serial, paths) {
  const cleanupController = new AbortController();
  const args = ["shell", "rm", "-f", paths.temporary, paths.working];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runAdbRaw(
      runtime,
      serial,
      args,
      timeouts.cleanupMs,
      cleanupController.signal
    );
    if (result.status === 0) return;
    if (attempt === 0 && /\bclosed\b/i.test(result.stderr ?? "")) {
      await runtime.sleep(100, cleanupController.signal);
      continue;
    }
    if (deviceUnavailable(result)) return;
    throw commandFailure(serial, args, result);
  }
}
async function waitForAbstractSocketAsync(runtime, timeouts, serial, name, signal) {
  while (true) {
    throwIfAborted(signal, `waiting for @${name} aborted`);
    const result = await runAdbRaw(
      runtime,
      serial,
      ["shell", "cat", "/proc/net/unix"],
      timeouts.socketPollMs,
      signal
    );
    if (result.status === 0 && result.stdout.includes(`@${name}`)) return;
    const detail = `${result.stderr ?? ""} ${result.stdout ?? ""}`;
    if (/\b(offline|unauthorized|not found|no devices?)\b/i.test(detail)) {
      throw commandFailure(
        serial,
        ["shell", "cat", "/proc/net/unix"],
        result
      );
    }
    await runtime.sleep(100, signal);
  }
}
var MAX_READER_BUFFER_BYTES = 32 * 1024 * 1024;
var ScrcpyStreamError = class extends Error {
  constructor(code, message, meta, options) {
    super(message, options);
    this.code = code;
    this.meta = meta;
    this.name = "ScrcpyStreamError";
  }
  code;
  meta;
};
var FramedReader = class {
  constructor(sock) {
    this.sock = sock;
    sock.on("data", (d) => {
      if (this.total + d.length > MAX_READER_BUFFER_BYTES) {
        this.fail(
          new ScrcpyStreamError(
            "reader-overflow",
            `scrcpy video reader buffer overflow (> ${MAX_READER_BUFFER_BYTES} bytes)`,
            { limit: MAX_READER_BUFFER_BYTES }
          )
        );
        return;
      }
      this.chunks.push(d);
      this.total += d.length;
      this.flush();
    });
    sock.on(
      "error",
      (e) => this.fail(
        new ScrcpyStreamError(
          "socket-error",
          `scrcpy video socket error: ${e.message}`,
          void 0,
          { cause: e }
        )
      )
    );
    sock.on("end", () => this.endStream());
    sock.on("close", () => this.endStream());
  }
  sock;
  chunks = [];
  firstChunkOffset = 0;
  total = 0;
  waiters = [];
  err = null;
  ended = false;
  // Terminal failure: record the first cause, reject pending reads, drop the
  // buffer, and destroy the socket so no further data can accumulate.
  fail(e) {
    if (this.err) return;
    this.err = e;
    this.chunks.length = 0;
    this.firstChunkOffset = 0;
    this.total = 0;
    while (this.waiters.length) this.waiters.shift().reject(e);
    try {
      this.sock.destroy();
    } catch {
    }
  }
  // Socket end/close. A pending header read with an empty buffer is a clean
  // frame-boundary EOF; anything else means the stream was cut mid-packet.
  endStream() {
    if (this.err || this.ended) return;
    this.ended = true;
    while (this.waiters.length) {
      const w = this.waiters.shift();
      const clean = w.kind === "header" && this.total === 0;
      w.reject(
        clean ? new ScrcpyStreamError(
          "clean-eof",
          "scrcpy video stream ended cleanly"
        ) : new ScrcpyStreamError(
          w.kind === "header" ? "truncated-header" : "truncated-payload",
          `scrcpy stream ended mid-${w.kind} (needed ${w.n}, had ${this.total})`,
          { needed: w.n, had: this.total }
        )
      );
    }
  }
  read(n, kind) {
    if (this.err) return Promise.reject(this.err);
    if (this.ended && this.total < n) {
      const clean = kind === "header" && this.total === 0;
      return Promise.reject(
        clean ? new ScrcpyStreamError(
          "clean-eof",
          "scrcpy video stream ended cleanly"
        ) : new ScrcpyStreamError(
          kind === "header" ? "truncated-header" : "truncated-payload",
          `scrcpy stream ended mid-${kind} (needed ${n}, had ${this.total})`,
          { needed: n, had: this.total }
        )
      );
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ n, kind, resolve, reject });
      this.flush();
    });
  }
  prepend(data) {
    if (data.length === 0) return;
    if (this.firstChunkOffset > 0 && this.chunks.length > 0) {
      this.chunks[0] = this.chunks[0].subarray(this.firstChunkOffset);
      this.firstChunkOffset = 0;
    }
    this.chunks.unshift(data);
    this.total += data.length;
    this.flush();
  }
  consume(n) {
    const first = this.chunks[0];
    const firstAvailable = first.length - this.firstChunkOffset;
    if (firstAvailable >= n) {
      const out2 = first.subarray(
        this.firstChunkOffset,
        this.firstChunkOffset + n
      );
      this.firstChunkOffset += n;
      this.total -= n;
      if (this.firstChunkOffset === first.length) {
        this.chunks.shift();
        this.firstChunkOffset = 0;
      }
      return out2;
    }
    const out = Buffer.allocUnsafe(n);
    let written = 0;
    while (written < n) {
      const chunk = this.chunks[0];
      const available = chunk.length - this.firstChunkOffset;
      const take = Math.min(n - written, available);
      chunk.copy(
        out,
        written,
        this.firstChunkOffset,
        this.firstChunkOffset + take
      );
      written += take;
      this.firstChunkOffset += take;
      this.total -= take;
      if (this.firstChunkOffset === chunk.length) {
        this.chunks.shift();
        this.firstChunkOffset = 0;
      }
    }
    return out;
  }
  flush() {
    while (this.waiters.length && this.total >= this.waiters[0].n) {
      const w = this.waiters.shift();
      w.resolve(this.consume(w.n));
    }
  }
};
function parseFrameHeader(header, protocol) {
  const ptsRaw = header.readBigUInt64BE(0);
  if (protocol === 4 && (ptsRaw & PACKET_V4_FLAG_SESSION) !== 0n) {
    return {
      kind: "session",
      width: header.readUInt32BE(4),
      height: header.readUInt32BE(8),
      clientResized: (ptsRaw & 1n << 32n) !== 0n
    };
  }
  const size = header.readUInt32BE(8);
  if (size === 0 || size > 16 * 1024 * 1024) {
    throw new ScrcpyStreamError(
      "invalid-frame-size",
      `invalid scrcpy frame size: ${size}`,
      { size }
    );
  }
  const isConfig = protocol === 4 ? (ptsRaw & PACKET_V4_FLAG_CONFIG) !== 0n : (ptsRaw & PACKET_FLAG_CONFIG) !== 0n;
  const isKey = protocol === 4 ? (ptsRaw & PACKET_V4_FLAG_KEY_FRAME) !== 0n : (ptsRaw & PACKET_FLAG_KEY_FRAME) !== 0n;
  const pts = ptsRaw & ~(protocol === 4 ? PACKET_V4_FLAGS : PACKET_V3_FLAGS);
  return { kind: "frame", size, pts, isConfig, isKey };
}
async function connectOnce(port, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const s = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      s.removeListener("error", onError);
      s.removeListener("connect", onConnect);
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => {
        s.destroy();
        reject(new Error(`Timed out connecting to adb forward tcp:${port}`));
      });
    }, timeoutMs);
    const onError = (e) => {
      finish(() => reject(e));
    };
    const onConnect = () => {
      finish(() => resolve(s));
    };
    const onAbort = () => {
      finish(() => {
        s.destroy();
        reject(abortError2(signal, "scrcpy socket connection aborted"));
      });
    };
    s.once("error", onError);
    s.once("connect", onConnect);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
var CODEC_NAMES = {
  1748121140: "h264",
  1748121141: "h265",
  6387249: "av1"
};
function parseVideoPreamble(buf) {
  for (const offset of [0, 1]) {
    const streamMetaOffset = offset + 64;
    if (streamMetaOffset + 16 <= buf.length) {
      const codecId2 = buf.readUInt32BE(streamMetaOffset);
      const sessionFlags = buf.readUInt32BE(streamMetaOffset + 4);
      const width2 = buf.readUInt32BE(streamMetaOffset + 8);
      const height2 = buf.readUInt32BE(streamMetaOffset + 12);
      const codecName2 = CODEC_NAMES[codecId2];
      if (codecName2 && (sessionFlags & 2147483648) !== 0 && width2 >= 1 && height2 >= 1 && width2 <= 16384 && height2 <= 16384) {
        const nameBuf2 = buf.subarray(offset, offset + 64);
        const deviceName2 = nameBuf2.toString("utf8").replace(/\0+$/, "");
        return {
          deviceName: deviceName2,
          codecName: codecName2,
          width: width2,
          height: height2,
          protocol: 4,
          extra: buf.subarray(streamMetaOffset + 16)
        };
      }
    }
    if (streamMetaOffset + 12 > buf.length) continue;
    const codecId = buf.readUInt32BE(streamMetaOffset);
    const width = buf.readUInt32BE(streamMetaOffset + 4);
    const height = buf.readUInt32BE(streamMetaOffset + 8);
    const codecName = CODEC_NAMES[codecId];
    if (!codecName || width < 1 || height < 1 || width > 16384 || height > 16384)
      continue;
    const nameBuf = buf.subarray(offset, offset + 64);
    const deviceName = nameBuf.toString("utf8").replace(/\0+$/, "");
    return {
      deviceName,
      codecName,
      width,
      height,
      protocol: 3,
      extra: buf.subarray(streamMetaOffset + 12)
    };
  }
  throw new ScrcpyStreamError(
    "protocol-parse",
    `Could not parse scrcpy video preamble: ${buf.toString("hex", 0, 24)}...`,
    { head: buf.toString("hex", 0, 24) }
  );
}
async function startScrcpy(opts, deps = {}) {
  const runtime = runtimeFor(deps);
  const timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts };
  const { serial } = opts;
  const maxFps = opts.maxFps ?? SCRCPY_DEFAULTS.maxFps;
  const bitRate = opts.bitRate ?? SCRCPY_DEFAULTS.bitRate;
  const maxSize = opts.maxSize ?? SCRCPY_DEFAULTS.maxSize;
  const keyFrameInterval = opts.keyFrameInterval ?? SCRCPY_DEFAULTS.keyFrameInterval;
  const repeatFrameMs = opts.repeatFrameMs ?? SCRCPY_DEFAULTS.repeatFrameMs;
  const codecOptions = [
    ...keyFrameInterval > 0 ? [`i-frame-interval=${keyFrameInterval}`] : [],
    ...repeatFrameMs > 0 ? [`repeat-previous-frame-after:long=${Math.round(repeatFrameMs * 1e3)}`] : []
  ];
  const scid = runtime.randomScid();
  const forwardTarget = `localabstract:scrcpy_${scid}`;
  const startupController = new AbortController();
  let startupComplete = false;
  let jarPreparationStarted = false;
  let forwardAttempted = false;
  let jarPaths = null;
  let localPort = null;
  let proc = null;
  let childSettled = true;
  let childDone = Promise.resolve();
  let videoSock = null;
  let controlSock = null;
  let closeTask = null;
  let closeWithReason;
  const externalAbort = () => {
    const reason = abortError2(opts.signal, "scrcpy startup aborted");
    startupController.abort(reason);
    if (startupComplete) {
      void closeWithReason(reason).catch((err) => {
        console.error("[scrcpy] cleanup failed:", err);
      });
    }
  };
  closeWithReason = (reason) => {
    if (closeTask) return closeTask;
    opts.signal?.removeEventListener("abort", externalAbort);
    startupController.abort(reason);
    try {
      videoSock?.destroy();
    } catch {
    }
    try {
      controlSock?.destroy();
    } catch {
    }
    try {
      proc?.kill("SIGTERM");
    } catch {
    }
    const child = proc;
    const paths = jarPaths;
    closeTask = (async () => {
      const cleanupErrors = [];
      if (child && !childSettled) {
        try {
          await withDeadline(
            runtime,
            void 0,
            timeouts.processExitMs,
            "scrcpy process exit",
            () => childDone
          );
        } catch (termWaitError) {
          let killError = null;
          try {
            child.kill("SIGKILL");
          } catch (err) {
            killError = err;
          }
          try {
            await withDeadline(
              runtime,
              void 0,
              timeouts.processExitMs,
              "scrcpy process reap",
              () => childDone
            );
          } catch (reapError) {
            cleanupErrors.push(
              new AggregateError(
                [termWaitError, ...killError ? [killError] : [], reapError],
                "scrcpy process did not exit during cleanup"
              )
            );
          }
        }
      }
      const cleanupResults = await Promise.allSettled([
        forwardAttempted ? removeForwards(
          runtime,
          timeouts,
          serial,
          forwardTarget,
          localPort
        ) : Promise.resolve(),
        jarPreparationStarted && paths ? removeWorkingJars(runtime, timeouts, serial, paths) : Promise.resolve()
      ]);
      cleanupErrors.push(
        ...cleanupResults.flatMap(
          (result) => result.status === "rejected" ? [result.reason] : []
        )
      );
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, "scrcpy cleanup failed");
      }
    })();
    return closeTask;
  };
  opts.signal?.addEventListener("abort", externalAbort, { once: true });
  if (opts.signal?.aborted) externalAbort();
  try {
    throwIfAborted(startupController.signal, "scrcpy startup aborted");
    const jar = await withDeadline(
      runtime,
      startupController.signal,
      timeouts.pushMs,
      "locating scrcpy server",
      () => runtime.ensureServer()
    );
    const fingerprint = await withDeadline(
      runtime,
      startupController.signal,
      timeouts.pushMs,
      "hashing scrcpy server",
      () => runtime.serverFingerprint(jar)
    );
    const cacheKey = fingerprint.slice(0, 24);
    jarPaths = {
      cache: `${DEVICE_JAR_CACHE_PATH}-${cacheKey}`,
      temporary: `${DEVICE_JAR_CACHE_PATH}-${cacheKey}.${scid}.tmp`,
      working: `/data/local/tmp/serve-emu-scrcpy-${scid}.jar`
    };
    jarPreparationStarted = true;
    await prepareDeviceServerJar(
      runtime,
      timeouts,
      serial,
      jar,
      jarPaths,
      startupController.signal
    );
    throwIfAborted(startupController.signal, "scrcpy startup aborted");
    forwardAttempted = true;
    localPort = await forwardAbstractSocket(
      runtime,
      timeouts,
      serial,
      forwardTarget,
      startupController.signal
    );
    throwIfAborted(startupController.signal, "scrcpy startup aborted");
    proc = runtime.spawnAdb(serial, [
      "shell",
      `CLASSPATH=${jarPaths.working}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      SCRCPY_VERSION,
      `scid=${scid}`,
      "log_level=info",
      "audio=false",
      "tunnel_forward=true",
      `max_size=${maxSize}`,
      `video_bit_rate=${bitRate}`,
      `max_fps=${maxFps}`,
      ...codecOptions.length > 0 ? [`video_codec_options=${codecOptions.join(",")}`] : []
    ]);
    childSettled = false;
    let stderrTail = "";
    childDone = new Promise((resolve) => {
      const settle = (startupError) => {
        if (childSettled) return;
        childSettled = true;
        resolve();
        if (!startupComplete) startupController.abort(startupError);
      };
      proc.once(
        "error",
        (err) => settle(new Error(`scrcpy process failed during startup: ${err.message}`))
      );
      proc.once("exit", (code, signal) => {
        const suffix = stderrTail.trim() ? `: ${stderrTail.trim()}` : "";
        settle(
          new Error(
            `scrcpy process exited during startup (code=${code ?? "null"}, signal=${signal ?? "none"})${suffix}`
          )
        );
      });
    });
    proc.stdout?.on(
      "data",
      (b) => process.stdout.write(`[scrcpy] ${b}`)
    );
    proc.stderr?.on("data", (b) => {
      stderrTail = `${stderrTail}${b.toString("utf8")}`.slice(-8192);
      process.stderr.write(`[scrcpy] ${b}`);
    });
    await withDeadline(
      runtime,
      startupController.signal,
      timeouts.socketReadyMs,
      `waiting for scrcpy abstract socket @scrcpy_${scid}`,
      (signal) => waitForAbstractSocketAsync(
        runtime,
        timeouts,
        serial,
        `scrcpy_${scid}`,
        signal
      )
    );
    videoSock = await withDeadline(
      runtime,
      startupController.signal,
      timeouts.connectMs,
      "connecting scrcpy video socket",
      (signal) => runtime.connect(localPort, timeouts.connectMs, signal)
    );
    throwIfAborted(startupController.signal, "scrcpy startup aborted");
    controlSock = await withDeadline(
      runtime,
      startupController.signal,
      timeouts.connectMs,
      "connecting scrcpy control socket",
      (signal) => runtime.connect(localPort, timeouts.connectMs, signal)
    );
    throwIfAborted(startupController.signal, "scrcpy startup aborted");
    controlSock.on("data", () => {
    });
    const reader = new FramedReader(videoSock);
    const preambleBytes = await withDeadline(
      runtime,
      startupController.signal,
      timeouts.preambleMs,
      "reading scrcpy video preamble",
      () => reader.read(81, "header")
    );
    throwIfAborted(startupController.signal, "scrcpy startup aborted");
    const preamble = parseVideoPreamble(preambleBytes);
    if (preamble.codecName !== "h264") {
      throw new ScrcpyStreamError(
        "unsupported-codec",
        `bundled UI decodes H.264 only; device negotiated ${preamble.codecName}`,
        { codec: preamble.codecName }
      );
    }
    reader.prepend(preamble.extra);
    startupComplete = true;
    return {
      transport: "scrcpy",
      meta: {
        deviceName: preamble.deviceName,
        codecId: preamble.codecName,
        width: preamble.width,
        height: preamble.height
      },
      protocol: preamble.protocol,
      videoReader: reader,
      controlSocket: controlSock,
      proc,
      scid,
      localPort,
      serial,
      readFrame: () => readFrame(reader, preamble.protocol),
      close: () => closeWithReason(new Error("scrcpy session closed"))
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    startupController.abort(error);
    try {
      await closeWithReason(error);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        error.message,
        { cause: error }
      );
    }
    throw err;
  }
}
var PACKET_FLAG_CONFIG = 1n << 63n;
var PACKET_FLAG_KEY_FRAME = 1n << 62n;
var PACKET_V4_FLAG_SESSION = 1n << 63n;
var PACKET_V4_FLAG_CONFIG = 1n << 62n;
var PACKET_V4_FLAG_KEY_FRAME = 1n << 61n;
var PACKET_V3_FLAGS = PACKET_FLAG_CONFIG | PACKET_FLAG_KEY_FRAME;
var PACKET_V4_FLAGS = PACKET_V4_FLAG_SESSION | PACKET_V4_FLAG_CONFIG | PACKET_V4_FLAG_KEY_FRAME;
async function readFrame(reader, protocol) {
  let header;
  try {
    header = await reader.read(12, "header");
  } catch (e) {
    if (e instanceof ScrcpyStreamError && e.code === "clean-eof") return null;
    throw e;
  }
  const parsed = parseFrameHeader(header, protocol);
  if (parsed.kind === "session") {
    return {
      type: "session",
      width: parsed.width,
      height: parsed.height,
      clientResized: parsed.clientResized
    };
  }
  const data = await reader.read(parsed.size, "payload");
  return {
    type: "frame",
    data,
    pts: parsed.pts,
    isConfig: parsed.isConfig,
    isKey: parsed.isKey
  };
}

// runtimes/serve-emu/src/server.ts
import { readFile as readFile2 } from "node:fs/promises";
import { WebSocket as WebSocket2 } from "ws";

// runtimes/serve-emu/src/node-server.ts
import { createServer, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WebSocketServer } from "ws";
var BodyLimitError = class extends Error {
};
async function* limitedBody(incoming, limit) {
  let bytes = 0;
  for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      incoming.resume();
      throw new BodyLimitError("request body too large");
    }
    yield chunk;
  }
}
async function sendResponse(response, outgoing, method) {
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") outgoing.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
  if (method === "HEAD" || response.body === null) {
    await response.body?.cancel();
    outgoing.end();
    return;
  }
  outgoing.flushHeaders();
  const body = Readable.fromWeb(response.body);
  await pipeline(body, outgoing);
}
async function serve(options) {
  const requests = /* @__PURE__ */ new WeakMap();
  const sockets = /* @__PURE__ */ new Set();
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: options.websocket.maxPayloadLength,
    perMessageDeflate: false
  });
  const http = createServer();
  const server = {
    port: options.port,
    upgrade(request, { data }) {
      const context = requests.get(request);
      if (context?.socket === void 0 || context.head === void 0 || context.upgraded) return false;
      context.upgraded = true;
      websocket.handleUpgrade(context.incoming, context.socket, context.head, (socket) => {
        const client = Object.assign(socket, { data });
        client.on("message", (message, binary) => {
          if (binary) return;
          const payload = message.toString();
          options.websocket.message(client, payload);
        });
        client.on("close", () => options.websocket.close(client));
        client.on("error", () => client.terminate());
        websocket.emit("connection", client, context.incoming);
        options.websocket.open(client);
      });
      return true;
    },
    timeout(request, seconds) {
      const context = requests.get(request);
      context?.incoming.setTimeout(seconds * 1e3);
    },
    async stop() {
      const closed = new Promise((resolve, reject) => {
        http.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      for (const client of websocket.clients) client.terminate();
      websocket.close();
      for (const socket of sockets) socket.destroy();
      await closed;
    }
  };
  const handle = async (incoming, outgoing, socket, head) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const connection = outgoing ?? socket;
    connection?.once("close", abort);
    incoming.once("aborted", abort);
    try {
      const contentLength = Number(incoming.headers["content-length"] ?? 0);
      if (contentLength > options.maxRequestBodySize) throw new BodyLimitError("request body too large");
      const host = incoming.headers.host ?? `${options.hostname}:${server.port}`;
      const url = `http://${host}${incoming.url ?? "/"}`;
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      }
      const init = {
        method: incoming.method,
        headers,
        signal: controller.signal
      };
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        const chunks = limitedBody(incoming, options.maxRequestBodySize);
        const body = Readable.from(chunks);
        init.body = Readable.toWeb(body);
        init.duplex = "half";
      }
      const request = new Request(url, init);
      const context = { incoming, socket, head, upgraded: false };
      requests.set(request, context);
      const response = await options.fetch(request, server);
      if (context.upgraded) return;
      if (response === void 0) throw new Error("HTTP handler returned no response");
      if (outgoing === void 0 && socket) {
        outgoing = new ServerResponse(incoming);
        outgoing.assignSocket(socket);
        outgoing.shouldKeepAlive = false;
      }
      if (outgoing) await sendResponse(response, outgoing, incoming.method);
    } catch (error) {
      if (outgoing === void 0 && socket && socket.destroyed === false) {
        outgoing = new ServerResponse(incoming);
        outgoing.assignSocket(socket);
        outgoing.shouldKeepAlive = false;
      }
      if (outgoing && outgoing.headersSent === false && outgoing.destroyed === false) {
        const status = error instanceof BodyLimitError ? 413 : 500;
        const message = status === 413 ? "request body too large" : "internal server error";
        const response = new Response(message, { status });
        await sendResponse(response, outgoing, incoming.method);
      } else {
        outgoing?.destroy();
        socket?.destroy();
      }
    } finally {
      connection?.off("close", abort);
      incoming.off("aborted", abort);
    }
  };
  http.on("request", (request, response) => {
    void handle(request, response).catch(() => response.destroy());
  });
  http.on("upgrade", (request, socket, head) => {
    void handle(request, void 0, socket, head).catch(() => socket.destroy());
  });
  http.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    const failed = (error) => reject(error);
    http.once("error", failed);
    http.listen(options.port, options.hostname, () => {
      http.off("error", failed);
      resolve();
    });
  });
  const address = http.address();
  if (address && typeof address !== "string") server.port = address.port;
  return server;
}

// runtimes/serve-emu/src/server.ts
import { timingSafeEqual } from "node:crypto";
import { dirname as dirname2, join as join4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// runtimes/serve-emu/src/accessibility.ts
var SELECTOR_STRING_FIELDS = [
  "id",
  "text",
  "textContains",
  "contentDescription",
  "contentDescriptionContains",
  "resourceId",
  "resourceIdContains",
  "className",
  "packageName"
];
var MAX_SELECTOR_TEXT_BYTES = 512;
var DUMP_ATTEMPTS = 3;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function selectorString(value, name) {
  if (value === void 0) return void 0;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty`);
  if (Buffer.byteLength(trimmed, "utf8") > MAX_SELECTOR_TEXT_BYTES) {
    throw new Error(`${name} is too long`);
  }
  return trimmed;
}
function selectorBoolean(value, name) {
  if (value === void 0) return void 0;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}
function selectorIndex(value) {
  if (value === void 0) return void 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1e4) {
    throw new Error("index must be a non-negative integer");
  }
  return value;
}
function parseAccessibilitySelector(value) {
  if (!isRecord(value)) throw new Error("selector must be an object");
  const selector = {};
  const strings = {
    id: selectorString(value.id, "id"),
    text: selectorString(value.text, "text"),
    textContains: selectorString(value.textContains, "textContains"),
    contentDescription: selectorString(value.contentDescription, "contentDescription"),
    contentDescriptionContains: selectorString(
      value.contentDescriptionContains,
      "contentDescriptionContains"
    ),
    resourceId: selectorString(value.resourceId, "resourceId"),
    resourceIdContains: selectorString(value.resourceIdContains, "resourceIdContains"),
    className: selectorString(value.className, "className"),
    packageName: selectorString(value.packageName, "packageName")
  };
  for (const field of SELECTOR_STRING_FIELDS) {
    if (strings[field] !== void 0) selector[field] = strings[field];
  }
  const clickable = selectorBoolean(value.clickable, "clickable");
  const enabled = selectorBoolean(value.enabled, "enabled");
  const index = selectorIndex(value.index);
  if (clickable !== void 0) selector.clickable = clickable;
  if (enabled !== void 0) selector.enabled = enabled;
  if (index !== void 0) selector.index = index;
  const hasMatcher = SELECTOR_STRING_FIELDS.some((field) => selector[field] !== void 0) || selector.clickable !== void 0 || selector.enabled !== void 0;
  if (!hasMatcher) throw new Error("selector must include at least one matcher");
  return selector;
}
function matchesSelector(node, selector) {
  if (selector.id !== void 0 && node.id !== selector.id) return false;
  if (selector.text !== void 0 && node.text !== selector.text) return false;
  if (selector.textContains !== void 0 && !node.text.includes(selector.textContains)) return false;
  if (selector.contentDescription !== void 0 && node.contentDescription !== selector.contentDescription) {
    return false;
  }
  if (selector.contentDescriptionContains !== void 0 && !node.contentDescription.includes(selector.contentDescriptionContains)) {
    return false;
  }
  if (selector.resourceId !== void 0 && node.resourceId !== selector.resourceId) return false;
  if (selector.resourceIdContains !== void 0 && !node.resourceId.includes(selector.resourceIdContains)) {
    return false;
  }
  if (selector.className !== void 0 && node.className !== selector.className) return false;
  if (selector.packageName !== void 0 && node.packageName !== selector.packageName) return false;
  if (selector.clickable !== void 0 && node.clickable !== selector.clickable) return false;
  if (selector.enabled !== void 0 && node.enabled !== selector.enabled) return false;
  return true;
}
function findAccessibilityNode(nodes, selector) {
  const matches = nodes.filter((node) => matchesSelector(node, selector));
  if (matches.length === 0) throw new Error("no accessibility node matched selector");
  if (selector.index !== void 0) {
    const node = matches[selector.index];
    if (!node) throw new Error(`selector matched ${matches.length} nodes, index is out of range`);
    return node;
  }
  if (matches.length > 1) {
    throw new Error(`selector matched ${matches.length} nodes; provide index to disambiguate`);
  }
  return matches[0];
}
function decodeXml(value) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function attrsFor(node) {
  const attrs = {};
  for (const match of node.matchAll(/\s([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2] ?? "");
  }
  return attrs;
}
function parseBounds(value) {
  const match = value?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4])
  };
}
function boolAttr(value) {
  return value === "true";
}
async function dumpXml(serial, signal) {
  const throwIfAborted2 = () => {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new Error("accessibility request aborted");
  };
  throwIfAborted2();
  const path = `/sdcard/window-${Date.now()}.xml`;
  let lastError = "uiautomator dump failed";
  for (let attempt = 1; attempt <= DUMP_ATTEMPTS; attempt++) {
    const dump = await execText("adb", ["-s", serial, "shell", "uiautomator", "dump", path], {
      timeout: 8e3,
      signal,
      lane: "interactive"
    });
    throwIfAborted2();
    if (dump.status !== 0 || dump.error) {
      lastError = (dump.stderr || dump.error?.message || dump.stdout || `uiautomator dump failed with status ${dump.status}`).trim();
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      continue;
    }
    const result = await execText("adb", ["-s", serial, "shell", "cat", path], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 8e3,
      signal,
      lane: "interactive"
    });
    throwIfAborted2();
    void execText("adb", ["-s", serial, "shell", "rm", path], { timeout: 2e3 });
    if (result.status === 0 && !result.error) return result.stdout;
    lastError = (result.stderr || result.error?.message || result.stdout || "uiautomator dump read failed").trim();
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
  }
  void execText("adb", ["-s", serial, "shell", "rm", path], { timeout: 2e3 });
  throw new Error(lastError);
}
async function getAccessibilitySnapshot(serial, signal) {
  const xml = await dumpXml(serial, signal);
  return {
    ok: true,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    nodes: parseAccessibilityXml(xml)
  };
}
function parseAccessibilityXml(xml) {
  const nodes = [];
  let index = 0;
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const attrs = attrsFor(match[0]);
    const bounds = parseBounds(attrs.bounds);
    if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) continue;
    nodes.push({
      id: `${index++}`,
      text: attrs.text ?? "",
      contentDescription: attrs["content-desc"] ?? "",
      resourceId: attrs["resource-id"] ?? "",
      className: attrs.class ?? "",
      packageName: attrs.package ?? "",
      clickable: boolAttr(attrs.clickable),
      enabled: boolAttr(attrs.enabled),
      bounds
    });
  }
  return nodes;
}

// runtimes/serve-emu/src/api/api-error.ts
var API_ERROR_STATUS = {
  invalid_request: 400,
  invalid_json: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  downstream_failure: 502,
  service_unavailable: 503
};
var ApiError = class extends Error {
  status;
  code;
  headers;
  constructor(status, code, message, options = {}) {
    super(message, { cause: options.cause });
    const expectedStatus = API_ERROR_STATUS[code];
    if (status !== expectedStatus) {
      throw new TypeError(
        `API error code ${code} must use status ${expectedStatus}, not ${status}`
      );
    }
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.headers = new Headers(options.headers);
  }
};
function apiErrorBody(error) {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message
    }
  };
}
function apiErrorResponse(error) {
  const headers = new Headers(error.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(apiErrorBody(error), {
    status: error.status,
    headers
  });
}
function internalApiError(cause) {
  return new ApiError(500, "internal_error", "Internal server error", {
    cause
  });
}

// runtimes/serve-emu/src/api/router.ts
var METHOD_ORDER = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS"
];
var METHOD_RANK = new Map(
  METHOD_ORDER.map((method, index) => [method, index])
);
var defaultApiPath = (pathname) => pathname === "/api" || pathname.startsWith("/api/");
function validateRoute(route) {
  if (!route.path.startsWith("/") || route.path.includes("?") || route.path.includes("#")) {
    throw new TypeError(
      `API route path must be an absolute pathname: ${route.path}`
    );
  }
  if (!METHOD_RANK.has(route.method)) {
    throw new TypeError(`Unsupported API method: ${route.method}`);
  }
  if (typeof route.handler !== "function") {
    throw new TypeError(
      `API route handler must be a function: ${route.method} ${route.path}`
    );
  }
}
function sortedMethods(routes) {
  return routes.map((route) => route.method).sort((a, b) => (METHOD_RANK.get(a) ?? 99) - (METHOD_RANK.get(b) ?? 99));
}
function logServerError(logger, request, url, error) {
  try {
    logger.error("API request failed", {
      method: request.method,
      path: url.pathname,
      status: error.status,
      code: error.code,
      cause: error.cause
    });
  } catch {
  }
}
function createApiRouter(definitions, options = {}) {
  const routes = Object.freeze(
    definitions.map((route) => Object.freeze({ ...route }))
  );
  const routesByPath = /* @__PURE__ */ new Map();
  const registered = /* @__PURE__ */ new Set();
  for (const route of routes) {
    validateRoute(route);
    const key = `${route.method} ${route.path}`;
    if (registered.has(key)) {
      throw new TypeError(`Duplicate API route: ${key}`);
    }
    registered.add(key);
    const pathRoutes = routesByPath.get(route.path) ?? [];
    pathRoutes.push(route);
    routesByPath.set(route.path, pathRoutes);
  }
  const logger = options.logger ?? console;
  const isApiPath = options.isApiPath ?? defaultApiPath;
  return {
    routes,
    async handle(request, deps) {
      const url = new URL(request.url);
      if (!isApiPath(url.pathname)) return null;
      const pathRoutes = routesByPath.get(url.pathname);
      if (!pathRoutes) {
        return apiErrorResponse(
          new ApiError(404, "not_found", "API route not found")
        );
      }
      const route = pathRoutes.find((item) => item.method === request.method);
      if (!route) {
        const allow = sortedMethods(pathRoutes);
        return apiErrorResponse(
          new ApiError(
            405,
            "method_not_allowed",
            "Method not allowed for this API route",
            { headers: { Allow: allow.join(", ") } }
          )
        );
      }
      try {
        const response = await route.handler({ request, url, deps });
        if (!(response instanceof Response)) {
          throw new TypeError("API route handler did not return a Response");
        }
        return response;
      } catch (cause) {
        const error = cause instanceof ApiError ? cause : internalApiError(cause);
        if (error.status >= 500) {
          logServerError(logger, request, url, error);
        }
        return apiErrorResponse(error);
      }
    }
  };
}

// runtimes/serve-emu/src/app-management.ts
import { randomBytes } from "node:crypto";
var AppManagementError = class extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
    this.name = "AppManagementError";
  }
  code;
};
var PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
var PERMISSION_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
var ACTIVITY_RE = /^([A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+|\.?[A-Za-z][A-Za-z0-9_.$]*)(\/[A-Za-z0-9_.$]+)?$/;
function output(stdout, stderr) {
  return `${stdout}${stderr}`.trim();
}
async function adb2(serial, args, timeout = 3e4, signal, runExec = execText) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
  }
  const result = await runExec("adb", ["-s", serial, ...args], {
    timeout,
    signal,
    lane: "background"
  });
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
  }
  const text = output(result.stdout, result.stderr);
  if (result.timedOut) {
    throw new AppManagementError(
      "adb-timeout",
      text || `adb ${args.join(" ")} timed out`,
      { cause: result.error }
    );
  }
  if (result.error) {
    throw new AppManagementError(
      "adb-failed",
      text || result.error.message || `adb ${args.join(" ")} failed`,
      { cause: result.error }
    );
  }
  if (result.status !== 0) {
    throw new AppManagementError(
      "adb-failed",
      text || `adb ${args.join(" ")} failed`
    );
  }
  return { ok: true, output: text };
}
function adbHost(serial, args, timeout = 3e4, signal, runExec = execText) {
  return adb2(serial, args, timeout, signal, runExec);
}
function validate(value, name, pattern) {
  if (typeof value !== "string" || !pattern.test(value.trim())) {
    throw new Error(`${name} is invalid`);
  }
  return value.trim();
}
function packageName(value) {
  return validate(value, "packageName", PACKAGE_RE);
}
function activityName(value) {
  return validate(value, "activity", ACTIVITY_RE);
}
function permissionName(value) {
  return validate(value, "permission", PERMISSION_RE);
}
async function installApk(serial, file, signal, dependencies = {}) {
  if (!file.filename.toLowerCase().endsWith(".apk")) {
    throw new Error("APK file must end with .apk");
  }
  return adb2(
    serial,
    ["install", "-r", file.path],
    12e4,
    signal,
    dependencies.execText
  );
}
function safeFileName(name, fallback) {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean && clean !== "." && clean !== ".." ? clean : fallback;
}
function mediaKind(file) {
  if (file.mediaType.startsWith("image/")) return "image";
  if (file.mediaType.startsWith("video/")) return "video";
  const lower = file.filename.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|heif)$/.test(lower)) return "image";
  if (/\.(mp4|m4v|mov|webm|3gp|mkv)$/.test(lower)) return "video";
  return "file";
}
async function importMediaFile(serial, file, signal, dependencies = {}) {
  const uploadId = dependencies.uploadId?.() ?? randomBytes(6).toString("hex");
  const filename = safeFileName(file.filename, `upload-${uploadId}`);
  const kind = mediaKind(file);
  const remoteDir = kind === "image" ? "/sdcard/Pictures" : kind === "video" ? "/sdcard/Movies" : "/sdcard/Download";
  const remotePath = `${remoteDir}/${filename}`;
  const partialPath = `${remoteDir}/.serve-emu-${uploadId}-${filename}.part`;
  const runExec = dependencies.execText;
  let committed = false;
  let operationFailure;
  try {
    await adb2(
      serial,
      ["shell", "mkdir", "-p", remoteDir],
      3e4,
      signal,
      runExec
    );
    await adbHost(
      serial,
      ["push", file.path, partialPath],
      12e4,
      signal,
      runExec
    );
    await adb2(
      serial,
      ["shell", "mv", "-f", partialPath, remotePath],
      3e4,
      signal,
      runExec
    );
    committed = true;
    await adb2(serial, [
      "shell",
      "am",
      "broadcast",
      "-a",
      "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
      "-d",
      `file://${remotePath}`
    ], 3e4, signal, runExec);
    return {
      ok: true,
      output: `Imported ${file.filename} to ${remotePath}`,
      path: remotePath,
      kind
    };
  } catch (error) {
    operationFailure = error;
    throw error;
  } finally {
    if (!committed) {
      try {
        await adb2(
          serial,
          ["shell", "rm", "-f", partialPath],
          5e3,
          void 0,
          runExec
        );
      } catch (cleanupError) {
        throw new AppManagementError(
          "adb-cleanup-failed",
          `failed to remove partial upload ${partialPath}`,
          {
            cause: new AggregateError(
              [operationFailure, cleanupError].filter(
                (error) => error !== void 0
              )
            )
          }
        );
      }
    }
  }
}
function launchApp(serial, packageNameValue, activity, dependencies = {}) {
  const pkg = packageName(packageNameValue);
  if (activity) {
    const act = activityName(activity);
    const component = act.includes("/") ? act : `${pkg}/${act}`;
    return adb2(
      serial,
      ["shell", "am", "start", "-n", component],
      3e4,
      void 0,
      dependencies.execText
    );
  }
  return adb2(
    serial,
    [
      "shell",
      "monkey",
      "-p",
      pkg,
      "-c",
      "android.intent.category.LAUNCHER",
      "1"
    ],
    3e4,
    void 0,
    dependencies.execText
  );
}
function clearAppData(serial, packageNameValue, dependencies = {}) {
  return adb2(
    serial,
    ["shell", "pm", "clear", packageName(packageNameValue)],
    3e4,
    void 0,
    dependencies.execText
  );
}
function forceStopApp(serial, packageNameValue, dependencies = {}) {
  return adb2(
    serial,
    ["shell", "am", "force-stop", packageName(packageNameValue)],
    3e4,
    void 0,
    dependencies.execText
  );
}
function grantPermission(serial, packageNameValue, permissionValue, dependencies = {}) {
  return adb2(
    serial,
    [
      "shell",
      "pm",
      "grant",
      packageName(packageNameValue),
      permissionName(permissionValue)
    ],
    3e4,
    void 0,
    dependencies.execText
  );
}

// runtimes/serve-emu/src/api/routes/applications.ts
function applicationRoutes() {
  return [
    {
      method: "POST",
      path: "/api/apps/install",
      handler: async ({ request: req, deps }) => {
        const { installEndpoint, requestContext } = deps;
        return installEndpoint(requestContext, req);
      }
    },
    {
      method: "POST",
      path: "/api/files/import",
      handler: async ({ request: req, deps }) => {
        const { fileImportEndpoint, requestContext } = deps;
        return fileImportEndpoint(requestContext, req);
      }
    },
    {
      method: "POST",
      path: "/api/apps/launch",
      handler: async ({ request: req, deps }) => {
        const { appJsonEndpoint, requestContext } = deps;
        return appJsonEndpoint(
          requestContext,
          req,
          (payload) => launchApp(
            requestContext.serial,
            String(payload.packageName ?? ""),
            typeof payload.activity === "string" && payload.activity.trim() ? payload.activity : void 0
          )
        );
      }
    },
    {
      method: "POST",
      path: "/api/apps/clear",
      handler: async ({ request: req, deps }) => {
        const { appJsonEndpoint, requestContext } = deps;
        return appJsonEndpoint(
          requestContext,
          req,
          (payload) => clearAppData(
            requestContext.serial,
            String(payload.packageName ?? "")
          )
        );
      }
    },
    {
      method: "POST",
      path: "/api/apps/force-stop",
      handler: async ({ request: req, deps }) => {
        const { appJsonEndpoint, requestContext } = deps;
        return appJsonEndpoint(
          requestContext,
          req,
          (payload) => forceStopApp(
            requestContext.serial,
            String(payload.packageName ?? "")
          )
        );
      }
    },
    {
      method: "POST",
      path: "/api/apps/grant",
      handler: async ({ request: req, deps }) => {
        const { appJsonEndpoint, requestContext } = deps;
        return appJsonEndpoint(
          requestContext,
          req,
          (payload) => grantPermission(
            requestContext.serial,
            String(payload.packageName ?? ""),
            String(payload.permission ?? "")
          )
        );
      }
    }
  ];
}

// runtimes/serve-emu/src/api/routes/devices.ts
function deviceRoutes() {
  return [
    {
      method: "GET",
      path: "/api",
      handler: async ({ deps }) => {
        const { requestContext } = deps;
        return Response.json({
          generation: requestContext.generation,
          serial: requestContext.serial,
          device: requestContext.scrcpy.meta.deviceName,
          codec: requestContext.scrcpy.meta.codecId,
          size: {
            width: requestContext.screen.width,
            height: requestContext.screen.height
          },
          status: requestContext.status,
          clients: requestContext.clients.size
        });
      }
    },
    {
      method: "GET",
      path: "/api/devices",
      handler: async ({ deps }) => {
        const {
          runForPublishedContext,
          requestContext,
          listDevices: listDevices2,
          errorResponse
        } = deps;
        try {
          const devices = await runForPublishedContext(
            requestContext,
            () => listDevices2()
          );
          return Response.json({
            ok: true,
            currentSerial: requestContext.serial,
            devices: devices.map((device) => ({
              ...device,
              current: device.serial === requestContext.serial
            }))
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/device-grid",
      handler: async ({ deps }) => {
        const { deviceGrid, requestContext, errorResponse } = deps;
        try {
          return Response.json(await deviceGrid(requestContext));
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/devices/select",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2,
          requestContext,
          switchSession,
          errorResponse
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext,
            false
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("select payload must be an object");
          }
          const serial = payload.serial;
          if (typeof serial !== "string" || !serial.trim()) {
            throw new Error("serial is required");
          }
          return Response.json(await switchSession(serial.trim()));
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/avds/start",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2,
          requestContext,
          launchEmulator,
          sessions,
          switchSession,
          errorResponse
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext,
            false
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("start payload must be an object");
          }
          const avd = payload.avd;
          if (typeof avd !== "string" || !avd.trim())
            throw new Error("avd is required");
          const launch = await launchEmulator({ avd: avd.trim() });
          try {
            sessions.assertPublished(requestContext);
          } catch (err) {
            launch.stop();
            throw err;
          }
          const select = payload.select !== false;
          if (select) {
            try {
              const switched = await switchSession(launch.serial);
              return Response.json({ ...switched, avd: avd.trim() });
            } catch (err) {
              launch.stop();
              throw err;
            }
          }
          return Response.json({
            ok: true,
            serial: launch.serial,
            avd: avd.trim()
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/avds/stop",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2,
          requestContext,
          listActiveAvds,
          sessions,
          stopCurrentSession,
          killEmulator,
          errorResponse
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext,
            false
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("stop payload must be an object");
          }
          const body = payload;
          let serial = typeof body.serial === "string" ? body.serial.trim() : "";
          if (!serial && typeof body.avd === "string" && body.avd.trim()) {
            const running = await listActiveAvds();
            sessions.assertPublished(requestContext);
            serial = running.find((running2) => running2.avd === body.avd)?.serial ?? "";
          }
          if (!serial) throw new Error("serial or running avd is required");
          if (!/^emulator-\d+$/.test(serial))
            throw new Error(`${serial} is not an emulator`);
          if (serial === requestContext.serial) {
            await stopCurrentSession(
              requestContext,
              "current emulator stopped"
            );
          }
          await killEmulator(serial);
          sessions.assertPublished(requestContext);
          return Response.json({ ok: true, serial });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/orientation",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            orientation: await runForContext(
              requestContext,
              (context) => getUserRotation(context.serial)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/orientation",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("orientation payload must be an object");
          }
          const orientation = payload.orientation;
          if (orientation !== "auto" && orientation !== "portrait" && orientation !== "landscape") {
            throw new Error("orientation must be auto, portrait, or landscape");
          }
          return Response.json({
            ok: true,
            orientation: await runForContext(
              requestContext,
              (context) => setUserRotation(context.serial, orientation)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/night-mode",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            nightMode: await runForContext(
              requestContext,
              (context) => getNightMode(context.serial)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/night-mode",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("night mode payload must be an object");
          }
          const mode = payload.mode;
          if (mode !== "dark" && mode !== "light" && mode !== "auto") {
            throw new Error("mode must be dark, light, or auto");
          }
          return Response.json({
            ok: true,
            nightMode: await runForContext(
              requestContext,
              (context) => setNightMode(context.serial, mode)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/font-scale",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            fontScale: await runForContext(
              requestContext,
              (context) => getFontScale(context.serial)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/font-scale",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("font scale payload must be an object");
          }
          const scale = Number(payload.scale);
          if (!Number.isFinite(scale) || scale < 0.7 || scale > 2) {
            throw new Error("scale must be a number between 0.7 and 2.0");
          }
          return Response.json({
            ok: true,
            fontScale: await runForContext(
              requestContext,
              (context) => setFontScale(context.serial, scale)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/network",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            network: await runForContext(
              requestContext,
              (context) => getNetworkStatus(context.serial)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/network",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("network payload must be an object");
          }
          const enabled = payload.enabled;
          if (typeof enabled !== "boolean") {
            throw new Error("enabled must be a boolean");
          }
          return Response.json({
            ok: true,
            network: await runForContext(
              requestContext,
              (context) => setNetworkEnabled(context.serial, enabled)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    }
  ];
}

// runtimes/serve-emu/src/api/routes/input.ts
function inputRoutes() {
  return [
    {
      method: "POST",
      path: "/api/tap",
      handler: async ({ request: req, deps }) => {
        const { gestureEndpoint, requestContext } = deps;
        return gestureEndpoint(requestContext, req, "tap", "rest:tap");
      }
    },
    {
      method: "POST",
      path: "/api/swipe",
      handler: async ({ request: req, deps }) => {
        const { gestureEndpoint, requestContext } = deps;
        return gestureEndpoint(requestContext, req, "swipe", "rest:swipe");
      }
    },
    {
      method: "POST",
      path: "/api/text",
      handler: async ({ request: req, deps }) => {
        const { gestureEndpoint, requestContext } = deps;
        return gestureEndpoint(requestContext, req, "text", "rest:text");
      }
    },
    {
      method: "POST",
      path: "/api/key",
      handler: async ({ request: req, deps }) => {
        const { keyEndpoint, requestContext } = deps;
        return keyEndpoint(requestContext, req);
      }
    }
  ];
}

// runtimes/serve-emu/src/app-info.ts
async function adbShell(serial, args, timeout = 4e3, runExec = execText) {
  const result = await runExec("adb", ["-s", serial, "shell", ...args], { timeout });
  if (result.status !== 0 || result.error) {
    throw new Error(
      (result.stderr || result.error?.message || result.stdout || `adb shell ${args.join(" ")} failed`).trim(),
      { cause: result.error ?? void 0 }
    );
  }
  return result.stdout;
}
function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}
function parseComponent(value) {
  const clean = value.trim().replace(/^\{|\}$/g, "");
  const component = clean.split(/\s+/).find((part) => part.includes("/")) ?? clean;
  const [packageName2, activityRaw] = component.split("/", 2);
  if (!packageName2 || !/^[A-Za-z0-9_.]+$/.test(packageName2)) return null;
  const activity = activityRaw ? activityRaw.startsWith(".") ? `${packageName2}${activityRaw}` : activityRaw : null;
  return { packageName: packageName2, activity };
}
async function foregroundComponent(serial, runExec) {
  const windowDump = await adbShell(serial, ["dumpsys", "window"], 5e3, runExec);
  const windowMatch = firstMatch(windowDump, [
    /mCurrentFocus=Window\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\}/,
    /mFocusedApp=ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/,
    /mInputMethodTarget=Window\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\}/
  ]);
  if (windowMatch?.[1]) {
    const parsed = parseComponent(windowMatch[1]);
    if (parsed) return parsed;
  }
  const activityDump = await adbShell(
    serial,
    ["dumpsys", "activity", "activities"],
    5e3,
    runExec
  );
  const activityMatch = firstMatch(activityDump, [
    /topResumedActivity=ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/,
    /mResumedActivity: ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/,
    /ResumedActivity: ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/
  ]);
  return activityMatch?.[1] ? parseComponent(activityMatch[1]) : null;
}
async function packagePid(serial, packageName2, runExec) {
  try {
    const out = (await adbShell(serial, ["pidof", packageName2], 2e3, runExec)).trim();
    const first = out.split(/\s+/)[0];
    const pid = first ? Number(first) : NaN;
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}
async function packageDetails(serial, packageName2, runExec) {
  try {
    const dump = await adbShell(
      serial,
      ["dumpsys", "package", packageName2],
      5e3,
      runExec
    );
    const versionName = dump.match(/versionName=([^\s]+)/)?.[1] ?? null;
    const versionCode = dump.match(/versionCode=(\d+)/)?.[1] ?? null;
    const label = dump.match(/application-label(?:-[a-zA-Z]+)?:'([^']+)'/)?.[1] ?? dump.match(/labelRes=0x[0-9a-fA-F]+ nonLocalizedLabel=([^\n]+)/)?.[1]?.trim() ?? null;
    const debuggable = /pkgFlags=\[[^\]]*\bDEBUGGABLE\b/.test(dump) || /\bDEBUGGABLE\b/.test(dump);
    return { label, versionName, versionCode, debuggable };
  } catch {
    return { label: null, versionName: null, versionCode: null, debuggable: null };
  }
}
async function getForegroundApp(serial, runExec = execText) {
  const component = await foregroundComponent(serial, runExec);
  if (!component) {
    return {
      packageName: null,
      activity: null,
      pid: null,
      label: null,
      versionName: null,
      versionCode: null,
      debuggable: null
    };
  }
  const [details, pid] = await Promise.all([
    packageDetails(serial, component.packageName, runExec),
    packagePid(serial, component.packageName, runExec)
  ]);
  return {
    packageName: component.packageName,
    activity: component.activity,
    pid,
    ...details
  };
}

// runtimes/serve-emu/src/api/routes/inspection.ts
function inspectionRoutes() {
  return [
    {
      method: "GET",
      path: "/api/logcat",
      handler: async ({ request: req, url, deps }) => {
        const { sessions, requestContext, srv, logcatStream, errorResponse } = deps;
        try {
          sessions.assertCurrent(requestContext);
          srv.timeout(req, 0);
          return logcatStream(requestContext, req, url);
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/screenshot",
      handler: async ({ url, deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          const png = await runForContext(
            requestContext,
            (context) => screencapPng(context.serial)
          );
          if (url.searchParams.get("format") === "base64") {
            return Response.json({
              ok: true,
              mimeType: "image/png",
              data: png.toString("base64")
            });
          }
          return new Response(new Uint8Array(png), {
            headers: { "Content-Type": "image/png" }
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/screenshot",
      handler: async ({ url, deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          const png = await runForContext(
            requestContext,
            (context) => screencapPng(context.serial)
          );
          if (url.searchParams.get("format") === "base64") {
            return Response.json({
              ok: true,
              mimeType: "image/png",
              data: png.toString("base64")
            });
          }
          return new Response(new Uint8Array(png), {
            headers: { "Content-Type": "image/png" }
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/foreground",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            app: await runForContext(
              requestContext,
              (context) => getForegroundApp(context.serial)
            )
          });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/accessibility",
      handler: async ({ deps }) => {
        const { readAccessibilitySnapshot, requestContext, errorResponse } = deps;
        try {
          return Response.json(await readAccessibilitySnapshot(requestContext));
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "POST",
      path: "/api/accessibility/tap",
      handler: async ({ request: req, deps }) => {
        const { accessibilityTapEndpoint, requestContext } = deps;
        return accessibilityTapEndpoint(requestContext, req);
      }
    }
  ];
}

// runtimes/serve-emu/src/control-input-queue.ts
import { setTimeout as sleep3 } from "node:timers/promises";

// runtimes/serve-emu/src/input.ts
var TYPE_INJECT_KEYCODE = 0;
var TYPE_INJECT_TEXT = 1;
var TYPE_INJECT_TOUCH = 2;
var TYPE_BACK_OR_SCREEN_ON = 4;
var TYPE_RESET_VIDEO = 17;
function resetVideoPacket() {
  return RESET_VIDEO_PACKET;
}
var ACTION_DOWN = 0;
var ACTION_UP = 1;
var ACTION_MOVE = 2;
var KEY = {
  home: 3,
  recents: 187,
  power: 26
};
var PRIMARY_POINTER_ID = 0n;
var PRESSURE_FULL = 65535;
var BUTTON_PRIMARY = 1;
var RESET_VIDEO_PACKET = Buffer.from([TYPE_RESET_VIDEO]);
var MAX_TEXT_BYTES = 300;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}
function unitNumber(value, name) {
  const n = finiteNumber(value, name);
  if (n < 0 || n > 1) throw new Error(`${name} must be between 0 and 1`);
  return n;
}
function optionalDurationMs(value) {
  if (value === void 0) return void 0;
  const n = finiteNumber(value, "durationMs");
  if (n < 0 || n > 1e4) throw new Error("durationMs must be between 0 and 10000");
  return n;
}
function optionalPointerId(value) {
  if (value === void 0) return void 0;
  const n = finiteNumber(value, "pointerId");
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new Error("pointerId must be a non-negative safe integer");
  }
  return n;
}
function keycode(value) {
  const n = finiteNumber(value, "keycode");
  if (!Number.isInteger(n) || n < 0 || n > 1e4) {
    throw new Error("keycode must be an integer between 0 and 10000");
  }
  return n;
}
function optionalKeyAction(value) {
  if (value === void 0) return void 0;
  if (value !== "down" && value !== "up") throw new Error("key action must be down or up");
  return value;
}
function optionalMetaState(value) {
  if (value === void 0) return void 0;
  const n = finiteNumber(value, "metaState");
  if (!Number.isInteger(n) || n < 0 || n > 2147483647) {
    throw new Error("metaState must be a non-negative 32-bit integer");
  }
  return n;
}
function textBytes(text) {
  const out = [];
  let total = 0;
  for (const char of text) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (total + bytes > MAX_TEXT_BYTES) break;
    out.push(char);
    total += bytes;
  }
  return Buffer.from(out.join(""), "utf8");
}
function normalizeTextForControl(text) {
  return textBytes(text).toString("utf8");
}
function normalizeGesture(gesture) {
  return parseGesture(gesture);
}
function parseGesture(value) {
  if (!isRecord2(value) || typeof value.type !== "string") {
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
        durationMs: optionalDurationMs(value.durationMs)
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
        pointerId: optionalPointerId(value.pointerId)
      };
    }
    case "key":
      return {
        type: "key",
        keycode: keycode(value.keycode),
        action: optionalKeyAction(value.action),
        metaState: optionalMetaState(value.metaState)
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
function touchPacket(action, x, y, screen, pointerId = PRIMARY_POINTER_ID) {
  const buf = Buffer.allocUnsafe(32);
  let o = 0;
  buf.writeUInt8(TYPE_INJECT_TOUCH, o);
  o += 1;
  buf.writeUInt8(action, o);
  o += 1;
  buf.writeBigUInt64BE(pointerId, o);
  o += 8;
  buf.writeInt32BE(Math.round(x), o);
  o += 4;
  buf.writeInt32BE(Math.round(y), o);
  o += 4;
  buf.writeUInt16BE(screen.width, o);
  o += 2;
  buf.writeUInt16BE(screen.height, o);
  o += 2;
  buf.writeUInt16BE(action === ACTION_UP ? 0 : PRESSURE_FULL, o);
  o += 2;
  buf.writeUInt32BE(BUTTON_PRIMARY, o);
  o += 4;
  buf.writeUInt32BE(action === ACTION_UP ? 0 : BUTTON_PRIMARY, o);
  o += 4;
  return buf;
}
function keyPacket(action, keycode3, metaState = 0) {
  const buf = Buffer.allocUnsafe(14);
  let o = 0;
  buf.writeUInt8(TYPE_INJECT_KEYCODE, o);
  o += 1;
  buf.writeUInt8(action, o);
  o += 1;
  buf.writeInt32BE(keycode3, o);
  o += 4;
  buf.writeInt32BE(0, o);
  o += 4;
  buf.writeInt32BE(metaState, o);
  o += 4;
  return buf;
}
function textPacket(text) {
  const bytes = textBytes(text);
  const len = bytes.length;
  const buf = Buffer.allocUnsafe(5 + len);
  buf.writeUInt8(TYPE_INJECT_TEXT, 0);
  buf.writeUInt32BE(len, 1);
  bytes.copy(buf, 5);
  return buf;
}
function backOrScreenOnPacket(action) {
  const buf = Buffer.allocUnsafe(2);
  buf.writeUInt8(TYPE_BACK_OR_SCREEN_ON, 0);
  buf.writeUInt8(action, 1);
  return buf;
}
function actionCode(a) {
  return a === "down" ? ACTION_DOWN : a === "up" ? ACTION_UP : ACTION_MOVE;
}
function validateScreen(screen) {
  if (!Number.isInteger(screen.width) || !Number.isInteger(screen.height) || screen.width <= 0 || screen.height <= 0 || screen.width > 65535 || screen.height > 65535) {
    throw new Error("screen width and height must be integers between 1 and 65535");
  }
  return { width: screen.width, height: screen.height };
}
function compileGesture(gesture, screenValue) {
  const normalized = normalizeGesture(gesture);
  const screen = validateScreen(screenValue);
  const px = (n) => n * screen.width;
  const py = (n) => n * screen.height;
  const steps = [];
  const append = (packet, delayMs = 0) => {
    steps.push({ delayMs, packet });
  };
  switch (normalized.type) {
    case "tap": {
      append(
        touchPacket(
          ACTION_DOWN,
          px(normalized.x),
          py(normalized.y),
          screen
        )
      );
      append(
        touchPacket(
          ACTION_UP,
          px(normalized.x),
          py(normalized.y),
          screen
        ),
        20
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
          screen
        )
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
          screen
        ),
        stepDelayMs
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
          BigInt(normalized.pointerId ?? 0)
        )
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
    bytes: steps.reduce((total, step) => total + step.packet.length, 0)
  };
}

// runtimes/serve-emu/src/control-input-queue.ts
var DEFAULT_CONTROL_QUEUE_MAX_DEPTH = 128;
var DEFAULT_CONTROL_QUEUE_MAX_BYTES = 1024 * 1024;
var ControlInputError = class extends Error {
  constructor(code, message, meta, options) {
    super(message, options);
    this.code = code;
    this.meta = meta;
    this.name = "ControlInputError";
  }
  code;
  meta;
};
function signalError(signal, fallback) {
  return signal.reason instanceof Error ? signal.reason : new ControlInputError("control-queue-closed", fallback);
}
var SocketControlWriter = class {
  constructor(socket) {
    this.socket = socket;
    socket.on("drain", this.#onDrain);
    socket.on("error", this.#onError);
    socket.on("close", this.#onClose);
    if (socket.destroyed || !socket.writable) {
      this.#failure = new ControlInputError(
        "control-writer-closed",
        "scrcpy control socket is not writable"
      );
    }
  }
  socket;
  #failure = null;
  #waiters = /* @__PURE__ */ new Set();
  async write(packet, signal) {
    if (signal.aborted) throw signalError(signal, "control write aborted");
    if (this.#failure) throw this.#failure;
    await new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
        },
        callbackDone: false,
        drained: false,
        needsDrain: false,
        writeReturned: false
      };
      waiter.onAbort = () => {
        if (!this.#waiters.delete(waiter)) return;
        signal.removeEventListener("abort", waiter.onAbort);
        reject(signalError(signal, "control write aborted"));
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.#waiters.add(waiter);
      if (this.#failure) {
        this.#rejectWaiter(waiter, this.#failure);
      } else if (signal.aborted) {
        waiter.onAbort();
      } else {
        try {
          const writable = this.socket.write(packet, (err) => {
            if (err) {
              this.#fail(
                new ControlInputError(
                  "control-writer-error",
                  `scrcpy control write failed: ${err.message}`,
                  void 0,
                  { cause: err }
                )
              );
              return;
            }
            waiter.callbackDone = true;
            this.#finishWaiterIfReady(waiter);
          });
          waiter.needsDrain = !writable;
          waiter.drained = writable;
          waiter.writeReturned = true;
          this.#finishWaiterIfReady(waiter);
        } catch (err) {
          this.#fail(
            new ControlInputError(
              "control-writer-error",
              `scrcpy control write failed: ${err instanceof Error ? err.message : String(err)}`,
              void 0,
              { cause: err }
            )
          );
        }
      }
    });
  }
  close(reason) {
    const failure = reason instanceof ControlInputError ? reason : new ControlInputError(
      "control-writer-closed",
      reason.message,
      void 0,
      { cause: reason }
    );
    this.#fail(failure);
  }
  #onDrain = () => {
    for (const waiter of Array.from(this.#waiters)) {
      waiter.drained = true;
      this.#finishWaiterIfReady(waiter);
    }
  };
  #onError = (err) => {
    this.#fail(
      new ControlInputError(
        "control-writer-error",
        `scrcpy control socket error: ${err.message}`,
        void 0,
        { cause: err }
      )
    );
  };
  #onClose = () => {
    this.#fail(
      new ControlInputError(
        "control-writer-closed",
        "scrcpy control socket closed"
      )
    );
  };
  #fail(failure) {
    if (!this.#failure) this.#failure = failure;
    for (const waiter of Array.from(this.#waiters)) {
      this.#rejectWaiter(waiter, this.#failure);
    }
  }
  #finishWaiterIfReady(waiter) {
    if (!waiter.writeReturned || !waiter.callbackDone || waiter.needsDrain && !waiter.drained) {
      return;
    }
    if (!this.#waiters.delete(waiter)) return;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve();
  }
  #rejectWaiter(waiter, reason) {
    if (!this.#waiters.delete(waiter)) return;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.reject(reason);
  }
};
var SYSTEM_CLOCK2 = {
  sleep: (ms, signal) => sleep3(ms, void 0, { signal })
};
var ControlInputQueue = class {
  #writer;
  #clock;
  #maxDepth;
  #maxBytes;
  #controller = new AbortController();
  #pending = [];
  #active = null;
  #depth = 0;
  #bytes = 0;
  #running = false;
  #scheduled = false;
  #closedError = null;
  #openPointers = /* @__PURE__ */ new Set();
  constructor(options) {
    if (Boolean(options.writer) === Boolean(options.socket)) {
      throw new Error("ControlInputQueue requires exactly one writer or socket");
    }
    this.#writer = options.writer ?? new SocketControlWriter(options.socket);
    this.#clock = options.clock ?? SYSTEM_CLOCK2;
    this.#maxDepth = positiveInteger(
      options.maxDepth ?? DEFAULT_CONTROL_QUEUE_MAX_DEPTH,
      "maxDepth"
    );
    this.#maxBytes = positiveInteger(
      options.maxBytes ?? DEFAULT_CONTROL_QUEUE_MAX_BYTES,
      "maxBytes"
    );
  }
  enqueue(gesture, screen) {
    this.#assertOpen();
    const compiled = compileGesture(gesture, { ...screen });
    const moveKey = compiled.gesture.type === "touch" && compiled.gesture.action === "move" ? `touch:${compiled.gesture.pointerId ?? 0}` : null;
    const pointerKey = compiled.gesture.type === "touch" ? `touch:${compiled.gesture.pointerId ?? 0}` : null;
    let nextReservedReleases = this.#openPointers.size;
    if (pointerKey && compiled.gesture.type === "touch" && compiled.gesture.action === "down" && !this.#openPointers.has(pointerKey)) {
      nextReservedReleases++;
    } else if (pointerKey && compiled.gesture.type === "touch" && compiled.gesture.action === "up" && this.#openPointers.has(pointerKey)) {
      nextReservedReleases--;
    }
    const waiter = this.#createWaiter();
    const tail = this.#pending.at(-1);
    if (moveKey && tail?.moveKey === moveKey) {
      this.#reserveCoalesced(tail, compiled.bytes);
      const previous = tail.waiters.at(-1);
      if (previous) previous.status = "coalesced";
      tail.steps = compiled.steps;
      tail.bytes = compiled.bytes;
      tail.gesture = compiled.gesture;
      tail.waiters.push(waiter.waiter);
      return { gesture: compiled.gesture, completion: waiter.promise };
    }
    this.#reserveNew(compiled.bytes, nextReservedReleases);
    if (pointerKey && compiled.gesture.type === "touch") {
      if (compiled.gesture.action === "down") {
        this.#openPointers.add(pointerKey);
      } else if (compiled.gesture.action === "up") {
        this.#openPointers.delete(pointerKey);
      }
    }
    this.#pending.push({
      steps: compiled.steps,
      bytes: compiled.bytes,
      gesture: compiled.gesture,
      moveKey,
      coalesceKey: null,
      waiters: [waiter.waiter]
    });
    this.#schedule();
    return { gesture: compiled.gesture, completion: waiter.promise };
  }
  enqueuePacket(packet, options = {}) {
    this.#assertOpen();
    if (!Buffer.isBuffer(packet) || packet.length === 0) {
      throw new Error("control packet must be a non-empty Buffer");
    }
    const bytes = packet.length;
    const coalesceKey = options.coalesceKey ?? null;
    const waiter = this.#createWaiter();
    const tail = this.#pending.at(-1);
    if (coalesceKey && tail?.coalesceKey === coalesceKey) {
      this.#reserveCoalesced(tail, bytes);
      const previous = tail.waiters.at(-1);
      if (previous) previous.status = "coalesced";
      tail.steps = [{ delayMs: 0, packet: Buffer.from(packet) }];
      tail.bytes = bytes;
      tail.waiters.push(waiter.waiter);
      return { completion: waiter.promise };
    }
    this.#reserveNew(bytes);
    this.#pending.push({
      steps: [{ delayMs: 0, packet: Buffer.from(packet) }],
      bytes,
      gesture: null,
      moveKey: null,
      coalesceKey,
      waiters: [waiter.waiter]
    });
    this.#schedule();
    return { completion: waiter.promise };
  }
  close(reason = new Error("control input queue closed")) {
    if (this.#closedError) return;
    this.#closedError = reason instanceof ControlInputError ? reason : new ControlInputError(
      "control-queue-closed",
      reason.message,
      void 0,
      { cause: reason }
    );
    this.#controller.abort(this.#closedError);
    this.#writer.close?.(this.#closedError);
    this.#openPointers.clear();
    const pending = this.#pending;
    this.#pending = [];
    for (const entry of pending) {
      this.#rejectEntry(entry, this.#closedError);
      this.#release(entry);
    }
  }
  snapshot() {
    return {
      closed: this.#closedError !== null,
      depth: this.#depth,
      bytes: this.#bytes,
      entries: this.#pending.length + (this.#active ? 1 : 0),
      active: this.#active !== null,
      reservedReleases: this.#openPointers.size,
      maxDepth: this.#maxDepth,
      maxBytes: this.#maxBytes
    };
  }
  assertOpen() {
    this.#assertOpen();
  }
  #assertOpen() {
    if (this.#closedError) throw this.#closedError;
  }
  #createWaiter() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      promise,
      waiter: { status: "completed", resolve, reject }
    };
  }
  #reserveNew(bytes, reservedReleases = this.#openPointers.size) {
    this.#assertCapacity(
      this.#depth + 1,
      this.#bytes + bytes,
      reservedReleases
    );
    this.#depth++;
    this.#bytes += bytes;
  }
  #reserveCoalesced(entry, bytes) {
    const nextBytes = this.#bytes - entry.bytes + bytes;
    this.#assertCapacity(
      this.#depth + 1,
      nextBytes,
      this.#openPointers.size
    );
    this.#depth++;
    this.#bytes = nextBytes;
  }
  #assertCapacity(depth, bytes, reservedReleases) {
    if (depth + reservedReleases <= this.#maxDepth && bytes + reservedReleases * 32 <= this.#maxBytes) {
      return;
    }
    throw new ControlInputError(
      "control-queue-overloaded",
      "scrcpy control input queue is full",
      {
        depth: this.#depth,
        bytes: this.#bytes,
        maxDepth: this.#maxDepth,
        maxBytes: this.#maxBytes
      }
    );
  }
  #schedule() {
    if (this.#scheduled || this.#running || this.#closedError) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.#pump();
    });
  }
  async #pump() {
    if (this.#running || this.#closedError) return;
    this.#running = true;
    try {
      while (!this.#closedError && this.#pending.length > 0) {
        const entry = this.#pending.shift();
        this.#active = entry;
        try {
          await this.#dispatch(entry.steps);
          if (this.#controller.signal.aborted) {
            throw signalError(
              this.#controller.signal,
              "control input queue closed"
            );
          }
          for (const waiter of entry.waiters) {
            waiter.resolve({ status: waiter.status });
          }
        } catch (err) {
          const failure = this.#controller.signal.aborted ? signalError(
            this.#controller.signal,
            "control input queue closed"
          ) : err instanceof ControlInputError ? err : new ControlInputError(
            "control-dispatch-failed",
            `scrcpy control dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
            void 0,
            { cause: err }
          );
          this.#rejectEntry(entry, failure);
          this.#release(entry);
          this.#active = null;
          this.close(failure);
          return;
        }
        this.#release(entry);
        this.#active = null;
      }
    } finally {
      this.#running = false;
      if (!this.#closedError && this.#pending.length > 0) this.#schedule();
    }
  }
  async #dispatch(steps) {
    for (const step of steps) {
      if (this.#controller.signal.aborted) {
        throw signalError(
          this.#controller.signal,
          "control input queue closed"
        );
      }
      if (step.delayMs > 0) {
        await this.#clock.sleep(step.delayMs, this.#controller.signal);
      }
      if (this.#controller.signal.aborted) {
        throw signalError(
          this.#controller.signal,
          "control input queue closed"
        );
      }
      await this.#writer.write(step.packet, this.#controller.signal);
      if (this.#controller.signal.aborted) {
        throw signalError(
          this.#controller.signal,
          "control input queue closed"
        );
      }
    }
  }
  #rejectEntry(entry, reason) {
    for (const waiter of entry.waiters) waiter.reject(reason);
  }
  #release(entry) {
    this.#depth -= entry.waiters.length;
    this.#bytes -= entry.bytes;
  }
};
function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

// runtimes/serve-emu/src/frame-stat-window.ts
var FrameStatWindow = class {
  #capacity;
  #intervalsMs;
  #sizes;
  #isKey;
  #idx = 0;
  #count = 0;
  #lastFrameMs = 0;
  constructor(capacity) {
    this.#capacity = capacity;
    this.#intervalsMs = new Float64Array(capacity);
    this.#sizes = new Uint32Array(capacity);
    this.#isKey = new Uint8Array(capacity);
  }
  record(bytes, isKey, nowMs = performance.now()) {
    this.#intervalsMs[this.#idx] = this.#lastFrameMs > 0 ? nowMs - this.#lastFrameMs : 0;
    this.#sizes[this.#idx] = bytes;
    this.#isKey[this.#idx] = isKey ? 1 : 0;
    this.#idx = (this.#idx + 1) % this.#capacity;
    if (this.#count < this.#capacity) this.#count++;
    this.#lastFrameMs = nowMs;
  }
  reset() {
    this.#idx = 0;
    this.#count = 0;
    this.#lastFrameMs = 0;
  }
  summary() {
    if (this.#count === 0) return null;
    const intervals = [];
    let keyBytes = 0;
    let keyFrames = 0;
    let deltaBytes = 0;
    let deltaFrames = 0;
    for (let i = 0; i < this.#count; i++) {
      if (this.#intervalsMs[i] > 0) intervals.push(this.#intervalsMs[i]);
      if (this.#isKey[i]) {
        keyBytes += this.#sizes[i];
        keyFrames++;
      } else {
        deltaBytes += this.#sizes[i];
        deltaFrames++;
      }
    }
    intervals.sort((a, b) => a - b);
    const at = (q) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * q))];
    const round1 = (n) => Math.round(n * 10) / 10;
    return {
      windowFrames: this.#count,
      intervalMs: intervals.length > 0 ? { p50: round1(at(0.5)), p95: round1(at(0.95)), max: round1(intervals[intervals.length - 1]) } : null,
      avgKeyFrameBytes: keyFrames > 0 ? Math.round(keyBytes / keyFrames) : null,
      avgDeltaFrameBytes: deltaFrames > 0 ? Math.round(deltaBytes / deltaFrames) : null,
      keyFramesInWindow: keyFrames
    };
  }
};

// runtimes/serve-emu/src/logcat.ts
import {
  spawn as spawn4
} from "node:child_process";
import { StringDecoder } from "node:string_decoder";
var DEFAULT_MAX_LOGCAT_SUBSCRIBERS = 8;
var DEFAULT_LOGCAT_BATCH_INTERVAL_MS = 75;
var DEFAULT_LOGCAT_QUEUE_LINES = 256;
var DEFAULT_LOGCAT_QUEUE_BYTES = 256 * 1024;
var DEFAULT_LOGCAT_MAX_LINE_BYTES = 16 * 1024;
var DEFAULT_LOGCAT_PID_REFRESH_MS = 5e3;
var DEFAULT_LOGCAT_TERMINATION_GRACE_MS = 1e3;
var LOGCAT_PID_LOOKUP_TIMEOUT_MS = 2e3;
var LOGCAT_PID_LOOKUP_MAX_OUTPUT_BYTES = 64 * 1024;
var SYSTEM_CLOCK3 = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer)
};
function positiveInteger2(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}
async function resolvePackagePids(serial, packageName2, signal) {
  if (!/^[A-Za-z0-9_.:-]+$/.test(packageName2) || signal.aborted) {
    return /* @__PURE__ */ new Set();
  }
  return new Promise((resolve) => {
    let child;
    let timer = null;
    let outputBytes = 0;
    let failed = false;
    let killRequested = false;
    const stdoutChunks = [];
    const kill = () => {
      failed = true;
      if (killRequested) return;
      killRequested = true;
      try {
        child.kill("SIGKILL");
      } catch {
      }
    };
    const onAbort = () => kill();
    const collect = (target, value) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (chunk.byteLength > LOGCAT_PID_LOOKUP_MAX_OUTPUT_BYTES - outputBytes) {
        kill();
        return;
      }
      outputBytes += chunk.byteLength;
      if (target === "stdout") stdoutChunks.push(chunk);
    };
    const finish = (status) => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (failed || status !== 0) {
        resolve(/* @__PURE__ */ new Set());
        return;
      }
      resolve(
        new Set(
          Buffer.concat(stdoutChunks).toString("utf8").trim().split(/\s+/).filter(Boolean)
        )
      );
    };
    try {
      child = spawn4(
        "adb",
        ["-s", serial, "shell", "pidof", packageName2],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch {
      resolve(/* @__PURE__ */ new Set());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(kill, LOGCAT_PID_LOOKUP_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      collect("stdout", chunk);
    });
    child.stderr.on("data", (chunk) => {
      collect("stderr", chunk);
    });
    child.once("error", () => {
      failed = true;
    });
    child.stdout.once("error", kill);
    child.stderr.once("error", kill);
    child.once("close", (status) => finish(status));
    if (signal.aborted) onAbort();
  });
}
function spawnLogcat(serial) {
  return spawn4(
    "adb",
    ["-s", serial, "logcat", "-T", "1", "-v", "threadtime"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
}
function encodeEvent(event, value) {
  return new TextEncoder().encode(
    `event: ${event}
data: ${JSON.stringify(value)}

`
  );
}
var BoundedLineQueue = class {
  constructor(maxLines, maxBytes) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
  }
  maxLines;
  maxBytes;
  #entries = [];
  #head = 0;
  #bytes = 0;
  #droppedSinceFlush = 0;
  get lineCount() {
    return this.#entries.length - this.#head;
  }
  get byteCount() {
    return this.#bytes;
  }
  push(value) {
    const bytes = Buffer.byteLength(value.line, "utf8") + Buffer.byteLength(value.at, "utf8");
    let dropped = 0;
    if (bytes > this.maxBytes) {
      this.#droppedSinceFlush++;
      return 1;
    }
    while (this.lineCount >= this.maxLines || this.#bytes + bytes > this.maxBytes) {
      const entry = this.#entries[this.#head++];
      if (!entry) break;
      this.#bytes -= entry.bytes;
      dropped++;
    }
    if (this.#head >= 64) {
      this.#entries = this.#entries.slice(this.#head);
      this.#head = 0;
    }
    this.#entries.push({ value, bytes });
    this.#bytes += bytes;
    this.#droppedSinceFlush += dropped;
    return dropped;
  }
  drain() {
    const lines = this.#entries.slice(this.#head).map((entry) => entry.value);
    const dropped = this.#droppedSinceFlush;
    this.#entries = [];
    this.#head = 0;
    this.#bytes = 0;
    this.#droppedSinceFlush = 0;
    return { lines, dropped };
  }
};
var LogcatHub = class {
  serial;
  #maxSubscribers;
  #batchIntervalMs;
  #maxQueueLines;
  #maxQueueBytes;
  #maxSourceLineBytes;
  #pidRefreshMs;
  #terminationGraceMs;
  #spawn;
  #resolvePackagePids;
  #now;
  #clock;
  #subscribers = /* @__PURE__ */ new Map();
  #decoder = new StringDecoder("utf8");
  #totals = {
    childStarts: 0,
    forcedKills: 0,
    batches: 0,
    deliveredLines: 0,
    droppedLines: 0,
    sourceDroppedLines: 0
  };
  #nextSubscriberId = 1;
  #child = null;
  #terminatingChild = null;
  #terminationTimer = null;
  #lineBuffer = "";
  #discardingLongLine = false;
  #activePidLookups = 0;
  #closed = false;
  #lastError = null;
  constructor(serial, options = {}) {
    if (!serial) throw new TypeError("serial must not be empty");
    this.serial = serial;
    this.#maxSubscribers = positiveInteger2(
      options.maxSubscribers ?? DEFAULT_MAX_LOGCAT_SUBSCRIBERS,
      "maxSubscribers"
    );
    this.#batchIntervalMs = positiveInteger2(
      options.batchIntervalMs ?? DEFAULT_LOGCAT_BATCH_INTERVAL_MS,
      "batchIntervalMs"
    );
    this.#maxQueueLines = positiveInteger2(
      options.maxQueueLines ?? DEFAULT_LOGCAT_QUEUE_LINES,
      "maxQueueLines"
    );
    this.#maxQueueBytes = positiveInteger2(
      options.maxQueueBytes ?? DEFAULT_LOGCAT_QUEUE_BYTES,
      "maxQueueBytes"
    );
    this.#maxSourceLineBytes = positiveInteger2(
      options.maxSourceLineBytes ?? DEFAULT_LOGCAT_MAX_LINE_BYTES,
      "maxSourceLineBytes"
    );
    this.#pidRefreshMs = positiveInteger2(
      options.pidRefreshMs ?? DEFAULT_LOGCAT_PID_REFRESH_MS,
      "pidRefreshMs"
    );
    this.#terminationGraceMs = positiveInteger2(
      options.terminationGraceMs ?? DEFAULT_LOGCAT_TERMINATION_GRACE_MS,
      "terminationGraceMs"
    );
    this.#spawn = options.dependencies?.spawn ?? spawnLogcat;
    this.#resolvePackagePids = options.dependencies?.resolvePackagePids ?? resolvePackagePids;
    this.#now = options.dependencies?.now ?? (() => /* @__PURE__ */ new Date());
    this.#clock = options.dependencies?.clock ?? SYSTEM_CLOCK3;
  }
  subscribe(options, signal) {
    if (this.#closed) {
      return Response.json(
        { ok: false, code: "logcat-session-closed", error: "logcat session is closed" },
        { status: 409 }
      );
    }
    if (signal?.aborted) {
      return Response.json(
        { ok: false, code: "logcat-request-aborted", error: "request was aborted" },
        { status: 499 }
      );
    }
    if (this.#subscribers.size >= this.#maxSubscribers) {
      return Response.json(
        {
          ok: false,
          code: "logcat-subscriber-limit",
          error: `logcat subscriber limit is ${this.#maxSubscribers}`
        },
        { status: 429 }
      );
    }
    try {
      this.#ensureChild();
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: "logcat-start-failed",
          error: error instanceof Error ? error.message : String(error)
        },
        { status: 502 }
      );
    }
    const packageName2 = (options.packageName ?? "").trim();
    const search = (options.search ?? "").trim().toLowerCase();
    let subscriber;
    const stream = new ReadableStream({
      start: (controller) => {
        subscriber = {
          id: this.#nextSubscriberId++,
          active: true,
          packageName: packageName2,
          search,
          pids: /* @__PURE__ */ new Set(),
          controller,
          queue: new BoundedLineQueue(
            this.#maxQueueLines,
            this.#maxQueueBytes
          ),
          totalDropped: 0,
          sourceDroppedReported: this.#totals.sourceDroppedLines,
          batchTimer: null,
          waitingForPull: false,
          pidTimer: null,
          pidRefresh: null,
          pidAbort: null,
          signal,
          abortListener: null
        };
        this.#subscribers.set(subscriber.id, subscriber);
        this.#sendControl(subscriber, "ready", {
          serial: this.serial,
          package: packageName2 || null,
          search: search || null,
          batchIntervalMs: this.#batchIntervalMs
        });
        if (packageName2) {
          this.#refreshPids(subscriber);
          subscriber.pidTimer = this.#clock.setInterval(
            () => this.#refreshPids(subscriber),
            this.#pidRefreshMs
          );
        }
        if (signal) {
          const onAbort = () => this.#removeSubscriber(subscriber, true);
          subscriber.abortListener = onAbort;
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        }
      },
      pull: () => {
        if (!subscriber?.active) return;
        subscriber.waitingForPull = false;
        this.#flush(subscriber);
      },
      cancel: () => {
        if (subscriber) this.#removeSubscriber(subscriber);
      }
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  }
  close(reason = "device session closed") {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopChild();
    for (const subscriber of [...this.#subscribers.values()]) {
      this.#sendControl(subscriber, "close", { reason });
      this.#removeSubscriber(subscriber, true);
    }
  }
  snapshot() {
    let queuedLines = 0;
    let queuedBytes = 0;
    for (const subscriber of this.#subscribers.values()) {
      queuedLines += subscriber.queue.lineCount;
      queuedBytes += subscriber.queue.byteCount;
    }
    return {
      serial: this.serial,
      closed: this.#closed,
      childActive: this.#child !== null,
      childTerminating: this.#terminatingChild !== null,
      childCount: Number(this.#child !== null) + Number(this.#terminatingChild !== null),
      subscribers: this.#subscribers.size,
      activePidLookups: this.#activePidLookups,
      queuedLines,
      queuedBytes,
      limits: {
        subscribers: this.#maxSubscribers,
        queueLinesPerSubscriber: this.#maxQueueLines,
        queueBytesPerSubscriber: this.#maxQueueBytes,
        sourceLineBytes: this.#maxSourceLineBytes,
        batchIntervalMs: this.#batchIntervalMs,
        terminationGraceMs: this.#terminationGraceMs
      },
      totals: { ...this.#totals },
      lastError: this.#lastError
    };
  }
  #ensureChild() {
    if (this.#child || this.#terminatingChild) return;
    const child = this.#spawn(this.serial);
    this.#child = child;
    this.#decoder = new StringDecoder("utf8");
    this.#lineBuffer = "";
    this.#discardingLongLine = false;
    this.#totals.childStarts++;
    child.stdout.on("data", (chunk) => {
      if (this.#child !== child) return;
      this.#consumeSource(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (this.#child !== child) return;
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      const line = text.trim();
      if (!line) return;
      this.#lastError = line.slice(0, this.#maxSourceLineBytes);
      this.#dispatchLine(`[logcat stderr] ${this.#lastError}`);
    });
    child.once("error", (error) => {
      if (this.#child !== child) return;
      this.#lastError = error.message;
      for (const subscriber of this.#subscribers.values()) {
        this.#sendControl(subscriber, "error", {
          error: error.message,
          at: this.#now().toISOString()
        });
      }
    });
    child.once("close", (code, signal) => {
      if (this.#terminatingChild === child) {
        this.#terminatingChild = null;
        if (this.#terminationTimer !== null) {
          this.#clock.clearTimeout(this.#terminationTimer);
          this.#terminationTimer = null;
        }
        if (!this.#closed && this.#subscribers.size > 0) {
          this.#startReplacementChild();
        }
        return;
      }
      if (this.#child !== child) return;
      this.#child = null;
      this.#decoder.end();
      this.#decoder = new StringDecoder("utf8");
      this.#lineBuffer = "";
      this.#discardingLongLine = false;
      for (const subscriber of [...this.#subscribers.values()]) {
        this.#sendControl(subscriber, "close", { code, signal });
        this.#removeSubscriber(subscriber, true);
      }
    });
  }
  #consumeSource(value) {
    let text = Buffer.isBuffer(value) ? this.#decoder.write(value) : value;
    if (this.#discardingLongLine) {
      const newline = text.indexOf("\n");
      if (newline === -1) return;
      text = text.slice(newline + 1);
      this.#discardingLongLine = false;
    }
    const lines = `${this.#lineBuffer}${text}`.split("\n");
    this.#lineBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      this.#acceptSourceLine(rawLine.replace(/\r$/, ""));
    }
    if (Buffer.byteLength(this.#lineBuffer, "utf8") > this.#maxSourceLineBytes) {
      this.#lineBuffer = "";
      this.#discardingLongLine = true;
      this.#recordSourceDrop();
    }
  }
  #acceptSourceLine(line) {
    if (!line) return;
    if (Buffer.byteLength(line, "utf8") > this.#maxSourceLineBytes) {
      this.#recordSourceDrop();
      return;
    }
    this.#dispatchLine(line);
  }
  #dispatchLine(line) {
    const value = { line, at: this.#now().toISOString() };
    for (const subscriber of this.#subscribers.values()) {
      if (!this.#matches(subscriber, line)) continue;
      const dropped = subscriber.queue.push(value);
      if (dropped > 0) {
        subscriber.totalDropped += dropped;
        this.#totals.droppedLines += dropped;
      }
      this.#scheduleFlush(subscriber);
    }
  }
  #matches(subscriber, line) {
    if (subscriber.search && !line.toLowerCase().includes(subscriber.search)) {
      return false;
    }
    if (!subscriber.packageName) return true;
    const pid = line.trim().split(/\s+/, 4)[2];
    return Boolean(
      pid && subscriber.pids.has(pid) || line.includes(subscriber.packageName)
    );
  }
  #scheduleFlush(subscriber) {
    if (!subscriber.active || subscriber.batchTimer !== null || subscriber.waitingForPull) {
      return;
    }
    subscriber.batchTimer = this.#clock.setTimeout(() => {
      subscriber.batchTimer = null;
      this.#flush(subscriber);
    }, this.#batchIntervalMs);
  }
  #flush(subscriber) {
    if (!subscriber.active) return;
    if (subscriber.controller.desiredSize !== null && subscriber.controller.desiredSize <= 0) {
      subscriber.waitingForPull = true;
      return;
    }
    const batch = subscriber.queue.drain();
    const sourceDropped = this.#totals.sourceDroppedLines;
    if (batch.lines.length === 0 && batch.dropped === 0 && sourceDropped === subscriber.sourceDroppedReported) {
      return;
    }
    try {
      subscriber.controller.enqueue(
        encodeEvent("logs", {
          lines: batch.lines,
          dropped: batch.dropped,
          totalDropped: subscriber.totalDropped,
          sourceDropped
        })
      );
      subscriber.sourceDroppedReported = sourceDropped;
      this.#totals.batches++;
      this.#totals.deliveredLines += batch.lines.length;
    } catch {
      this.#removeSubscriber(subscriber);
    }
  }
  #sendControl(subscriber, event, value) {
    if (!subscriber.active) return;
    try {
      subscriber.controller.enqueue(encodeEvent(event, value));
    } catch {
      this.#removeSubscriber(subscriber);
    }
  }
  #refreshPids(subscriber) {
    if (!subscriber.active || !subscriber.packageName || subscriber.pidRefresh) {
      return;
    }
    const abort = new AbortController();
    subscriber.pidAbort = abort;
    this.#activePidLookups++;
    const refresh = Promise.resolve().then(
      () => this.#resolvePackagePids(
        this.serial,
        subscriber.packageName,
        abort.signal
      )
    ).then((pids) => {
      if (subscriber.active) subscriber.pids = pids;
    }).catch((error) => {
      if (subscriber.active) {
        this.#lastError = error instanceof Error ? error.message : String(error);
      }
    }).finally(() => {
      this.#activePidLookups--;
      if (subscriber.pidRefresh === refresh) {
        subscriber.pidRefresh = null;
      }
      if (subscriber.pidAbort === abort) subscriber.pidAbort = null;
    });
    subscriber.pidRefresh = refresh;
  }
  #removeSubscriber(subscriber, closeStream = false) {
    if (!subscriber.active) return;
    subscriber.active = false;
    this.#subscribers.delete(subscriber.id);
    if (subscriber.batchTimer !== null) {
      this.#clock.clearTimeout(subscriber.batchTimer);
      subscriber.batchTimer = null;
    }
    if (subscriber.pidTimer !== null) {
      this.#clock.clearInterval(subscriber.pidTimer);
      subscriber.pidTimer = null;
    }
    if (subscriber.pidAbort) {
      const abort = subscriber.pidAbort;
      subscriber.pidAbort = null;
      abort.abort("logcat subscriber closed");
    }
    if (subscriber.abortListener && subscriber.signal) {
      subscriber.signal.removeEventListener(
        "abort",
        subscriber.abortListener
      );
      subscriber.abortListener = null;
    }
    if (closeStream) {
      try {
        subscriber.controller.close();
      } catch {
      }
    }
    if (this.#subscribers.size === 0) this.#stopChild();
  }
  #recordSourceDrop() {
    this.#totals.sourceDroppedLines++;
    for (const subscriber of this.#subscribers.values()) {
      this.#scheduleFlush(subscriber);
    }
  }
  #startReplacementChild() {
    try {
      this.#ensureChild();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#lastError = message;
      for (const subscriber of [...this.#subscribers.values()]) {
        this.#sendControl(subscriber, "error", {
          error: message,
          at: this.#now().toISOString()
        });
        this.#sendControl(subscriber, "close", {
          reason: "logcat restart failed"
        });
        this.#removeSubscriber(subscriber, true);
      }
    }
  }
  #stopChild() {
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    this.#terminatingChild = child;
    this.#lineBuffer = "";
    this.#discardingLongLine = false;
    this.#decoder.end();
    this.#decoder = new StringDecoder("utf8");
    this.#terminationTimer = this.#clock.setTimeout(() => {
      this.#terminationTimer = null;
      if (this.#terminatingChild !== child) return;
      this.#totals.forcedKills++;
      try {
        child.kill("SIGKILL");
      } catch (error) {
        this.#lastError = error instanceof Error ? error.message : String(error);
      }
    }, this.#terminationGraceMs);
    try {
      child.kill("SIGTERM");
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
    }
  }
};

// runtimes/serve-emu/src/route-playback.ts
var RoutePlaybackConflictError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RoutePlaybackConflictError";
  }
};
var RoutePlaybackDisposedError = class extends RoutePlaybackConflictError {
  constructor(message) {
    super(message);
    this.name = "RoutePlaybackDisposedError";
  }
};
var RoutePlaybackApplyError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RoutePlaybackApplyError";
  }
};
function routePlaybackErrorStatus(error) {
  if (error instanceof RoutePlaybackConflictError) return 409;
  if (error instanceof RoutePlaybackApplyError) return 502;
  return 500;
}
var EARTH_RADIUS_METERS = 6371e3;
var DEFAULT_SPEED_KPH = 30;
var DEFAULT_INTERVAL_MS = 1e3;
var MAX_WAYPOINTS = 1e4;
var MIN_INTERVAL_MS = 250;
var MAX_INTERVAL_MS = 6e4;
var SYSTEM_CLOCK4 = {
  now: Date.now,
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle)
};
function finiteNumber2(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}
function optionalNumber(value, name) {
  if (value === void 0 || value === null) return void 0;
  return finiteNumber2(value, name);
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
function radians(degrees2) {
  return degrees2 * Math.PI / 180;
}
function degrees(radiansValue) {
  return radiansValue * 180 / Math.PI;
}
function distanceMeters(a, b) {
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function interpolate(a, b, t) {
  const lat1 = radians(a.latitude);
  const lon1 = radians(a.longitude);
  const lat2 = radians(b.latitude);
  const lon2 = radians(b.longitude);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  ));
  if (d === 0) return { ...a };
  const aa = Math.sin((1 - t) * d) / Math.sin(d);
  const bb = Math.sin(t * d) / Math.sin(d);
  const x = aa * Math.cos(lat1) * Math.cos(lon1) + bb * Math.cos(lat2) * Math.cos(lon2);
  const y = aa * Math.cos(lat1) * Math.sin(lon1) + bb * Math.cos(lat2) * Math.sin(lon2);
  const z = aa * Math.sin(lat1) + bb * Math.sin(lat2);
  const lat = Math.atan2(z, Math.sqrt(x ** 2 + y ** 2));
  const lon = Math.atan2(y, x);
  const altitude = a.altitude === void 0 && b.altitude === void 0 ? void 0 : (a.altitude ?? 0) + ((b.altitude ?? a.altitude ?? 0) - (a.altitude ?? 0)) * t;
  return {
    latitude: degrees(lat),
    longitude: degrees(lon),
    ...altitude === void 0 ? {} : { altitude },
    velocity: a.velocity ?? b.velocity
  };
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseWaypoint(value, index) {
  if (!isRecord3(value)) throw new Error(`waypoint ${index + 1} must be an object`);
  const latitude = finiteNumber2(value.latitude ?? value.lat, `waypoint ${index + 1} latitude`);
  const longitude = finiteNumber2(
    value.longitude ?? value.lng ?? value.lon,
    `waypoint ${index + 1} longitude`
  );
  const altitude = optionalNumber(value.altitude ?? value.alt ?? value.ele, `waypoint ${index + 1} altitude`);
  if (latitude < -90 || latitude > 90) {
    throw new Error(`waypoint ${index + 1} latitude must be between -90 and 90`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error(`waypoint ${index + 1} longitude must be between -180 and 180`);
  }
  if (altitude !== void 0 && (altitude < -1e3 || altitude > 1e5)) {
    throw new Error(`waypoint ${index + 1} altitude must be between -1000 and 100000`);
  }
  return { latitude, longitude, ...altitude === void 0 ? {} : { altitude } };
}
function prepareRoute(waypoints) {
  const cumulativeMeters = [0];
  let totalMeters = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalMeters += distanceMeters(waypoints[i - 1], waypoints[i]);
    cumulativeMeters.push(totalMeters);
  }
  return { waypoints, cumulativeMeters, totalMeters };
}
function segmentForProgress(cumulativeMeters, progress) {
  let low = 1;
  let high = cumulativeMeters.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (cumulativeMeters[mid] >= progress) high = mid;
    else low = mid + 1;
  }
  return low;
}
function locationAt(route, progressMeters) {
  if (route.waypoints.length === 1 || route.totalMeters === 0) return route.waypoints[0];
  const progress = clamp(progressMeters, 0, route.totalMeters);
  const segment = segmentForProgress(route.cumulativeMeters, progress);
  const startMeters = route.cumulativeMeters[segment - 1];
  const endMeters = route.cumulativeMeters[segment];
  const t = endMeters === startMeters ? 0 : (progress - startMeters) / (endMeters - startMeters);
  return interpolate(route.waypoints[segment - 1], route.waypoints[segment], t);
}
function parseRoutePlaybackRequest(value) {
  if (!isRecord3(value)) throw new Error("route payload must be an object");
  if (!Array.isArray(value.waypoints)) throw new Error("waypoints must be an array");
  if (value.waypoints.length < 1) throw new Error("route must include at least one waypoint");
  if (value.waypoints.length > MAX_WAYPOINTS) throw new Error(`route cannot exceed ${MAX_WAYPOINTS} waypoints`);
  const speedKph = optionalNumber(value.speedKph, "speedKph") ?? DEFAULT_SPEED_KPH;
  const multiplier = optionalNumber(value.multiplier, "multiplier") ?? 1;
  const intervalMs = optionalNumber(value.intervalMs, "intervalMs") ?? DEFAULT_INTERVAL_MS;
  if (speedKph <= 0 || speedKph > 500) throw new Error("speedKph must be between 0 and 500");
  if (multiplier <= 0 || multiplier > 100) throw new Error("multiplier must be between 0 and 100");
  if (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    throw new Error(`intervalMs must be between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}`);
  }
  return {
    waypoints: value.waypoints.map(parseWaypoint),
    speedKph,
    multiplier,
    intervalMs: Math.round(intervalMs),
    loop: value.loop === true
  };
}
var RoutePlayback = class {
  #applyLocation;
  #onLocation;
  #clock;
  #route = null;
  #timer = null;
  #status = "idle";
  #speedKph = DEFAULT_SPEED_KPH;
  #multiplier = 1;
  #intervalMs = DEFAULT_INTERVAL_MS;
  #loop = false;
  #progressMeters = 0;
  #lastTickMs = 0;
  #startedAt = null;
  #updatedAt = null;
  #pausedAt = null;
  #completedAt = null;
  #lastError = null;
  #currentLocation = null;
  #runId = 0;
  #runController = null;
  #startingRunId = null;
  #applyingRunId = null;
  #closed = false;
  constructor(opts) {
    this.#applyLocation = opts.applyLocation;
    this.#onLocation = opts.onLocation;
    this.#clock = opts.clock ?? SYSTEM_CLOCK4;
  }
  async start(request) {
    if (this.#closed) {
      throw new RoutePlaybackConflictError("route playback is closed");
    }
    if (this.#startingRunId === this.#runId) {
      throw new RoutePlaybackConflictError(
        "route playback start is already in progress"
      );
    }
    const runId = this.#beginRun();
    this.#startingRunId = runId;
    try {
      this.#route = prepareRoute(request.waypoints);
      this.#speedKph = request.speedKph ?? DEFAULT_SPEED_KPH;
      this.#multiplier = request.multiplier ?? 1;
      this.#intervalMs = request.intervalMs ?? DEFAULT_INTERVAL_MS;
      this.#loop = request.loop ?? false;
      this.#progressMeters = 0;
      this.#lastTickMs = this.#clock.now();
      this.#status = "running";
      this.#startedAt = new Date(this.#lastTickMs).toISOString();
      this.#updatedAt = this.#startedAt;
      this.#pausedAt = null;
      this.#completedAt = null;
      this.#lastError = null;
      const applied = await this.#applyCurrentLocation(runId, true);
      if (!applied || !this.#isRunActive(runId)) {
        throw new RoutePlaybackConflictError(
          "route playback start was cancelled"
        );
      }
      if (this.#status === "running") this.#scheduleTimer(runId);
      return this.snapshot();
    } finally {
      if (this.#startingRunId === runId) this.#startingRunId = null;
    }
  }
  pause() {
    if (!this.#closed && this.#status === "running") {
      this.#status = "paused";
      this.#pausedAt = new Date(this.#clock.now()).toISOString();
      this.#clearTimer(this.#runId);
    }
    return this.snapshot();
  }
  resume() {
    if (!this.#closed && this.#status === "paused" && this.#isRunActive(this.#runId)) {
      this.#status = "running";
      this.#pausedAt = null;
      this.#lastTickMs = this.#clock.now();
      if (this.#startingRunId !== this.#runId) {
        this.#scheduleTimer(this.#runId);
      }
    }
    return this.snapshot();
  }
  /** Stop the current route while keeping this player reusable. */
  stop() {
    if (this.#closed) return this.snapshot();
    this.#invalidateRun();
    this.#resetRouteState("idle", false);
    return this.snapshot();
  }
  snapshot() {
    return {
      status: this.#status,
      waypointCount: this.#route?.waypoints.length ?? 0,
      totalMeters: this.#route?.totalMeters ?? 0,
      progressMeters: this.#progressMeters,
      speedKph: this.#speedKph,
      multiplier: this.#multiplier,
      intervalMs: this.#intervalMs,
      loop: this.#loop,
      startedAt: this.#startedAt,
      updatedAt: this.#updatedAt,
      pausedAt: this.#pausedAt,
      completedAt: this.#completedAt,
      lastError: this.#lastError,
      currentLocation: this.#currentLocation
    };
  }
  /** Permanently dispose this player; a closed instance cannot be restarted. */
  close() {
    if (this.#closed) return this.snapshot();
    this.#closed = true;
    this.#invalidateRun();
    this.#resetRouteState("closed", true);
    return this.snapshot();
  }
  #tick(runId) {
    void this.#tickNow(runId);
  }
  async #tickNow(runId) {
    if (!this.#isRunActive(runId) || this.#status !== "running" || this.#applyingRunId === runId) {
      return;
    }
    const route = this.#route;
    if (!route) return;
    const now = this.#clock.now();
    const elapsedSeconds = Math.max(0, (now - this.#lastTickMs) / 1e3);
    this.#lastTickMs = now;
    this.#progressMeters += this.#speedKph * 1e3 * elapsedSeconds * this.#multiplier / 3600;
    if (route.totalMeters === 0 || this.#progressMeters >= route.totalMeters) {
      if (this.#loop && route.totalMeters > 0) {
        this.#progressMeters %= route.totalMeters;
      } else {
        this.#progressMeters = route.totalMeters;
        this.#status = "completed";
        this.#completedAt = new Date(now).toISOString();
        this.#clearTimer(runId);
      }
    }
    await this.#applyCurrentLocation(runId, false);
  }
  async #applyCurrentLocation(runId, propagateError) {
    if (!this.#isRunActive(runId)) return false;
    const route = this.#route;
    const controller = this.#runController;
    if (!route || !controller) return false;
    this.#applyingRunId = runId;
    try {
      const fix = locationAt(route, this.#progressMeters);
      await this.#applyLocation(fix, controller.signal);
      if (!this.#isRunActive(runId) || this.#route !== route) return false;
      this.#currentLocation = {
        ...fix,
        appliedAt: new Date(this.#clock.now()).toISOString()
      };
      this.#updatedAt = this.#currentLocation.appliedAt;
      this.#onLocation(this.#currentLocation);
      return true;
    } catch (err) {
      if (this.#isRunActive(runId) && this.#route === route) {
        if (err instanceof RoutePlaybackDisposedError) {
          this.close();
          if (propagateError) throw err;
          return false;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.#status = "error";
        this.#lastError = message;
        this.#clearTimer(runId);
        if (propagateError) {
          throw new RoutePlaybackApplyError(message, { cause: err });
        }
      }
      return false;
    } finally {
      if (this.#applyingRunId === runId) this.#applyingRunId = null;
    }
  }
  #beginRun() {
    this.#invalidateRun();
    this.#runController = new AbortController();
    return this.#runId;
  }
  #invalidateRun() {
    this.#runController?.abort();
    this.#runController = null;
    this.#runId++;
    this.#clearTimer();
  }
  #isRunActive(runId) {
    return !this.#closed && this.#runId === runId && this.#route !== null && this.#runController !== null && !this.#runController.signal.aborted;
  }
  #scheduleTimer(runId) {
    if (!this.#isRunActive(runId) || this.#status !== "running") return;
    this.#clearTimer();
    const handle = this.#clock.setInterval(
      () => this.#tick(runId),
      this.#intervalMs
    );
    if (!this.#isRunActive(runId) || this.#status !== "running") {
      this.#clock.clearInterval(handle);
      return;
    }
    this.#timer = { handle, runId };
  }
  #clearTimer(runId) {
    if (!this.#timer || runId !== void 0 && this.#timer.runId !== runId) {
      return;
    }
    this.#clock.clearInterval(this.#timer.handle);
    this.#timer = null;
  }
  #resetRouteState(status, clearCurrentLocation) {
    this.#route = null;
    this.#status = status;
    this.#progressMeters = 0;
    this.#lastTickMs = 0;
    this.#startedAt = null;
    this.#updatedAt = null;
    this.#pausedAt = null;
    this.#completedAt = null;
    this.#lastError = null;
    if (clearCurrentLocation) {
      this.#speedKph = DEFAULT_SPEED_KPH;
      this.#multiplier = 1;
      this.#intervalMs = DEFAULT_INTERVAL_MS;
      this.#loop = false;
      this.#currentLocation = null;
    }
  }
};

// runtimes/serve-emu/src/session-recorder.ts
var DEFAULT_MAX_SESSION_EVENTS = 2e3;
var DEFAULT_MAX_SESSION_BYTES = 1024 * 1024;
var SessionReplayValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionReplayValidationError";
  }
};
var SessionReplayConflictError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionReplayConflictError";
  }
};
function sessionReplayErrorStatus(error) {
  if (error instanceof SessionReplayValidationError) return 400;
  if (error instanceof SessionReplayConflictError) return 409;
  return 500;
}
function parseSessionReplayMultiplier(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SessionReplayValidationError(
      "session replay payload must be an object"
    );
  }
  const raw = value.multiplier;
  if (raw !== void 0 && typeof raw !== "number") {
    throw new SessionReplayValidationError("multiplier must be a number");
  }
  const multiplier = raw ?? 1;
  validateMultiplier(multiplier);
  return multiplier;
}
var EMPTY_ARRAY_BYTES = 2;
function cloneGesture(gesture) {
  return gesture.type === "text" ? { type: "text", text: normalizeTextForControl(gesture.text) } : { ...gesture };
}
function cloneEvent(event) {
  return event.kind === "gesture" ? { ...event, gesture: cloneGesture(event.gesture) } : { ...event, location: { ...event.location } };
}
function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("session replay cancelled", "AbortError");
}
function abortableDelay(ms, signal) {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    const timeout = setTimeout(() => finish(resolve), Math.max(0, ms));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
var SYSTEM_REPLAY_CLOCK = {
  now: Date.now,
  delay: abortableDelay
};
function validateMultiplier(multiplier) {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
    throw new SessionReplayValidationError(
      "multiplier must be between 0 and 100"
    );
  }
}
var SessionRecorder = class {
  #events = [];
  #retainedBytes = EMPTY_ARRAY_BYTES;
  #droppedEvents = 0;
  #maxEvents;
  #maxBytes;
  #nextId = 1;
  #lastEventMs = null;
  #recording = true;
  #replaying = false;
  #replayStatus = "idle";
  #replayStartedAt = null;
  #replayCompletedAt = null;
  #replayCancelledAt = null;
  #lastError = null;
  #nextReplayId = 1;
  #activeReplay = null;
  #closed = false;
  #admissionEpoch = 0;
  #clock;
  #legacySleep;
  #legacyStopReplay = false;
  constructor(clockOrOptions = SYSTEM_REPLAY_CLOCK) {
    const options = "delay" in clockOrOptions ? { clock: clockOrOptions } : clockOrOptions;
    this.#clock = options.clock ?? (options.now || options.sleep ? {
      now: options.now ?? Date.now,
      delay: async (ms, signal) => {
        if (signal.aborted) throw abortReason(signal);
        await (options.sleep ?? ((value) => abortableDelay(value, signal)))(ms);
        if (signal.aborted) throw abortReason(signal);
      }
    } : SYSTEM_REPLAY_CLOCK);
    this.#legacySleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#maxEvents = options.maxEvents ?? DEFAULT_MAX_SESSION_EVENTS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_SESSION_BYTES;
    if (!Number.isSafeInteger(this.#maxEvents) || this.#maxEvents <= 0) {
      throw new Error("maxEvents must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 2) {
      throw new Error("maxBytes must be a safe integer of at least 2");
    }
  }
  get isReplaying() {
    return this.#replaying;
  }
  get replayAdmissionEpoch() {
    return this.#admissionEpoch;
  }
  recordGesture(gesture, source) {
    this.#record({ kind: "gesture", gesture, source });
  }
  recordLocation(location, source) {
    this.#record({ kind: "location", location, source });
  }
  clear() {
    if (this.#closed) {
      throw new SessionReplayConflictError("session recorder is closed");
    }
    if (this.#activeReplay) {
      throw new SessionReplayConflictError(
        "cannot clear session while replay is running"
      );
    }
    this.#admissionEpoch++;
    this.#events = [];
    this.#retainedBytes = EMPTY_ARRAY_BYTES;
    this.#droppedEvents = 0;
    this.#lastEventMs = null;
    if (!this.#replaying) {
      this.#replayStatus = "idle";
      this.#replayStartedAt = null;
      this.#replayCompletedAt = null;
      this.#replayCancelledAt = null;
    }
    this.#lastError = null;
    return this.summary();
  }
  async cancelAndWait() {
    this.#admissionEpoch++;
    return this.#cancelActiveReplay();
  }
  async dispose() {
    this.#admissionEpoch++;
    this.#closed = true;
    this.#recording = false;
    return this.#cancelActiveReplay();
  }
  async #cancelActiveReplay() {
    const replay = this.#activeReplay;
    if (!replay) return this.snapshot();
    replay.controller.abort();
    await replay.completion;
    return this.snapshot();
  }
  snapshot() {
    return {
      events: this.#events.map(cloneEvent),
      recording: this.#recording,
      replaying: this.#replaying,
      replayStatus: this.#replayStatus,
      replayStartedAt: this.#replayStartedAt,
      replayCompletedAt: this.#replayCompletedAt,
      replayCancelledAt: this.#replayCancelledAt,
      lastError: this.#lastError
    };
  }
  summary() {
    const events = this.#events;
    const oldest = events[0] ?? null;
    const newest = events.at(-1) ?? null;
    return {
      eventCount: events.length,
      retainedBytes: this.#retainedBytes,
      limits: { maxEvents: this.#maxEvents, maxBytes: this.#maxBytes },
      droppedEvents: this.#droppedEvents,
      oldestEventId: oldest?.id ?? null,
      newestEventId: newest?.id ?? null,
      oldestEventAt: oldest?.at ?? null,
      newestEventAt: newest?.at ?? null,
      recording: this.#recording,
      replaying: this.#replaying,
      replayStartedAt: this.#replayStartedAt,
      replayCompletedAt: this.#replayCompletedAt,
      lastError: this.#lastError
    };
  }
  page({ limit, before }) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive safe integer");
    }
    if (before !== void 0 && (!Number.isSafeInteger(before) || before <= 0)) {
      throw new Error("before must be a positive safe integer");
    }
    const eligible = before === void 0 ? this.#events : this.#events.filter((event) => event.id < before);
    const events = eligible.slice(-limit).map(cloneEvent);
    const hasMore = eligible.length > events.length;
    return {
      session: this.summary(),
      events,
      nextBefore: hasMore ? events[0]?.id ?? null : null,
      hasMore
    };
  }
  export() {
    return { session: this.summary(), events: this.#events.map(cloneEvent) };
  }
  async replay(handlers, multiplier = 1) {
    if (this.#closed) {
      throw new SessionReplayConflictError("session recorder is closed");
    }
    if (this.#replaying) {
      throw new SessionReplayConflictError("session replay is already running");
    }
    if (this.#events.length === 0) {
      throw new SessionReplayValidationError("session has no recorded events");
    }
    validateMultiplier(multiplier);
    const events = this.#events.map(cloneEvent);
    this.#replaying = true;
    this.#legacyStopReplay = false;
    this.#replayStartedAt = new Date(this.#clock.now()).toISOString();
    this.#replayCompletedAt = null;
    this.#lastError = null;
    let targetMs = this.#clock.now();
    try {
      for (const event of events) {
        targetMs += event.delayMs / multiplier;
        await this.#legacySleep(Math.max(0, targetMs - this.#clock.now()));
        if (this.#legacyStopReplay) break;
        if (event.kind === "gesture") {
          await handlers.dispatchGesture(cloneGesture(event.gesture));
        } else {
          await handlers.setLocation({ ...event.location });
        }
      }
      this.#replayCompletedAt = new Date(this.#clock.now()).toISOString();
      this.#replaying = false;
      return this.summary();
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.#replaying = false;
      this.#legacyStopReplay = false;
    }
  }
  stopReplay() {
    this.#legacyStopReplay = true;
    this.#activeReplay?.controller.abort();
    return this.summary();
  }
  startReplay(handlers, multiplier = 1) {
    if (this.#closed) {
      throw new SessionReplayConflictError("session recorder is closed");
    }
    if (this.#activeReplay) {
      throw new SessionReplayConflictError(
        "session replay is already running"
      );
    }
    if (this.#events.length === 0) {
      throw new SessionReplayValidationError(
        "session has no recorded events"
      );
    }
    validateMultiplier(multiplier);
    const events = this.#events.map(cloneEvent);
    const replay = {
      id: this.#nextReplayId++,
      controller: new AbortController(),
      completion: Promise.resolve(this.snapshot())
    };
    this.#activeReplay = replay;
    this.#replaying = true;
    this.#replayStatus = "running";
    this.#replayStartedAt = new Date(this.#clock.now()).toISOString();
    this.#replayCompletedAt = null;
    this.#replayCancelledAt = null;
    this.#lastError = null;
    replay.completion = Promise.resolve().then(
      () => this.#executeReplay(replay, events, handlers, multiplier)
    );
    return { snapshot: this.snapshot(), completion: replay.completion };
  }
  async #executeReplay(replay, events, handlers, multiplier) {
    let outcome = "completed";
    let targetMs = this.#clock.now();
    try {
      for (const event of events) {
        this.#assertReplayActive(replay);
        targetMs += event.delayMs / multiplier;
        await this.#clock.delay(
          Math.max(0, targetMs - this.#clock.now()),
          replay.controller.signal
        );
        this.#assertReplayActive(replay);
        if (event.kind === "gesture") {
          await handlers.dispatchGesture(
            event.gesture,
            replay.controller.signal
          );
        } else {
          await handlers.setLocation(
            event.location,
            replay.controller.signal
          );
        }
        this.#assertReplayActive(replay);
      }
    } catch (err) {
      if (replay.controller.signal.aborted || this.#activeReplay?.id !== replay.id) {
        outcome = "cancelled";
      } else {
        outcome = "error";
        this.#lastError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (this.#activeReplay?.id === replay.id) {
        const finishedAt = new Date(this.#clock.now()).toISOString();
        this.#replaying = false;
        this.#replayStatus = outcome;
        this.#replayCompletedAt = outcome === "completed" ? finishedAt : null;
        this.#replayCancelledAt = outcome === "cancelled" ? finishedAt : null;
        this.#activeReplay = null;
      }
    }
    return this.snapshot();
  }
  #assertReplayActive(replay) {
    if (replay.controller.signal.aborted || this.#activeReplay?.id !== replay.id) {
      throw abortReason(replay.controller.signal);
    }
  }
  #record(event) {
    if (this.#closed || !this.#recording || this.#replaying) return;
    const now = this.#clock.now();
    const delayMs = this.#lastEventMs !== null ? Math.max(0, now - this.#lastEventMs) : 0;
    this.#lastEventMs = now;
    const base = {
      id: this.#nextId++,
      at: new Date(now).toISOString(),
      delayMs,
      source: event.source
    };
    const recorded = event.kind === "gesture" ? { ...base, kind: "gesture", gesture: cloneGesture(event.gesture) } : { ...base, kind: "location", location: { ...event.location } };
    const bytes = Buffer.byteLength(JSON.stringify(recorded), "utf8");
    if (EMPTY_ARRAY_BYTES + bytes > this.#maxBytes) {
      this.#droppedEvents++;
      return;
    }
    this.#events.push(recorded);
    this.#retainedBytes += bytes + (this.#events.length > 1 ? 1 : 0);
    while (this.#events.length > this.#maxEvents || this.#retainedBytes > this.#maxBytes) {
      const removed = this.#events.shift();
      this.#retainedBytes -= Buffer.byteLength(JSON.stringify(removed), "utf8") + (this.#events.length > 0 ? 1 : 0);
      this.#droppedEvents++;
    }
  }
};

// runtimes/serve-emu/src/session-replay-lifecycle.ts
async function disposeReplayBefore(opts) {
  opts.stopRoute();
  await opts.recorder.dispose();
  return opts.afterReplayStopped();
}

// runtimes/serve-emu/src/device-session-context.ts
var FRAME_STAT_WINDOW = 240;
var SessionChangedError = class extends Error {
  constructor(expectedGeneration, activeGeneration) {
    super(
      activeGeneration === null ? `device session ${expectedGeneration} is no longer active` : `device session changed from generation ${expectedGeneration} to ${activeGeneration}`
    );
    this.expectedGeneration = expectedGeneration;
    this.activeGeneration = activeGeneration;
    this.name = "SessionChangedError";
  }
  expectedGeneration;
  activeGeneration;
  code = "session_changed";
};
var ActiveDeviceSession = class {
  serial;
  generation;
  scrcpy;
  screen;
  recorder = new SessionRecorder();
  logcat;
  inputQueue;
  route;
  clients = /* @__PURE__ */ new Set();
  abortController = new AbortController();
  frameStats = new FrameStatWindow(FRAME_STAT_WINDOW);
  status = "streaming";
  terminalTransitionStarted = false;
  startedMs;
  startedAt;
  stoppedAt = null;
  lastError = null;
  lastErrorCode = null;
  lastErrorMeta = null;
  frameCount = 0;
  configPacketCount = 0;
  lastFrameMs = 0;
  totalDroppedFrames = 0;
  totalBackpressureEvents = 0;
  sourceFps = 0;
  lastFpsFrameCount = 0;
  videoResetRequests = 0;
  lastVideoResetAt = null;
  lastVideoResetReason = null;
  lastVideoResetMs = 0;
  lastLocation = null;
  cachedConfig = null;
  watchdog = null;
  #accessibilitySnapshotCache = null;
  #accessibilitySnapshotInFlight = null;
  #closeClient;
  #cleanup = /* @__PURE__ */ new Set();
  #cleanupTasks = /* @__PURE__ */ new Set();
  #drains = /* @__PURE__ */ new Set();
  #disposeTask = null;
  #now;
  constructor(opts) {
    this.serial = opts.serial;
    this.logcat = new LogcatHub(opts.serial);
    this.generation = opts.generation;
    this.scrcpy = opts.scrcpy;
    this.screen = {
      width: opts.scrcpy.meta.width,
      height: opts.scrcpy.meta.height
    };
    this.#now = opts.now ?? Date.now;
    this.startedMs = this.#now();
    this.startedAt = new Date(this.startedMs).toISOString();
    this.#closeClient = opts.closeClient ?? ((client, code, reason) => {
      client.ws.close(code, reason);
    });
    this.inputQueue = opts.inputQueue ?? (opts.scrcpy.controlSocket ? new ControlInputQueue({ socket: opts.scrcpy.controlSocket }) : new ControlInputQueue({
      writer: {
        async write() {
          throw new Error("scrcpy control socket is unavailable");
        }
      }
    }));
    this.route = new RoutePlayback({
      applyLocation: async (fix, signal) => {
        this.assertUsable();
        await opts.applyLocation(this.serial, fix, signal);
        this.assertUsable();
      },
      onLocation: (fix) => {
        if (!this.signal.aborted) this.lastLocation = fix;
      }
    });
  }
  get signal() {
    return this.abortController.signal;
  }
  get disposed() {
    return this.#disposeTask !== null;
  }
  get accessibilitySnapshotInFlight() {
    return this.#accessibilitySnapshotInFlight !== null;
  }
  assertUsable(activeGeneration = this.generation) {
    if (this.signal.aborted || activeGeneration !== this.generation) {
      throw new SessionChangedError(this.generation, activeGeneration);
    }
  }
  readAccessibilitySnapshot(load, cacheMs = 2500) {
    this.assertUsable();
    const now = this.#now();
    if (this.#accessibilitySnapshotCache && this.#accessibilitySnapshotCache.expiresMs > now) {
      return Promise.resolve(this.#accessibilitySnapshotCache.snapshot);
    }
    if (this.#accessibilitySnapshotInFlight) {
      return this.#accessibilitySnapshotInFlight;
    }
    const request = load(this.serial, this.signal).then((snapshot) => {
      this.assertUsable();
      this.#accessibilitySnapshotCache = {
        snapshot,
        expiresMs: this.#now() + cacheMs
      };
      return snapshot;
    }).finally(() => {
      if (this.#accessibilitySnapshotInFlight === request) {
        this.#accessibilitySnapshotInFlight = null;
      }
    });
    this.#accessibilitySnapshotInFlight = this.trackDrain(request);
    return this.#accessibilitySnapshotInFlight;
  }
  registerCleanup(cleanup) {
    if (this.signal.aborted) {
      this.#startCleanup(cleanup);
      return () => {
      };
    }
    this.#cleanup.add(cleanup);
    return () => this.#cleanup.delete(cleanup);
  }
  trackDrain(task) {
    this.assertUsable();
    this.#drains.add(task);
    void task.finally(() => this.#drains.delete(task)).catch(() => {
    });
    return task;
  }
  /**
   * Tracks capability-bearing background work only until this generation is
   * revoked. The underlying legacy task may finish later, but every handler is
   * generation-guarded and disposal is never held by an uninterruptible wait.
   */
  trackUntilAbort(task) {
    this.assertUsable();
    let onAbort;
    const aborted2 = new Promise((resolve) => {
      onAbort = resolve;
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
    const guarded = Promise.race([task.then(() => {
    }), aborted2]).finally(() => {
      this.signal.removeEventListener("abort", onAbort);
    });
    return this.trackDrain(guarded);
  }
  closeClients(code, reason) {
    for (const client of this.clients) {
      try {
        this.#closeClient(client, code, reason);
      } catch {
      }
    }
    this.clients.clear();
  }
  setWatchdog(timer) {
    if (this.signal.aborted) {
      clearInterval(timer);
      return;
    }
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = timer;
  }
  /** Idempotent; every owner receives the exact same cleanup promise. */
  dispose(reason, opts = {}) {
    if (this.#disposeTask) return this.#disposeTask;
    let finishDispose;
    this.#disposeTask = new Promise((resolve) => {
      finishDispose = resolve;
    });
    const nextStatus = opts.status ?? "stopped";
    this.status = nextStatus;
    this.lastError = reason;
    this.stoppedAt = new Date(this.#now()).toISOString();
    this.abortController.abort(new SessionChangedError(this.generation, null));
    this.inputQueue.close(new Error(reason));
    this.logcat.close(reason);
    const replayDisposed = disposeReplayBefore({
      recorder: this.recorder,
      stopRoute: () => {
        this.route.stop();
        this.route.close();
      },
      afterReplayStopped: () => {
      }
    });
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.closeClients(opts.clientCode ?? (nextStatus === "error" ? 1011 : 1e3), reason);
    const cleanups = Array.from(this.#cleanup);
    this.#cleanup.clear();
    const drains = Array.from(this.#drains);
    void (async () => {
      for (const cleanup of cleanups) this.#startCleanup(cleanup);
      await replayDisposed;
      try {
        this.scrcpy.close();
      } catch {
      }
      await Promise.allSettled(drains);
      await this.#drainCleanups();
      this.route.stop();
      this.route.close();
    })().then(finishDispose, finishDispose);
    return this.#disposeTask;
  }
  #startCleanup(cleanup) {
    const task = Promise.resolve().then(cleanup);
    this.#cleanupTasks.add(task);
    void task.finally(() => this.#cleanupTasks.delete(task)).catch(() => {
    });
  }
  async #drainCleanups() {
    while (this.#cleanupTasks.size > 0) {
      await Promise.allSettled(Array.from(this.#cleanupTasks));
    }
  }
};
var DeviceSessionManager = class {
  #current;
  #tail = Promise.resolve();
  #transitionController = null;
  #closing = false;
  #closed = false;
  constructor(initial) {
    this.#current = initial;
  }
  get current() {
    return this.#current;
  }
  isCurrent(context) {
    return this.#current === context && !context.signal.aborted;
  }
  isPublished(context) {
    return this.#current === context;
  }
  assertCurrent(context) {
    if (!this.isCurrent(context)) {
      throw new SessionChangedError(
        context.generation,
        this.#closed || this.#current === context && context.signal.aborted ? null : this.#current.generation
      );
    }
  }
  assertPublished(context) {
    if (this.#closing || !this.isPublished(context)) {
      throw new SessionChangedError(
        context.generation,
        this.#closing ? null : this.#current.generation
      );
    }
  }
  switch(serial, prepare, activate) {
    return this.#enqueue(async () => {
      if (this.#closing) throw new Error("device session manager is closed");
      const previous = this.#current;
      if (previous.serial === serial && !previous.signal.aborted) return previous;
      const transition = new AbortController();
      this.#transitionController = transition;
      let next;
      try {
        next = await prepare(
          serial,
          previous.generation + 1,
          transition.signal
        );
      } finally {
        if (this.#transitionController === transition) {
          this.#transitionController = null;
        }
      }
      if (this.#closing) {
        await next.dispose("server stopped during device switch");
        throw new Error("device session manager is closed");
      }
      this.#current = next;
      try {
        activate?.(next);
      } catch (err) {
        this.#current = previous;
        await next.dispose("device session activation failed");
        throw err;
      }
      await previous.dispose("device switched", { clientCode: 1012 });
      return next;
    });
  }
  stop(context, reason, opts = {}) {
    return this.#enqueue(async () => {
      this.assertPublished(context);
      await context.dispose(reason, opts);
    });
  }
  close(reason) {
    this.#closing = true;
    this.#transitionController?.abort(
      new SessionChangedError(this.#current.generation, null)
    );
    const activeAtClose = this.#current;
    const immediateDispose = activeAtClose.dispose(reason, {
      clientCode: 1001
    });
    return this.#enqueue(async () => {
      if (this.#closed) {
        await immediateDispose;
        return;
      }
      this.#closed = true;
      await immediateDispose;
      if (this.#current !== activeAtClose) {
        await this.#current.dispose(reason, { clientCode: 1001 });
      }
    });
  }
  #enqueue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => {
      },
      () => {
      }
    );
    return result;
  }
};

// runtimes/serve-emu/src/location.ts
function finiteNumber3(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}
function optionalNumber2(value, name) {
  if (value === void 0 || value === null) return void 0;
  return finiteNumber3(value, name);
}
function optionalInteger(value, name) {
  const n = optionalNumber2(value, name);
  if (n === void 0) return void 0;
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
}
function decimal(value) {
  return String(Number(value.toFixed(7)));
}
function geoFixArgs(serial, fix) {
  if (!/^emulator-\d+$/.test(serial)) {
    throw new Error("location control is currently supported for Android Emulator serials only");
  }
  const args = [
    "-s",
    serial,
    "emu",
    "geo",
    "fix",
    decimal(fix.longitude),
    decimal(fix.latitude)
  ];
  if (fix.altitude !== void 0) args.push(decimal(fix.altitude));
  if (fix.satellites !== void 0) args.push(String(fix.satellites));
  if (fix.velocity !== void 0) args.push(decimal(fix.velocity));
  return args;
}
function assertGeoFixOutput(status, output2) {
  if (status !== 0 || /^KO\b/.test(output2)) {
    throw new Error(`adb emu geo fix failed: ${output2 || "unknown error"}`);
  }
}
function parseGeoFix(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("location payload must be an object");
  }
  const record2 = value;
  const latitude = finiteNumber3(record2.latitude, "latitude");
  const longitude = finiteNumber3(record2.longitude, "longitude");
  const altitude = optionalNumber2(record2.altitude, "altitude");
  const satellites = optionalInteger(record2.satellites, "satellites");
  const velocity = optionalNumber2(record2.velocity, "velocity");
  if (latitude < -90 || latitude > 90) throw new Error("latitude must be between -90 and 90");
  if (longitude < -180 || longitude > 180) throw new Error("longitude must be between -180 and 180");
  if (altitude !== void 0 && (altitude < -1e3 || altitude > 1e5)) {
    throw new Error("altitude must be between -1000 and 100000");
  }
  if (satellites !== void 0 && (satellites < 1 || satellites > 64)) {
    throw new Error("satellites must be between 1 and 64");
  }
  if (velocity !== void 0 && (velocity < 0 || velocity > 1e3)) {
    throw new Error("velocity must be between 0 and 1000");
  }
  return { latitude, longitude, altitude, satellites, velocity };
}
async function setEmulatorLocationAsync(serial, fix, signalOrExec, runExecOverride) {
  const signal = signalOrExec instanceof AbortSignal ? signalOrExec : void 0;
  const runExec = runExecOverride ?? (typeof signalOrExec === "function" ? signalOrExec : execText);
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("location update aborted");
  }
  const result = await runExec("adb", geoFixArgs(serial, fix), {
    timeout: 5e3,
    maxBuffer: 64 * 1024,
    lane: "interactive",
    signal
  });
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("location update aborted");
  }
  if (result.timedOut) throw new Error("adb emu geo fix timed out");
  const output2 = `${result.stdout}${result.stderr}`.trim();
  if (result.error) {
    throw new Error(
      `adb emu geo fix failed: ${output2 || result.error.message}`,
      { cause: result.error }
    );
  }
  assertGeoFixOutput(result.status, output2);
}

// runtimes/serve-emu/src/route-playback-api.ts
function routePlaybackErrorResponse(error, status = routePlaybackErrorStatus(error)) {
  return Response.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    },
    { status }
  );
}

// runtimes/serve-emu/src/api/routes/location.ts
function locationRoutes() {
  return [
    {
      method: "GET",
      path: "/api/location",
      handler: async ({ deps }) => {
        const { requestContext } = deps;
        return Response.json({
          generation: requestContext.generation,
          serial: requestContext.serial,
          emulator: /^emulator-\d+$/.test(requestContext.serial),
          location: requestContext.lastLocation
        });
      }
    },
    {
      method: "POST",
      path: "/api/location",
      handler: async ({ request: req, deps }) => {
        const {
          requestContext,
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2,
          applyLocation,
          errorResponse
        } = deps;
        try {
          const fix = parseGeoFix(
            await readJsonBody(req, MAX_JSON_BODY_BYTES2, requestContext)
          );
          const location = await applyLocation(
            requestContext,
            fix,
            "rest:location"
          );
          return Response.json({ ok: true, location });
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/route",
      handler: async ({ deps }) => {
        const { requestContext } = deps;
        return Response.json(requestContext.route.snapshot());
      }
    },
    {
      method: "POST",
      path: "/api/route",
      handler: async ({ request: req, deps }) => {
        const {
          requestContext,
          readJsonBody,
          MAX_ROUTE_BODY_BYTES: MAX_ROUTE_BODY_BYTES2,
          errorResponse,
          sessions
        } = deps;
        let route;
        try {
          route = parseRoutePlaybackRequest(
            await readJsonBody(req, MAX_ROUTE_BODY_BYTES2, requestContext)
          );
        } catch (err) {
          return errorResponse(err, 400);
        }
        try {
          const start = requestContext.route.start(route);
          const snapshot = await requestContext.trackDrain(start);
          sessions.assertCurrent(requestContext);
          return Response.json({
            ok: true,
            route: snapshot
          });
        } catch (err) {
          return err instanceof SessionChangedError ? errorResponse(err) : routePlaybackErrorResponse(err);
        }
      }
    },
    {
      method: "DELETE",
      path: "/api/route",
      handler: async ({ deps }) => {
        const { requestContext, sessions } = deps;
        sessions.assertCurrent(requestContext);
        return Response.json({
          ok: true,
          route: requestContext.route.stop()
        });
      }
    },
    {
      method: "POST",
      path: "/api/route/control",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2,
          requestContext,
          errorResponse
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext
          );
          if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("control payload must be an object");
          }
          const action = payload.action;
          if (action === "pause")
            return Response.json({
              ok: true,
              route: requestContext.route.pause()
            });
          if (action === "resume")
            return Response.json({
              ok: true,
              route: requestContext.route.resume()
            });
          if (action === "stop")
            return Response.json({
              ok: true,
              route: requestContext.route.stop()
            });
          throw new Error("action must be pause, resume, or stop");
        } catch (err) {
          return errorResponse(err);
        }
      }
    }
  ];
}

// runtimes/serve-emu/src/request-body.ts
var HTTP_BODY_ERROR_STATUS = {
  "payload-too-large": 413,
  "too-many-body-chunks": 413,
  "invalid-content-length": 400,
  "request-aborted": 499,
  "body-read-failed": 400,
  "invalid-json": 400
};
var MAX_REQUEST_BODY_CHUNKS = 262144;
var REQUEST_BODY_YIELD_INTERVAL = 256;
var HttpBodyError = class extends Error {
  code;
  status;
  limit;
  received;
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "HttpBodyError";
    this.code = code;
    this.status = HTTP_BODY_ERROR_STATUS[code];
    this.limit = options.limit;
    this.received = options.received;
  }
};
function assertMaxBytes(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
}
function abortedError(signal) {
  return new HttpBodyError("request-aborted", "request body read aborted", {
    cause: signal.reason
  });
}
function bodyTooLargeError(maxBytes, received) {
  return new HttpBodyError(
    "payload-too-large",
    `request body exceeds ${maxBytes} bytes`,
    { limit: maxBytes, received }
  );
}
function tooManyBodyChunksError(received) {
  return new HttpBodyError(
    "too-many-body-chunks",
    `request body exceeds ${MAX_REQUEST_BODY_CHUNKS} chunks`,
    { limit: MAX_REQUEST_BODY_CHUNKS, received }
  );
}
function yieldToMacrotask() {
  return new Promise((resolve) => setImmediate(resolve));
}
function parseContentLength(request, maxBytes) {
  const header = request.headers.get("content-length");
  if (header === null) return null;
  const value = header.trim();
  if (!/^\d+$/.test(value)) {
    throw new HttpBodyError(
      "invalid-content-length",
      "content-length must be a non-negative integer"
    );
  }
  const declared = BigInt(value);
  if (declared > BigInt(maxBytes)) {
    throw bodyTooLargeError(
      maxBytes,
      declared <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(declared) : void 0
    );
  }
  return Number(declared);
}
async function cancelUnlockedBody(body, reason) {
  if (!body || body.locked) return;
  try {
    await body.cancel(reason);
  } catch {
  }
}
async function readBodyLimited(request, maxBytes, externalSignal) {
  assertMaxBytes(maxBytes);
  try {
    parseContentLength(request, maxBytes);
  } catch (error) {
    await cancelUnlockedBody(request.body, error);
    throw error;
  }
  const signals = Array.from(
    new Set(
      [request.signal, externalSignal].filter(
        (signal) => signal !== void 0
      )
    )
  );
  const alreadyAborted = signals.find((signal) => signal.aborted);
  if (alreadyAborted) {
    const error = abortedError(alreadyAborted);
    await cancelUnlockedBody(request.body, error);
    throw error;
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let abortFailure = null;
  let cancelPromise = null;
  const cancel = (reason) => {
    if (!cancelPromise) {
      cancelPromise = reader.cancel(reason).then(
        () => {
        },
        () => {
        }
      );
    }
    return cancelPromise;
  };
  const listeners = signals.map((signal) => {
    const onAbort = () => {
      abortFailure ??= abortedError(signal);
      void cancel(abortFailure);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return { signal, onAbort };
  });
  for (const { signal, onAbort } of listeners) {
    if (signal.aborted) onAbort();
  }
  let body = new Uint8Array(Math.min(maxBytes, 16 * 1024));
  let received = 0;
  let chunksRead = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (abortFailure) throw abortFailure;
      if (next.done) break;
      chunksRead += 1;
      if (chunksRead > MAX_REQUEST_BODY_CHUNKS) {
        const error = tooManyBodyChunksError(chunksRead);
        await cancel(error);
        throw error;
      }
      const nextReceived = received + next.value.byteLength;
      if (nextReceived > maxBytes) {
        const error = bodyTooLargeError(maxBytes, nextReceived);
        await cancel(error);
        throw error;
      }
      if (nextReceived > body.byteLength) {
        const capacity = Math.min(
          maxBytes,
          Math.max(nextReceived, Math.max(1024, body.byteLength * 2))
        );
        const grown = new Uint8Array(capacity);
        grown.set(body.subarray(0, received));
        body = grown;
      }
      body.set(next.value, received);
      received = nextReceived;
      if (chunksRead % REQUEST_BODY_YIELD_INTERVAL === 0) {
        await yieldToMacrotask();
        if (abortFailure) throw abortFailure;
      }
    }
    if (abortFailure) throw abortFailure;
    return received === body.byteLength ? body : body.slice(0, received);
  } catch (cause) {
    const error = cause instanceof HttpBodyError ? cause : abortFailure ?? new HttpBodyError(
      "body-read-failed",
      "failed to read request body",
      { cause }
    );
    await cancel(error);
    throw error;
  } finally {
    for (const { signal, onAbort } of listeners) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }
}
async function readJsonLimited(request, maxBytes, externalSignal) {
  const body = await readBodyLimited(request, maxBytes, externalSignal);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text);
  } catch (cause) {
    throw new HttpBodyError("invalid-json", "request body is not valid JSON", {
      cause
    });
  }
}

// runtimes/serve-emu/src/session-api.ts
var DEFAULT_SESSION_PAGE_LIMIT = 50;
var MAX_SESSION_PAGE_LIMIT = 200;
function positiveSafeInteger(value, name) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}
function parseSessionPageQuery(searchParams) {
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_SESSION_PAGE_LIMIT : positiveSafeInteger(rawLimit, "limit");
  if (limit > MAX_SESSION_PAGE_LIMIT) {
    throw new Error(`limit must be at most ${MAX_SESSION_PAGE_LIMIT}`);
  }
  const rawBefore = searchParams.get("before");
  return rawBefore === null ? { limit } : { limit, before: positiveSafeInteger(rawBefore, "before") };
}

// runtimes/serve-emu/src/session-replay-api.ts
function sessionReplayErrorResponse(error, status = sessionReplayErrorStatus(error)) {
  return Response.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    },
    { status }
  );
}
function startSessionReplayResponse(recorder, handlers, multiplier, isCurrent = () => true) {
  if (!isCurrent()) {
    return sessionReplayErrorResponse(
      new SessionReplayConflictError(
        "device session changed before session replay start"
      )
    );
  }
  try {
    const replay = recorder.startReplay(handlers, multiplier);
    return Response.json({ ok: true, session: replay.snapshot });
  } catch (error) {
    return sessionReplayErrorResponse(error);
  }
}
async function stopSessionReplayResponse(recorder) {
  try {
    return Response.json({
      ok: true,
      session: await recorder.cancelAndWait()
    });
  } catch (error) {
    return sessionReplayErrorResponse(error);
  }
}
function clearSessionReplayResponse(recorder) {
  try {
    return Response.json({ ok: true, session: recorder.clear() });
  } catch (error) {
    return sessionReplayErrorResponse(error);
  }
}

// runtimes/serve-emu/src/session-replay-session.ts
function abortReason2(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("session replay cancelled", "AbortError");
}
function createSessionReplayHandlers(opts) {
  const assertCurrent = (signal) => {
    if (signal.aborted) throw abortReason2(signal);
    if (opts.generation !== opts.getGeneration()) {
      throw new SessionReplayConflictError(
        "device session changed during session replay"
      );
    }
  };
  return {
    dispatchGesture: async (gesture, signal) => {
      assertCurrent(signal);
      await opts.dispatchGesture(gesture, signal);
      assertCurrent(signal);
    },
    setLocation: async (fix, signal) => {
      assertCurrent(signal);
      await opts.setLocation(fix, signal);
      assertCurrent(signal);
    }
  };
}

// runtimes/serve-emu/src/api/routes/session.ts
function sessionRoutes() {
  return [
    {
      method: "GET",
      path: "/api/session",
      handler: async ({ url, deps }) => {
        const { responseMetrics, requestContext, errorResponse } = deps;
        try {
          return responseMetrics.response(
            "sessionPage",
            requestContext.recorder.page(
              parseSessionPageQuery(url.searchParams)
            )
          );
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "DELETE",
      path: "/api/session",
      handler: async ({ deps }) => {
        const { requestContext, errorResponse, sessions } = deps;
        try {
          sessions.assertCurrent(requestContext);
          return clearSessionReplayResponse(requestContext.recorder);
        } catch (err) {
          return errorResponse(err);
        }
      }
    },
    {
      method: "GET",
      path: "/api/session/export",
      handler: async ({ deps }) => {
        const { responseMetrics, requestContext } = deps;
        return responseMetrics.response(
          "sessionExport",
          requestContext.recorder.export()
        );
      }
    },
    {
      method: "POST",
      path: "/api/session/replay",
      handler: async ({ request: req, deps }) => {
        const {
          requestContext,
          readJsonBody,
          MAX_JSON_BODY_BYTES: MAX_JSON_BODY_BYTES2,
          errorResponse,
          sessions,
          enqueueGesture,
          setLocation
        } = deps;
        const replayRecorder = requestContext.recorder;
        const replayAdmissionEpoch = replayRecorder.replayAdmissionEpoch;
        let multiplier;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES2,
            requestContext
          );
          multiplier = parseSessionReplayMultiplier(payload);
        } catch (err) {
          return err instanceof SessionChangedError || err instanceof HttpBodyError ? errorResponse(err) : sessionReplayErrorResponse(err, 400);
        }
        const isCurrentReplaySession = () => replayAdmissionEpoch === replayRecorder.replayAdmissionEpoch && replayRecorder === requestContext.recorder && sessions.isCurrent(requestContext);
        const handlers = createSessionReplayHandlers({
          generation: requestContext.generation,
          getGeneration: () => sessions.current.generation,
          dispatchGesture: (gesture) => enqueueGesture(
            requestContext,
            gesture,
            "session:replay",
            false
          ).completion.then(() => {
          }),
          setLocation: async (fix, signal) => {
            requestContext.route.stop();
            await setLocation(requestContext.serial, fix, signal);
            if (!isCurrentReplaySession()) {
              throw new SessionReplayConflictError(
                "device session changed during session replay"
              );
            }
            requestContext.lastLocation = {
              ...fix,
              appliedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
          }
        });
        return startSessionReplayResponse(
          replayRecorder,
          handlers,
          multiplier,
          isCurrentReplaySession
        );
      }
    },
    {
      method: "POST",
      path: "/api/session/replay/stop",
      handler: async ({ deps }) => {
        const { requestContext, sessions } = deps;
        const stoppedRecorder = requestContext.recorder;
        const response = await stopSessionReplayResponse(stoppedRecorder);
        if (!sessions.isCurrent(requestContext)) {
          return sessionReplayErrorResponse(
            new SessionReplayConflictError(
              "device session changed while stopping session replay"
            )
          );
        }
        return response;
      }
    }
  ];
}

// runtimes/serve-emu/src/api/routes/index.ts
function createApiRoutes() {
  return [
    ...deviceRoutes(),
    ...inspectionRoutes(),
    ...inputRoutes(),
    ...applicationRoutes(),
    ...locationRoutes(),
    ...sessionRoutes()
  ];
}

// runtimes/serve-emu/src/json-response.ts
function emptyMetric() {
  return {
    responses: 0,
    lastBytes: 0,
    maxBytes: 0,
    lastSerializationMs: 0,
    maxSerializationMs: 0,
    lastAt: null
  };
}
function roundedMilliseconds(value) {
  return Math.round(Math.max(0, value) * 1e3) / 1e3;
}
var JsonResponseTracker = class {
  #metrics;
  #measureNow;
  #wallNow;
  constructor(channels, dependencies = {}) {
    this.#metrics = Object.fromEntries(
      channels.map((channel) => [channel, emptyMetric()])
    );
    this.#measureNow = dependencies.measureNow ?? performance.now.bind(performance);
    this.#wallNow = dependencies.wallNow ?? (() => /* @__PURE__ */ new Date());
  }
  response(channel, value, init = {}) {
    const started = this.#measureNow();
    const body = JSON.stringify(value);
    if (body === void 0) {
      throw new TypeError("JSON response value is not serializable");
    }
    const serializationMs = roundedMilliseconds(
      this.#measureNow() - started
    );
    const bytes = Buffer.byteLength(body, "utf8");
    const metric = this.#metrics[channel];
    metric.responses++;
    metric.lastBytes = bytes;
    metric.maxBytes = Math.max(metric.maxBytes, bytes);
    metric.lastSerializationMs = serializationMs;
    metric.maxSerializationMs = Math.max(
      metric.maxSerializationMs,
      serializationMs
    );
    metric.lastAt = this.#wallNow().toISOString();
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }
    headers.set("Content-Length", String(bytes));
    return new Response(body, { ...init, headers });
  }
  snapshot() {
    const snapshot = {};
    for (const channel of Object.keys(this.#metrics)) {
      snapshot[channel] = { ...this.#metrics[channel] };
    }
    return snapshot;
  }
};

// runtimes/serve-emu/src/multipart-upload.ts
import Busboy from "@fastify/busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";
import { pipeline as pipeline2 } from "node:stream/promises";
var DEFAULT_HEADER_PAIRS = 32;
var DEFAULT_HEADER_BYTES = 16 * 1024;
var MAX_CONTENT_TYPE_BYTES = 1024;
var DEFAULT_STREAM_HIGH_WATER_MARK = 64 * 1024;
var PARSER_FEED_BYTES = 64 * 1024;
var PARSER_TRAILER_BYTES = 8 * 1024;
var ParserTrailerBuffer = class {
  #buffer = Buffer.allocUnsafe(
    PARSER_FEED_BYTES + PARSER_TRAILER_BYTES
  );
  #start = 0;
  #length = 0;
  async append(chunk, write) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (this.#length === this.#buffer.byteLength) {
        await this.#flushPrefix(PARSER_FEED_BYTES, write);
      }
      const writable = Math.min(
        this.#buffer.byteLength - this.#length,
        chunk.byteLength - offset
      );
      const end = (this.#start + this.#length) % this.#buffer.byteLength;
      const first = Math.min(writable, this.#buffer.byteLength - end);
      chunk.copy(this.#buffer, end, offset, offset + first);
      if (first < writable) {
        chunk.copy(
          this.#buffer,
          0,
          offset + first,
          offset + writable
        );
      }
      this.#length += writable;
      offset += writable;
    }
  }
  async finish(write) {
    if (this.#length > PARSER_TRAILER_BYTES) {
      await this.#flushPrefix(this.#length - PARSER_TRAILER_BYTES, write);
    }
    if (this.#length === 0) return;
    const trailer = Buffer.allocUnsafe(this.#length);
    const first = Math.min(
      this.#length,
      this.#buffer.byteLength - this.#start
    );
    this.#buffer.copy(trailer, 0, this.#start, this.#start + first);
    if (first < this.#length) {
      this.#buffer.copy(trailer, first, 0, this.#length - first);
    }
    this.#start = 0;
    this.#length = 0;
    await write(trailer);
  }
  async #flushPrefix(bytes, write) {
    let remaining = bytes;
    while (remaining > 0) {
      const contiguous = Math.min(
        remaining,
        this.#buffer.byteLength - this.#start
      );
      const owned = Buffer.from(
        this.#buffer.subarray(this.#start, this.#start + contiguous)
      );
      await write(owned);
      this.#start = (this.#start + contiguous) % this.#buffer.byteLength;
      this.#length -= contiguous;
      remaining -= contiguous;
    }
  }
};
var MULTIPART_UPLOAD_ERROR_STATUS = {
  "invalid-multipart": 400,
  "unexpected-multipart-part": 400,
  "upload-write-failed": 500,
  "upload-cleanup-failed": 500
};
var MultipartUploadError = class extends Error {
  code;
  status;
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "MultipartUploadError";
    this.code = code;
    this.status = MULTIPART_UPLOAD_ERROR_STATUS[code];
  }
};
function deferred() {
  let resolvePromise;
  let rejectPromise;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
    get settled() {
      return settled;
    }
  };
}
function assertNonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
function bodyTooLarge(limit, received, message = `request body exceeds ${limit} bytes`) {
  return new HttpBodyError("payload-too-large", message, { limit, received });
}
function tooManyBodyChunks(received) {
  return new HttpBodyError(
    "too-many-body-chunks",
    `request body exceeds ${MAX_REQUEST_BODY_CHUNKS} chunks`,
    { limit: MAX_REQUEST_BODY_CHUNKS, received }
  );
}
function aborted(signal) {
  return new HttpBodyError("request-aborted", "multipart upload aborted", {
    cause: signal.reason
  });
}
function parseDeclaredLength(request, maxBodyBytes) {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const value = header.trim();
  if (!/^\d+$/.test(value)) {
    throw new HttpBodyError(
      "invalid-content-length",
      "content-length must be a non-negative integer"
    );
  }
  const declared = BigInt(value);
  if (declared > BigInt(maxBodyBytes)) {
    throw bodyTooLarge(
      maxBodyBytes,
      declared <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(declared) : void 0
    );
  }
}
async function cancelUnlockedBody2(body, reason) {
  if (!body || body.locked) return;
  try {
    await body.cancel(reason);
  } catch {
  }
}
function normalizeFailure(error) {
  if (error instanceof Error) return error;
  return new MultipartUploadError(
    "invalid-multipart",
    "multipart upload failed",
    { cause: error }
  );
}
function parserFailure(error) {
  return new MultipartUploadError(
    "invalid-multipart",
    "request body is not valid multipart/form-data",
    { cause: error }
  );
}
async function writeParserChunk(parser, chunk, signal) {
  await new Promise((resolve, reject) => {
    let callbackDone = false;
    let drainDone = false;
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      parser.off("close", onClose);
      parser.off("drain", onDrain);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = () => {
      if (settled || !callbackDone || !drainDone) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => fail(signal.reason);
    const onClose = () => fail(signal.reason ?? parserFailure("parser closed"));
    const onDrain = () => {
      drainDone = true;
      finish();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    parser.once("close", onClose);
    try {
      const accepted = parser.write(chunk, (error) => {
        if (error) {
          fail(error);
          return;
        }
        callbackDone = true;
        finish();
      });
      drainDone = accepted;
      if (!accepted) parser.once("drain", onDrain);
      finish();
    } catch (error) {
      fail(error);
    }
  });
}
async function stageMultipartUpload(request, options) {
  if (!options.fieldName) throw new TypeError("fieldName must not be empty");
  assertNonNegativeSafeInteger(options.maxBodyBytes, "maxBodyBytes");
  assertNonNegativeSafeInteger(options.maxFileBytes, "maxFileBytes");
  const maxHeaderPairs = options.maxHeaderPairs ?? DEFAULT_HEADER_PAIRS;
  const maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_HEADER_BYTES;
  const highWaterMark = options.highWaterMark ?? DEFAULT_STREAM_HIGH_WATER_MARK;
  const fileHighWaterMark = options.fileHighWaterMark ?? DEFAULT_STREAM_HIGH_WATER_MARK;
  assertPositiveSafeInteger(maxHeaderPairs, "maxHeaderPairs");
  assertPositiveSafeInteger(maxHeaderBytes, "maxHeaderBytes");
  assertPositiveSafeInteger(highWaterMark, "highWaterMark");
  assertPositiveSafeInteger(fileHighWaterMark, "fileHighWaterMark");
  const signals = Array.from(
    new Set(
      [request.signal, options.signal].filter(
        (signal) => signal !== void 0
      )
    )
  );
  const alreadyAborted = signals.find((signal) => signal.aborted);
  if (alreadyAborted) {
    const error = aborted(alreadyAborted);
    await cancelUnlockedBody2(request.body, error);
    throw error;
  }
  try {
    parseDeclaredLength(request, options.maxBodyBytes);
  } catch (error) {
    await cancelUnlockedBody2(request.body, error);
    throw error;
  }
  let directory = null;
  let cleanupPromise = null;
  const cleanup = () => {
    if (!directory) return Promise.resolve();
    cleanupPromise ??= rm(directory, { recursive: true, force: true });
    return cleanupPromise;
  };
  let parser = null;
  let reader = null;
  let activeFile = null;
  let activeWriter = null;
  let ingestion = null;
  let filePipeline = null;
  let primaryFailure = null;
  const processing = new AbortController();
  const parserDone = deferred();
  const fileDone = deferred();
  void parserDone.promise.catch(() => {
  });
  void fileDone.promise.catch(() => {
  });
  const recordFailure = (error) => {
    primaryFailure ??= error;
    return primaryFailure;
  };
  const stop = (error) => {
    const failure = recordFailure(error);
    parserDone.reject(failure);
    fileDone.reject(failure);
    if (!processing.signal.aborted) processing.abort(failure);
    if (reader) void reader.cancel(failure).catch(() => {
    });
    activeFile?.destroy();
    activeWriter?.destroy();
    parser?.destroy();
  };
  const abortListeners = signals.map((signal) => {
    const onAbort = () => stop(aborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    return { signal, onAbort };
  });
  try {
    try {
      directory = await mkdtemp(
        join3(options.tempRoot ?? tmpdir(), "serve-emu-upload-")
      );
    } catch (cause) {
      throw new MultipartUploadError(
        "upload-write-failed",
        "failed to create multipart upload directory",
        { cause }
      );
    }
    const racedAbort = signals.find((signal) => signal.aborted);
    if (racedAbort) throw aborted(racedAbort);
    const contentType = request.headers.get("content-type");
    if (!contentType) {
      throw parserFailure("missing content-type header");
    }
    if (Buffer.byteLength(contentType, "utf8") > MAX_CONTENT_TYPE_BYTES) {
      throw parserFailure("content-type header is too large");
    }
    let stagedPath = join3(directory, "upload");
    let filename = null;
    let mediaType = null;
    let size = 0;
    let fileSeen = false;
    let parserFinished = false;
    try {
      parser = new Busboy({
        headers: { "content-type": contentType },
        highWaterMark,
        fileHwm: fileHighWaterMark,
        preservePath: false,
        limits: {
          fieldNameSize: Buffer.byteLength(options.fieldName, "utf8"),
          fieldSize: 0,
          fields: 0,
          fileSize: options.maxFileBytes,
          files: 1,
          parts: 1,
          headerPairs: maxHeaderPairs,
          headerSize: maxHeaderBytes
        }
      });
    } catch (error) {
      throw parserFailure(error);
    }
    parser.once("error", (error) => {
      const failure = recordFailure(parserFailure(error));
      parserDone.reject(failure);
    });
    parser.once("close", () => {
      if (!parserFinished) {
        parserDone.reject(
          primaryFailure ?? parserFailure("multipart parser closed early")
        );
      }
    });
    parser.once("finish", () => {
      parserFinished = true;
      if (!fileSeen) {
        fileDone.reject(
          recordFailure(
            new MultipartUploadError(
              "unexpected-multipart-part",
              `multipart field ${options.fieldName} must be a file`
            )
          )
        );
      }
      parserDone.resolve();
    });
    parser.once("partsLimit", () => {
      fileDone.reject(
        recordFailure(
          new MultipartUploadError(
            "unexpected-multipart-part",
            "multipart upload must contain exactly one part"
          )
        )
      );
    });
    parser.once("filesLimit", () => {
      fileDone.reject(
        recordFailure(
          new MultipartUploadError(
            "unexpected-multipart-part",
            "multipart upload must contain exactly one file"
          )
        )
      );
    });
    parser.once("fieldsLimit", () => {
      fileDone.reject(
        recordFailure(
          new MultipartUploadError(
            "unexpected-multipart-part",
            `multipart field ${options.fieldName} must be a file`
          )
        )
      );
    });
    parser.on(
      "file",
      (fieldName, stream, uploadedFilename, _transferEncoding, mimeType) => {
        if (fileSeen || fieldName !== options.fieldName) {
          stream.resume();
          fileDone.reject(
            recordFailure(
              new MultipartUploadError(
                "unexpected-multipart-part",
                `unexpected multipart file field ${fieldName}`
              )
            )
          );
          return;
        }
        if (typeof uploadedFilename !== "string") {
          stream.resume();
          fileDone.reject(
            recordFailure(
              new MultipartUploadError(
                "unexpected-multipart-part",
                `multipart field ${options.fieldName} must include a filename`
              )
            )
          );
          return;
        }
        fileSeen = true;
        filename = uploadedFilename;
        mediaType = mimeType;
        if (uploadedFilename.toLowerCase().endsWith(".apk")) {
          stagedPath = join3(directory, "upload.apk");
        }
        activeFile = stream;
        stream.once("limit", () => {
          fileDone.reject(
            recordFailure(
              bodyTooLarge(
                options.maxFileBytes,
                options.maxFileBytes + 1,
                `multipart file exceeds ${options.maxFileBytes} bytes`
              )
            )
          );
        });
        try {
          activeWriter = options.writerFactory ? options.writerFactory(stagedPath) : createWriteStream(stagedPath, { flags: "wx", mode: 384 });
          filePipeline = pipeline2(stream, activeWriter, {
            signal: processing.signal
          }).then(
            () => {
              if (stream.truncated) {
                fileDone.reject(
                  recordFailure(
                    bodyTooLarge(
                      options.maxFileBytes,
                      stream.bytesRead + 1,
                      `multipart file exceeds ${options.maxFileBytes} bytes`
                    )
                  )
                );
                return;
              }
              size = stream.bytesRead;
              activeFile = null;
              activeWriter = null;
              fileDone.resolve();
            },
            (error) => {
              const failure = primaryFailure ?? new MultipartUploadError(
                "upload-write-failed",
                "failed to write multipart upload",
                { cause: error }
              );
              fileDone.reject(recordFailure(failure));
            }
          );
        } catch (error) {
          stream.resume();
          fileDone.reject(
            recordFailure(
              new MultipartUploadError(
                "upload-write-failed",
                "failed to create multipart upload file",
                { cause: error }
              )
            )
          );
        }
      }
    );
    if (!request.body) {
      throw parserFailure("multipart request body is missing");
    }
    reader = request.body.getReader();
    ingestion = (async () => {
      let received = 0;
      let chunksRead = 0;
      const trailer = new ParserTrailerBuffer();
      const write = (buffer) => writeParserChunk(parser, buffer, processing.signal);
      while (true) {
        const next = await reader.read();
        if (processing.signal.aborted) throw processing.signal.reason;
        if (next.done) break;
        chunksRead++;
        if (chunksRead > MAX_REQUEST_BODY_CHUNKS) {
          throw tooManyBodyChunks(chunksRead);
        }
        if (next.value.byteLength > options.maxBodyBytes - received) {
          throw bodyTooLarge(
            options.maxBodyBytes,
            received + next.value.byteLength
          );
        }
        received += next.value.byteLength;
        const chunk = Buffer.from(
          next.value.buffer,
          next.value.byteOffset,
          next.value.byteLength
        );
        await trailer.append(chunk, write);
        if (chunksRead % REQUEST_BODY_YIELD_INTERVAL === 0) {
          await yieldToMacrotask();
          if (processing.signal.aborted) throw processing.signal.reason;
        }
      }
      await trailer.finish(write);
      parser.end();
    })();
    await Promise.all([ingestion, parserDone.promise, fileDone.promise]);
    if (processing.signal.aborted) throw processing.signal.reason;
    if (primaryFailure) throw primaryFailure;
    if (filename === null || mediaType === null) {
      throw parserFailure("multipart file metadata is missing");
    }
    reader.releaseLock();
    reader = null;
    return { path: stagedPath, filename, mediaType, size, cleanup };
  } catch (error) {
    const failure = recordFailure(normalizeFailure(error));
    stop(failure);
    await Promise.allSettled(
      [ingestion, filePipeline].filter(
        (promise) => promise !== null
      )
    );
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new MultipartUploadError(
        "upload-cleanup-failed",
        "failed to clean up multipart upload",
        { cause: new AggregateError([failure, cleanupError]) }
      );
    }
    throw failure;
  } finally {
    for (const { signal, onAbort } of abortListeners) {
      signal.removeEventListener("abort", onAbort);
    }
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
      }
    }
  }
}

// runtimes/serve-emu/src/server/backpressure.ts
function frameDeliveryDecision(options) {
  if (options.bufferedBytes > options.closeThresholdBytes) {
    return "close-slow-client";
  }
  if (options.awaitingKeyFrame && !options.isKeyFrame) {
    return "drop-awaiting-keyframe";
  }
  if (options.bufferedBytes > options.dropThresholdBytes) {
    return "drop-buffered";
  }
  return "send";
}

// runtimes/serve-emu/src/session-recovery-watchdog.ts
var SYSTEM_RECOVERY_WATCHDOG_CLOCK = {
  now: Date.now,
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (timer) => clearInterval(timer)
};
var DEFAULT_INTERVAL_MS2 = 1e3;
var DEFAULT_SESSION_RESET_COOLDOWN_MS = 500;
var DEFAULT_FIRST_FRAME_RESET_MS = 5e3;
var DEFAULT_SOURCE_STALL_RESET_MS = 2500;
var DEFAULT_AWAITING_KEYFRAME_RESET_MS = 2500;
var SessionRecoveryWatchdog = class {
  startedMs;
  #clock;
  #clients;
  #requestReset;
  #intervalMs;
  #sessionResetCooldownMs;
  #firstFrameResetMs;
  #sourceStallResetMs;
  #awaitingKeyFrameResetMs;
  #timer = null;
  #runEpoch = 0;
  #frameCount = 0;
  #lastFrameMs = null;
  #sourceFps = 0;
  #lastFpsFrameCount = 0;
  #lastFpsSampleMs;
  #lastSessionResetAttemptMs = null;
  constructor(options) {
    this.#clock = options.clock ?? SYSTEM_RECOVERY_WATCHDOG_CLOCK;
    this.#clients = options.clients;
    this.#requestReset = options.requestReset;
    this.startedMs = options.startedMs ?? this.#clock.now();
    this.#lastFpsSampleMs = this.startedMs;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS2;
    this.#sessionResetCooldownMs = options.sessionResetCooldownMs ?? DEFAULT_SESSION_RESET_COOLDOWN_MS;
    this.#firstFrameResetMs = options.firstFrameResetMs ?? DEFAULT_FIRST_FRAME_RESET_MS;
    this.#sourceStallResetMs = options.sourceStallResetMs ?? DEFAULT_SOURCE_STALL_RESET_MS;
    this.#awaitingKeyFrameResetMs = options.awaitingKeyFrameResetMs ?? DEFAULT_AWAITING_KEYFRAME_RESET_MS;
  }
  get running() {
    return this.#timer !== null;
  }
  start() {
    if (this.#timer !== null) return;
    const epoch = ++this.#runEpoch;
    this.#timer = this.#clock.setInterval(() => {
      if (this.#timer === null || epoch !== this.#runEpoch) return;
      this.tick();
    }, this.#intervalMs);
  }
  stop() {
    if (this.#timer === null) return;
    this.#runEpoch++;
    this.#clock.clearInterval(this.#timer);
    this.#timer = null;
  }
  recordFrame() {
    this.#frameCount++;
    this.#lastFrameMs = this.#clock.now();
  }
  markAwaiting(client) {
    if (!client.awaitingKeyFrame) {
      client.awaitingKeyFrame = true;
      client.lastKeyFrameRequestMs = null;
    }
    if (client.awaitingKeyFrameSinceMs === null) {
      client.awaitingKeyFrameSinceMs = this.#clock.now();
    }
  }
  keyFrameAccepted(client) {
    if (!client.awaitingKeyFrame) return;
    client.awaitingKeyFrame = false;
    client.awaitingKeyFrameSinceMs = null;
    client.lastKeyFrameRequestMs = null;
  }
  requestVideoReset(reason) {
    const now = this.#clock.now();
    if (this.#lastSessionResetAttemptMs !== null && now - this.#lastSessionResetAttemptMs < this.#sessionResetCooldownMs) {
      return false;
    }
    this.#lastSessionResetAttemptMs = now;
    let admitted = false;
    try {
      admitted = this.#requestReset(reason, now);
    } catch {
      return false;
    }
    if (!admitted) return false;
    for (const client of this.#clients()) {
      if (client.awaitingKeyFrame) client.lastKeyFrameRequestMs = now;
    }
    return true;
  }
  tick() {
    const now = this.#clock.now();
    const elapsedMs = now - this.#lastFpsSampleMs;
    if (elapsedMs > 0) {
      const elapsedFrames = this.#frameCount - this.#lastFpsFrameCount;
      this.#sourceFps = elapsedFrames * 1e3 / elapsedMs;
      this.#lastFpsFrameCount = this.#frameCount;
      this.#lastFpsSampleMs = now;
    }
    const clients = Array.from(this.#clients());
    if (clients.length === 0) return;
    if (this.#frameCount === 0 && now - this.startedMs >= this.#firstFrameResetMs) {
      this.requestVideoReset("first video frame not received");
    } else if (this.#lastFrameMs !== null && now - this.#lastFrameMs >= this.#sourceStallResetMs) {
      this.requestVideoReset("video source stalled");
    }
    const awaitingRetry = clients.some((client) => {
      if (!client.awaitingKeyFrame || client.awaitingKeyFrameSinceMs === null) {
        return false;
      }
      const retryFrom = client.lastKeyFrameRequestMs ?? client.awaitingKeyFrameSinceMs;
      return now - retryFrom >= this.#awaitingKeyFrameResetMs;
    });
    if (awaitingRetry) {
      this.requestVideoReset("client awaiting keyframe");
    }
  }
  snapshot(nowMs = this.#clock.now()) {
    let awaitingClients = 0;
    let oldestAwaitingAgeMs = null;
    for (const client of this.#clients()) {
      if (!client.awaitingKeyFrame || client.awaitingKeyFrameSinceMs === null) {
        continue;
      }
      awaitingClients++;
      const ageMs = Math.max(0, nowMs - client.awaitingKeyFrameSinceMs);
      oldestAwaitingAgeMs = Math.max(oldestAwaitingAgeMs ?? 0, ageMs);
    }
    return {
      sourceFps: this.#sourceFps,
      lastFrameMs: this.#lastFrameMs,
      sourceFrameAgeMs: Math.max(
        0,
        nowMs - (this.#lastFrameMs ?? this.startedMs)
      ),
      awaitingClients,
      oldestAwaitingAgeMs,
      lastResetAttemptMs: this.#lastSessionResetAttemptMs
    };
  }
};

// runtimes/serve-emu/src/session-status.ts
function terminalTransitionAllowed(current, next) {
  if (current === "error") return false;
  if (current !== "streaming" && next !== "error") return false;
  return true;
}
function isAbnormalExit(code, signal) {
  return signal !== null || (code ?? 0) !== 0;
}
function procExitDetail(code, signal) {
  return {
    reason: `scrcpy exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
    code: "process-exit",
    meta: {
      ...code !== null ? { exitCode: code } : {},
      ...signal !== null ? { signal } : {}
    }
  };
}

// runtimes/serve-emu/src/shared/frame-meta.ts
var FRAME_META_MAGIC = 1397050709;
var FRAME_META_VERSION = 2;
var FRAME_META_HEADER_BYTES = 24;
var FRAME_FLAG_KEY = 1 << 0;
var epochNowMs = () => performance.timeOrigin + performance.now();
function writeFrameMetaHeader(target, meta) {
  const view = new DataView(target.buffer, target.byteOffset, FRAME_META_HEADER_BYTES);
  view.setUint32(0, FRAME_META_MAGIC, false);
  view.setUint8(4, FRAME_META_VERSION);
  view.setUint8(5, meta.isKey ? FRAME_FLAG_KEY : 0);
  view.setUint16(6, 0, false);
  view.setBigUint64(8, meta.pts, false);
  view.setBigUint64(16, BigInt(Math.round(meta.serverTsMs * 1e3)), false);
}

// runtimes/serve-emu/src/shared/control-contracts.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber4(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}
function unitNumber2(value, name) {
  const n = finiteNumber4(value, name);
  if (n < 0 || n > 1) throw new Error(`${name} must be between 0 and 1`);
  return n;
}
function optionalDurationMs2(value) {
  if (value === void 0) return void 0;
  const n = finiteNumber4(value, "durationMs");
  if (n < 0 || n > 1e4) throw new Error("durationMs must be between 0 and 10000");
  return n;
}
function optionalPointerId2(value) {
  if (value === void 0) return void 0;
  const n = finiteNumber4(value, "pointerId");
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new Error("pointerId must be a non-negative safe integer");
  }
  return n;
}
function keycode2(value) {
  const n = finiteNumber4(value, "keycode");
  if (!Number.isInteger(n) || n < 0 || n > 1e4) {
    throw new Error("keycode must be an integer between 0 and 10000");
  }
  return n;
}
function optionalKeyAction2(value) {
  if (value === void 0) return void 0;
  if (value !== "down" && value !== "up") throw new Error("key action must be down or up");
  return value;
}
function optionalMetaState2(value) {
  if (value === void 0) return void 0;
  const n = finiteNumber4(value, "metaState");
  if (!Number.isInteger(n) || n < 0 || n > 2147483647) {
    throw new Error("metaState must be a non-negative 32-bit integer");
  }
  return n;
}
function parseGesture2(value) {
  if (!isRecord4(value) || typeof value.type !== "string") {
    throw new Error("message must be a gesture object");
  }
  switch (value.type) {
    case "tap":
      return { type: "tap", x: unitNumber2(value.x, "x"), y: unitNumber2(value.y, "y") };
    case "swipe":
      return {
        type: "swipe",
        x1: unitNumber2(value.x1, "x1"),
        y1: unitNumber2(value.y1, "y1"),
        x2: unitNumber2(value.x2, "x2"),
        y2: unitNumber2(value.y2, "y2"),
        durationMs: optionalDurationMs2(value.durationMs)
      };
    case "touch": {
      if (value.action !== "down" && value.action !== "move" && value.action !== "up") {
        throw new Error("touch action must be down, move, or up");
      }
      return {
        type: "touch",
        action: value.action,
        x: unitNumber2(value.x, "x"),
        y: unitNumber2(value.y, "y"),
        pointerId: optionalPointerId2(value.pointerId)
      };
    }
    case "key":
      return {
        type: "key",
        keycode: keycode2(value.keycode),
        action: optionalKeyAction2(value.action),
        metaState: optionalMetaState2(value.metaState)
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

// runtimes/serve-emu/src/shared/websocket-contracts.ts
function record(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}
function optionalBoolean(value, name) {
  if (value === void 0) return void 0;
  if (typeof value !== "boolean")
    throw new TypeError(`${name} must be a boolean`);
  return value;
}
function parseWsRequestId(value) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new TypeError("requestId must be a string of 1 to 128 characters");
  }
  return value;
}
function clockTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new TypeError("clock timestamp must be a non-negative finite number");
  return value;
}
function parseWsClientMessage(value) {
  const source = record(value, "WebSocket client message");
  const ack = optionalBoolean(source.ack, "ack");
  const requestId = parseWsRequestId(source.requestId);
  const correlation = requestId === void 0 ? {} : { requestId };
  if (source.type === "clock-sync") {
    return {
      type: "clock-sync",
      clientTsMs: clockTimestamp(source.clientTsMs),
      ...correlation,
      ...ack === void 0 ? {} : { ack }
    };
  }
  if (source.type === "reset-video") {
    return {
      type: "reset-video",
      ...correlation,
      ...ack === void 0 ? {} : { ack }
    };
  }
  const recordAction = optionalBoolean(source.record, "record");
  const gesture = parseGesture2(source);
  return {
    ...gesture,
    ...correlation,
    ...ack === void 0 ? {} : { ack },
    ...recordAction === void 0 ? {} : { record: recordAction }
  };
}

// runtimes/serve-emu/src/upload-manager.ts
var UploadManagerError = class extends Error {
  constructor(code, message, context, options) {
    super(message, options);
    this.code = code;
    this.context = context;
    this.name = "UploadManagerError";
  }
  code;
  context;
};
var SYSTEM_UPLOAD_MANAGER_CLOCK = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer)
};
var DEFAULT_MAX_ACTIVE = 2;
var DEFAULT_MAX_QUEUED = 4;
var DEFAULT_QUEUE_TIMEOUT_MS = 5e3;
var MAX_UPLOAD_QUEUE_TIMEOUT_MS = 2147483647;
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}
function positiveInteger3(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}
function contextError(code, context, cause) {
  const message = code === "queue-full" ? "upload queue is full" : code === "queue-timeout" ? "upload queue deadline exceeded" : code === "upload-cancelled" ? "upload request was cancelled" : code === "device-session-changed" ? `device session ${context.generation} is no longer active` : "upload manager is closed";
  return new UploadManagerError(code, message, context, { cause });
}
function isUploadCleanupFailure(error) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "upload-cleanup-failed" || error.code === "adb-cleanup-failed";
}
var UploadManager = class {
  #maxActive;
  #maxQueued;
  #queueTimeoutMs;
  #clock;
  #queue = [];
  #active = /* @__PURE__ */ new Map();
  #cancelledGenerations = /* @__PURE__ */ new Set();
  #totals = {
    accepted: 0,
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    rejected: 0,
    timedOut: 0
  };
  #nextId = 1;
  #closed = false;
  #closePromise = null;
  constructor(options = {}) {
    this.#maxActive = positiveInteger3(
      options.maxActive ?? DEFAULT_MAX_ACTIVE,
      "maxActive"
    );
    this.#maxQueued = nonNegativeInteger(
      options.maxQueued ?? DEFAULT_MAX_QUEUED,
      "maxQueued"
    );
    this.#queueTimeoutMs = nonNegativeInteger(
      options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
      "queueTimeoutMs"
    );
    if (this.#queueTimeoutMs > MAX_UPLOAD_QUEUE_TIMEOUT_MS) {
      throw new TypeError(
        `queueTimeoutMs must be at most ${MAX_UPLOAD_QUEUE_TIMEOUT_MS}`
      );
    }
    this.#clock = options.clock ?? SYSTEM_UPLOAD_MANAGER_CLOCK;
  }
  run(options, operation) {
    const context = this.#copyContext(options.context);
    if (this.#closed) {
      return this.#rejectImmediately(contextError("closed", context));
    }
    if (this.#cancelledGenerations.has(context.generation)) {
      return this.#rejectImmediately(
        contextError("device-session-changed", context)
      );
    }
    if (options.sessionSignal?.aborted) {
      return this.#rejectImmediately(
        contextError(
          "device-session-changed",
          context,
          options.sessionSignal.reason
        )
      );
    }
    if (options.requestSignal?.aborted) {
      return this.#rejectImmediately(
        contextError(
          "upload-cancelled",
          context,
          options.requestSignal.reason
        )
      );
    }
    if (this.#active.size >= this.#maxActive && this.#queue.length >= this.#maxQueued) {
      return this.#rejectImmediately(contextError("queue-full", context));
    }
    const job = {
      id: this.#nextId++,
      context,
      operation,
      controller: new AbortController(),
      deferred: createDeferred(),
      enqueuedMs: this.#clock.now(),
      state: "queued",
      queueTimer: null,
      cancellation: null,
      listenerCleanup: [],
      cleanup: null
    };
    this.#totals.accepted++;
    this.#listenForAbort(
      job,
      options.requestSignal,
      "upload-cancelled"
    );
    this.#listenForAbort(
      job,
      options.sessionSignal,
      "device-session-changed"
    );
    if (job.cancellation) {
      this.#finishQueuedCancellation(job);
      return job.deferred.promise;
    }
    if (this.#active.size < this.#maxActive) {
      this.#start(job);
    } else {
      this.#queue.push(job);
      const timer = this.#clock.setTimeout(() => {
        if (job.state !== "queued") return;
        this.#cancel(
          job,
          contextError("queue-timeout", job.context)
        );
      }, this.#queueTimeoutMs);
      if (job.state === "queued") job.queueTimer = timer;
      else this.#clock.clearTimeout(timer);
    }
    return job.deferred.promise;
  }
  async cancelGeneration(generation, cause) {
    nonNegativeInteger(generation, "generation");
    this.#cancelledGenerations.add(generation);
    const cleanups = [];
    for (const job of [...this.#queue]) {
      if (job.context.generation !== generation) continue;
      this.#cancel(
        job,
        contextError("device-session-changed", job.context, cause)
      );
    }
    for (const job of this.#active.values()) {
      if (job.context.generation !== generation) continue;
      this.#cancel(
        job,
        contextError("device-session-changed", job.context, cause)
      );
      if (job.cleanup) cleanups.push(job.cleanup);
    }
    await Promise.allSettled(cleanups);
  }
  close(cause) {
    if (this.#closePromise) return this.#closePromise;
    let finish;
    this.#closePromise = new Promise((resolve) => {
      finish = resolve;
    });
    this.#closed = true;
    const cleanups = [];
    for (const job of [...this.#queue]) {
      this.#cancel(job, contextError("closed", job.context, cause));
    }
    for (const job of this.#active.values()) {
      this.#cancel(job, contextError("closed", job.context, cause));
      if (job.cleanup) cleanups.push(job.cleanup);
    }
    void Promise.allSettled(cleanups).then(() => finish());
    return this.#closePromise;
  }
  snapshot() {
    const now = this.#clock.now();
    return {
      closed: this.#closed,
      active: this.#active.size,
      queued: this.#queue.length,
      oldestQueuedAgeMs: this.#queue.length === 0 ? null : Math.max(0, now - this.#queue[0].enqueuedMs),
      limits: {
        active: this.#maxActive,
        queued: this.#maxQueued,
        queueTimeoutMs: this.#queueTimeoutMs
      },
      totals: { ...this.#totals }
    };
  }
  #copyContext(context) {
    if (typeof context.serial !== "string" || context.serial.length === 0) {
      throw new TypeError("context.serial must be a non-empty string");
    }
    nonNegativeInteger(context.generation, "context.generation");
    return { serial: context.serial, generation: context.generation };
  }
  #rejectImmediately(error) {
    this.#totals.rejected++;
    return Promise.reject(error);
  }
  #listenForAbort(job, signal, code) {
    if (!signal) return;
    const onAbort = () => {
      this.#cancel(job, contextError(code, job.context, signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    job.listenerCleanup.push(
      () => signal.removeEventListener("abort", onAbort)
    );
    if (signal.aborted) onAbort();
  }
  #start(job) {
    if (job.state !== "queued") return;
    job.state = "active";
    this.#active.set(job.id, job);
    this.#totals.started++;
    let value;
    let operationError;
    let operationFailed = false;
    const cleanup = Promise.resolve().then(() => {
      if (job.cancellation) throw job.cancellation;
      return job.operation({
        context: job.context,
        signal: job.controller.signal
      });
    }).then(
      (result) => {
        value = result;
      },
      (error) => {
        operationFailed = true;
        operationError = error;
      }
    ).then(() => {
      this.#finishActive(job, value, operationFailed, operationError);
    });
    job.cleanup = cleanup;
    this.#clearQueueTimer(job);
  }
  #finishActive(job, value, operationFailed, operationError) {
    if (job.state !== "active") return;
    job.state = "finished";
    this.#active.delete(job.id);
    this.#disposeJob(job);
    if (operationFailed && isUploadCleanupFailure(operationError)) {
      this.#totals.failed++;
      job.deferred.reject(operationError);
    } else if (job.cancellation) {
      this.#recordCancellation(job.cancellation);
      job.deferred.reject(job.cancellation);
    } else if (operationFailed) {
      this.#totals.failed++;
      job.deferred.reject(operationError);
    } else {
      this.#totals.completed++;
      job.deferred.resolve(value);
    }
    this.#drain();
  }
  #cancel(job, error) {
    if (job.state === "finished" || job.cancellation) return;
    job.cancellation = error;
    job.controller.abort(error);
    if (job.state === "queued") this.#finishQueuedCancellation(job);
  }
  #finishQueuedCancellation(job) {
    if (job.state !== "queued" || !job.cancellation) return;
    job.state = "finished";
    const index = this.#queue.indexOf(job);
    if (index >= 0) this.#queue.splice(index, 1);
    this.#disposeJob(job);
    this.#recordCancellation(job.cancellation);
    job.deferred.reject(job.cancellation);
    this.#drain();
  }
  #recordCancellation(error) {
    if (error.code === "queue-timeout") this.#totals.timedOut++;
    else this.#totals.cancelled++;
  }
  #disposeJob(job) {
    this.#clearQueueTimer(job);
    for (const cleanup of job.listenerCleanup.splice(0)) cleanup();
  }
  #clearQueueTimer(job) {
    if (job.queueTimer === null) return;
    this.#clock.clearTimeout(job.queueTimer);
    job.queueTimer = null;
  }
  #drain() {
    if (this.#closed) return;
    while (this.#active.size < this.#maxActive) {
      const job = this.#queue.shift();
      if (!job) return;
      if (job.state !== "queued") continue;
      this.#start(job);
    }
  }
};

// runtimes/serve-emu/src/server.ts
var __dirname2 = dirname2(fileURLToPath2(import.meta.url));
var UI_DIR = join4(__dirname2, "..", "dist", "ui");
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_MAX_APK_UPLOAD_BYTES = 512 * 1024 * 1024;
var DEFAULT_MAX_MEDIA_UPLOAD_BYTES = 1024 * 1024 * 1024;
var DEFAULT_MAX_ACTIVE_UPLOADS = 2;
var DEFAULT_MAX_QUEUED_UPLOADS = 4;
var DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS = 5e3;
var MULTIPART_BODY_OVERHEAD_BYTES = 1024 * 1024;
var SESSION_COOKIE = "semu_session";
function safeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = part.slice(idx + 1).trim();
  }
  return out;
}
var MAX_WS_MESSAGE_BYTES = 16 * 1024;
var DROP_FRAME_BUFFERED_BYTES = 512 * 1024;
var CLOSE_CLIENT_BUFFERED_BYTES = 16 * 1024 * 1024;
var VIDEO_RESET_COOLDOWN_MS = 500;
var FIRST_FRAME_RESET_MS = 5e3;
var SOURCE_STALL_RESET_MS = 2500;
var AWAITING_KEYFRAME_RESET_MS = 2500;
var MAX_JSON_BODY_BYTES = 8 * 1024;
var MAX_ROUTE_BODY_BYTES = 2 * 1024 * 1024;
var MAX_LOGCAT_QUERY_BYTES = 200;
function serverLimit(value, fallback, name, allowZero = false) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < (allowZero ? 0 : 1)) {
    throw new Error(
      `${name} must be ${allowZero ? "a non-negative" : "a positive"} safe integer`
    );
  }
  return resolved;
}
async function startServer(opts, dependencies = {}) {
  const openScrcpy = dependencies.openScrcpy ?? ((serial, signal) => (dependencies.startScrcpy ?? startScrcpy)({
    serial,
    signal,
    maxFps: opts.maxFps,
    bitRate: opts.bitRate,
    maxSize: opts.maxSize,
    keyFrameInterval: opts.keyFrameInterval,
    repeatFrameMs: opts.repeatFrameMs
  }));
  const serve2 = dependencies.serve ?? serve;
  const listDevices2 = dependencies.listDevices ?? dependencies.listAllDevices ?? listAllDevices;
  const launchEmulator = dependencies.startEmulator ?? startEmulator;
  const killEmulator = dependencies.stopEmulator ?? stopEmulator;
  const listActiveAvds = dependencies.listRunningAvds ?? listRunningAvds;
  const availableAvds = dependencies.listAvds ?? listAvds;
  const loadAccessibility = dependencies.loadAccessibility ?? ((serial, signal) => getAccessibilitySnapshot(serial, signal));
  const setLocation = dependencies.setLocation ?? ((serial, fix, signal) => setEmulatorLocationAsync(serial, fix, signal));
  const createInputQueue = dependencies.createInputQueue ?? ((session) => new ControlInputQueue({ socket: session.controlSocket }));
  const recoveryClock = dependencies.recoveryClock ?? SYSTEM_RECOVERY_WATCHDOG_CLOCK;
  const stageUpload = dependencies.stageMultipartUpload ?? stageMultipartUpload;
  const installStagedApk = dependencies.installApk ?? installApk;
  const importStagedMedia = dependencies.importMediaFile ?? importMediaFile;
  const maxApkUploadBytes = serverLimit(
    opts.maxApkUploadBytes,
    DEFAULT_MAX_APK_UPLOAD_BYTES,
    "maxApkUploadBytes"
  );
  const maxMediaUploadBytes = serverLimit(
    opts.maxMediaUploadBytes,
    DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
    "maxMediaUploadBytes"
  );
  const maxActiveUploads = serverLimit(
    opts.maxActiveUploads,
    DEFAULT_MAX_ACTIVE_UPLOADS,
    "maxActiveUploads"
  );
  const maxQueuedUploads = serverLimit(
    opts.maxQueuedUploads,
    DEFAULT_MAX_QUEUED_UPLOADS,
    "maxQueuedUploads",
    true
  );
  const uploadQueueTimeoutMs = serverLimit(
    opts.uploadQueueTimeoutMs,
    DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS,
    "uploadQueueTimeoutMs",
    true
  );
  if (uploadQueueTimeoutMs > MAX_UPLOAD_QUEUE_TIMEOUT_MS) {
    throw new Error(
      `uploadQueueTimeoutMs must be at most ${MAX_UPLOAD_QUEUE_TIMEOUT_MS}`
    );
  }
  const maxUploadFileBytes = Math.max(maxApkUploadBytes, maxMediaUploadBytes);
  if (maxUploadFileBytes > Number.MAX_SAFE_INTEGER - MULTIPART_BODY_OVERHEAD_BYTES * 2) {
    throw new Error("upload byte limit is too large");
  }
  const maxRequestBodySize = Math.max(
    maxUploadFileBytes + MULTIPART_BODY_OVERHEAD_BYTES * 2,
    MAX_ROUTE_BODY_BYTES
  );
  const uploads = (dependencies.createUploadManager ?? ((options) => new UploadManager(options)))({
    maxActive: maxActiveUploads,
    maxQueued: maxQueuedUploads,
    queueTimeoutMs: uploadQueueTimeoutMs
  });
  const host = opts.host ?? DEFAULT_HOST;
  const authToken = opts.token && opts.token.length > 0 ? opts.token : null;
  const presentedToken = (req, url) => {
    const authorization = req.headers.get("authorization");
    if (authorization && authorization.startsWith("Bearer ")) {
      return authorization.slice("Bearer ".length).trim();
    }
    const cookie = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
    if (cookie) return cookie;
    return url.searchParams.get("token");
  };
  const tokenValid = (req, url) => {
    if (!authToken) return true;
    const presented = presentedToken(req, url);
    return presented !== null && safeEqual(presented, authToken);
  };
  const originAllowed = (req) => {
    const origin = req.headers.get("origin");
    if (!origin) return true;
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false;
    }
    return originHost === req.headers.get("host");
  };
  const createContext = (serial, generation, scrcpy) => {
    const context = new ActiveDeviceSession({
      serial,
      generation,
      scrcpy,
      applyLocation: setLocation,
      inputQueue: createInputQueue(scrcpy)
    });
    context.registerCleanup(
      () => uploads.cancelGeneration(
        generation,
        new UploadManagerError(
          "device-session-changed",
          `device session ${generation} is no longer active`,
          { serial, generation }
        )
      )
    );
    return context;
  };
  const initialScrcpy = await openScrcpy(opts.serial, opts.signal);
  let initialContext;
  try {
    initialContext = createContext(opts.serial, 0, initialScrcpy);
  } catch (err) {
    try {
      initialScrcpy.close();
    } catch {
    }
    throw err;
  }
  const sessions = new DeviceSessionManager(initialContext);
  const recoveries = /* @__PURE__ */ new WeakMap();
  const responseMetrics = new JsonResponseTracker([
    "health",
    "sessionPage",
    "sessionExport"
  ]);
  let stopRequested = false;
  console.log(
    `scrcpy ready: ${initialScrcpy.meta.deviceName} \u2022 ${initialScrcpy.meta.codecId} \u2022 ${initialScrcpy.meta.width}\xD7${initialScrcpy.meta.height}`
  );
  const health = (context = sessions.current) => {
    const now = recoveryClock.now();
    const recovery = recoveries.get(context);
    const recoverySnapshot = recovery?.snapshot(now) ?? {
      sourceFps: 0,
      lastFrameMs: null,
      sourceFrameAgeMs: Math.max(0, now - context.startedMs),
      awaitingClients: 0,
      oldestAwaitingAgeMs: null,
      lastResetAttemptMs: null
    };
    return {
      ok: context.status === "streaming",
      status: context.status,
      generation: context.generation,
      serial: context.serial,
      device: context.scrcpy.meta.deviceName,
      codec: context.scrcpy.meta.codecId,
      size: { width: context.screen.width, height: context.screen.height },
      clients: context.clients.size,
      frames: context.frameCount,
      sourceFps: recoverySnapshot.sourceFps,
      sourceFrameAgeMs: recoverySnapshot.sourceFrameAgeMs,
      keyFrameRecovery: {
        awaitingClients: recoverySnapshot.awaitingClients,
        oldestAwaitingAgeMs: recoverySnapshot.oldestAwaitingAgeMs,
        lastResetAttemptAt: recoverySnapshot.lastResetAttemptMs === null ? null : new Date(recoverySnapshot.lastResetAttemptMs).toISOString()
      },
      frameStats: context.frameStats.summary(),
      configPackets: context.configPacketCount,
      droppedFrames: context.totalDroppedFrames,
      backpressureEvents: context.totalBackpressureEvents,
      videoResetRequests: context.videoResetRequests,
      lastVideoResetAt: context.lastVideoResetAt,
      lastVideoResetReason: context.lastVideoResetReason,
      location: context.lastLocation,
      route: context.route.snapshot(),
      session: context.recorder.summary(),
      responseMetrics: responseMetrics.snapshot(),
      logcat: context.logcat.snapshot(),
      uploads: uploads.snapshot(),
      executor: getExecSnapshot(),
      clientsDetail: Array.from(context.clients, (client) => ({
        id: client.id,
        frameMeta: client.frameMeta,
        sentFrames: client.sentFrames,
        droppedFrames: client.droppedFrames,
        backpressureEvents: client.backpressureEvents,
        bufferedBytes: client.ws.bufferedAmount,
        awaitingKeyFrame: client.awaitingKeyFrame,
        awaitingKeyFrameSinceAt: client.awaitingKeyFrameSinceMs === null ? null : new Date(client.awaitingKeyFrameSinceMs).toISOString(),
        awaitingKeyFrameAgeMs: client.awaitingKeyFrameSinceMs === null ? null : Math.max(0, now - client.awaitingKeyFrameSinceMs),
        lastKeyFrameRequestAt: client.lastKeyFrameRequestMs === null ? null : new Date(client.lastKeyFrameRequestMs).toISOString()
      })),
      startedAt: context.startedAt,
      stoppedAt: context.stoppedAt,
      lastFrameAt: recoverySnapshot.lastFrameMs === null ? null : new Date(recoverySnapshot.lastFrameMs).toISOString(),
      lastError: context.lastError,
      lastErrorCode: context.lastErrorCode,
      lastErrorMeta: context.lastErrorMeta
    };
  };
  const deviceGrid = async (context) => {
    const [adbDevices, runningAvds, avds] = await Promise.all([
      listDevices2(),
      listActiveAvds(),
      availableAvds()
    ]);
    sessions.assertPublished(context);
    const runningBySerial = new Map(
      runningAvds.map((running) => [running.serial, running])
    );
    const runningByAvd = new Map(
      runningAvds.map((running) => [running.avd, running])
    );
    const rows = adbDevices.map((device) => {
      const running = runningBySerial.get(device.serial);
      const isEmulator = /^emulator-\d+$/.test(device.serial);
      return {
        id: device.serial,
        kind: isEmulator ? "emulator" : "physical",
        serial: device.serial,
        avd: running?.avd ?? null,
        name: running?.avd ?? device.serial,
        state: device.state,
        current: device.serial === context.serial,
        canSelect: device.state === "device",
        canStart: false,
        canStop: isEmulator
      };
    });
    const knownAvdSerials = new Set(
      runningAvds.map((running) => running.serial)
    );
    for (const avd of avds) {
      const running = runningByAvd.get(avd);
      if (running && knownAvdSerials.has(running.serial)) continue;
      rows.push({
        id: `avd:${avd}`,
        kind: "avd",
        serial: running?.serial ?? null,
        avd,
        name: avd,
        state: running?.state ?? "stopped",
        current: running?.serial === context.serial,
        canSelect: running?.state === "device",
        canStart: !running,
        canStop: Boolean(running)
      });
    }
    return {
      ok: true,
      currentSerial: context.serial,
      sessionStatus: context.status,
      devices: rows
    };
  };
  const markTerminal = (context, nextStatus, reason, detail) => {
    if (sessions.current !== context) return;
    if (!terminalTransitionAllowed(context.status, nextStatus)) return;
    context.terminalTransitionStarted = true;
    context.status = nextStatus;
    context.lastError = reason;
    context.lastErrorCode = detail?.code ?? null;
    context.lastErrorMeta = detail?.meta ?? null;
    void context.dispose(reason, {
      status: nextStatus,
      clientCode: nextStatus === "error" ? 1011 : 1e3
    });
  };
  const sendJson = (ws, value) => {
    try {
      ws.send(JSON.stringify(value));
    } catch {
    }
  };
  const withFrameMeta = (frameData, frame, config) => {
    const configBytes = config?.length ?? 0;
    const out = Buffer.allocUnsafe(
      FRAME_META_HEADER_BYTES + configBytes + frameData.length
    );
    writeFrameMetaHeader(out, {
      isKey: frame.isKey,
      pts: frame.pts,
      serverTsMs: epochNowMs()
    });
    if (config) config.copy(out, FRAME_META_HEADER_BYTES);
    frameData.copy(out, FRAME_META_HEADER_BYTES + configBytes);
    return out;
  };
  const withConfig = (frameData, config) => {
    if (!config) return frameData;
    const out = Buffer.allocUnsafe(config.length + frameData.length);
    config.copy(out, 0);
    frameData.copy(out, config.length);
    return out;
  };
  const wantsAck = (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return true;
    return value.ack !== false;
  };
  const readJsonBody = async (req, maxBytes = MAX_JSON_BODY_BYTES, context, requireUsableContext = true) => {
    const value = await readJsonLimited(req, maxBytes);
    if (context) {
      if (requireUsableContext) sessions.assertCurrent(context);
      else sessions.assertPublished(context);
    }
    return value;
  };
  const errorResponse = (err, fallbackStatus = 400) => {
    const error = err instanceof Error ? err.message : String(err);
    if (err instanceof SessionChangedError) {
      return Response.json(
        { ok: false, code: err.code, error },
        { status: 409 }
      );
    }
    let status = fallbackStatus;
    let code;
    if (err instanceof HttpBodyError) {
      status = err.status;
      code = err.code;
    } else if (err instanceof MultipartUploadError) {
      status = err.status;
      code = err.code;
    } else if (err instanceof UploadManagerError) {
      const mapped = {
        "queue-full": { status: 429, code: "upload-queue-full" },
        "queue-timeout": { status: 503, code: "upload-queue-timeout" },
        "upload-cancelled": { status: 499, code: "upload-cancelled" },
        "device-session-changed": {
          status: 409,
          code: "device-session-changed"
        },
        closed: { status: 503, code: "upload-service-closed" }
      };
      status = mapped[err.code].status;
      code = mapped[err.code].code;
    } else if (err instanceof AppManagementError) {
      status = err.code === "adb-timeout" ? 504 : 502;
      code = err.code;
    }
    return Response.json(
      { ok: false, ...code ? { code } : {}, error },
      { status }
    );
  };
  const inputErrorPayload = (err, status) => ({
    ok: false,
    status,
    ...err instanceof ControlInputError ? { code: err.code } : {},
    error: err instanceof Error ? err.message : String(err)
  });
  const inputErrorResponse = (err, status) => {
    if (err instanceof HttpBodyError) return errorResponse(err);
    return Response.json(inputErrorPayload(err, status), {
      status: err instanceof ControlInputError && err.code === "control-queue-overloaded" ? 429 : err instanceof ControlInputError ? 503 : 400
    });
  };
  const runForContext = async (context, operation) => {
    sessions.assertCurrent(context);
    const result = await operation(context);
    sessions.assertCurrent(context);
    return result;
  };
  const runForPublishedContext = async (context, operation) => {
    sessions.assertPublished(context);
    const result = await operation(context);
    sessions.assertPublished(context);
    return result;
  };
  const shouldRecord = (value) => typeof value !== "object" || value === null || Array.isArray(value) || value.record !== false;
  const readAccessibilitySnapshot = async (context, cacheMs = 2500) => {
    const snapshot = await context.readAccessibilitySnapshot(
      loadAccessibility,
      cacheMs
    );
    sessions.assertCurrent(context);
    return snapshot;
  };
  let nextTouchId = 1;
  const enqueueGesture = (context, gesture, source, record2 = true) => {
    sessions.assertCurrent(context);
    if (context.status !== "streaming") {
      throw new Error(`session is ${context.status}`);
    }
    const accepted = context.inputQueue.enqueue(gesture, { ...context.screen });
    if (record2) context.recorder.recordGesture(accepted.gesture, source);
    return accepted;
  };
  const enqueueClientGesture = (ws, gesture, record2) => {
    const client = ws.data.handle;
    if (gesture.type !== "touch")
      return enqueueGesture(ws.data.context, gesture, "ws", record2);
    if (!client) throw new Error("WebSocket client is not open");
    const sourceId = gesture.pointerId ?? 0;
    const previous = client.touches.get(sourceId);
    if (gesture.action === "down" ? previous : !previous) {
      throw new Error(
        gesture.action === "down" ? "pointer is already down" : "pointer is not down"
      );
    }
    if (!previous && !Number.isSafeInteger(nextTouchId))
      throw new Error("pointer id space exhausted");
    const mapped = {
      ...gesture,
      pointerId: previous?.gesture.pointerId ?? nextTouchId++
    };
    const accepted = enqueueGesture(ws.data.context, mapped, "ws", record2);
    if (gesture.action === "up") client.touches.delete(sourceId);
    else
      client.touches.set(sourceId, {
        gesture: mapped,
        record: record2 || previous?.record === true
      });
    return accepted;
  };
  const releaseClientTouches = (client) => {
    if (sessions.isCurrent(client.context)) {
      for (const { gesture, record: record2 } of client.touches.values()) {
        try {
          const accepted = enqueueGesture(
            client.context,
            { ...gesture, action: "up" },
            "ws:disconnect",
            record2
          );
          void accepted.completion.catch(() => {
          });
        } catch {
        }
      }
    }
    client.touches.clear();
  };
  const dispatchGesture = (context, gesture, source, record2 = true) => enqueueGesture(context, gesture, source, record2).completion;
  const applyLocation = async (context, fix, source, record2 = true) => {
    sessions.assertCurrent(context);
    context.route.stop();
    await setLocation(context.serial, fix, context.signal);
    sessions.assertCurrent(context);
    context.lastLocation = { ...fix, appliedAt: (/* @__PURE__ */ new Date()).toISOString() };
    if (record2) context.recorder.recordLocation(fix, source);
    return context.lastLocation;
  };
  const logcatStream = (context, req, url) => {
    const packageName2 = (url.searchParams.get("package") ?? "").trim().slice(0, MAX_LOGCAT_QUERY_BYTES);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, MAX_LOGCAT_QUERY_BYTES).toLowerCase();
    return context.logcat.subscribe({ packageName: packageName2, search }, req.signal);
  };
  const gestureEndpoint = async (context, req, type, source) => {
    try {
      const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES, context);
      const gesture = parseGesture(
        typeof payload === "object" && payload !== null && !Array.isArray(payload) ? { ...payload, type } : payload
      );
      const accepted = enqueueGesture(
        context,
        gesture,
        source,
        shouldRecord(payload)
      );
      try {
        const result = await accepted.completion;
        return Response.json({ ok: true, status: result.status });
      } catch (err) {
        return inputErrorResponse(err, "failed");
      }
    } catch (err) {
      return inputErrorResponse(err, "rejected");
    }
  };
  const keyEndpoint = async (context, req) => {
    try {
      const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES, context);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("key payload must be an object");
      }
      const key = payload.key;
      const gesture = key === "back" || key === "home" || key === "recents" || key === "power" ? parseGesture({ type: key }) : parseGesture({ ...payload, type: "key" });
      const accepted = enqueueGesture(
        context,
        gesture,
        "rest:key",
        shouldRecord(payload)
      );
      try {
        const result = await accepted.completion;
        return Response.json({ ok: true, status: result.status });
      } catch (err) {
        return inputErrorResponse(err, "failed");
      }
    } catch (err) {
      return inputErrorResponse(err, "rejected");
    }
  };
  const accessibilityTapEndpoint = async (context, req) => {
    try {
      const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES, context);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("accessibility tap payload must be an object");
      }
      const body = payload;
      const selector = parseAccessibilitySelector(body.selector ?? body);
      const snapshot = await readAccessibilitySnapshot(context, 1e3);
      const node = findAccessibilityNode(snapshot.nodes, selector);
      const centerX = (node.bounds.left + node.bounds.right) / 2;
      const centerY = (node.bounds.top + node.bounds.bottom) / 2;
      const accessibilityWidth = Math.max(
        ...snapshot.nodes.map((n) => n.bounds.right),
        context.screen.width
      );
      const accessibilityHeight = Math.max(
        ...snapshot.nodes.map((n) => n.bounds.bottom),
        context.screen.height
      );
      const x = centerX / accessibilityWidth;
      const y = centerY / accessibilityHeight;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new Error(
          "matched accessibility node is outside the current stream bounds"
        );
      }
      const accepted = enqueueGesture(
        context,
        {
          type: "tap",
          x,
          y
        },
        "accessibility:tap",
        shouldRecord(payload)
      );
      try {
        const result = await accepted.completion;
        return Response.json({
          ok: true,
          status: result.status,
          node,
          capturedAt: snapshot.capturedAt
        });
      } catch (err) {
        return inputErrorResponse(err, "failed");
      }
    } catch (err) {
      return inputErrorResponse(err, "rejected");
    }
  };
  const appJsonEndpoint = async (context, req, action) => {
    try {
      const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES, context);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new Error("payload must be an object");
      }
      const result = await action(payload);
      sessions.assertCurrent(context);
      return Response.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
  const uploadEndpoint = async (context, req, options) => {
    try {
      const uploadContext = {
        serial: context.serial,
        generation: context.generation
      };
      const result = await uploads.run(
        {
          context: uploadContext,
          requestSignal: req.signal,
          sessionSignal: context.signal
        },
        async ({ context: acceptedContext, signal }) => {
          const staged = await stageUpload(req, {
            fieldName: options.fieldName,
            maxFileBytes: options.maxFileBytes,
            maxBodyBytes: options.maxFileBytes + MULTIPART_BODY_OVERHEAD_BYTES,
            signal
          });
          try {
            sessions.assertCurrent(context);
            if (acceptedContext.serial !== context.serial || acceptedContext.generation !== context.generation) {
              throw new UploadManagerError(
                "device-session-changed",
                "device session changed during upload",
                acceptedContext
              );
            }
            return await options.action(context.serial, staged, signal);
          } finally {
            try {
              await staged.cleanup();
            } catch (error) {
              throw new MultipartUploadError(
                "upload-cleanup-failed",
                "failed to clean up multipart upload",
                { cause: error }
              );
            }
          }
        }
      );
      return Response.json(result);
    } catch (error) {
      if (req.body && !req.body.locked) {
        await req.body.cancel(error).catch(() => {
        });
      }
      return errorResponse(error);
    }
  };
  const installEndpoint = (context, req) => uploadEndpoint(context, req, {
    fieldName: "apk",
    maxFileBytes: maxApkUploadBytes,
    action: (serial, file, signal) => installStagedApk(serial, file, signal)
  });
  const fileImportEndpoint = (context, req) => uploadEndpoint(context, req, {
    fieldName: "file",
    maxFileBytes: maxMediaUploadBytes,
    action: (serial, file, signal) => importStagedMedia(serial, file, signal)
  });
  const enqueueVideoReset = (context, reason) => {
    sessions.assertCurrent(context);
    context.inputQueue.assertOpen();
    const now = Date.now();
    if (now - context.lastVideoResetMs < VIDEO_RESET_COOLDOWN_MS) {
      return { completion: Promise.resolve({ status: "coalesced" }) };
    }
    const accepted = context.inputQueue.enqueuePacket(resetVideoPacket(), {
      coalesceKey: "reset-video"
    });
    context.lastVideoResetMs = now;
    context.videoResetRequests++;
    context.lastVideoResetAt = new Date(now).toISOString();
    context.lastVideoResetReason = reason;
    return accepted;
  };
  const requestVideoReset = (context, reason) => {
    try {
      return enqueueVideoReset(context, reason).completion;
    } catch (err) {
      return Promise.reject(err);
    }
  };
  const createRecovery = (context) => new SessionRecoveryWatchdog({
    clock: recoveryClock,
    clients: () => context.clients,
    startedMs: recoveryClock.now(),
    intervalMs: 1e3,
    sessionResetCooldownMs: VIDEO_RESET_COOLDOWN_MS,
    firstFrameResetMs: FIRST_FRAME_RESET_MS,
    sourceStallResetMs: SOURCE_STALL_RESET_MS,
    awaitingKeyFrameResetMs: AWAITING_KEYFRAME_RESET_MS,
    requestReset: (reason, now) => {
      if (!sessions.isCurrent(context) || context.status !== "streaming") {
        return false;
      }
      try {
        const accepted = context.inputQueue.enqueuePacket(
          resetVideoPacket(),
          { coalesceKey: "reset-video" }
        );
        void accepted.completion.catch(() => {
        });
        context.lastVideoResetMs = now;
        context.videoResetRequests++;
        context.lastVideoResetAt = new Date(now).toISOString();
        context.lastVideoResetReason = reason;
        return true;
      } catch {
        return false;
      }
    }
  });
  const dropUntilKeyFrame = (client) => {
    client.droppedFrames++;
    client.context.totalDroppedFrames++;
    const recovery = recoveries.get(client.context);
    recovery?.markAwaiting(client);
    recovery?.requestVideoReset("client backpressure");
  };
  const sendFrame = (client, data, isKeyFrame) => {
    const decision = frameDeliveryDecision({
      awaitingKeyFrame: client.awaitingKeyFrame,
      isKeyFrame,
      bufferedBytes: client.ws.bufferedAmount,
      dropThresholdBytes: DROP_FRAME_BUFFERED_BYTES,
      closeThresholdBytes: CLOSE_CLIENT_BUFFERED_BYTES
    });
    if (decision === "drop-awaiting-keyframe") {
      client.droppedFrames++;
      client.context.totalDroppedFrames++;
      return;
    }
    if (decision === "close-slow-client") {
      client.context.clients.delete(client);
      try {
        client.ws.close(1013, "client too slow");
      } catch {
      }
      return;
    }
    if (decision === "drop-buffered") {
      dropUntilKeyFrame(client);
      return;
    }
    if (client.ws.readyState !== WebSocket2.OPEN) {
      client.context.clients.delete(client);
      return;
    }
    try {
      const packet = data();
      client.ws.send(packet);
    } catch {
      client.context.clients.delete(client);
      try {
        client.ws.close(1011, "frame send failed");
      } catch {
      }
      return;
    }
    if (client.ws.bufferedAmount > DROP_FRAME_BUFFERED_BYTES) {
      client.backpressureEvents++;
      client.context.totalBackpressureEvents++;
      dropUntilKeyFrame(client);
      return;
    }
    client.sentFrames++;
    if (isKeyFrame) recoveries.get(client.context)?.keyFrameAccepted(client);
  };
  const startFramePump = (context) => {
    context.cachedConfig = null;
    const pump = (async () => {
      try {
        while (!stopRequested && sessions.isCurrent(context)) {
          const f = await context.scrcpy.readFrame();
          if (!sessions.isCurrent(context)) break;
          if (!f) {
            if (!stopRequested)
              markTerminal(context, "stopped", "scrcpy video stream ended");
            break;
          }
          if (f.type === "session") {
            if (f.width > 0 && f.height > 0) {
              context.screen.width = f.width;
              context.screen.height = f.height;
              context.cachedConfig = null;
              for (const c of context.clients) {
                recoveries.get(context)?.markAwaiting(c);
                sendJson(c.ws, {
                  type: "video-session",
                  size: { width: f.width, height: f.height }
                });
              }
              recoveries.get(context)?.requestVideoReset(
                `video session resized to ${f.width}\xD7${f.height}`
              );
            }
            continue;
          }
          if (f.isConfig) {
            context.cachedConfig = f.data;
            context.configPacketCount++;
            continue;
          }
          context.frameCount++;
          recoveries.get(context)?.recordFrame();
          context.frameStats.record(f.data.length, f.isKey);
          const config = f.isKey ? context.cachedConfig : null;
          let rawOut = null;
          let framedOut = null;
          for (const c of context.clients) {
            sendFrame(
              c,
              () => c.frameMeta ? framedOut ??= withFrameMeta(f.data, f, config) : rawOut ??= withConfig(f.data, config),
              f.isKey
            );
          }
        }
      } catch (err) {
        if (stopRequested || context.signal.aborted && !context.terminalTransitionStarted) {
          return;
        }
        if (err instanceof ScrcpyStreamError) {
          markTerminal(context, "error", err.message, {
            code: err.code,
            meta: err.meta ?? null
          });
        } else {
          markTerminal(context, "error", String(err));
        }
      }
    })();
    void context.trackDrain(pump).catch(() => {
    });
  };
  const attachSessionHandlers = (context) => {
    context.scrcpy.proc.once("exit", (code, signal) => {
      if (stopRequested || sessions.current !== context || context.signal.aborted && !context.terminalTransitionStarted) {
        return;
      }
      if (!isAbnormalExit(code, signal)) return;
      const { reason, ...detail } = procExitDetail(code, signal);
      markTerminal(context, "error", reason, detail);
    });
    context.scrcpy.controlSocket.once("error", (err) => {
      if (!stopRequested && sessions.current === context && (!context.signal.aborted || context.terminalTransitionStarted)) {
        markTerminal(
          context,
          "error",
          `scrcpy control socket error: ${err.message}`
        );
      }
    });
  };
  const activateContext = (context) => {
    const recovery = createRecovery(context);
    recoveries.set(context, recovery);
    context.registerCleanup(() => recovery.stop());
    startFramePump(context);
    attachSessionHandlers(context);
    recovery.start();
  };
  const switchSession = async (serial) => {
    const previous = sessions.current;
    if (serial !== previous.serial) {
      await uploads.cancelGeneration(
        previous.generation,
        new UploadManagerError("device-session-changed", "device switched", {
          serial: previous.serial,
          generation: previous.generation
        })
      );
    }
    const context = await sessions.switch(
      serial,
      async (targetSerial, generation, signal) => {
        const device = (await listDevices2()).find(
          (candidate) => candidate.serial === targetSerial
        );
        if (signal.aborted) {
          throw signal.reason instanceof Error ? signal.reason : new Error("device switch aborted");
        }
        if (!device) throw new Error(`Unknown adb device "${targetSerial}".`);
        if (device.state !== "device") {
          throw new Error(`${targetSerial} is ${device.state}, not ready.`);
        }
        const scrcpy = await openScrcpy(targetSerial, signal);
        try {
          return createContext(targetSerial, generation, scrcpy);
        } catch (err) {
          try {
            scrcpy.close();
          } catch {
          }
          throw err;
        }
      },
      activateContext
    );
    console.log(
      `scrcpy ready: ${context.scrcpy.meta.deviceName} \u2022 ${context.scrcpy.meta.codecId} \u2022 ${context.scrcpy.meta.width}\xD7${context.scrcpy.meta.height}`
    );
    return {
      ok: true,
      serial: context.serial,
      generation: context.generation,
      device: context.scrcpy.meta.deviceName
    };
  };
  const stopCurrentSession = (context, reason) => sessions.stop(context, reason);
  try {
    activateContext(sessions.current);
  } catch (err) {
    stopRequested = true;
    await sessions.close("server startup failed");
    throw err;
  }
  const apiRouter = createApiRouter(createApiRoutes());
  const apiServices = {
    runForPublishedContext,
    listDevices: listDevices2,
    errorResponse,
    deviceGrid,
    readJsonBody,
    MAX_JSON_BODY_BYTES,
    switchSession,
    launchEmulator,
    sessions,
    listActiveAvds,
    stopCurrentSession,
    killEmulator,
    runForContext,
    logcatStream,
    readAccessibilitySnapshot,
    accessibilityTapEndpoint,
    gestureEndpoint,
    keyEndpoint,
    responseMetrics,
    enqueueGesture,
    setLocation,
    installEndpoint,
    fileImportEndpoint,
    appJsonEndpoint,
    applyLocation,
    MAX_ROUTE_BODY_BYTES
  };
  let nextId = 1;
  const serverOptions = {
    port: opts.port,
    hostname: host,
    maxRequestBodySize,
    async fetch(req, srv) {
      const requestContext = sessions.current;
      const url = new URL(req.url);
      if (authToken && req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html")) {
        const queryToken = url.searchParams.get("token");
        if (queryToken && safeEqual(queryToken, authToken)) {
          const clean = new URL(url);
          clean.searchParams.delete("token");
          return new Response(null, {
            status: 303,
            headers: {
              Location: `${clean.pathname}${clean.search}`,
              "Set-Cookie": `${SESSION_COOKIE}=${authToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`
            }
          });
        }
      }
      if (!tokenValid(req, url)) {
        return new Response(
          JSON.stringify({ ok: false, error: "unauthorized" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "WWW-Authenticate": "Bearer"
            }
          }
        );
      }
      if (url.pathname === "/ws" || req.method !== "GET" && req.method !== "HEAD") {
        if (!originAllowed(req)) {
          return new Response(
            JSON.stringify({ ok: false, error: "forbidden origin" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            }
          );
        }
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        const apiResponse = await apiRouter.handle(req, {
          ...apiServices,
          requestContext,
          srv
        });
        if (apiResponse) return apiResponse;
      }
      if (url.pathname === "/health") {
        return responseMetrics.response("health", health(requestContext), {
          status: requestContext.status === "streaming" ? 200 : 503
        });
      }
      if (url.pathname === "/ws") {
        if (requestContext.status !== "streaming") {
          return new Response(JSON.stringify(health(requestContext)), {
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }
        const frameMeta = url.searchParams.get("frame-meta") === "1";
        const ok = srv.upgrade(req, {
          data: { id: nextId++, frameMeta, context: requestContext }
        });
        if (ok) return void 0;
        return new Response("upgrade failed", { status: 400 });
      }
      const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
      if (reqPath.includes(".."))
        return new Response("not found", { status: 404 });
      const path = join4(UI_DIR, reqPath);
      try {
        const file = await readFile2(path);
        const content = new Uint8Array(file);
        const extension = path.slice(path.lastIndexOf("."));
        const mimeTypes = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".json": "application/json",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".woff2": "font/woff2"
        };
        const contentType = mimeTypes[extension] ?? "application/octet-stream";
        return new Response(content, { headers: { "Content-Type": contentType } });
      } catch (error) {
        if (error.code === "ENOENT") return new Response("not found", { status: 404 });
        throw error;
      }
    },
    websocket: {
      maxPayloadLength: MAX_WS_MESSAGE_BYTES,
      open(ws) {
        const context = ws.data.context;
        if (!sessions.isCurrent(context)) {
          sendJson(ws, {
            ok: false,
            code: "session_changed",
            error: "device session changed"
          });
          ws.close(1012, "device session changed");
          return;
        }
        const handle = {
          touches: /* @__PURE__ */ new Map(),
          id: ws.data.id,
          ws,
          context,
          frameMeta: ws.data.frameMeta,
          sentFrames: 0,
          droppedFrames: 0,
          backpressureEvents: 0,
          awaitingKeyFrame: false,
          awaitingKeyFrameSinceMs: null,
          lastKeyFrameRequestMs: null
        };
        context.clients.add(handle);
        ws.data.handle = handle;
        const recovery = recoveries.get(context);
        recovery?.markAwaiting(handle);
        recovery?.requestVideoReset("client opened");
      },
      message(ws, raw) {
        const context = ws.data.context;
        if (!sessions.isCurrent(context)) {
          ws.close(1012, "device session changed");
          return;
        }
        if (typeof raw !== "string") return;
        if (raw.length > MAX_WS_MESSAGE_BYTES) {
          ws.close(1009, "message too large");
          return;
        }
        let acknowledge = true;
        let requestId;
        const reply = (value) => sendJson(ws, {
          ...value,
          ...requestId === void 0 ? {} : { requestId }
        });
        try {
          if (context.status !== "streaming") {
            throw new Error(`session is ${context.status}`);
          }
          const payload = JSON.parse(raw);
          acknowledge = wantsAck(payload);
          requestId = parseWsRequestId(payload?.requestId);
          const msg = parseWsClientMessage(payload);
          if (msg.type === "clock-sync") {
            reply({ type: "clock-sync", clientTsMs: msg.clientTsMs, serverTsMs: epochNowMs() });
            return;
          }
          if (msg.type === "reset-video") {
            const accepted2 = enqueueVideoReset(
              context,
              "client requested keyframe"
            );
            void accepted2.completion.then((result) => {
              if (acknowledge) {
                reply({ ok: true, status: result.status });
              }
            }).catch((err) => {
              if (acknowledge) {
                reply(inputErrorPayload(err, "failed"));
              }
            });
            return;
          }
          const accepted = enqueueClientGesture(ws, msg, shouldRecord(payload));
          void accepted.completion.then((result) => {
            if (acknowledge) {
              reply({ ok: true, status: result.status });
            }
          }).catch((err) => {
            if (acknowledge) {
              reply(inputErrorPayload(err, "failed"));
            }
          });
        } catch (err) {
          if (acknowledge) {
            reply(inputErrorPayload(err, "rejected"));
          }
        }
      },
      close(ws) {
        if (ws.data.handle) {
          releaseClientTouches(ws.data.handle);
          ws.data.context.clients.delete(ws.data.handle);
        }
      }
    }
  };
  let server;
  try {
    server = await serve2(serverOptions);
  } catch (err) {
    stopRequested = true;
    await sessions.close("server startup failed");
    await uploads.close(
      new UploadManagerError("closed", "server startup failed", {
        serial: sessions.current.serial,
        generation: sessions.current.generation
      })
    );
    throw err;
  }
  let stopTask = null;
  const stop = () => {
    if (stopTask) return stopTask;
    stopRequested = true;
    const serverClosed = server.stop();
    const context = sessions.current;
    const error = new UploadManagerError("closed", "server is stopping", {
      serial: context.serial,
      generation: context.generation
    });
    stopTask = Promise.all([
      serverClosed,
      sessions.close("server stopping"),
      uploads.close(error)
    ]).then(() => {
    });
    return stopTask;
  };
  return {
    server,
    get session() {
      const context = sessions.current;
      return context.signal.aborted ? null : context.scrcpy;
    },
    getSession() {
      const context = sessions.current;
      return context.signal.aborted ? null : context.scrcpy;
    },
    stop
  };
}

// runtimes/serve-emu/src/cli.ts
var argv = process.argv.slice(2);
var { values } = parseArgs({
  args: argv,
  options: {
    port: { type: "string", short: "p", default: "3300" },
    host: { type: "string" },
    token: { type: "string" },
    "unsafe-no-auth": { type: "boolean" },
    serial: { type: "string", short: "s" },
    "max-fps": { type: "string", default: String(SCRCPY_DEFAULTS.maxFps) },
    "bit-rate": { type: "string", default: String(SCRCPY_DEFAULTS.bitRate) },
    "max-size": { type: "string", default: String(SCRCPY_DEFAULTS.maxSize) },
    "key-frame-interval": { type: "string", default: String(SCRCPY_DEFAULTS.keyFrameInterval) },
    "repeat-frame-ms": { type: "string", default: String(SCRCPY_DEFAULTS.repeatFrameMs) },
    "max-apk-upload-bytes": { type: "string", default: String(DEFAULT_MAX_APK_UPLOAD_BYTES) },
    "max-media-upload-bytes": { type: "string", default: String(DEFAULT_MAX_MEDIA_UPLOAD_BYTES) },
    "max-active-uploads": { type: "string", default: String(DEFAULT_MAX_ACTIVE_UPLOADS) },
    "max-queued-uploads": { type: "string", default: String(DEFAULT_MAX_QUEUED_UPLOADS) },
    "upload-queue-timeout-ms": { type: "string", default: String(DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS) },
    avd: { type: "string" },
    "avd-list": { type: "boolean" },
    "running-avds": { type: "boolean" },
    "restart-avd": { type: "boolean" },
    emulator: { type: "string" },
    "emulator-port": { type: "string" },
    gpu: { type: "string", default: "host" },
    help: { type: "boolean", short: "h" }
  },
  allowPositionals: true
});
function numberOption(name, fallback) {
  const value = values[name];
  if (typeof value !== "string") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number.`);
  return n;
}
function isLoopbackHost(host) {
  const h = host.toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127.");
}
function displayHost(host) {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return "localhost";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
if (values.help) {
  console.log(`serve-emu \u2014 host an Android device over scrcpy + WebSocket

Usage:
  serve-emu [-p <port>] [--host <addr>] [--token <secret>] [-s <serial>] [--max-fps N] [--bit-rate N] [--max-size N] [--key-frame-interval sec] [--repeat-frame-ms ms]
  serve-emu --avd <name> [--restart-avd]
  serve-emu --avd-list
  serve-emu --running-avds

Options:
  -p, --port <port>      Port to listen on (default: 3300)
      --host <addr>      Address to bind (default: 127.0.0.1, loopback only).
                         Use 0.0.0.0 to expose over the LAN \u2014 this requires
                         authentication (see --token) unless --unsafe-no-auth.
      --token <secret>   Require this shared secret on every request. Browsers
                         authenticate by opening the printed ?token= URL once
                         (exchanged for an HttpOnly cookie); agents send
                         'Authorization: Bearer <secret>'. On a non-loopback
                         bind a token is generated automatically if omitted.
      --unsafe-no-auth   Allow a non-loopback bind with NO authentication.
                         Anyone who can reach the port can control the device.
  -s, --serial <serial>  adb device serial (defaults to the only booted device)
      --max-fps <n>      Cap source frame rate (default: ${SCRCPY_DEFAULTS.maxFps})
      --bit-rate <bps>   H.264 bit rate (default: ${SCRCPY_DEFAULTS.bitRate})
      --max-size <px>    Cap longest screen edge in pixels; 0 = native. The
                         emulator only has a software H.264 encoder, which
                         sustains 60fps only below ~1 megapixel, so this
                         defaults to ${SCRCPY_DEFAULTS.maxSize}.
      --key-frame-interval <sec>
                         Ask the encoder for regular keyframes; 0 disables this
                         codec option (default: ${SCRCPY_DEFAULTS.keyFrameInterval}). Late joiners get keyframes
                         on demand via reset-video, so a long interval avoids
                         periodic keyframe bursts.
      --repeat-frame-ms <ms>
                         Re-encode the previous frame after this many ms with no
                         screen change, so static screens keep producing frames
                         (16 \u2248 steady 60fps at the cost of extra CPU/bandwidth;
                         0 keeps the encoder default of one repeat per 100ms)
      --max-apk-upload-bytes <n>    Maximum streamed APK bytes (default: ${DEFAULT_MAX_APK_UPLOAD_BYTES})
      --max-media-upload-bytes <n>  Maximum streamed media bytes (default: ${DEFAULT_MAX_MEDIA_UPLOAD_BYTES})
      --max-active-uploads <n>      Concurrent uploads (default: ${DEFAULT_MAX_ACTIVE_UPLOADS})
      --max-queued-uploads <n>      Queued uploads (default: ${DEFAULT_MAX_QUEUED_UPLOADS})
      --upload-queue-timeout-ms <ms> Upload queue wait limit (default: ${DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS})
      --avd <name>       Launch this Android Virtual Device before streaming
      --gpu <mode>       Emulator GPU mode for --avd launches (default: host).
                         host uses the real GPU for smooth ~60fps; the AVD's
                         own auto often falls back to a software compositor that
                         stutters. Use swiftshader_indirect on headless hosts.
      --restart-avd      Stop a running matching AVD before launching it
      --avd-list         Print available Android Virtual Device names
      --running-avds     Print currently running emulator AVDs
      --emulator <path>  Android Emulator binary (default: PATH or Android SDK)
      --emulator-port <n>
                         Emulator console port for --avd (even 5554-5682)
  -h, --help             Show this help
`);
  process.exit(0);
}
async function main() {
  if (values["avd-list"]) {
    console.log((await listAvds(values.emulator)).join("\n"));
    return;
  }
  if (values["running-avds"]) {
    const running = await listRunningAvds();
    console.log(running.length ? running.map((avd) => `${avd.serial}	${avd.avd}	${avd.state}`).join("\n") : "");
    return;
  }
  if ((values["emulator-port"] || values["restart-avd"]) && !values.avd) {
    throw new Error("--emulator-port and --restart-avd require --avd.");
  }
  if (values.avd && values.serial) {
    throw new Error("Use either --avd to launch an emulator or --serial to attach to an existing device, not both.");
  }
  let emulatorLaunch = null;
  const serial = values.avd ? (emulatorLaunch = await startEmulator({
    avd: values.avd,
    emulatorPath: values.emulator,
    port: values["emulator-port"] ? Number(values["emulator-port"]) : void 0,
    restartAvd: values["restart-avd"],
    gpu: values.gpu
  })).serial : await pickDevice(values.serial);
  const port = Number(values.port);
  const maxFps = numberOption("max-fps", SCRCPY_DEFAULTS.maxFps);
  const bitRate = numberOption("bit-rate", SCRCPY_DEFAULTS.bitRate);
  const maxSize = numberOption("max-size", SCRCPY_DEFAULTS.maxSize);
  const keyFrameInterval = numberOption("key-frame-interval", SCRCPY_DEFAULTS.keyFrameInterval);
  const repeatFrameMs = numberOption("repeat-frame-ms", SCRCPY_DEFAULTS.repeatFrameMs);
  const maxApkUploadBytes = numberOption("max-apk-upload-bytes", DEFAULT_MAX_APK_UPLOAD_BYTES);
  const maxMediaUploadBytes = numberOption("max-media-upload-bytes", DEFAULT_MAX_MEDIA_UPLOAD_BYTES);
  const maxActiveUploads = numberOption("max-active-uploads", DEFAULT_MAX_ACTIVE_UPLOADS);
  const maxQueuedUploads = numberOption("max-queued-uploads", DEFAULT_MAX_QUEUED_UPLOADS);
  const uploadQueueTimeoutMs = numberOption("upload-queue-timeout-ms", DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS);
  const host = values.host ?? DEFAULT_HOST;
  const loopback = isLoopbackHost(host);
  const unsafeNoAuth = Boolean(values["unsafe-no-auth"]);
  let token = values.token || void 0;
  if (!loopback) {
    if (unsafeNoAuth) {
      token = void 0;
    } else if (!token) {
      token = randomBytes2(24).toString("base64url");
    }
  }
  const lifecycleController = new AbortController();
  let activeServer = null;
  let startupTask = null;
  let stopping = null;
  const stop = () => {
    if (stopping) return stopping;
    lifecycleController.abort(new Error("serve-emu stopping"));
    stopping = (async () => {
      try {
        const started = activeServer ?? await startupTask?.catch(() => null) ?? null;
        await started?.stop();
      } finally {
        emulatorLaunch?.stop();
      }
    })();
    return stopping;
  };
  process.once("SIGINT", () => {
    void stop().catch((err) => console.error("Shutdown cleanup failed:", err)).finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().catch((err) => console.error("Shutdown cleanup failed:", err)).finally(() => process.exit(0));
  });
  startupTask = startServer({
    serial,
    port,
    host,
    token,
    signal: lifecycleController.signal,
    maxFps,
    bitRate,
    maxSize,
    keyFrameInterval,
    repeatFrameMs,
    maxApkUploadBytes,
    maxMediaUploadBytes,
    maxActiveUploads,
    maxQueuedUploads,
    uploadQueueTimeoutMs
  });
  try {
    activeServer = await startupTask;
  } catch (err) {
    emulatorLaunch?.stop();
    if (lifecycleController.signal.aborted) {
      await stop();
      return;
    }
    throw err;
  }
  if (lifecycleController.signal.aborted) {
    await stop();
    return;
  }
  const { server } = activeServer;
  const base = `http://${displayHost(host)}:${server.port}`;
  if (token) {
    console.log(`serve-emu \u2192 ${base}/?token=${token}  (device: ${serial})`);
    console.error(
      "Authentication is ON. Open the URL above once to authenticate this browser (the token is exchanged for an HttpOnly cookie). Agents send 'Authorization: Bearer <token>' or append ?token=<token>."
    );
  } else {
    console.log(`serve-emu \u2192 ${base}/  (device: ${serial})`);
    if (!loopback) {
      console.error(
        `WARNING: bound to non-loopback address ${host} with --unsafe-no-auth. The device is reachable and controllable without authentication.`
      );
    }
  }
}
await main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
