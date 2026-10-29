import { resolve } from "node:path";
import { call, option, readBatches, withServer } from "./lib/mcp-smoke.mjs";

const physical = process.argv.includes("--physical");
const selectedUdid = option("--device");
const processName = option("--process");
await withServer({ args: [resolve("dist/server.mjs")], name: "mobile-dev-logs-smoke" }, async client => {
  const listed = await call(client, physical ? "mobile_list_ios_devices" : "mobile_list_simulators");
  const devices = physical ? listed.structuredContent.physicalDevices : listed.structuredContent.devices;
  const device = devices.find(device => device.state === (physical ? "connected" : "Booted") && (selectedUdid === undefined || selectedUdid === device.udid));
  if (!device) throw new Error("No selected iOS device is already available. This smoke test does not boot a simulator or launch an app.");
  const target = { platform: "ios", deviceId: device.udid, ...(physical ? { kind: "physical" } : {}), ...(processName ? { process: processName } : {}) };
  const opened = await call(client, "mobile_logs_session", { options: { native: target } });
  const sessionId = opened._meta.sessionId;
  try {
    let records = 0;
    let live = false;
    let reads = 0;
    for await (const batch of readBatches(client, opened._meta.logsUri)) {
      records += batch.entries.length;
      live ||= batch.statuses.some(status => status.source === "native" && status.state === "live");
      for (const entry of batch.entries) {
        if (entry.deviceId !== device.udid || (processName && entry.process !== processName)) throw new Error("The log reader returned an unexpected device or executable.");
      }
      const failed = batch.statuses.find(status => status.message);
      if (failed) throw new Error(failed.message);
      if ((live && records >= 100) || ++reads === 15) break;
    }
    if (!live || !records) throw new Error(`Native stream did not deliver logs: live=${live}, records=${records}.`);
    console.log(`Read ${records} native logs from ${device.name}. Log text stayed out of test output.`);
  } finally {
    await client.callTool({ name: "mobile_logs_close", arguments: { sessionId } }).catch(() => {});
  }
});
