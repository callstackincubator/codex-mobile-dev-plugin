import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { errorMessage, udidSchema } from "@mobile-dev/shared/protocol.ts";
import type { SimulatorDevice, Status } from "@mobile-dev/shared/protocol.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";

const execute = promisify(execFile);
const listing = z.object({
  devices: z.record(z.string(), z.array(z.object({
    udid: z.string(), name: z.string(), state: z.string(), isAvailable: z.boolean().optional(),
  }).loose())),
});

/** "com.apple.CoreSimulator.SimRuntime.iOS-26-0" reads as "iOS 26.0". */
export function simulatorRuntimeName(identifier: string): string {
  const match = /SimRuntime\.([A-Za-z]+)-(\d+(?:-\d+)*)$/.exec(identifier);
  if (match === null) return identifier;
  return `${match[1]} ${match[2].replaceAll("-", ".")}`;
}

export function parseSimulatorList(output: string): SimulatorDevice[] {
  const { devices } = listing.parse(JSON.parse(output));
  const simulators: SimulatorDevice[] = [];
  for (const [runtime, entries] of Object.entries(devices)) {
    for (const entry of entries) {
      if (entry.isAvailable === false || udidSchema.safeParse(entry.udid).success === false) continue;
      simulators.push({ udid: entry.udid, name: entry.name, state: entry.state, runtime: simulatorRuntimeName(runtime) });
    }
  }
  return simulators.sort((a, b) => Number(b.state === "Booted") - Number(a.state === "Booted") || a.name.localeCompare(b.name));
}

/**
 * Lists iOS simulators with `xcrun simctl` for the tools that target one, such as logs,
 * CPU and device choices, without starting the panel's simulator backend.
 */
export class Simctl {
  private readonly run: (args: string[]) => Promise<string>;

  constructor(run = async (args: string[]) => (await execute("xcrun", args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 })).stdout) {
    this.run = run;
  }

  async list(): Promise<Status> {
    try {
      const devices = parseSimulatorList(await this.run(["simctl", "list", "devices", "--json"]));
      return { connected: true, managed: false, baseUrl: "", devices };
    } catch (error) {
      return { connected: false, managed: false, baseUrl: "", devices: [], error: `Cannot list iOS simulators. Install Xcode with an iOS simulator runtime. ${errorMessage(error)}` };
    }
  }

  async device(udid: string, mustBeBooted = false) {
    udidSchema.parse(udid);
    const status = await this.list();
    if (!status.connected) throw new SimulatorUnavailableError(status.error ?? "Cannot list iOS simulators.");
    const device = status.devices.find(item => item.udid === udid);
    if (!device) throw new SimulatorUnavailableError("This simulator is no longer available. List the simulators again.");
    if (mustBeBooted && device.state !== "Booted") throw new SimulatorUnavailableError("The simulator is stopped. Boot it first.");
    return device;
  }
}
