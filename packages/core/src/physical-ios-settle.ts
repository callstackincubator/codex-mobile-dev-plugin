import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { recordTestingDeviceSettle } from "./telemetry.ts";

const execute = promisify(execFile);

type Run = (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;

/** A simulator UDID is a UUID; hardware UDIDs are `<8 hex>-<16 hex>` (or a bare 40-hex legacy UDID). */
export function isHardwareUdid(deviceId: string): boolean {
  return /^[0-9A-F]{8}-[0-9A-F]{16}$/i.test(deviceId) || /^[0-9a-f]{40}$/i.test(deviceId);
}

const RUNNER = /AgentDeviceRunner/;
const BOUND_MS = 10_000;
const POLL_MS = 500;
/** One quiet poll can be the gap between the runner process exiting and the app it drove being torn down. */
const GRACE_MS = 750;

/**
 * Waits for a physical iPhone to let go of the recorder's XCTest runner.
 *
 * Closing the recorder's agent-device session returns once the daemon has asked the runner to stop;
 * the phone then tears the runner down on its own clock, and XCTest takes the app it was driving
 * with it. A test run that launches that app in the meantime has the new process killed under it,
 * which devicectl reports as "process identifier ... could not be determined" (CoreDevice 10004).
 * Running again works only because by then the teardown has finished. Waiting for the runner to
 * leave the process list removes the overlap instead of retrying through it.
 *
 * Best effort and bounded: a phone that cannot list processes, or a runner that outlives the bound,
 * does not block the run, which then proceeds exactly as it did before.
 */
export async function settlePhysicalIos(deviceId: string, run: Run = execute, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), now: () => number = Date.now): Promise<void> {
  const startedAt = now();
  const args = ["devicectl", "device", "info", "processes", "--device", deviceId, "--quiet", "--timeout", "10", "--omit-deprecated-fields-in-json", "--json-output", "-"];
  while (true) {
    let running: boolean;
    try {
      const { stdout } = await run("/usr/bin/xcrun", args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
      const parsed = JSON.parse(stdout) as { result?: { runningProcesses?: { executable?: unknown }[] } };
      running = (parsed.result?.runningProcesses ?? []).some(entry => typeof entry.executable === "string" && RUNNER.test(entry.executable));
    } catch {
      recordTestingDeviceSettle("unavailable", now() - startedAt);
      return;
    }
    if (!running) {
      await sleep(GRACE_MS);
      recordTestingDeviceSettle("settled", now() - startedAt);
      return;
    }
    if (now() - startedAt >= BOUND_MS) {
      recordTestingDeviceSettle("timeout", now() - startedAt);
      return;
    }
    await sleep(POLL_MS);
  }
}
