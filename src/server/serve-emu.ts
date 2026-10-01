import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { bootAndroidEmulator, parseAvdName } from "./android-emulator.ts";
import { adbPath } from "./native-logs.ts";
import { errorMessage, parseBaseUrl } from "../shared/protocol.ts";
import type { SimulatorDevice, Status } from "../shared/protocol.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";

const execute = promisify(execFile);
export const androidIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:\[\]%-]+$/);
const healthSchema = z.object({ serial: androidIdSchema, codec: z.string(), size: z.object({ width: z.number().positive(), height: z.number().positive() }) });
type Backend = { url: URL; child?: ChildProcess };

export class ServeEmu {
  private readonly avdNames = new Map<string, string>();
  private readonly backends = new Map<string, Backend>();
  private readonly booting = new Map<string, Promise<Status>>();
  private readonly lifetime = new AbortController();
  private readonly starting = new Map<string, Promise<Backend>>();
  private disposed = false;
  private readonly external?: URL;

  constructor(baseUrl = process.env.SERVE_EMU_URL) {
    if (baseUrl) this.external = parseBaseUrl(baseUrl, "SERVE_EMU_URL");
  }

  private async emulatorPath() {
    for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk")]) {
      if (!root) continue;
      const path = join(root, "emulator/emulator");
      try { await access(path, constants.X_OK); return path; } catch { /* Try PATH next. */ }
    }
    return "emulator";
  }

  async list(): Promise<Status> {
    try {
      const adb = await adbPath();
      const emulator = await this.emulatorPath();
      const [devices, avds] = await Promise.all([
        execute(adb, ["devices", "-l"], { timeout: 5000, maxBuffer: 1024 * 1024 }),
        execute(emulator, ["-list-avds"], { timeout: 5000, maxBuffer: 1024 * 1024 }).catch(error => {
          if (error.code === "ENOENT") return { stdout: "" };
          throw error;
        }),
      ]);
      const deviceLines = devices.stdout.split(/\r?\n/);
      const runningReads = deviceLines.flatMap(line => {
        const match = line.match(/^(\S+)\s+(device|offline|unauthorized)(?:\s|$)(.*)/);
        if (!match) return [];
        const parsedId = androidIdSchema.safeParse(match[1]);
        if (parsedId.success === false) return [];
        return [(async (): Promise<SimulatorDevice> => {
          const rawModel = match[3].match(/(?:^|\s)model:(\S+)/)?.[1];
          const model = rawModel?.replace(/_/g, " ");
          let name = model ?? match[1];
          const emulatorDevice = /^emulator-\d+$/.test(match[1]);
          if (emulatorDevice && match[2] === "device") {
            const response = await execute(adb, ["-s", match[1], "emu", "avd", "name"], { timeout: 3000 }).catch(() => undefined);
            const avdName = parseAvdName(response?.stdout);
            if (avdName) this.avdNames.set(match[1], avdName);
            name = avdName ?? this.avdNames.get(match[1]) ?? name;
          }
          const identity = { udid: match[1], name, state: match[2] === "device" ? "Booted" : match[2], runtime: "Android", platform: "android" as const };
          if (emulatorDevice) return { ...identity, kind: "emulator" };
          const network = /:\d+$|\._adb(?:-tls-connect)?\._tcp\.?$/.test(match[1]);
          const transportType = network ? "localNetwork" : "wired";
          return { ...identity, kind: "physical", transportType, ...(model ? { model } : {}) };
        })()];
      });
      const running = await Promise.all(runningReads);
      for (const serial of this.avdNames.keys()) if (!running.some(device => device.udid === serial)) this.avdNames.delete(serial);
      const avdOutput = avds.stdout.trim();
      const avdLines = avdOutput.split(/\r?\n/);
      const stoppedNames = avdLines.filter(name => {
        if (!name) return false;
        const parsedId = androidIdSchema.safeParse(`avd:${name}`);
        const runningAvd = running.some(device => device.kind === "emulator" && device.name === name);
        return parsedId.success && !runningAvd;
      });
      const stopped = stoppedNames.map(name => ({ udid: `avd:${name}`, name, state: "Shutdown", runtime: "Android", platform: "android" as const, kind: "emulator" as const }));
      return { connected: true, managed: [...this.backends.values()].some(backend => !!backend.child), baseUrl: this.external?.origin ?? "", devices: [...running, ...stopped] };
    } catch (error) {
      return { connected: false, managed: false, baseUrl: "", devices: [], error: `Cannot list Android devices. Install Android SDK platform-tools and emulator. ${errorMessage(error)}` };
    }
  }

  async device(id: string, booted = false) {
    androidIdSchema.parse(id);
    const status = await this.list();
    if (!status.connected) throw new Error(status.error);
    const device = status.devices.find(device => device.udid === id);
    if (!device) throw new SimulatorUnavailableError("This Android device is no longer available. Refresh the device list.");
    if (booted && device.state !== "Booted") throw new SimulatorUnavailableError("The Android device is stopped or offline. Press Start or reconnect it.");
    return device;
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
    const device = await this.device(id);
    if (device.state === "Booted") return this.list();
    if (!id.startsWith("avd:")) throw new SimulatorUnavailableError("Reconnect and authorize this Android device through adb.");
    const adb = await adbPath();
    // Launch separately from serve-emu so closing the panel never stops the AVD.
    return bootAndroidEmulator({
      name: device.name, executable: await this.emulatorPath(), signal: this.lifetime.signal,
      ready: async () => {
        const status = await this.list();
        if (!status.connected) throw new Error(status.error);
        const running = status.devices.find(item => item.kind === "emulator" && item.name === device.name && item.state === "Booted");
        if (!running) return;
        const response = await execute(adb, ["-s", running.udid, "shell", "getprop", "sys.boot_completed"], { timeout: 3000 }).catch(() => undefined);
        if (response?.stdout.trim() === "1") return status;
      },
    });
  }

  async shutdown(id: string) {
    androidIdSchema.parse(id);
    if (!/^emulator-\d+$/.test(id)) throw new Error("Only Android emulators can be shut down from this panel.");
    const before = await this.list();
    if (!before.connected) throw new Error(before.error);
    if (!before.devices.some(device => device.udid === id)) return before;
    await execute(await adbPath(), ["-s", id, "emu", "kill"], { timeout: 5000 });
    this.backends.get(id)?.child?.kill("SIGTERM");
    this.backends.delete(id);
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]);
    while (true) {
      signal.throwIfAborted();
      const status = await this.list();
      if (!status.connected) throw new Error(status.error);
      if (!status.devices.some(device => device.udid === id)) return status;
      await delay(250, undefined, { signal });
    }
  }

  async json(url: URL, path: string, options: RequestInit = {}) {
    const response = await fetch(new URL(path, url), { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`serve-emu returned HTTP ${response.status} for ${path}.`);
    const payload = await response.json();
    if (payload.ok === false) throw new Error(payload.error ?? "serve-emu rejected the request.");
    return payload;
  }

  private async health(url: URL) {
    const response = await fetch(new URL("/health", url), { redirect: "error", signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`serve-emu health returned HTTP ${response.status}.`);
    return healthSchema.parse(await response.json());
  }

  async assertDevice(id: string, url: URL) {
    if ((await this.health(url)).serial !== id) throw new SimulatorUnavailableError("The Android backend switched to another device. Refresh and reconnect the selected device.");
  }

  async start(id: string): Promise<Backend> {
    if (this.disposed) throw new Error("The plugin server has closed.");
    let pending = this.starting.get(id);
    if (!pending) {
      pending = this.ensureStarted(id).finally(() => this.starting.delete(id));
      this.starting.set(id, pending);
    }
    return pending;
  }

  private async ensureStarted(id: string): Promise<Backend> {
    await this.device(id, true);
    const existing = this.backends.get(id);
    if (existing) {
      try { if ((await this.health(existing.url)).serial === id) return existing; } catch { /* Restart our failed backend. */ }
      existing.child?.kill("SIGTERM"); this.backends.delete(id);
    }
    const candidate = this.external ?? new URL("http://127.0.0.1:3300");
    try {
      const health = await this.health(candidate);
      if (health.serial === id) { const backend = { url: candidate }; this.backends.set(id, backend); return backend; }
      if (this.external) throw new SimulatorUnavailableError(`SERVE_EMU_URL streams ${health.serial}, not the selected device ${id}.`);
    } catch (error) { if (this.external) throw error; }
    const cli = fileURLToPath(new URL("./serve-emu/node_modules/serve-emu/src/cli.ts", import.meta.url));
    await access(cli).catch(() => { throw new Error("The plugin is missing its bundled serve-emu runtime. Run npm run vendor:serve-emu and npm run build, then package it again."); });
    const bunPath = process.env.BUN_PATH ?? join(homedir(), ".bun/bin/bun");
    const bun = await access(bunPath, constants.X_OK).then(() => bunPath, () => "bun");
    const listener = createServer();
    await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
    const address = listener.address();
    await new Promise<void>(resolve => listener.close(() => resolve()));
    if (!address || typeof address === "string") throw new Error("Cannot allocate an Android stream port.");
    if (this.disposed) throw new Error("The plugin server has closed.");
    const url = new URL(`http://127.0.0.1:${address.port}`);
    const child = spawn(bun, [cli, "--host", "127.0.0.1", "--port", url.port, "--serial", id, "--max-fps", "30"], {
      stdio: ["ignore", "pipe", "pipe"], shell: false,
      env: { ...process.env, PATH: `${dirname(await adbPath())}:${process.env.PATH ?? ""}`, SERVE_EMU_UPDATE_CHECK: "0" },
    });
    const backend = { url, child };
    this.backends.set(id, backend);
    let launchError: Error | undefined;
    let diagnostics = "";
    child.on("error", error => { launchError = error; });
    child.on("exit", () => { if (this.backends.get(id) === backend) this.backends.delete(id); });
    for (const output of [child.stdout, child.stderr]) output?.on("data", chunk => {
      diagnostics = (diagnostics + chunk).slice(-4000); process.stderr.write(chunk);
    });
    try {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !this.disposed) {
        if (launchError) throw new Error(`Cannot start serve-emu. Install Bun 1.3.13 or later. ${launchError.message}`);
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`serve-emu exited before it became ready. ${diagnostics.trim()}`);
        try { if ((await this.health(url)).serial === id) return backend; } catch { /* Wait for scrcpy startup. */ }
        await delay(250);
      }
      throw new Error(`serve-emu did not become ready within 30 seconds. ${diagnostics.trim()}`);
    } catch (error) { child.kill("SIGTERM"); this.backends.delete(id); throw error; }
  }

  async definition(id: string) {
    const backend = await this.start(id);
    const health = await this.health(backend.url);
    return { identity: { udid: id, name: (await this.device(id)).name, model: "Android" }, screen: { rect: health.size } };
  }

  dispose() {
    this.disposed = true;
    this.lifetime.abort();
    for (const backend of this.backends.values()) backend.child?.kill("SIGTERM");
    this.backends.clear();
  }
}
