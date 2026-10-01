import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const physical = process.argv.includes("--physical");
function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
const selectedUdid = option("--device");
const processName = option("--process");
const client = new Client({ name: "mobile-dev-logs-smoke", version: "1" });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/server.mjs")], stderr: "pipe" });
let sessionId;
try {
  await client.connect(transport);
  const listed = await client.callTool({ name: physical ? "mobile_list_ios_devices" : "mobile_list_simulators", arguments: {} });
  if (listed.isError) throw new Error(JSON.stringify(listed.content));
  const devices = physical ? listed.structuredContent.physicalDevices : listed.structuredContent.devices;
  const device = devices.find(device => device.state === (physical ? "connected" : "Booted") && (selectedUdid === undefined || selectedUdid === device.udid));
  if (!device) throw new Error("No selected iOS device is already available. This smoke test does not boot a simulator or launch an app.");
  const target = { platform: "ios", deviceId: device.udid, ...(physical ? { kind: "physical" } : {}), ...(processName ? { process: processName } : {}) };
  const opened = await client.callTool({ name: "mobile_logs_session", arguments: { options: { native: target } } });
  if (opened.isError) throw new Error(JSON.stringify(opened.content));
  sessionId = opened._meta.sessionId;
  const uri = new URL(opened._meta.logsUri);
  let records = 0;
  let live = false;
  for (let index = 0; index < 15; index++) {
    const resource = await client.readResource({ uri: uri.href });
    const batch = JSON.parse(resource.contents[0].text);
    records += batch.entries.length;
    live ||= batch.statuses.some(status => status.source === "native" && status.state === "live");
    for (const entry of batch.entries) {
      if (entry.deviceId !== device.udid || (processName && entry.process !== processName)) throw new Error("The log reader returned an unexpected device or executable.");
    }
    const failed = batch.statuses.find(status => status.message);
    if (failed) throw new Error(failed.message);
    uri.searchParams.set("after", String(batch.cursor));
    if (live && records >= 100) break;
  }
  if (!live || !records) throw new Error(`Native stream did not deliver logs: live=${live}, records=${records}.`);
  console.log(`Read ${records} native logs from ${device.name}. Log text stayed out of test output.`);
} finally {
  if (sessionId) await client.callTool({ name: "mobile_logs_close", arguments: { sessionId } }).catch(() => {});
  await client.close();
}
