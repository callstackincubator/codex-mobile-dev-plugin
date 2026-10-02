import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { Socket, createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { WebSocket } from "ws";
import { buildServeEmu } from "../scripts/build-serve-emu.mjs";
import type { ScrcpySession, VideoPacket } from "../runtimes/serve-emu/src/scrcpy.ts";

const execute = promisify(execFile);
let directory: string;
let runtime: {
  startServer: typeof import("../runtimes/serve-emu/src/server.ts").startServer;
  serve: typeof import("../runtimes/serve-emu/src/node-server.ts").serve;
  FramedReader: typeof import("../runtimes/serve-emu/src/scrcpy.ts").FramedReader;
  ControlInputQueue: typeof import("../runtimes/serve-emu/src/control-input-queue.ts").ControlInputQueue;
};

before(async () => {
  const prefix = join(tmpdir(), "mobile-dev-node-emu-");
  directory = await mkdtemp(prefix);
  const sourceDirectory = join(directory, "src");
  await mkdir(sourceDirectory);
  const uiDirectory = join(directory, "dist/ui");
  await mkdir(uiDirectory, { recursive: true });
  await writeFile(join(uiDirectory, "index.html"), "<html>Android</html>");
  const output = join(sourceDirectory, "server.mjs");
  const source = [
    'export { startServer } from "./server.ts";',
    'export { serve } from "./node-server.ts";',
    'export { FramedReader } from "./scrcpy.ts";',
    'export { ControlInputQueue } from "./control-input-queue.ts";',
  ].join("\n");
  const resolveDir = resolve("runtimes/serve-emu/src");
  await build({
    stdin: { contents: source, resolveDir, loader: "ts" }, outfile: output,
    bundle: true, platform: "node", format: "esm", target: "node22.18",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const moduleUrl = pathToFileURL(output);
  runtime = await import(moduleUrl.href);
});

after(async () => { await rm(directory, { recursive: true, force: true }); });

function fakeScrcpy() {
  const controlSocket = new Socket();
  const videoSocket = new Socket();
  const videoReader = new runtime.FramedReader(videoSocket);
  const packets: Buffer[] = [];
  let nextFrame: ((packet: VideoPacket | null) => void) | undefined;
  let closed = false;
  const session: ScrcpySession = {
    transport: "scrcpy", serial: "emulator-5554", scid: "12345678", localPort: 28000,
    protocol: 4, meta: { deviceName: "Android", codecId: "h264", width: 1080, height: 1920 },
    proc: new ChildProcess(), controlSocket, videoReader,
    readFrame: () => new Promise(resolve => { nextFrame = resolve; }),
    async close() {
      closed = true;
      nextFrame?.(null);
      controlSocket.destroy();
      videoSocket.destroy();
    },
  };
  const inputQueue = new runtime.ControlInputQueue({
    writer: { async write(packet) { packets.push(packet); } },
  });
  return {
    session, inputQueue, packets,
    get closed() { return closed; },
    frame(packet: VideoPacket) { nextFrame?.(packet); },
  };
}

test("Node Android server preserves HTTP, WebSocket video, input acknowledgements, and cleanup", async t => {
  const scrcpy = fakeScrcpy();
  const backend = await runtime.startServer({ serial: "emulator-5554", port: 0 }, {
    openScrcpy: async () => scrcpy.session,
    createInputQueue: () => scrcpy.inputQueue,
  });
  t.after(() => backend.stop());
  const base = `http://127.0.0.1:${backend.server.port}`;
  const healthResponse = await fetch(`${base}/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.serial, "emulator-5554");
  assert.deepEqual(health.size, { width: 1080, height: 1920 });
  const page = await fetch(base);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(await page.text(), "<html>Android</html>");

  const socket = new WebSocket(`ws://127.0.0.1:${backend.server.port}/ws?frame-meta=1`);
  t.after(() => socket.terminate());
  await once(socket, "open");
  const acknowledgement = once(socket, "message");
  socket.send('{"type":"home","requestId":"input-1","record":false}');
  const [reply, binary] = await acknowledgement;
  assert.equal(binary, false);
  const parsedReply = JSON.parse(reply.toString());
  assert.equal(parsedReply.ok, true);
  assert.equal(parsedReply.requestId, "input-1");
  assert.ok(scrcpy.packets.length > 0);
  const video = once(socket, "message");
  const data = Buffer.from([0, 0, 0, 1, 0x65, 0x80]);
  scrcpy.frame({ type: "frame", data, pts: 1000n, isKey: true, isConfig: false });
  const [frame, videoBinary] = await video;
  assert.equal(videoBinary, true);
  const payload = frame.subarray(-data.length);
  assert.deepEqual(payload, data);

  const socketClosed = once(socket, "close");
  await backend.stop();
  await socketClosed;
  assert.equal(scrcpy.closed, true);
  const connection = fetch(`${base}/health`);
  await assert.rejects(connection);
});

test("Node server keeps authorization and origin guards on HTTP and WebSocket upgrades", async t => {
  const scrcpy = fakeScrcpy();
  const backend = await runtime.startServer({ serial: "emulator-5554", port: 0, token: "test-token" }, {
    openScrcpy: async () => scrcpy.session,
    createInputQueue: () => scrcpy.inputQueue,
  });
  t.after(() => backend.stop());
  const base = `http://127.0.0.1:${backend.server.port}`;
  const unauthorized = await fetch(`${base}/health`);
  assert.equal(unauthorized.status, 401);
  await unauthorized.text();
  const bootstrap = await fetch(`${base}/?token=test-token`, { redirect: "manual", headers: { accept: "text/html" } });
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get("location"), "/");
  assert.match(bootstrap.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/);
  await bootstrap.text();
  const forbidden = await fetch(`${base}/api/key`, {
    method: "POST", headers: { authorization: "Bearer test-token", origin: "http://other.invalid" },
    body: '{"key":"home"}',
  });
  assert.equal(forbidden.status, 403);
  await forbidden.text();
  const socket = new WebSocket(`ws://127.0.0.1:${backend.server.port}/ws`, {
    headers: { authorization: "Bearer test-token", origin: "http://other.invalid" },
  });
  socket.on("error", () => {});
  t.after(() => socket.terminate());
  const rejected = once(socket, "unexpected-response");
  const [, response] = await rejected;
  assert.equal(response.statusCode, 403);
  response.resume();
});

test("Node HTTP transport streams responses, cancels on disconnect, and bounds requests", async t => {
  let cancelled: (() => void) | undefined;
  const cancelledPromise = new Promise<void>(resolve => { cancelled = resolve; });
  const backend = await runtime.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16,
    websocket: { maxPayloadLength: 16, open() {}, message() {}, close() {} },
    async fetch(request) {
      if (request.method === "POST") {
        const body = await request.text();
        return new Response(body);
      }
      const body = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const chunk = encoder.encode("first\n");
          controller.enqueue(chunk);
        },
        cancel() { cancelled?.(); },
      });
      return new Response(body);
    },
  });
  t.after(() => backend.stop());
  const base = `http://127.0.0.1:${backend.port}`;
  const response = await fetch(base);
  const reader = response.body!.getReader();
  const first = await reader.read();
  const decoder = new TextDecoder();
  assert.equal(decoder.decode(first.value), "first\n");
  await reader.cancel();
  await cancelledPromise;
  const tooLarge = await fetch(base, { method: "POST", body: "x".repeat(17) });
  assert.equal(tooLarge.status, 413);
  await tooLarge.text();
  const allowed = await fetch(base, { method: "POST", body: "hello" });
  assert.equal(await allowed.text(), "hello");
  const chunkedBody = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const chunk = encoder.encode("x".repeat(17));
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const chunkedOptions: RequestInit & { duplex: "half" } = { method: "POST", body: chunkedBody, duplex: "half" };
  const chunked = await fetch(base, chunkedOptions);
  assert.equal(chunked.status, 413);
  await chunked.text();
});

test("Node startup failure cleans up the scrcpy session", async t => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(() => listener.close());
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const scrcpy = fakeScrcpy();
  const startup = runtime.startServer({ serial: "emulator-5554", port: address.port }, {
    openScrcpy: async () => scrcpy.session, createInputQueue: () => scrcpy.inputQueue,
  });
  await assert.rejects(startup, { code: "EADDRINUSE" });
  assert.equal(scrcpy.closed, true);
});

test("built Android CLI runs with Node.js and no Bun on PATH", async () => {
  const output = await buildServeEmu(join(directory, "cli-runtime"));
  const result = await execute(process.execPath, [output, "--help"], {
    env: { ...process.env, PATH: "/usr/bin:/bin", BUN_PATH: "/missing/bun" },
  });
  assert.match(result.stdout, /host an Android device/);
});
