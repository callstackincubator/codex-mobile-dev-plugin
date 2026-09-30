import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ServeEmu } from "../src/server/serve-emu.ts";
import { AndroidStreams, androidInput } from "../src/server/android-streams.ts";
import { videoPacket } from "../src/ui/android-video.ts";
import { Baguette } from "../src/server/baguette.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput, PNG } from "./fixtures.ts";

const ID = "emulator-5554";
const SCREEN = { width: 1080, height: 2400 };
const H264 = Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]);
function packet() {
  const header = Buffer.alloc(24); header.write("SEMU"); header[4] = 2; header[5] = 1;
  header.writeBigUInt64BE(123456n, 8); return Buffer.concat([header, H264]);
}
async function fakeAndroid() {
  const inputs: unknown[] = [];
  let currentSerial = ID;
  const server = createServer(async (request, response) => {
    if (request.url === "/api/screenshot") { response.setHeader("Content-Type", "image/png"); response.end(PNG); return; }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/health") { response.end(JSON.stringify({ serial: currentSerial, codec: "h264", size: SCREEN })); return; }
    if (request.url === "/api/accessibility") { response.end(JSON.stringify({ ok: true, nodes: [{ text: "Hello" }] })); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    inputs.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    response.end(JSON.stringify({ ok: true }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => {
    assert.equal(request.url, "/ws?frame-meta=1");
    socket.send(JSON.stringify({ type: "video-session", size: SCREEN })); socket.send(packet());
    socket.on("message", bytes => inputs.push(JSON.parse(bytes.toString())));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  class FakeAndroid extends ServeEmu {
    boots: string[] = [];
    async list() { return { connected: true, managed: false, baseUrl: url, devices: [{ udid: ID, name: "Pixel", state: "Booted", runtime: "Android", platform: "android" as const }] }; }
    async boot(id: string) { this.boots.push(id); return this.list(); }
  }
  const backend = new FakeAndroid(url);
  return { backend, inputs, sockets, url, switchDevice: () => { currentSerial = "emulator-5556"; }, async close() {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Timed out waiting for Android input."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test("Android input maps device pixels, touch phases, and hardware keys", () => {
  assert.deepEqual(androidInput({ type: "tap", x: 540, y: 1200, ...SCREEN }), { type: "tap", x: .5, y: .5 });
  assert.deepEqual(androidInput({ type: "touch1-move", x: 1080, y: 2400, ...SCREEN }), { type: "touch", action: "move", x: 1, y: 1, pointerId: 0 });
  assert.deepEqual(androidInput({ type: "button", button: "app-switcher" }), { type: "recents" });
  assert.deepEqual(androidInput({ type: "button", button: "back" }), { type: "back" });
  assert.deepEqual(androidInput({ type: "key", code: "KeyA", modifiers: ["control"] }), { type: "key", keycode: 29, metaState: 4096 });
  assert.throws(() => androidInput({ type: "run_shell", command: "whoami" }));
});

test("H.264 packet parsing reads SEMU timestamps, IDR frames, and the SPS codec", () => {
  const parsed = videoPacket(packet());
  assert.equal(parsed.timestamp, 123456); assert.equal(parsed.key, true); assert.equal(parsed.codec, "avc1.640028");
  assert.deepEqual(parsed.bytes, H264);
  assert.equal(videoPacket(H264).key, true);
  const v1 = Buffer.concat([packet().subarray(0, 16), H264]); v1[4] = 1;
  assert.equal(videoPacket(v1).timestamp, 123456);
});

test("Android streams relay video, validate batches, and refuse a device switch", async t => {
  const fake = await fakeAndroid(); const streams = new AndroidStreams(fake.backend);
  t.after(async () => { streams.close(); fake.backend.dispose(); await fake.close(); });
  const id = await streams.open(ID);
  const batch = await streams.batch(id, 0);
  assert.equal(batch.generation, 1); assert.deepEqual(Buffer.from(batch.packets[0].data, "base64"), packet());
  assert.equal(await streams.input(id, [{ type: "button", button: "home" }]), 1);
  await waitFor(() => fake.inputs.some(input => (input as { type?: string }).type === "home"));
  const before = fake.inputs.length;
  await assert.rejects(streams.input(id, [{ type: "button", button: "back" }, { type: "run_shell" }]));
  assert.equal(fake.inputs.length, before);
  fake.switchDevice();
  await assert.rejects(streams.input(id, [{ type: "button", button: "home" }]), /switched to another device/);
  await assert.rejects(streams.batch(id, batch.sequence), /switched to another device/);
  streams.closeSession(id);
  await assert.rejects(streams.batch(id, 0), /expired or closed/);
  assert.equal((await fetch(`${fake.url}/health`)).status, 200, "A reused backend must survive panel close.");
});

test("Android MCP flow lists without booting, captures, streams, and closes", async t => {
  const fake = await fakeAndroid(); const ios = await fakeBaguette();
  const plugin = await createTestPlugin("<canvas></canvas>", new Baguette(ios.url), fakeSimulatorInput(), undefined, fake.backend, async bytes => { assert.deepEqual(bytes, PNG); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "android-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); await ios.close(); });
  await plugin.server.connect(serverTransport); await client.connect(clientTransport);
  const listed = await client.callTool({ name: "mobile_list_android_devices", arguments: {} });
  assert.equal((listed.structuredContent?.devices as { udid: string }[])[0].udid, ID);
  assert.deepEqual(fake.backend.boots, []); assert.equal(fake.sockets.clients.size, 0);
  const screenshot = await client.callTool({ name: "mobile_android_screenshot", arguments: { deviceId: ID } });
  assert.deepEqual(screenshot.content[0], { type: "image", mimeType: "image/png", data: PNG.toString("base64") });
  const captured = await client.callTool({ name: "mobile_android_capture_screenshot", arguments: { deviceId: ID } });
  assert.deepEqual(captured.content[0], screenshot.content[0]);
  assert.equal(captured.structuredContent?.copied, true);
  const input = await client.callTool({ name: "mobile_android_send_input", arguments: { deviceId: ID, input: { type: "button", button: "back" } } });
  assert.equal(input.isError, undefined);
  assert.deepEqual(fake.inputs.at(-1), { path: "/api/key", body: { key: "back", record: false } });
  const session = await client.callTool({ name: "mobile_android_stream_session", arguments: { deviceId: ID } });
  assert.equal(session.isError, undefined);
  const id = session._meta?.sessionId;
  const resource = await client.readResource({ uri: session._meta?.frameUri as string });
  assert.equal(resource.contents[0].mimeType, "application/json");
  assert.ok("text" in resource.contents[0] && JSON.parse(resource.contents[0].text).packets.length);
  const accepted = await client.callTool({ name: "mobile_android_stream_input", arguments: { sessionId: id, messages: [{ type: "tap", x: 540, y: 1200, ...SCREEN }] } });
  assert.equal(accepted.structuredContent?.accepted, 1);
  const reset = await client.callTool({ name: "mobile_android_stream_reset", arguments: { sessionId: id } });
  assert.equal(reset.isError, undefined);
  for (const socket of fake.sockets.clients) socket.send(packet());
  const fresh = await client.readResource({ uri: session._meta?.frameUri as string });
  assert.ok("text" in fresh.contents[0] && JSON.parse(fresh.contents[0].text).generation === 2);
  const invalid = await client.callTool({ name: "mobile_android_stream_session", arguments: { deviceId: "avd:unknown" } });
  assert.equal(invalid.isError, true); assert.equal(invalid._meta?.retryable, false);
  await client.callTool({ name: "mobile_android_stream_close", arguments: { sessionId: id } });
  await assert.rejects(client.readResource({ uri: session._meta?.frameUri as string }), /expired or closed/);
  assert.deepEqual(fake.backend.boots, []);
});

test("closing an Android stream releases a waiting read and rejects later input", async t => {
  const fake = await fakeAndroid(); const streams = new AndroidStreams(fake.backend);
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(ID); const first = await streams.batch(id, 0);
  const pending = streams.batch(id, first.sequence);
  await new Promise(resolve => setTimeout(resolve, 25));
  streams.closeSession(id);
  await assert.rejects(pending, /stream closed/);
  await assert.rejects(streams.input(id, [{ type: "button", button: "home" }]), /expired or closed/);
  await waitFor(() => fake.sockets.clients.size === 0);
});

test("a dropped Android stream can reopen without booting or replaying input", async t => {
  const fake = await fakeAndroid(); const streams = new AndroidStreams(fake.backend);
  t.after(async () => { streams.close(); await fake.close(); });
  const first = await streams.open(ID); await streams.batch(first, 0);
  await streams.input(first, [{ type: "button", button: "home" }]);
  await waitFor(() => fake.inputs.some(input => (input as { type?: string }).type === "home"));
  for (const socket of fake.sockets.clients) socket.terminate();
  await waitFor(() => fake.sockets.clients.size === 0);
  await assert.rejects(streams.batch(first, 1), /disconnected/);
  streams.closeSession(first);
  const second = await streams.open(ID); assert.notEqual(first, second);
  assert.equal((await streams.batch(second, 0)).packets.length, 1);
  assert.equal(fake.inputs.filter(input => (input as { type?: string }).type === "home").length, 1);
  assert.deepEqual(fake.backend.boots, []);
});

test("stalled Android readers request a keyframe and keep their stream session", async t => {
  const fake = await fakeAndroid(); const streams = new AndroidStreams(fake.backend);
  t.after(async () => { streams.close(); await fake.close(); });
  const id = await streams.open(ID); const first = await streams.batch(id, 0);
  for (const socket of fake.sockets.clients) for (let index = 0; index < 121; index++) socket.send(packet());
  await new Promise(resolve => setTimeout(resolve, 25));
  const waiting = await streams.batch(id, first.sequence);
  assert.equal(waiting.generation, first.generation + 1);
  assert.equal(waiting.packets.length, 0);
  assert.equal(fake.sockets.clients.size, 1);
  assert.equal(await streams.input(id, [{ type: "button", button: "home" }]), 1);
  for (const socket of fake.sockets.clients) socket.send(packet());
  const resumed = await streams.batch(id, waiting.sequence);
  assert.equal(resumed.generation, waiting.generation);
  assert.equal(resumed.packets.length, 1);
});

test("explicit video reset is scoped to its session and drops delta frames until a keyframe", async t => {
  const fake = await fakeAndroid(); const streams = new AndroidStreams(fake.backend);
  t.after(async () => { streams.close(); await fake.close(); });
  const first = await streams.open(ID); const second = await streams.open(ID);
  const before = await streams.batch(first, 0); const other = await streams.batch(second, 0);
  await assert.rejects(streams.reset("0".repeat(64)), /expired or closed/);
  await streams.reset(first);
  const delta = Buffer.from([0, 0, 0, 1, 0x41, 1]);
  for (const socket of fake.sockets.clients) socket.send(delta);
  const waiting = await streams.batch(first, before.sequence);
  assert.equal(waiting.generation, before.generation + 1); assert.equal(waiting.packets.length, 0);
  const untouched = await streams.batch(second, other.sequence);
  assert.equal(untouched.generation, other.generation); assert.equal(untouched.packets.length, 1);
  for (const socket of fake.sockets.clients) socket.send(packet());
  assert.equal((await streams.batch(first, waiting.sequence)).packets.length, 1);
});
