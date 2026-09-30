import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { udidSchema } from "../shared/protocol.ts";

export type InputStatus = { state: "ready" | "blocked" | "unknown" };
export interface SimulatorInput {
  status(udid: string, options?: { fresh: boolean }): Promise<InputStatus>;
  repair(udid: string): Promise<InputStatus>;
}

const execute = promisify(execFile);
const deviceHubKey = "com.apple.coredevice.dtuhidd.active";

type Check = { expires: number; result?: Promise<InputStatus>; pending?: Promise<InputStatus> };

async function readDeviceHubState(udid: string): Promise<string> {
  const { stdout } = await execute("/usr/bin/xcrun", ["simctl", "spawn", udid, "notifyutil", "-g", deviceHubKey], {
    timeout: 5000, maxBuffer: 1024 * 1024, encoding: "utf8",
  });
  return stdout;
}

export class SimulatorInputService implements SimulatorInput {
  private readonly checks = new Map<string, Check>();
  private readonly repairs = new Map<string, Promise<InputStatus>>();
  private readonly repairDevice: (udid: string) => Promise<void>;
  private readonly readState: (udid: string) => Promise<string>;

  constructor(repairDevice: (udid: string) => Promise<void>, readState = readDeviceHubState) {
    this.repairDevice = repairDevice;
    this.readState = readState;
  }

  status(udid: string, options?: { fresh: boolean }): Promise<InputStatus> {
    udidSchema.parse(udid);
    const repair = this.repairs.get(udid);
    if (repair) return repair;
    let cached = this.checks.get(udid);
    if (cached == null) {
      cached = { expires: 0 };
      this.checks.set(udid, cached);
    }
    if (options?.fresh !== true && cached.result) {
      if (cached.expires <= Date.now() && cached.pending == null) void this.refresh(udid, cached);
      return cached.result;
    }
    return cached.pending ?? this.refresh(udid, cached);
  }

  private refresh(udid: string, cached: Check): Promise<InputStatus> {
    cached.expires = Date.now() + 1000;
    const pending = this.check(udid).then(status => {
      if (this.checks.get(udid) === cached) {
        cached.result = pending;
        cached.pending = undefined;
      }
      return status;
    });
    cached.pending = pending;
    return pending;
  }

  private async check(udid: string): Promise<InputStatus> {
    try {
      const output = await this.readState(udid);
      const value = output.trim().split(/\s+/).at(-1);
      return { state: value === "1" ? "blocked" : value === "0" ? "ready" : "unknown" };
    } catch { return { state: "unknown" }; }
  }

  repair(udid: string): Promise<InputStatus> {
    udidSchema.parse(udid);
    const pending = this.repairs.get(udid);
    if (pending) return pending;
    this.checks.delete(udid);
    const result = this.reclaim(udid).finally(() => {
      this.repairs.delete(udid);
      this.checks.delete(udid);
    });
    this.repairs.set(udid, result);
    return result;
  }

  private async reclaim(udid: string): Promise<InputStatus> {
    const status = await this.check(udid);
    if (status.state === "ready") return status;
    if (status.state === "unknown") throw new Error("Could not check Device Hub input. Confirm that the simulator is still running and retry.");
    await this.repairDevice(udid);
    const after = await this.check(udid);
    if (after.state !== "ready") throw new Error("Could not confirm the input repair. Check the simulator in Device Hub and retry.");
    return after;
  }
}
