import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServeEmu, androidDisplaySize } from "../src/serve-emu.ts";
import { AndroidStreams, androidInput } from "../src/android-streams.ts";
import { videoPacket } from "../../ui/src/android-video.ts";
import { Baguette } from "../src/baguette.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput, PNG } from "../../test-support/fixtures.ts";
import { fakeInspectionSdk } from "../../test-support/android-inspection-fixtures.ts";
import { createPanel } from "../src/panel-tools.ts";
import { registerAndroidTools } from "../src/android-tools.ts";

const ID = "emulator-5554";
const SCREEN = { width: 1080, height: 2400 };
const H264 = Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x65, 1]);

test("Android accessibility uses the active full-resolution display size and stream orientation", () => {
  const physical = "Physical size: 1080x2400\n";
  assert.deepEqual(androidDisplaySize(physical, { width: 576, height: 1280 }), SCREEN);
  assert.deepEqual(androidDisplaySize(physical, { width: 1280, height: 576 }), { width: 2400, height: 1080 });
  assert.deepEqual(androidDisplaySize(`${physical}Override size: 720x1600\n`, { width: 576, height: 1280 }), { width: 720, height: 1600 });
  assert.throws(() => androidDisplaySize("No display", SCREEN), /did not return/);
  assert.throws(() => androidDisplaySize("Physical size: 0x2400", SCREEN), /invalid display size/);
});
function packet() {
  const header = Buffer.alloc(24); header.write("SEMU"); header[4] = 2; header[5] = 1;
  header.writeBigUInt64BE(123456n, 8); return Buffer.concat([header, H264]);
}
async function fakeAndroid(deviceId = ID, videoSize = SCREEN) {
  const inputs: unknown[] = [];
  let currentSerial = deviceId;
  const server = createServer(async (request, response) => {
    if (request.url === "/api/screenshot") { response.setHeader("Content-Type", "image/png"); response.end(PNG); return; }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/health") { response.end(JSON.stringify({ serial: currentSerial, codec: "h264", size: videoSize })); return; }
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
    async list() { return { connected: true, managed: false, baseUrl: url, devices: [{ udid: deviceId, name: "Pixel", state: "Booted", runtime: "Android", platform: "android" as const }] }; }
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

test("Android accessibility reports full device pixels even when scrcpy downscales video", async t => {
  await fakeInspectionSdk(t);
  const fake = await fakeAndroid(ID, { width: 576, height: 1280 });
  t.after(async () => { fake.backend.dispose(); await fake.close(); });
  const snapshot = await fake.backend.accessibility(ID);
  assert.deepEqual(snapshot.screen, SCREEN);
  assert.equal(snapshot.tree.nodes[0].text, "Hello");
  assert.deepEqual(fake.backend.boots, []);
});

test("Android input maps device pixels, touch phases, and hardware keys", () => {
  assert.deepEqual(androidInput({ type: "tap", x: 540, y: 1200, ...SCREEN }), { type: "tap", x: .5, y: .5 });
  assert.deepEqual(androidInput({ type: "touch1-move", x: 1080, y: 2400, ...SCREEN }), { type: "touch", action: "move", x: 1, y: 1, pointerId: 0 });
  assert.deepEqual(androidInput({ type: "button", button: "app-switcher" }), { type: "recents" });
  assert.deepEqual(androidInput({ type: "button", button: "back" }), { type: "back" });
  assert.deepEqual(androidInput({ type: "key", code: "KeyA", modifiers: ["control"] }), { type: "key", keycode: 29, metaState: 4096 });
  assert.throws(() => androidInput({ type: "run_shell", command: "whoami" }));
});

test("physical Android panel streams route pointer, typing, and navigation input through scrcpy", async t => {
  const deviceId = "physical-phone";
  const fake = await fakeAndroid(deviceId);
  const streams = new AndroidStreams(fake.backend);
  t.after(async () => { streams.close(); fake.backend.dispose(); await fake.close(); });
  const sessionId = await streams.open(deviceId);
  const accepted = await streams.input(sessionId, [
    { type: "tap", x: 540, y: 1200, ...SCREEN },
    { type: "touch1-down", x: 540, y: 1200, ...SCREEN },
    { type: "touch1-move", x: 540, y: 600, ...SCREEN },
    { type: "touch1-up", x: 540, y: 600, ...SCREEN },
    { type: "type", text: "display" },
    { type: "key", code: "Backspace" },
    { type: "button", button: "home" },
    { type: "button", button: "back" },
    { type: "button", button: "app-switcher" },
  ]);
  assert.equal(accepted, 9);
  await waitFor(() => fake.inputs.length === accepted + 1);
  const delivered = fake.inputs.filter(input => typeof input === "object" && input !== null && "type" in input && input.type !== "reset-video");
  const expected = [
    { type: "tap", x: .5, y: .5 },
    { type: "touch", action: "down", x: .5, y: .5, pointerId: 0 },
    { type: "touch", action: "move", x: .5, y: .25, pointerId: 0 },
    { type: "touch", action: "up", x: .5, y: .25, pointerId: 0 },
    { type: "text", text: "display" },
    { type: "key", keycode: 67, metaState: 0 },
    { type: "home" },
    { type: "back" },
    { type: "recents" },
  ];
  for (let index = 0; index < expected.length; index++) {
    assert.deepEqual(delivered[index], { ...expected[index], ack: false, record: false });
  }
  assert.deepEqual(fake.backend.boots, []);
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
  const plugin = await createTestPlugin("<canvas></canvas>", { panel: createPanel({ baguette: new Baguette(ios.url), simulatorInput: fakeSimulatorInput(), copyScreenshot: async bytes => { assert.deepEqual(bytes, PNG); } }), android: fake.backend });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "android-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); await ios.close(); });
  await plugin.server.connect(serverTransport); await client.connect(clientTransport);
  const listed = await client.callTool({ name: "mobile_list_android_devices", arguments: {} });
  assert.equal((listed.structuredContent?.devices as { udid: string }[])[0].udid, ID);
  assert.deepEqual(fake.backend.boots, []); assert.equal(fake.sockets.clients.size, 0);
  const captured = await client.callTool({ name: "mobile_android_capture_screenshot", arguments: { deviceId: ID } });
  assert.deepEqual(captured.content[0], { type: "image", mimeType: "image/png", data: PNG.toString("base64") });
  assert.equal(captured.structuredContent?.copied, true);
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

test("a missing serve-emu runtime tells the user to reinstall and stops the panel's retries", async t => {
  await fakeInspectionSdk(t);
  // Running from source, serve-emu is never beside this module, so starting a stream finds it missing.
  class Unbundled extends ServeEmu {
    async list() { return { connected: true, managed: false, baseUrl: "", devices: [{ udid: ID, name: "Pixel", state: "Booted", runtime: "Android", platform: "android" as const }] }; }
  }
  const server = new McpServer({ name: "android-runtime-test", version: "1" });
  const backend = new Unbundled();
  registerAndroidTools(server, backend, "ui://mobile-dev/test.html", async () => {}, async () => {});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "android-runtime-test", version: "1" });
  t.after(async () => { await client.close(); await server.close(); backend.dispose(); });
  await server.connect(serverTransport); await client.connect(clientTransport);
  const session = await client.callTool({ name: "mobile_android_stream_session", arguments: { deviceId: ID } });
  assert.equal(session.isError, true);
  assert.equal(session._meta?.retryable, false);
  assert.deepEqual(session.content, [{ type: "text", text: "This Mobile Dev installation is missing its Android streaming backend. Reinstall Mobile Dev, then restart the app running it." }]);
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

test("serve-emu rejections surface their message, or a fixed one when they carry none", async t => {
  const replies: [number, unknown][] = [
    [200, { ok: true, value: 1 }],
    [200, { ok: false, error: "mode must be clean or live" }],
    [400, { ok: false, error: { code: "invalid_request", message: "bad body" } }],
    [200, { ok: false, error: "" }],
    [200, { ok: false }],
    [500, "not json"],
  ];
  const server = createServer((_request, response) => {
    const [status, body] = replies.shift()!;
    response.writeHead(status, { "Content-Type": "application/json" }).end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const backend = new ServeEmu();
  assert.deepEqual(await backend.json(url, "/api/x"), { ok: true, value: 1 });
  await assert.rejects(backend.json(url, "/api/x"), /^Error: mode must be clean or live$/);
  await assert.rejects(backend.json(url, "/api/x"), /^Error: bad body$/);
  await assert.rejects(backend.json(url, "/api/x"), /^Error: serve-emu rejected the request\.$/);
  await assert.rejects(backend.json(url, "/api/x"), /^Error: serve-emu rejected the request\.$/);
  await assert.rejects(backend.json(url, "/api/x"), /^Error: serve-emu returned HTTP 500 for \/api\/x\.$/);
});
