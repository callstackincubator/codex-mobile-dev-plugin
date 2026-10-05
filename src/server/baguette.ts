import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { errorMessage, normalizeDevices, parseBaseUrl, udidSchema } from "../shared/protocol.ts";
import type { Status } from "../shared/protocol.ts";
import { buttonMarginsSchema } from "../shared/bezel.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { baguetteEnvironment } from "./baguette-runtime.ts";

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
  private diagnostics = "";
  private disposed = false;
  private readonly embedded: boolean;

  constructor(baseUrl?: string) {
    this.embedded = baseUrl == null;
    this.baseUrl = parseBaseUrl(baseUrl ?? "http://127.0.0.1:0");
  }

  async json(path: string, options: RequestInit = {}, timeout = 10000): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...options, redirect: "error", signal: AbortSignal.any([
        this.lifecycle.signal, AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : []),
      ]),
    });
    if (!response.ok) throw new Error(`Baguette returned HTTP ${response.status} for ${path}.`);
    const payload = await response.json();
    if (payload?.ok === false) throw new Error(payload.error ?? "Baguette rejected the request.");
    return payload;
  }

  async status(signal?: AbortSignal): Promise<Status> {
    if (this.embedded && !this.child) {
      return { connected: false, managed: false, baseUrl: this.baseUrl.origin, devices: [], error: "The bundled simulator backend has not started." };
    }
    try {
      const devices = normalizeDevices(await this.json("/simulators.json", { signal }, 2000));
      return { connected: true, managed: this.child != null, baseUrl: this.baseUrl.origin, devices };
    } catch (error) {
      return {
        connected: false, managed: this.child != null, baseUrl: this.baseUrl.origin, devices: [],
        error: `Cannot reach Baguette at ${this.baseUrl.origin}. ${errorMessage(error)}`,
      };
    }
  }

  async start(): Promise<Status> {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.starting) return this.starting;
    this.starting = this.ensureStarted();
    try { return await this.starting; }
    finally { this.starting = undefined; }
  }

  private async executable(): Promise<string> {
    const path = fileURLToPath(new URL("./baguette/Baguette", import.meta.url));
    try {
      await access(path, constants.X_OK);
    } catch {
      throw new Error("The plugin is missing its bundled Baguette runtime. Run npm run vendor:baguette and npm run build in the source project, then package it again.");
    }
    return path;
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
    if (this.embedded && !this.child) this.baseUrl.port = String(await this.allocatePort());
    // Refuse to start over a listener that is slow or is not Baguette.
    try {
      await fetch(new URL("/simulators.json", this.baseUrl), { signal: AbortSignal.timeout(1500), redirect: "error" });
      throw new Error(`Port ${this.baseUrl.port || "80"} already answers HTTP but has no valid Baguette device list.`);
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      if (code !== "ECONNREFUSED") throw error;
    }
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new Error("Starting Baguette requires an Apple Silicon Mac with Xcode 26 or later.");
    }
    if (this.child) throw new Error("Baguette is already starting. Wait and refresh the device list.");

    this.diagnostics = "";
    const executable = await this.executable();
    const environment = await baguetteEnvironment(executable, this.lifecycle.signal);
    if (this.disposed) throw new Error("The plugin server has closed.");
    const child = spawn(executable, [
      "serve", "--host", this.baseUrl.hostname.replace(/^\[|\]$/g, ""),
      "--port", this.baseUrl.port || "80", "--no-plugins",
    ], { stdio: ["ignore", "pipe", "pipe"], shell: false, env: environment });
    this.child = child;
    let launchError: Error | undefined;
    child.on("error", error => { launchError = error; });
    child.on("exit", (code, signal) => {
      if (!this.disposed) process.stderr.write(`[mobile-dev] Baguette exited: code=${code} signal=${signal ?? "none"}.\n`);
      if (this.child === child) this.child = undefined;
    });
    for (const output of [child.stdout, child.stderr]) {
      output?.on("data", chunk => {
        this.diagnostics = (this.diagnostics + chunk.toString()).slice(-4000);
        process.stderr.write(chunk);
      });
    }
    try {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !this.disposed) {
        if (launchError) {
          if ((launchError as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error("The bundled Baguette executable could not start. Reinstall the plugin package.");
          }
          throw launchError;
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Baguette exited before it became ready. ${this.diagnostics.trim()}`);
        }
        const status = await this.status();
        if (status.connected) return status;
        await delay(250);
      }
      throw new Error(`Baguette did not become ready within 20 seconds. ${this.diagnostics.trim()}`);
    } catch (error) {
      child.kill("SIGTERM");
      if (this.child === child) this.child = undefined;
      throw error;
    }
  }

  async device(udid: string, mustBeBooted = false) {
    udidSchema.parse(udid);
    await this.start();
    const status = await this.status();
    if (!status.connected) throw new Error(status.error);
    const device = status.devices.find(item => item.udid === udid);
    if (!device) throw new SimulatorUnavailableError("This simulator is no longer available. Refresh the device list.");
    if (mustBeBooted && device.state !== "Booted") throw new SimulatorUnavailableError("The simulator is stopped. Press Start to boot it.");
    return device;
  }

  async definition(udid: string) {
    await this.device(udid, true);
    return definitionSchema.parse(await this.json(`/simulators/${udid}/definition.json`));
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
          if (!status.connected) throw new Error(status.error);
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
    const executable = await this.executable();
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
