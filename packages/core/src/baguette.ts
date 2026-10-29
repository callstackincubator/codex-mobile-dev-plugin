import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { normalizeDevices, parseBaseUrl, udidSchema } from "@mobile-dev/shared/protocol.ts";
import type { IosSimulator, Status } from "@mobile-dev/shared/protocol.ts";
import { buttonMarginsSchema } from "@mobile-dev/shared/bezel.ts";
import { definitionDeviceState, getDefinitionDiagnostic, parseDefinitionDiagnostic, setDefinitionDiagnostic } from "@mobile-dev/shared/simulator-definition-diagnostics.ts";
import { requireDevice } from "./device-lookup.ts";
import { allocatePort, superviseBackend } from "./backend-process.ts";
import { isMissingFile, MissingRuntimeError } from "./install-integrity.ts";
import { deferEpisodeReport, ExpectedOperationError, FailureEpisodes, errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { annotateDeviceCommand, backendCommand, inheritDeviceCommand } from "@mobile-dev/shared/device-command-diagnostics.ts";
import { errorReportSignature } from "@mobile-dev/shared/telemetry.ts";
import { baguetteRuntime, forgetBaguetteRuntime } from "./baguette-runtime.ts";
import { captureServerError, recordAccessibilityBridgeRestart } from "./telemetry.ts";

type DescribedUi = { tree?: { label?: unknown } };
const NO_ACCESSIBILITY_DATA = "no accessibility data";
const BRIDGE_RESTART_INTERVAL = 10000;
const PORT_ATTEMPTS = 3;
const SIMULATOR = { missing: "This simulator is no longer available. Refresh the device list.", stopped: "The simulator is stopped. Press Start to boot it." };

/** A started Baguette process; tests attach to a fake backend at its own `url` instead of the given port. */
export type LaunchedBaguette = { child: ChildProcess; url?: string };
export type BaguetteLauncher = (host: string, port: string, signal: AbortSignal) => Promise<LaunchedBaguette>;
export type BaguetteOptions = {
  launchBackend?: BaguetteLauncher;
  kickstartBridge?: (udid: string, signal: AbortSignal) => Promise<void>;
};

async function launchBundledBaguette(host: string, port: string, signal: AbortSignal): Promise<LaunchedBaguette> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new ExpectedOperationError("unsupported_platform", "Starting Baguette requires an Apple Silicon Mac with Xcode 26 or later.");
  }
  const { executable, env } = await baguetteRuntime(signal);
  const child = spawn(executable, ["serve", "--host", host, "--port", port, "--no-plugins"], {
    stdio: ["ignore", "pipe", "pipe"], shell: false, env,
  });
  // A launch that fails to spawn or crashes may have found a toolchain that has since changed.
  child.once("error", error => forgetBaguetteRuntime(error));
  child.once("exit", (_code, signal) => { if (signal !== null && signal !== "SIGTERM") forgetBaguetteRuntime(); });
  return { child };
}

// CoreSimulatorBridge can lose its accessibility connection after backboardd and SpringBoard
// restart, then report no data for every foreground app until it restarts.
async function kickstartAccessibilityBridge(udid: string, signal: AbortSignal): Promise<void> {
  await promisify(execFile)("/usr/bin/xcrun", ["simctl", "spawn", udid, "launchctl", "kickstart", "-k", "user/foreground/com.apple.CoreSimulator.bridge"], {
    timeout: 10000, maxBuffer: 64 * 1024, encoding: "utf8", signal,
  });
}

export const definitionSchema = z.object({
  identity: z.object({ udid: udidSchema, name: z.string(), model: z.string() }),
  screen: z.object({
    rect: z.object({ width: z.number().positive(), height: z.number().positive(), x: z.number().optional(), y: z.number().optional() }),
    viewport: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
    clipRadius: z.number().nonnegative().optional(),
    buttonMargins: buttonMarginsSchema.optional(),
    bezelImage: z.object({ rest: z.string() }).optional(),
    maskImage: z.string().nullish(),
  }),
});

export class Baguette {
  readonly baseUrl = parseBaseUrl("http://127.0.0.1:0");
  private child?: ChildProcess;
  private starting?: Promise<Status>;
  private readonly lifecycle = new AbortController();
  private readonly deviceChanges = new Map<string, Promise<Status>>();
  private disposed = false;
  private readonly kickstartBridge: (udid: string, signal: AbortSignal) => Promise<void>;
  private readonly bridgeRestarts = new Map<string, number>();
  private readonly launchBackend: BaguetteLauncher;
  private readonly startFailures = new FailureEpisodes();

  constructor({ launchBackend = launchBundledBaguette, kickstartBridge = kickstartAccessibilityBridge }: BaguetteOptions = {}) {
    this.kickstartBridge = kickstartBridge;
    this.launchBackend = launchBackend;
  }

  async json(path: string, options: RequestInit = {}, timeout = 10000): Promise<unknown> {
    const command = backendCommand("baguette", path);
    const response = await fetch(new URL(path, this.baseUrl), {
      ...options, redirect: "error", signal: AbortSignal.any([
        this.lifecycle.signal, AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : []),
      ]),
    }).catch(error => { throw annotateDeviceCommand(error, command); });
    if (response.ok === false) {
      const error = annotateDeviceCommand(new Error(`Baguette returned HTTP ${response.status} for ${path}.`), command, { failure: "http_status", status: response.status });
      if (response.status === 404 && /^\/simulators\/[^/]+\/definition\.json$/.test(path)) {
        const payload = await readDefinitionFailure(response);
        const diagnostic = parseDefinitionDiagnostic(payload);
        // Kept for comparison with releases that could attach to an external Baguette.
        diagnostic.backendMode = "embedded";
        setDefinitionDiagnostic(error, diagnostic);
      }
      throw error;
    }
    const payload = await response.json().catch(error => { throw annotateDeviceCommand(error, command); });
    if (payload?.ok === false) throw annotateDeviceCommand(new Error(payload.error ?? "Baguette rejected the request."), command, { failure: "rejected" });
    return payload;
  }

  async describeUi(udid: string): Promise<DescribedUi> {
    const path = `/simulators/${udidSchema.parse(udid)}/describe-ui.json`;
    try { return await this.json(path) as DescribedUi; }
    catch (error) {
      if (!(error instanceof Error) || error.message !== NO_ACCESSIBILITY_DATA || !await this.restartAccessibilityBridge(udid)) throw error;
    }
    try {
      const result = await this.json(path) as DescribedUi;
      recordAccessibilityBridgeRestart("recovered");
      return result;
    } catch (error) {
      recordAccessibilityBridgeRestart("unavailable");
      throw error;
    }
  }

  // A foreground app with no data usually means a stale bridge. Restart it at most every 10 s per device.
  private async restartAccessibilityBridge(udid: string): Promise<boolean> {
    if (Date.now() - (this.bridgeRestarts.get(udid) ?? -Infinity) < BRIDGE_RESTART_INTERVAL) return false;
    this.bridgeRestarts.set(udid, Date.now());
    try {
      await this.kickstartBridge(udid, this.lifecycle.signal);
      return true;
    } catch (error) {
      if (this.lifecycle.signal.aborted) throw error;
      recordAccessibilityBridgeRestart("failed");
      captureServerError(error, "simulator.accessibility_bridge");
      return false;
    }
  }

  /** The simulators the running Baguette lists; this never starts Baguette. */
  async devices(signal?: AbortSignal): Promise<IosSimulator[]> {
    if (!this.child) throw new Error("The bundled simulator backend has not started.");
    try {
      // Listing waits on CoreSimulator, which can take seconds while a device boots.
      return normalizeDevices(await this.json("/simulators.json", { signal }));
    } catch (error) {
      // The failure keeps how its request failed.
      throw inheritDeviceCommand(new Error(`Cannot reach Baguette at ${this.baseUrl.origin}. ${errorMessage(error)}`), error);
    }
  }

  async status(signal?: AbortSignal): Promise<Status> {
    try { return this.connected(await this.devices(signal)); }
    catch (error) { return { connected: false, managed: this.child != null, baseUrl: this.baseUrl.origin, devices: [], error: errorMessage(error) }; }
  }

  private connected(devices: IosSimulator[]): Status {
    return { connected: true, managed: this.child != null, baseUrl: this.baseUrl.origin, devices };
  }

  async start(): Promise<Status> {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.starting) return this.starting;
    this.starting = this.ensureStarted();
    try {
      const status = await this.starting;
      this.startFailures.recover("start");
      return status;
    } catch (error) {
      // Every device tool starts the backend, so a continuing failure is reported once, not once per call.
      // Ports, PIDs and timestamps differ between repeats of the same failure.
      const signature = errorReportSignature(error, {}).replace(/\d+/g, "#");
      deferEpisodeReport(error, () => this.startFailures.shouldReport("start", signature));
      throw error;
    } finally {
      this.starting = undefined;
    }
  }

  private async ensureStarted(): Promise<Status> {
    if (this.child) return this.connected(await this.devices());
    // Another process can bind an allocated port before Baguette does. Baguette then exits, so try a new port.
    for (let attempt = 1; ; attempt++) {
      this.baseUrl.port = String(await allocatePort("Could not allocate a port for the bundled simulator backend."));
      try {
        return await this.launch();
      } catch (error) {
        const portTaken = errorMessage(error).includes("Address already in use");
        if (portTaken === false || attempt === PORT_ATTEMPTS) throw error;
      }
    }
  }

  private async launch(): Promise<Status> {
    const { child, url } = await this.launchBackend(this.baseUrl.hostname, this.baseUrl.port, this.lifecycle.signal);
    if (this.disposed) {
      child.kill("SIGTERM");
      throw new Error("The plugin server has closed.");
    }
    if (url !== undefined) this.baseUrl.host = parseBaseUrl(url).host;
    this.child = child;
    child.on("exit", (code, signal) => {
      if (!this.disposed) process.stderr.write(`[mobile-dev] Baguette exited: code=${code} signal=${signal ?? "none"}.\n`);
      if (this.child === child) this.child = undefined;
    });
    try {
      const devices = await superviseBackend(child, {
        name: "Baguette", deadlineMs: 20000, command: "baguette_serve",
        probe: signal => this.devices(signal),
        closed: () => this.disposed,
        spawnError: error => isMissingFile(error)
          ? annotateDeviceCommand(new MissingRuntimeError("baguette"), "baguette_serve", { failure: "missing_executable" })
          : annotateDeviceCommand(error, "baguette_serve"),
      });
      return this.connected(devices);
    } catch (error) {
      if (this.child === child) this.child = undefined;
      throw error;
    }
  }

  async device(udid: string, mustBeBooted = false) {
    udidSchema.parse(udid);
    const { devices } = await this.start();
    return requireDevice(devices, udid, { ...SIMULATOR, booted: mustBeBooted });
  }

  // The simulator as a running Baguette lists it; this never starts Baguette.
  async listedDevice(udid: string, mustBeBooted = false, signal?: AbortSignal) {
    return requireDevice(await this.devices(signal), udid, { ...SIMULATOR, booted: mustBeBooted });
  }

  async definition(udid: string) {
    await this.device(udid, true);
    try {
      const payload = await this.json(`/simulators/${udid}/definition.json`);
      return definitionSchema.parse(payload);
    } catch (error) {
      const diagnostic = getDefinitionDiagnostic(error);
      if (diagnostic !== undefined) {
        diagnostic.deviceBefore = "Booted";
        const status = await this.status();
        const device = status.devices.find(item => item.udid === udid);
        if (status.connected === false) diagnostic.deviceAfter = "unreachable";
        else if (device === undefined) diagnostic.deviceAfter = "missing";
        else diagnostic.deviceAfter = definitionDeviceState(device.state);
      }
      throw error;
    }
  }

  async changeDeviceState(udid: string, action: "boot" | "shutdown", timeout = 120000): Promise<Status> {
    udidSchema.parse(udid);
    const previous = this.deviceChanges.get(udid);
    const change = (async () => {
      await previous?.catch(() => {});
      const started = await this.start();
      const device = requireDevice(started.devices, udid, SIMULATOR);
      const expected = action === "boot" ? "Booted" : "Shutdown";
      // Baguette's boot route also repairs input. Never call it on a running device.
      if (device.state === expected) return started;
      const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(timeout)]);
      try {
        const inProgress = device.state === (action === "boot" ? "Booting" : "ShuttingDown");
        if (!inProgress) await this.json(`/simulators/${udid}/${action}`, { method: "POST", signal }, timeout);
        while (true) {
          signal.throwIfAborted();
          const devices = await this.devices(signal);
          signal.throwIfAborted();
          if (requireDevice(devices, udid, SIMULATOR).state === expected) return this.connected(devices);
          await delay(250, undefined, { signal });
        }
      } catch (error) {
        if (this.disposed) throw new Error("The plugin server has closed.");
        if (signal.aborted) throw new Error(`The simulator did not finish ${action === "boot" ? "booting" : "shutting down"} within ${timeout / 1000} seconds. Refresh the device list before trying again.`);
        throw error;
      }
    })();
    this.deviceChanges.set(udid, change);
    try { return await change; }
    finally { if (this.deviceChanges.get(udid) === change) this.deviceChanges.delete(udid); }
  }

  async repairInput(udid: string): Promise<void> {
    await this.device(udid, true);
    const { executable, env } = await baguetteRuntime(this.lifecycle.signal);
    const execute = promisify(execFile);
    const { stdout, stderr } = await execute(executable, ["heal", "--udid", udid], {
      timeout: 45000, maxBuffer: 1024 * 1024, encoding: "utf8", env, signal: this.lifecycle.signal,
    }).catch(error => {
      forgetBaguetteRuntime(error);
      throw error;
    });
    if (stdout || stderr) process.stderr.write(stdout + stderr);
  }

  dispose() {
    this.disposed = true;
    this.lifecycle.abort();
    this.child?.kill("SIGTERM");
    this.child = undefined;
  }
}

async function readDefinitionFailure(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) return;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) return;
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks);
    const text = bytes.toString("utf8");
    return JSON.parse(text);
  } catch {
    return;
  } finally {
    const cancellation = reader.cancel();
    await cancellation.catch(() => {});
    reader.releaseLock();
  }
}
