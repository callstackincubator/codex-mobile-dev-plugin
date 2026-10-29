import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { errorMessage, normalizeDevices, parseBaseUrl, udidSchema } from "@mobile-dev/shared/protocol.ts";
import type { Status } from "@mobile-dev/shared/protocol.ts";
import { buttonMarginsSchema } from "@mobile-dev/shared/bezel.ts";
import { definitionDeviceState, getDefinitionDiagnostic, parseDefinitionDiagnostic, setDefinitionDiagnostic } from "@mobile-dev/shared/simulator-definition-diagnostics.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { deferEpisodeReport, ExpectedOperationError, FailureEpisodes } from "@mobile-dev/shared/error-reporting.ts";
import { annotateDeviceCommand, backendCommand, inheritDeviceCommand } from "@mobile-dev/shared/device-command-diagnostics.ts";
import { errorReportSignature } from "@mobile-dev/shared/telemetry.ts";
import { baguetteEnvironment } from "./baguette-runtime.ts";
import { captureServerError, recordAccessibilityBridgeRestart } from "./telemetry.ts";

type DescribedUi = { tree?: { label?: unknown } };
const NO_ACCESSIBILITY_DATA = "no accessibility data";
const BRIDGE_RESTART_INTERVAL = 10000;
const PORT_ATTEMPTS = 3;
// A failed device list keeps its request's error, so errors built from the status say how the request failed.
const listFailures = new WeakMap<Status, unknown>();

function listError(status: Status): Error {
  const error = new Error(status.error);
  return inheritDeviceCommand(error, listFailures.get(status));
}

async function bundledExecutable(): Promise<string> {
  const path = fileURLToPath(new URL("./baguette/Baguette", import.meta.url));
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error("The plugin is missing its bundled Baguette runtime. Run npm run vendor:baguette and npm run build in the source project, then package it again.");
  }
  return path;
}

async function launchBundledBaguette(host: string, port: string, signal: AbortSignal): Promise<ChildProcess> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new ExpectedOperationError("unsupported_platform", "Starting Baguette requires an Apple Silicon Mac with Xcode 26 or later.");
  }
  const executable = await bundledExecutable();
  const environment = await baguetteEnvironment(executable, signal);
  return spawn(executable, ["serve", "--host", host, "--port", port, "--no-plugins"], {
    stdio: ["ignore", "pipe", "pipe"], shell: false, env: environment,
  });
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
  readonly baseUrl: URL;
  private child?: ChildProcess;
  private starting?: Promise<Status>;
  private readonly lifecycle = new AbortController();
  private readonly deviceChanges = new Map<string, Promise<Status>>();
  private disposed = false;
  private readonly embedded: boolean;
  private readonly kickstartBridge: (udid: string, signal: AbortSignal) => Promise<void>;
  private readonly bridgeRestarts = new Map<string, number>();
  private readonly launchBackend: (host: string, port: string, signal: AbortSignal) => Promise<ChildProcess>;
  private readonly startFailures = new FailureEpisodes();

  constructor(baseUrl?: string, kickstartBridge = kickstartAccessibilityBridge, launchBackend = launchBundledBaguette) {
    this.embedded = baseUrl == null;
    this.baseUrl = parseBaseUrl(baseUrl ?? "http://127.0.0.1:0");
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
        diagnostic.backendMode = this.embedded ? "embedded" : "external";
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

  async status(signal?: AbortSignal): Promise<Status> {
    if (this.embedded && !this.child) {
      return { connected: false, managed: false, baseUrl: this.baseUrl.origin, devices: [], error: "The bundled simulator backend has not started." };
    }
    try {
      // Listing waits on CoreSimulator, which can take seconds while a device boots.
      const devices = normalizeDevices(await this.json("/simulators.json", { signal }));
      return { connected: true, managed: this.child != null, baseUrl: this.baseUrl.origin, devices };
    } catch (error) {
      const status = {
        connected: false, managed: this.child != null, baseUrl: this.baseUrl.origin, devices: [],
        error: `Cannot reach Baguette at ${this.baseUrl.origin}. ${errorMessage(error)}`,
      };
      listFailures.set(status, error);
      return status;
    }
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

  private async allocatePort(): Promise<number> {
    const socket = createServer();
    await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("Could not allocate a port for the bundled simulator backend.");
    await new Promise<void>(resolve => socket.close(() => resolve()));
    return address.port;
  }

  private async ensureStarted(): Promise<Status> {
    const current = await this.status();
    if (current.connected) return current;
    // The port is our running Baguette's own, so its failed device list is not a port conflict.
    if (this.child) throw listError(current);
    if (this.embedded === false) {
      // Refuse to start over a listener that is slow or is not Baguette.
      if (await this.portInUse()) throw new Error(`Port ${this.baseUrl.port || "80"} is in use, but its listener did not return a Baguette device list.`);
      return this.launch();
    }
    // Another process can bind an allocated port before Baguette does. Baguette then exits, so try a new port.
    for (let attempt = 1; ; attempt++) {
      this.baseUrl.port = String(await this.allocatePort());
      try {
        return await this.launch();
      } catch (error) {
        const portTaken = errorMessage(error).includes("Address already in use");
        if (portTaken === false || attempt === PORT_ATTEMPTS) throw error;
      }
    }
  }

  // Whether anything accepts connections at the address, whether or not it answers.
  private async portInUse(): Promise<boolean> {
    try {
      await fetch(new URL("/simulators.json", this.baseUrl), { signal: AbortSignal.timeout(1500), redirect: "error" });
      return true;
    } catch (error) {
      return (error as { cause?: { code?: string } }).cause?.code !== "ECONNREFUSED";
    }
  }

  private async launch(): Promise<Status> {
    // Each attempt keeps its own output, so a failed attempt's late output can't explain the next one.
    let diagnostics = "";
    const host = this.baseUrl.hostname.replace(/^\[|\]$/g, "");
    const child = await this.launchBackend(host, this.baseUrl.port || "80", this.lifecycle.signal);
    if (this.disposed) {
      child.kill("SIGTERM");
      throw new Error("The plugin server has closed.");
    }
    this.child = child;
    let launchError: Error | undefined;
    const exited = new AbortController();
    child.on("error", error => { launchError = error; });
    child.on("exit", (code, signal) => {
      exited.abort();
      if (!this.disposed) process.stderr.write(`[mobile-dev] Baguette exited: code=${code} signal=${signal ?? "none"}.\n`);
      if (this.child === child) this.child = undefined;
    });
    for (const output of [child.stdout, child.stderr]) {
      output?.on("data", chunk => {
        diagnostics = (diagnostics + chunk.toString()).slice(-4000);
        process.stderr.write(chunk);
      });
    }
    try {
      const deadline = AbortSignal.timeout(20000);
      // A listener that holds the port but never answers must not delay noticing that Baguette exited.
      const polling = AbortSignal.any([deadline, exited.signal]);
      while (!deadline.aborted && !this.disposed) {
        if (launchError) {
          if ((launchError as NodeJS.ErrnoException).code === "ENOENT") {
            const error = new Error("The bundled Baguette executable could not start. Reinstall the plugin package.");
            throw annotateDeviceCommand(error, "baguette_serve", { failure: "missing_executable" });
          }
          throw annotateDeviceCommand(launchError, "baguette_serve");
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          const error = new Error(`Baguette exited before it became ready. ${diagnostics.trim()}`);
          const status = child.exitCode ?? undefined;
          throw annotateDeviceCommand(error, "baguette_serve", child.signalCode === null ? { failure: "exit", status } : { failure: "signal" });
        }
        const status = await this.status(polling);
        if (status.connected) return status;
        await delay(250);
      }
      const error = new Error(`Baguette did not become ready within 20 seconds. ${diagnostics.trim()}`);
      throw annotateDeviceCommand(error, "baguette_serve", { failure: "deadline" });
    } catch (error) {
      child.kill("SIGTERM");
      if (this.child === child) this.child = undefined;
      throw error;
    }
  }

  async device(udid: string, mustBeBooted = false) {
    udidSchema.parse(udid);
    await this.start();
    return this.listedDevice(udid, mustBeBooted);
  }

  // The simulator as a running Baguette lists it; this never starts Baguette.
  async listedDevice(udid: string, mustBeBooted = false, signal?: AbortSignal) {
    const status = await this.status(signal);
    if (!status.connected) throw listError(status);
    const device = status.devices.find(item => item.udid === udid);
    if (!device) throw new SimulatorUnavailableError("This simulator is no longer available. Refresh the device list.");
    if (mustBeBooted && device.state !== "Booted") throw new SimulatorUnavailableError("The simulator is stopped. Press Start to boot it.");
    return device;
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
      const device = await this.device(udid);
      const expected = action === "boot" ? "Booted" : "Shutdown";
      // Baguette's boot route also repairs input. Never call it on a running device.
      if (device.state === expected) return this.status();
      const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(timeout)]);
      try {
        const inProgress = device.state === (action === "boot" ? "Booting" : "ShuttingDown");
        if (!inProgress) await this.json(`/simulators/${udid}/${action}`, { method: "POST", signal }, timeout);
        while (true) {
          signal.throwIfAborted();
          const status = await this.status(signal);
          signal.throwIfAborted();
          if (!status.connected) throw listError(status);
          const current = status.devices.find(item => item.udid === udid);
          if (!current) throw new SimulatorUnavailableError("This simulator is no longer available. Refresh the device list.");
          if (current.state === expected) return status;
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
    const executable = await bundledExecutable();
    const environment = await baguetteEnvironment(executable, this.lifecycle.signal);
    const execute = promisify(execFile);
    const { stdout, stderr } = await execute(executable, ["heal", "--udid", udid], {
      timeout: 45000, maxBuffer: 1024 * 1024, encoding: "utf8", env: environment, signal: this.lifecycle.signal,
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
