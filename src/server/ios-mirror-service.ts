import "./instrument.ts";
import { execFile } from "node:child_process";
import { chmod, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { IosMirrorHub } from "./ios-mirror-hub.ts";
import { openNativeIosCapture } from "./ios-native-capture.ts";
import { createIosMirrorServer } from "./ios-mirror-server.ts";
import { mirrorSocketPath } from "./ios-mirror-rpc.ts";
import { captureServerError, closeServerTelemetry, recordIosMirrorSharing } from "./telemetry.ts";
import { TELEMETRY_INTERVAL_MS } from "../shared/telemetry.ts";

const lockPath = mirrorSocketPath + ".lock";
const run = promisify(execFile);
let owned = false;
let stopping: Promise<void> | undefined;
let idleTimer: NodeJS.Timeout | undefined;
let metricsTimer: NodeJS.Timeout | undefined;
let previousDropped = 0;
const hub = new IosMirrorHub(openNativeIosCapture, () => {}, error => captureServerError(error, "ios-mirror.shared-capture"));
function metrics() {
  const state = hub.snapshot();
  const dropped = state.dropped - previousDropped;
  previousDropped = state.dropped;
  recordIosMirrorSharing(state.captures, state.subscribers, dropped);
}
function idle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => void stop(), 30000); }
function active() { clearTimeout(idleTimer); }
const service = createIosMirrorServer(hub, idle, active);

async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    clearTimeout(idleTimer);
    clearInterval(metricsTimer);
    try { await service.close(); }
    finally {
      metrics();
      if (owned) { await unlink(mirrorSocketPath).catch(() => {}); await unlink(lockPath).catch(() => {}); }
      await closeServerTelemetry();
    }
  })();
  return stopping;
}

try {
  // shlock atomically elects an owner and recovers locks whose process has exited.
  const pid = String(process.pid);
  try { await run("/usr/bin/shlock", ["-p", pid, "-f", lockPath]); owned = true; }
  catch { await closeServerTelemetry(); process.exit(0); }
  await unlink(mirrorSocketPath).catch(error => { if (error.code !== "ENOENT") throw error; });
  await new Promise<void>((resolve, reject) => {
    service.server.once("error", reject);
    service.server.listen(mirrorSocketPath, () => { service.server.removeListener("error", reject); resolve(); });
  });
  await chmod(mirrorSocketPath, 0o600);
  service.server.on("error", error => { captureServerError(error, "ios-mirror.service"); void stop(); });
  metricsTimer = setInterval(metrics, TELEMETRY_INTERVAL_MS);
  idle();
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
} catch (error) {
  captureServerError(error, "ios-mirror.service-startup");
  await stop().catch(() => {});
  process.exitCode = 1;
}
