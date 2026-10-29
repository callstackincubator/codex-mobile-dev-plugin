import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { bootAndroidEmulator, parseAvdName } from "./android-emulator.ts";
import { adbDevices, adbPath, androidSdkRoots } from "./android-sdk.ts";
import { parseBaseUrl } from "@mobile-dev/shared/protocol.ts";
import type { SimulatorDevice, Status } from "@mobile-dev/shared/protocol.ts";
import { annotateDeviceCommand, backendCommand, inheritDeviceCommand } from "@mobile-dev/shared/device-command-diagnostics.ts";
import { requireDevice } from "./device-lookup.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { isMissingFile, MissingRuntimeError } from "./install-integrity.ts";
import { recordAndroidEmulatorReconnect, recordAndroidBackendStop } from "./telemetry.ts";
import type { AndroidStartupContext } from "@mobile-dev/shared/android-startup-diagnostics.ts";
import { AndroidStartupTracker } from "./android-startup.ts";
import { allocatePort, superviseBackend } from "./backend-process.ts";
import { responseBytes } from "./response-body.ts";
import type { ByteRequest } from "./response-body.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { androidIdSchema, avdId, isEmulatorSerial, isStoppedAvd } from "@mobile-dev/shared/android-ids.ts";

const execute = promisify(execFile);
// Route handlers send { ok: false, error: message }; the API boundary sends { ok: false, error: { code, message } }.
const serveEmuErrorSchema = z.object({ ok: z.literal(false), error: z.union([z.string(), z.object({ message: z.string() }).loose()]).optional() }).loose();
const healthSchema = z.object({ serial: androidIdSchema, codec: z.string(), size: z.object({ width: z.number().positive(), height: z.number().positive() }) });
// serve-emu's accessibility nodes, of which the plugin reads only the app each belongs to.
const accessibilitySchema = z.object({ nodes: z.array(z.object({ packageName: z.unknown() }).partial().loose()).optional() }).loose();
/** A serve-emu backend. One this server starts is its `child` and requires `token`; one the user runs has neither. */
export type ServeEmuBackend = { url: URL; child?: ChildProcess; token?: string };
type Backend = ServeEmuBackend;

/** Headers that authorize a request to the backend. */
export function backendHeaders(backend: Backend, headers?: HeadersInit): Headers {
  const authorized = new Headers(headers);
  if (backend.token !== undefined) authorized.set("Authorization", `Bearer ${backend.token}`);
  return authorized;
}
type Started = { backend: Backend; device: SimulatorDevice };
const ANDROID_DEVICE = { missing: "This Android device is no longer available. Refresh the device list.", stopped: "The Android device is stopped or offline. Press Start or reconnect it." };

export function androidDisplaySize(output: string, video: { width: number; height: number }) {
  const matches = [...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const match = matches.at(-1);
  if (!match) throw new Error("Android did not return its display size.");
  let width = Number(match[1]), height = Number(match[2]);
  if (!width || !height || width > 16384 || height > 16384) throw new Error("Android returned an invalid display size.");
  if ((width > height) !== (video.width > video.height)) [width, height] = [height, width];
  return { width, height };
}

export class ServeEmu {
  private readonly avdNames = new Map<string, string>();
  private readonly reconnects = new Map<string, number>();
  private readonly backends = new Map<string, Backend>();
  private readonly booting = new Map<string, Promise<Status>>();
  private readonly lifetime = new AbortController();
  private readonly starting = new Map<string, Promise<Started>>();
  private readonly stopping = new Set<ChildProcess>();
  private readonly backendContexts = new WeakMap<ChildProcess, AndroidStartupContext>();
  private disposed = false;
  private readonly external?: URL;
  private readonly startListeners = new Set<(id: string) => void>();

  constructor(baseUrl = process.env.SERVE_EMU_URL) {
    if (baseUrl) this.external = parseBaseUrl(baseUrl, "SERVE_EMU_URL");
  }

  private async emulatorPath() {
    for (const root of androidSdkRoots()) {
      const path = join(root, "emulator/emulator");
      try { await access(path, constants.X_OK); return path; } catch { /* Try PATH next. */ }
    }
    return "emulator";
  }

  async devices(): Promise<SimulatorDevice[]> {
    try {
      const adb = await adbPath();
      const emulator = await this.emulatorPath();
      const [devices, avds] = await Promise.all([
        adbDevices(adb),
        execute(emulator, ["-list-avds"], { timeout: 5000, maxBuffer: 1024 * 1024 }).catch(error => {
          if (error.code === "ENOENT") return { stdout: "" };
          throw error;
        }),
      ]);
      const runningReads = devices.map(async ({ serial, state, model }): Promise<SimulatorDevice> => {
        let name = model ?? serial;
        const emulatorDevice = isEmulatorSerial(serial);
        // The emulator console names the AVD before adb authorizes the device.
        if (emulatorDevice) {
          const response = await execute(adb, ["-s", serial, "emu", "avd", "name"], { timeout: 3000 }).catch(() => undefined);
          const avdName = parseAvdName(response?.stdout);
          if (avdName) this.avdNames.set(serial, avdName);
          name = avdName ?? this.avdNames.get(serial) ?? name;
        }
        const identity = { udid: serial, name, state: state === "device" ? "Booted" : state, runtime: "Android", platform: "android" as const };
        if (emulatorDevice) return { ...identity, kind: "emulator" };
        const network = /:\d+$|\._adb(?:-tls-connect)?\._tcp\.?$/.test(serial);
        const transportType = network ? "localNetwork" : "wired";
        return { ...identity, kind: "physical", transportType, ...(model ? { model } : {}) };
      });
      const running = await Promise.all(runningReads);
      for (const serials of [this.avdNames, this.reconnects]) for (const serial of serials.keys()) if (!running.some(device => device.udid === serial)) serials.delete(serial);
      const avdOutput = avds.stdout.trim();
      const avdLines = avdOutput.split(/\r?\n/);
      const stoppedNames = avdLines.filter(name => {
        if (!name) return false;
        const parsedId = androidIdSchema.safeParse(avdId(name));
        const runningAvd = running.some(device => device.kind === "emulator" && device.name === name);
        return parsedId.success && !runningAvd;
      });
      const stopped = stoppedNames.map(name => ({ udid: avdId(name), name, state: "Shutdown", runtime: "Android", platform: "android" as const, kind: "emulator" as const }));
      return [...running, ...stopped];
    } catch (error) {
      throw inheritDeviceCommand(new Error(`Cannot list Android devices. Install Android SDK platform-tools and emulator. ${errorMessage(error)}`), error);
    }
  }

  async list(): Promise<Status> {
    try { return this.connected(await this.devices()); }
    catch (error) { return { connected: false, managed: false, baseUrl: "", devices: [], error: errorMessage(error) }; }
  }

  private connected(devices: SimulatorDevice[]): Status {
    return { connected: true, managed: [...this.backends.values()].some(backend => !!backend.child), baseUrl: this.external?.origin ?? "", devices };
  }

  async device(id: string, booted = false) {
    androidIdSchema.parse(id);
    return requireDevice(await this.devices(), id, { ...ANDROID_DEVICE, booted });
  }

  async boot(id: string): Promise<Status> {
    if (this.disposed) throw new Error("The plugin server has closed.");
    androidIdSchema.parse(id);
    let pending = this.booting.get(id);
    if (!pending) {
      pending = this.ensureBooted(id).finally(() => this.booting.delete(id));
      this.booting.set(id, pending);
    }
    return pending;
  }

  private async ensureBooted(id: string): Promise<Status> {
    const devices = await this.devices();
    const device = requireDevice(devices, id, ANDROID_DEVICE);
    if (device.state === "Booted") return this.connected(devices);
    if (device.kind === "emulator" && device.state === "unauthorized") return this.awaitRunningEmulator(id);
    if (!isStoppedAvd(id)) throw new SimulatorUnavailableError("Reconnect and authorize this Android device through adb.");
    // Launch separately from serve-emu so closing the panel never stops the AVD.
    return bootAndroidEmulator({
      name: device.name, executable: await this.emulatorPath(), signal: this.lifetime.signal,
      ready: () => this.emulatorReady(item => item.name === device.name, "boot"),
    });
  }

  // Ready means adb authorized the emulator and Android finished booting.
  private async emulatorReady(matches: (device: SimulatorDevice) => boolean, trigger: "boot" | "selection"): Promise<Status | undefined> {
    const devices = await this.devices();
    const running = devices.find(item => item.kind === "emulator" && matches(item));
    if (running?.state === "unauthorized") await this.reconnectEmulator(running.udid, trigger);
    if (running?.state !== "Booted") return;
    const response = await execute(await adbPath(), ["-s", running.udid, "shell", "getprop", "sys.boot_completed"], { timeout: 3000 }).catch(() => undefined);
    if (response?.stdout.trim() === "1") return this.connected(devices);
  }

  // A quick-boot snapshot can restore an emulator after adb has marked it unauthorized, and adb
  // never checks again. Reconnecting the transport repeats the key exchange, at most every 5 s.
  private async reconnectEmulator(serial: string, trigger: "boot" | "selection") {
    if (Date.now() - (this.reconnects.get(serial) ?? -Infinity) < 5000) return;
    this.reconnects.set(serial, Date.now());
    recordAndroidEmulatorReconnect(trigger);
    await execute(await adbPath(), ["-s", serial, "reconnect"], { timeout: 5000 }).catch(() => {});
  }

  private async awaitRunningEmulator(serial: string): Promise<Status> {
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]);
    while (!signal.aborted) {
      const status = await this.emulatorReady(device => device.udid === serial, "selection");
      if (status) return status;
      await delay(500, undefined, { signal }).catch(() => {});
    }
    throw new SimulatorUnavailableError("The Android emulator is still unauthorized. Restart it with a cold boot, or run adb kill-server and try again.");
  }

  async shutdown(id: string) {
    androidIdSchema.parse(id);
    if (!isEmulatorSerial(id)) throw new Error("Only Android emulators can be shut down from this panel.");
    const before = await this.devices();
    if (!before.some(device => device.udid === id)) return this.connected(before);
    await execute(await adbPath(), ["-s", id, "emu", "kill"], { timeout: 5000 });
    const backend = this.backends.get(id);
    if (backend) this.stopBackend(backend);
    this.backends.delete(id);
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]);
    while (true) {
      signal.throwIfAborted();
      const devices = await this.devices();
      if (!devices.some(device => device.udid === id)) return this.connected(devices);
      await delay(250, undefined, { signal });
    }
  }

  private async request(backend: Backend, path: string, command: string, options: RequestInit = {}, timeout = 10000): Promise<Response> {
    return fetch(new URL(path, backend.url), {
      ...options, headers: backendHeaders(backend, options.headers), redirect: "error", signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(timeout)]),
    }).catch(error => { throw annotateDeviceCommand(error, command); });
  }

  async json<T = unknown>(backend: Backend, path: string, { schema, ...options }: RequestInit & { schema?: z.ZodType<T> } = {}): Promise<T> {
    const command = backendCommand("serve_emu", path);
    const response = await this.request(backend, path, command, options);
    const payload = response.ok ? await response.json().catch(error => { throw annotateDeviceCommand(error, command); }) : await response.json().catch(() => undefined);
    const rejection = serveEmuErrorSchema.safeParse(payload);
    if (response.ok && !rejection.success) {
      if (schema === undefined) return payload;
      try { return schema.parse(payload); }
      catch (error) { throw annotateDeviceCommand(error, command); }
    }
    const error = rejection.data?.error;
    const message = (typeof error === "string" ? error : error?.message) || (response.ok ? "serve-emu rejected the request." : `serve-emu returned HTTP ${response.status} for ${path}.`);
    throw annotateDeviceCommand(new Error(message), command, response.ok ? { failure: "rejected" } : { failure: "http_status", status: response.status });
  }

  /** A binary response, such as a screenshot. */
  async fetchBytes(backend: Backend, path: string, request: ByteRequest): Promise<Buffer> {
    const command = backendCommand("serve_emu", path);
    const response = await this.request(backend, path, command, {}, request.timeout);
    return responseBytes(response, command, "serve-emu", path, request);
  }

  private async health(backend: Backend, signal?: AbortSignal) {
    const response = await fetch(new URL("/health", backend.url), {
      headers: backendHeaders(backend), redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(1500), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`serve-emu health returned HTTP ${response.status}.`);
    return healthSchema.parse(await response.json());
  }

  /** Whether `backend` still serves the device, which a restarted or stopped backend no longer does. */
  current(id: string, backend: Backend): boolean {
    return this.backends.get(id) === backend;
  }

  async assertDevice(id: string, backend: Backend) {
    if ((await this.health(backend)).serial !== id) throw new SimulatorUnavailableError("The Android backend switched to another device. Refresh and reconnect the selected device.");
  }

  // Listeners run after each successful start and must handle their own failures.
  onStart(listener: (id: string) => void) {
    this.startListeners.add(listener);
    return () => { this.startListeners.delete(listener); };
  }

  async start(id: string): Promise<Backend> {
    return (await this.startDevice(id)).backend;
  }

  /** Starts or reuses the device's backend, with the device as the start listed it. */
  private async startDevice(id: string): Promise<Started> {
    if (this.disposed) throw new Error("The plugin server has closed.");
    let pending = this.starting.get(id);
    if (!pending) {
      pending = this.ensureStarted(id).then(started => {
        for (const listener of this.startListeners) listener(id);
        return started;
      }).finally(() => this.starting.delete(id));
      this.starting.set(id, pending);
    }
    return pending;
  }

  private async ensureStarted(id: string): Promise<Started> {
    const device = await this.device(id, true);
    const backend = await this.reuse(id) ?? await this.adopt(id) ?? await this.launch(id, device);
    return { backend, device };
  }

  /** The backend this server already uses for the device, unless it stopped streaming it. */
  private async reuse(id: string): Promise<Backend | undefined> {
    const existing = this.backends.get(id);
    if (!existing) return;
    try { if ((await this.health(existing)).serial === id) return existing; } catch { /* Restart our failed backend. */ }
    this.stopBackend(existing); this.backends.delete(id);
  }

  /** A serve-emu the user runs for the device, at SERVE_EMU_URL or else on its default port. */
  private async adopt(id: string): Promise<Backend | undefined> {
    const candidate: Backend = { url: this.external ?? new URL("http://127.0.0.1:3300") };
    try {
      const health = await this.health(candidate);
      if (health.serial === id) { this.backends.set(id, candidate); return candidate; }
      if (this.external) throw new SimulatorUnavailableError(`SERVE_EMU_URL streams ${health.serial}, not the selected device ${id}.`);
    } catch (error) { if (this.external) throw error; }
  }

  private async launch(id: string, device: SimulatorDevice): Promise<Backend> {
    const cliUrl = new URL("./serve-emu/src/cli.mjs", import.meta.url);
    const cli = fileURLToPath(cliUrl);
    await access(cli).catch(error => {
      if (isMissingFile(error)) throw new MissingRuntimeError("serve-emu");
      throw new Error("Mobile Dev cannot read its bundled Android streaming backend. Reinstall Mobile Dev, then restart the app running it.");
    });
    const port = await allocatePort("Cannot allocate an Android stream port.");
    if (this.disposed) throw new Error("The plugin server has closed.");
    const url = new URL(`http://127.0.0.1:${port}`);
    // serve-emu only compares a request's Origin with its Host, which a DNS-rebinding page passes, so
    // backends this server starts require a token.
    const token = randomBytes(32).toString("hex");
    let activeBackends = 0;
    for (const backend of this.backends.values()) if (backend.child) activeBackends++;
    const startup = new AndroidStartupTracker({
      deviceKind: device.kind === "physical" ? "physical" : "emulator",
      transport: device.kind !== "physical" ? "emulator" : device.transportType === "wired" || device.transportType === "localNetwork" ? device.transportType : "unknown",
      stateBefore: "online", activeBackends, stoppingBackends: this.stopping.size,
      startingBackends: this.starting.size,
    });
    const adb = await adbPath();
    const child = spawn(process.execPath, [cli, "--host", "127.0.0.1", "--port", url.port, "--token", token, "--serial", id, "--max-fps", "30"], {
      stdio: ["ignore", "pipe", "pipe", "ipc"], shell: false,
      env: { ...process.env, PATH: `${dirname(adb)}:${process.env.PATH ?? ""}`, SERVE_EMU_UPDATE_CHECK: "0" },
    });
    this.backendContexts.set(child, startup.context);
    startup.observe(child);
    const backend = { url, child, token };
    this.backends.set(id, backend);
    child.on("exit", () => { if (this.backends.get(id) === backend) this.backends.delete(id); });
    try {
      await superviseBackend(child, {
        name: "serve-emu", deadlineMs: 30000, redact: token,
        // Health fails until scrcpy streams the device.
        probe: async signal => (await this.health(backend, signal)).serial === id ? backend : undefined,
        closed: () => this.disposed,
        spawnError: error => new Error(`Cannot start the bundled Node.js serve-emu runtime. ${error.message}`),
        stop: () => this.stopBackend(backend),
      });
      startup.ready();
      return backend;
    } catch (error) {
      this.backends.delete(id);
      const failure = startup.failure(error);
      if (this.disposed === false) startup.checkDeviceAfter(adb, id, failure, this.lifetime.signal);
      throw error;
    }
  }

  async definition(id: string) {
    const { backend, device } = await this.startDevice(id);
    const health = await this.health(backend);
    return { identity: { udid: id, name: device.name, model: "Android" }, screen: { rect: health.size } };
  }

  async accessibility(id: string) {
    const backend = await this.start(id);
    const adb = await adbPath();
    const [tree, health, display] = await Promise.all([
      this.json(backend, "/api/accessibility", { schema: accessibilitySchema }),
      this.health(backend),
      execute(adb, ["-s", id, "shell", "wm", "size"], { timeout: 3000, maxBuffer: 4096 }),
    ]);
    return { tree, screen: androidDisplaySize(display.stdout, health.size) };
  }

  dispose() {
    this.disposed = true;
    this.lifetime.abort();
    for (const backend of this.backends.values()) this.stopBackend(backend);
    this.backends.clear();
  }

  private stopBackend(backend: Backend) {
    const child = backend.child;
    if (child === undefined) return;
    const context = this.backendContexts.get(child);
    if (context && child.pid !== undefined && child.exitCode === null && child.signalCode === null && this.stopping.has(child) === false && process.env.MOBILE_DEV_TELEMETRY !== "off") {
      this.stopping.add(child);
      const started = performance.now();
      child.once("exit", () => {
        this.stopping.delete(child);
        const duration = performance.now() - started;
        recordAndroidBackendStop(duration, context);
      });
    }
    child.kill("SIGTERM");
  }
}
