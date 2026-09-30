import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const client = new Client({ name: "mobile-dev-logs-smoke", version: "1" });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/server.mjs")], stderr: "pipe" });
let sessionId;
try {
  await client.connect(transport);
  const listed = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
  if (listed.isError) throw new Error(JSON.stringify(listed.content));
  const device = listed.structuredContent.devices.find(device => device.state === "Booted");
  if (!device) throw new Error("No simulator is already booted. This smoke test does not boot one.");
  const opened = await client.callTool({ name: "mobile_logs_session", arguments: { options: { native: { platform: "ios", deviceId: device.udid } } } });
  if (opened.isError) throw new Error(JSON.stringify(opened.content));
  sessionId = opened._meta.sessionId;
  const uri = new URL(opened._meta.logsUri);
  let records = 0;
  let live = false;
  for (let index = 0; index < 3; index++) {
    const resource = await client.readResource({ uri: uri.href });
    const batch = JSON.parse(resource.contents[0].text);
    records += batch.entries.length;
    live ||= batch.statuses.some(status => status.source === "native" && status.state === "live");
    uri.searchParams.set("after", String(batch.cursor));
  }
  if (!live || !records) throw new Error(`Native stream did not deliver logs: live=${live}, records=${records}.`);
  console.log(`Read ${records} native logs from ${device.name}. Log text stayed out of test output.`);
} finally {
  if (sessionId) await client.callTool({ name: "mobile_logs_close", arguments: { sessionId } }).catch(() => {});
  await client.close();
}
