import { resolve } from "node:path";
import { call, option, readBatches, withServer } from "./lib/mcp-smoke.mjs";

const deviceId = option("--device");
const bundleId = option("--bundle");
if (deviceId === undefined || bundleId === undefined) throw new Error("Pass --device <hardware-UDID> --bundle <running-development-app>. This test does not launch apps.");
const withFps = process.argv.includes("--with-fps");

async function next(batches) {
  const { value: batch } = await batches.next();
  if (batch.phase === "failed") throw new Error(batch.error);
  return batch;
}

await withServer({ args: [resolve("dist/server.mjs")], name: "mobile-dev-physical-cpu-smoke" }, async client => {
  const structured = async (name, args) => (await call(client, name, args)).structuredContent;
  let cpuSession;
  let fpsSession;
  try {
    const device = { platform: "ios", kind: "physical", deviceId };
    const sources = await structured("mobile_performance_sources", device);
    const app = sources.apps.find(app => app.bundleId === bundleId);
    if (app === undefined) throw new Error("The selected development app is not already running.");
    const opened = await structured("mobile_cpu_session", { target: { ...device, bundleId } });
    cpuSession = opened.sessionId;
    const cpu = readBatches(client, opened.cpuUri);
    let fps;
    if (withFps) {
      const fpsOpened = await structured("mobile_display_fps_session", { target: { platform: "ios", deviceId } });
      fpsSession = fpsOpened.sessionId;
      fps = readBatches(client, fpsOpened.fpsUri);
    }
    const samples = [];
    const fpsSamples = [];
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline && (samples.length < 8 || (withFps && fpsSamples.length < 2))) {
      const batch = await next(cpu);
      if (batch.memoryMetric !== "physical-footprint") throw new Error("Unexpected physical iOS memory metric.");
      samples.push(...batch.samples);
      if (fps) fpsSamples.push(...(await next(fps)).samples);
    }
    const complete = samples.filter(sample => sample.cpuPercent !== null && sample.memoryBytes > 0 && sample.threads.length > 0);
    if (complete.length < 5) throw new Error("The device did not return live CPU, memory and thread samples.");
    if (withFps && fpsSamples.every(sample => sample.fps === null)) throw new Error("Concurrent Display FPS produced no complete measurements.");
    await call(client, "mobile_cpu_close", { sessionId: cpuSession });
    cpuSession = undefined;
    const after = await structured("mobile_performance_sources", device);
    const remaining = after.apps.find(app => app.bundleId === bundleId);
    if (remaining?.pid !== app.pid) throw new Error("The app exited or changed PID during monitoring.");
    const latest = complete.at(-1);
    const memoryMiB = latest.memoryBytes / 1048576;
    console.log(JSON.stringify({ deviceId, bundleId, pid: app.pid, samples: samples.length, cpuPercent: latest.cpuPercent,
      memoryMiB, threads: latest.threads.length, fpsSamples: fpsSamples.length, detached: true, samePid: true }));
  } finally {
    try {
      if (cpuSession) await call(client, "mobile_cpu_close", { sessionId: cpuSession });
    } finally {
      if (fpsSession) await call(client, "mobile_display_fps_close", { sessionId: fpsSession });
    }
  }
});
