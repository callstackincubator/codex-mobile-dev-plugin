import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const udid = process.argv[2];
if (udid === undefined) throw new Error("Pass the UDID of a connected, paired physical iOS device.");
const duration = Number(process.argv[3] ?? 10);
if (Number.isFinite(duration) === false || duration < 1 || duration > 60) throw new Error("Use a duration between 1 and 60 seconds.");
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/server.mjs")], stderr: "pipe" });
transport.stderr?.on("data", chunk => { process.stderr.write(chunk); });
const client = new Client({ name: "mobile-dev-physical-stream-check", version: "1" });
let id;
try {
  await client.connect(transport);
  const opened = await client.callTool({ name: "mobile_ios_mirror_session", arguments: { udid } });
  const message = JSON.stringify(opened.content);
  assert.equal(opened.isError, undefined, message);
  id = opened._meta.sessionId;
  const uri = opened._meta.frameUri;
  let frames = 0;
  let compressedBytes = 0;
  let dropped = 0;
  let configuration;
  const started = performance.now();
  while (performance.now() - started < duration * 1000) {
    const resource = await client.readResource({ uri });
    const batch = JSON.parse(resource.contents[0].text);
    configuration = batch.configuration ?? configuration;
    dropped = batch.dropped;
    for (const frame of batch.frames) {
      const bytes = Buffer.from(frame.data, "base64");
      compressedBytes += bytes.length;
      frames++;
    }
  }
  assert.ok(frames > 0, "The device did not produce a complete frame.");
  const seconds = (performance.now() - started) / 1000;
  console.log(JSON.stringify({ frames, seconds, framesPerSecond: frames / seconds, compressedMegabytesPerSecond: compressedBytes / seconds / 1_000_000, dropped, codec: configuration?.codec, width: configuration?.width, height: configuration?.height }, null, 2));
  console.log("Measures native capture and stdio MCP delivery; excludes the Codex iframe bridge and browser rendering.");
} finally {
  if (id) await client.callTool({ name: "mobile_ios_mirror_close", arguments: { sessionId: id } });
  await client.close();
}
