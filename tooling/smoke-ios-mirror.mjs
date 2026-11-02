import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const udid = process.argv[2];
if (udid === undefined) throw new Error("Pass the UDID of a connected, paired physical iOS device.");
const duration = Number(process.argv[3] ?? 10);
if (Number.isFinite(duration) === false || duration < 1 || duration > 60) throw new Error("Use a duration between 1 and 60 seconds.");
const recovery = process.argv.includes("--recovery");
if (recovery && duration < 20) throw new Error("Use at least 20 seconds for the recovery check.");
const interruptions = [
  { at: 3000, pause: 500 },
  { at: 10000, pause: 1000 },
  { at: 16000, pause: 0 },
];
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
  let generation = 0;
  let recovered = 0;
  let pendingRecovery;
  let configuration;
  const started = performance.now();
  while (performance.now() - started < duration * 1000) {
    const interruption = interruptions[recovered];
    const elapsed = performance.now() - started;
    if (recovery && pendingRecovery === undefined && interruption && elapsed >= interruption.at) {
      const previousGeneration = generation;
      const previousDropped = dropped;
      if (interruption.pause > 0) await delay(interruption.pause);
      else {
        const reset = await client.callTool({ name: "mobile_ios_mirror_reset", arguments: { sessionId: id } });
        assert.equal(reset.isError, undefined);
      }
      pendingRecovery = { previousGeneration, previousDropped, pause: interruption.pause, deadline: performance.now() + 5000 };
    }
    const resource = await client.readResource({ uri });
    const batch = JSON.parse(resource.contents[0].text);
    configuration = batch.configuration ?? configuration;
    dropped = batch.dropped;
    generation = batch.generation;
    let receivedKey = false;
    for (const frame of batch.frames) {
      const bytes = Buffer.from(frame.data, "base64");
      compressedBytes += bytes.length;
      frames++;
      if (frame.key) receivedKey = true;
    }
    if (pendingRecovery) {
      if (generation > pendingRecovery.previousGeneration && receivedKey) {
        if (pendingRecovery.pause > 0) assert.ok(dropped > pendingRecovery.previousDropped, "The reader pause did not overflow the queue.");
        recovered++;
        console.log(JSON.stringify({ recovery: recovered, pauseMs: pendingRecovery.pause, generation, dropped }));
        pendingRecovery = undefined;
      } else {
        if (performance.now() >= pendingRecovery.deadline) {
          if (generation === pendingRecovery.previousGeneration && pendingRecovery.pause > 0) {
            assert.fail("The reader pause did not overflow the queue. Keep the phone unlocked and its screen moving during the recovery check.");
          }
          assert.fail("The stream did not recover with a new keyframe within five seconds.");
        }
      }
    }
  }
  assert.ok(frames > 0, "The device did not produce a complete frame.");
  if (recovery) assert.equal(recovered, interruptions.length, "Not every interruption recovered.");
  const seconds = (performance.now() - started) / 1000;
  console.log(JSON.stringify({ frames, seconds, framesPerSecond: frames / seconds, compressedMegabytesPerSecond: compressedBytes / seconds / 1_000_000, dropped, codec: configuration?.codec, width: configuration?.width, height: configuration?.height }, null, 2));
  console.log("Measures native capture and stdio MCP delivery; excludes the Codex iframe bridge and browser rendering.");
} finally {
  if (id) await client.callTool({ name: "mobile_ios_mirror_close", arguments: { sessionId: id } });
  await client.close();
}
