import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const udid = process.argv[2];
if (!udid) throw new Error("Pass an already booted simulator UDID. This benchmark never boots, repairs, or sends input.");
const duration = Number(process.argv[3] ?? 10);
if (Number.isFinite(duration) === false || duration < 1 || duration > 60) throw new Error("Use a benchmark duration between 1 and 60 seconds.");
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/server.mjs")], stderr: "pipe" });
let diagnostics = "";
transport.stderr?.on("data", data => { diagnostics = (diagnostics + data).slice(-5000); });
const client = new Client({ name: "mobile-dev-stream-benchmark", version: "1" });
let sessionId;
try {
  await client.connect(transport);
  const opened = await client.callTool({ name: "mobile_stream_session", arguments: { udid, fps: 60 } });
  assert.equal(opened.isError, undefined, JSON.stringify(opened.content));
  sessionId = opened._meta.sessionId;
  const uri = new URL(opened._meta.frameUri);
  let after = 0;
  let frames = 0;
  let skipped = 0;
  let bytes = 0;
  const reads = [];
  const waits = [];
  const transfers = [];
  const started = performance.now();
  while (performance.now() - started < duration * 1000) {
    const before = performance.now();
    uri.searchParams.set("after", String(after));
    const result = await client.readResource({ uri: uri.href });
    const elapsed = performance.now() - before;
    const image = result.contents.find(item => item.mimeType === "image/jpeg" && "blob" in item);
    if (image == null) {
      const status = result.contents.find(item => "text" in item);
      assert.equal(JSON.parse(status.text).state, "waiting");
      continue;
    }
    const metadata = image._meta;
    assert.ok(metadata.sequence > after);
    skipped += metadata.sequence - after - 1;
    after = metadata.sequence;
    frames++;
    bytes += metadata.bytes;
    reads.push(elapsed);
    waits.push(metadata.serverWaitMs);
    transfers.push(Math.max(0, elapsed - metadata.serverWaitMs));
  }
  const elapsed = (performance.now() - started) / 1000;
  function timing(values) {
    values.sort((a, b) => a - b);
    const sum = values.reduce((total, value) => total + value, 0);
    const index = Math.max(0, Math.ceil(values.length * .95) - 1);
    return { averageMs: sum / Math.max(1, values.length), p95Ms: values[index] ?? 0 };
  }
  console.log(JSON.stringify({ requestedFps: 60, seconds: elapsed, deliveredFps: frames / elapsed, frames, skipped, jpegMegabytesPerSecond: bytes / elapsed / 1_000_000, read: timing(reads), serverWait: timing(waits), transfer: timing(transfers) }, null, 2));
  console.log("This measures the native capture and stdio MCP path. It excludes Codex's iframe bridge, browser decoding, rendering, and simulator input latency.");
} catch (error) { process.stderr.write(diagnostics); throw error; }
finally {
  if (sessionId) await client.callTool({ name: "mobile_stream_close", arguments: { sessionId } });
  await client.close();
}
