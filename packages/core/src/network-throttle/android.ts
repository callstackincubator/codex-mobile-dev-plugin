import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { networkPresets, type NetworkPreset } from "@mobile-dev/shared/device-settings.ts";
import { runAdb, systemCommands, type Commands } from "../app-control/commands.ts";
import { proxyToken, ThrottleProxy } from "./proxy.ts";

const marker = "mobile_dev_network_throttle";
const emulatorSerial = /^emulator-\d+$/;
type DeviceState = { proxy: string | null; owner: { token: string; port: number; preset: NetworkPreset } | null };
export type ThrottleReading = { preset: NetworkPreset | null } | { foreignProxy: string };

export function parseThrottleState(output: string): DeviceState {
  const [proxyLine = "", markerLine = ""] = output.split("\n").map(line => line.trim());
  const proxy = proxyLine === "null" || proxyLine === "" || proxyLine === ":0" ? null : proxyLine;
  const match = /^([0-9a-f-]{36}):(\d+):(lte|3g|edge)$/.exec(markerLine);
  return { proxy, owner: match ? { token: match[1], port: Number(match[2]), preset: match[3] as NetworkPreset } : null };
}

// Android throttling points the device's global proxy at a ThrottleProxy on the Mac. A marker setting
// records which proxy owns the device so any plugin process can tell its own setup from the user's
// proxy and clear a setup whose process is gone, which would otherwise leave the device offline.
export class AndroidNetworkThrottle {
  private readonly proxies = new Map<string, { proxy: ThrottleProxy; port: number }>();
  private readonly recovered = new Set<string>();
  // Throttle changes run one at a time, so concurrent views cannot start two proxies for a device.
  private queue: Promise<unknown> = Promise.resolve();
  private readonly commands: Commands;
  private readonly alive: (port: number) => Promise<string | null>;

  constructor(commands: Commands = systemCommands, alive = proxyToken) { this.commands = commands; this.alive = alive; }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private shell(serial: string, action: string, command: string) { return runAdb(this.commands, serial, action, ["shell", command], 10000); }

  // Phones reach the Mac's proxy through adb reverse; emulators reach it at 10.0.2.2.
  private async reverse(serial: string, action: string, args: string[]) {
    if (emulatorSerial.test(serial)) return;
    // A listener that is already gone needs no removal.
    try { await runAdb(this.commands, serial, action, ["reverse", ...args], 10000); }
    catch (error) { if (!/not found/i.test(errorMessage(error))) throw error; }
  }

  private async state(serial: string) {
    return parseThrottleState(await this.shell(serial, "Reading the network throttle", `settings get global http_proxy; settings get global ${marker}`));
  }

  private proxyAddress(serial: string, port: number) { return `${emulatorSerial.test(serial) ? "10.0.2.2" : "127.0.0.1"}:${port}`; }

  // A marker only counts while the device still points at the proxy it names.
  private ours(serial: string, state: DeviceState) {
    return state.owner !== null && state.proxy === this.proxyAddress(serial, state.owner.port);
  }

  private async clear(serial: string, port: number) {
    await this.shell(serial, "Clearing the network throttle", `settings put global http_proxy :0 && settings delete global http_proxy && settings delete global ${marker}`);
    await this.reverse(serial, "Clearing the network throttle", ["--remove", `tcp:${port}`]);
  }

  // A plugin process that crashed leaves the device pointing at a dead proxy. Checking once when this
  // process first reaches a device brings it back online without waiting for the settings panel.
  async recover(serial: string) {
    if (this.recovered.has(serial)) return;
    this.recovered.add(serial);
    try { await this.read(serial); }
    catch (error) { this.recovered.delete(serial); throw error; }
  }

  read(serial: string): Promise<ThrottleReading> {
    return this.serialized(async () => {
      const state = await this.state(serial);
      if (state.owner && !this.ours(serial, state)) {
        // Someone replaced or removed the proxy; drop the marker but leave their setting alone.
        await this.shell(serial, "Reading the network throttle", `settings delete global ${marker}`);
      } else if (state.owner) {
        if (await this.alive(state.owner.port) !== state.owner.token) {
          // The owning plugin process is gone, so the device would have no internet.
          await this.clear(serial, state.owner.port);
          return { preset: null };
        }
        // adb reverse ends when a phone reconnects; restore it for a proxy this process owns.
        if (this.proxies.get(serial)?.port === state.owner.port) await this.reverse(serial, "Restoring the network throttle", [`tcp:${state.owner.port}`, `tcp:${state.owner.port}`]);
        return { preset: state.owner.preset };
      }
      return state.proxy ? { foreignProxy: state.proxy } : { preset: null };
    });
  }

  // Returns what the device uses afterwards: the user's own proxy stays in place.
  set(serial: string, preset: NetworkPreset | null): Promise<ThrottleReading> {
    return this.serialized(async () => {
      const state = await this.state(serial);
      const ours = this.ours(serial, state);
      const current = this.proxies.get(serial);
      if (preset === null) {
        if (ours) await this.clear(serial, state.owner!.port);
        if (current) { this.proxies.delete(serial); await current.proxy.close(); }
        return state.proxy && !ours ? { foreignProxy: state.proxy } : { preset: null };
      }
      if (state.proxy && !ours) {
        throw new ExpectedOperationError("invalid_input", `This device already uses the proxy ${state.proxy}. Remove it to simulate a slower network.`);
      }
      const link = current ?? await this.start();
      this.proxies.set(serial, link);
      // Presets match iOS; latency is the round trip, so each direction carries half.
      link.proxy.profile = networkPresets[preset];
      await this.reverse(serial, "Throttling the network", [`tcp:${link.port}`, `tcp:${link.port}`]);
      await this.shell(serial, "Throttling the network", `settings put global http_proxy ${this.proxyAddress(serial, link.port)} && settings put global ${marker} ${link.proxy.token}:${link.port}:${preset}`);
      return { preset };
    });
  }

  private async start() {
    const proxy = new ThrottleProxy(networkPresets.lte);
    return { proxy, port: await proxy.listen() };
  }

  // Devices still pointing at this process's proxies would lose internet once it exits.
  async close() {
    await this.queue;
    await Promise.allSettled([...this.proxies].map(async ([serial, { proxy, port }]) => {
      try {
        const state = await this.state(serial);
        if (this.ours(serial, state) && state.owner!.token === proxy.token) await this.clear(serial, port);
      } finally { await proxy.close(); }
    }));
    this.proxies.clear();
  }
}
