import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
const deviceId = option("--device");
const bundleId = option("--bundle");
if (deviceId === undefined || bundleId === undefined) throw new Error("Pass --device <hardware-UDID> --bundle <running-development-app>. This test does not launch apps.");
const withFps = process.argv.includes("--with-fps");
const client = new Client({ name: "mobile-dev-physical-cpu-smoke", version: "1" });
const entrypoint = resolve("dist/server.mjs");
const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint], stderr: "pipe" });
let cpuSession;
let fpsSession;
async function call(name, arguments_) {
  const result = await client.callTool({ name, arguments: arguments_ });
  if (result.isError) {
    const messages = result.content.filter(item => item.type === "text");
    const text = messages.map(item => item.text).join("\n");
    throw new Error(text);
  }
  return result.structuredContent;
}
async function read(uri) {
  const resource = await client.readResource({ uri: uri.href });
  const content = resource.contents.find(item => "text" in item);
  const batch = JSON.parse(content.text);
  if (batch.phase === "failed") throw new Error(batch.error);
  uri.searchParams.set("after", String(batch.cursor));
  return batch;
}
try {
  await client.connect(transport);
  const device = { platform: "ios", kind: "physical", deviceId };
  const sources = await call("mobile_performance_sources", device);
  const app = sources.apps.find(app => app.bundleId === bundleId);
  if (app === undefined) throw new Error("The selected development app is not already running.");
  const opened = await call("mobile_cpu_session", { target: { ...device, bundleId } });
  cpuSession = opened.sessionId;
  const cpuUri = new URL(opened.cpuUri);
  let fpsUri;
  if (withFps) {
    const fps = await call("mobile_display_fps_session", { target: { platform: "ios", deviceId } });
    fpsSession = fps.sessionId;
    fpsUri = new URL(fps.fpsUri);
  }
  const samples = [];
  const fpsSamples = [];
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline && (samples.length < 8 || (withFps && fpsSamples.length < 2))) {
    const batch = await read(cpuUri);
    if (batch.memoryMetric !== "physical-footprint") throw new Error("Unexpected physical iOS memory metric.");
    samples.push(...batch.samples);
    if (fpsUri) {
      const fps = await read(fpsUri);
      fpsSamples.push(...fps.samples);
    }
  }
  const complete = samples.filter(sample => sample.cpuPercent !== null && sample.memoryBytes > 0 && sample.threads.length > 0);
  if (complete.length < 5) throw new Error("The device did not return live CPU, memory and thread samples.");
  if (withFps && fpsSamples.every(sample => sample.fps === null)) throw new Error("Concurrent Display FPS produced no complete measurements.");
  await call("mobile_cpu_close", { sessionId: cpuSession });
  cpuSession = undefined;
  const after = await call("mobile_performance_sources", device);
  const remaining = after.apps.find(app => app.bundleId === bundleId);
  if (remaining?.pid !== app.pid) throw new Error("The app exited or changed PID during monitoring.");
  const latest = complete.at(-1);
  const memoryMiB = latest.memoryBytes / 1048576;
  const summary = { deviceId, bundleId, pid: app.pid, samples: samples.length, cpuPercent: latest.cpuPercent,
    memoryMiB, threads: latest.threads.length, fpsSamples: fpsSamples.length, detached: true, samePid: true };
  const text = JSON.stringify(summary);
  console.log(text);
} finally {
  try {
    if (cpuSession) await call("mobile_cpu_close", { sessionId: cpuSession });
  } finally {
    try {
      if (fpsSession) await call("mobile_display_fps_close", { sessionId: fpsSession });
    } finally { await client.close(); }
  }
}
