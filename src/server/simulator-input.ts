import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { udidSchema } from "../shared/protocol.ts";

export type InputStatus = { state: "ready" | "blocked" | "unknown" };
export interface SimulatorInput {
  status(udid: string): Promise<InputStatus>;
  repair(udid: string): Promise<InputStatus>;
}

const execute = promisify(execFile);
const deviceHubKey = "com.apple.coredevice.dtuhidd.active";

export class SimulatorInputService implements SimulatorInput {
  private readonly checks = new Map<string, { expires: number; result: Promise<InputStatus> }>();
  private readonly repairs = new Map<string, Promise<InputStatus>>();
  private readonly repairDevice: (udid: string) => Promise<void>;

  constructor(repairDevice: (udid: string) => Promise<void>) { this.repairDevice = repairDevice; }

  private async spawn(udid: string, ...arguments_: string[]): Promise<string> {
    udidSchema.parse(udid);
    const { stdout } = await execute("/usr/bin/xcrun", ["simctl", "spawn", udid, ...arguments_], {
      timeout: 5000, maxBuffer: 1024 * 1024, encoding: "utf8",
    });
    return stdout;
  }

  status(udid: string): Promise<InputStatus> {
    const cached = this.checks.get(udid);
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = this.check(udid);
    this.checks.set(udid, { expires: Date.now() + 1000, result });
    return result;
  }

  private async check(udid: string): Promise<InputStatus> {
    try {
      const output = await this.spawn(udid, "notifyutil", "-g", deviceHubKey);
      const value = output.trim().split(/\s+/).at(-1);
      return { state: value === "1" ? "blocked" : value === "0" ? "ready" : "unknown" };
    } catch { return { state: "unknown" }; }
  }

  repair(udid: string): Promise<InputStatus> {
    const pending = this.repairs.get(udid);
    if (pending) return pending;
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
