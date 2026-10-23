import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const udid = process.argv[2];
if (udid === undefined) throw new Error("Pass the UDID of a connected, paired physical iOS device.");
const clients = [];
async function panel() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/server.mjs")], stderr: "pipe" });
  transport.stderr?.on("data", chunk => process.stderr.write(chunk));
  const client = new Client({ name: "mobile-dev-sharing-check", version: "1" });
  const result = { client, id: undefined, uri: undefined };
  clients.push(result);
  await client.connect(transport);
  const opened = await client.callTool({ name: "mobile_ios_mirror_session", arguments: { udid } });
  const message = JSON.stringify(opened.content);
  assert.equal(opened.isError, undefined, message);
  result.id = opened._meta.sessionId;
  result.uri = opened._meta.frameUri;
  return result;
}
async function batch(panel) {
  const resource = await panel.client.readResource({ uri: panel.uri });
  return JSON.parse(resource.contents[0].text);
}
async function receive(panel, seconds) {
  const deadline = performance.now() + seconds * 1000;
  let frames = 0;
  while (performance.now() < deadline) {
    const received = await batch(panel);
    frames += received.frames.length;
  }
  assert.ok(frames > 0, "A shared panel stopped receiving frames.");
  return frames;
}
async function close(panel) {
  if (panel.id) {
    await panel.client.callTool({ name: "mobile_ios_mirror_close", arguments: { sessionId: panel.id } });
    panel.id = undefined;
  }
}
try {
  const [a, b] = await Promise.all([panel(), panel()]);
  const concurrent = await Promise.all([receive(a, 5), receive(b, 5)]);
  console.log(JSON.stringify({ phase: "both panels", frames: concurrent }));
  const initial = await batch(b);
  const uninterrupted = await receive(a, 2);
  const deadline = performance.now() + 5000;
  let recovered = false;
  while (performance.now() < deadline) {
    const received = await batch(b);
    if (received.generation > initial.generation && received.frames.some(frame => frame.key)) { recovered = true; break; }
  }
  assert.ok(recovered, "A paused subscriber did not recover with a new keyframe.");
  const resumed = await Promise.all([receive(a, 3), receive(b, 3)]);
  console.log(JSON.stringify({ phase: "paused panel resumed", uninterrupted, frames: resumed }));
  await close(a);
  await a.client.close();
  const survivor = await receive(b, 4);
  console.log(JSON.stringify({ phase: "first panel closed", frames: survivor }));
  const c = await panel();
  const rejoined = await Promise.all([receive(b, 3), receive(c, 3)]);
  console.log(JSON.stringify({ phase: "another panel joined", frames: rejoined }));
  console.log("Verified independent MCP processes. This excludes iframe rendering.");
} finally {
  await Promise.allSettled(clients.map(async panel => {
    try { await close(panel); }
    finally { await panel.client.close(); }
  }));
}
