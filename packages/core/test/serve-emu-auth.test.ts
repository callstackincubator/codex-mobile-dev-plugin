import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Stands in for the bundled serve-emu CLI: it requires the --token it was given on every request and
// on the WebSocket upgrade, and logs each request with whether it carried the token.
const fakeCli = `
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const log = new URL("../../requests.log", import.meta.url);
writeFileSync(new URL("../../args.json", import.meta.url), JSON.stringify(args));
const authorized = request => request.headers.authorization === "Bearer " + option("--token");
const server = createServer((request, response) => {
  appendFileSync(log, JSON.stringify({ path: request.url, authorized: authorized(request) }) + "\\n");
  if (authorized(request) === false) { response.writeHead(401).end('{"ok":false,"error":"unauthorized"}'); return; }
  if (request.url === "/health") response.end(JSON.stringify({ serial: option("--serial"), codec: "h264", size: { width: 1080, height: 2400 } }));
  else if (request.url === "/api/screenshot") response.end(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  else response.end('{"ok":true,"value":1}');
});
server.on("upgrade", (request, socket) => {
  appendFileSync(log, JSON.stringify({ path: request.url, authorized: authorized(request) }) + "\\n");
  if (authorized(request) === false) { socket.end("HTTP/1.1 401 Unauthorized\\r\\n\\r\\n"); return; }
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
  socket.on("data", () => {});
});
server.listen(Number(option("--port")), option("--host"));
process.on("SIGTERM", () => process.exit(0));
`;

test("a serve-emu this server starts requires a fresh token that every request and the stream carry", async t => {
  const directory = await mkdtemp(join(tmpdir(), "serve-emu-auth-"));
  const previousHome = process.env.ANDROID_HOME;
  const previousTelemetry = process.env.MOBILE_DEV_TELEMETRY;
  process.env.ANDROID_HOME = directory;
  process.env.MOBILE_DEV_TELEMETRY = "off";
  t.after(async () => {
    if (previousHome === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = previousHome;
    if (previousTelemetry === undefined) delete process.env.MOBILE_DEV_TELEMETRY;
    else process.env.MOBILE_DEV_TELEMETRY = previousTelemetry;
    await rm(directory, { recursive: true, force: true });
  });
  const output = join(directory, "server.mjs");
  await build({
    stdin: { contents: 'export { ServeEmu } from "./packages/core/src/serve-emu.ts"; export { AndroidStreams } from "./packages/core/src/android-streams.ts";', resolveDir: resolve("."), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", target: "node22.18",
    banner: { js: 'import { createRequire as testCreateRequire } from "node:module"; const require = testCreateRequire(import.meta.url);' },
  });
  await mkdir(join(directory, "serve-emu/src"), { recursive: true });
  await writeFile(join(directory, "serve-emu/src/cli.mjs"), fakeCli);
  await writeFile(join(directory, "telemetry-environment.json"), '{"environment":"development"}');
  await mkdir(join(directory, "platform-tools"));
  await writeFile(join(directory, "platform-tools/adb"), `#!${process.execPath}\nif (process.argv[2] === "devices") console.log("List of devices attached\\nauth-test-device device model:Phone");\n`, { mode: 0o755 });

  const runtime = await import(pathToFileURL(output).href);
  const backend = new runtime.ServeEmu();
  const streams = new runtime.AndroidStreams(backend);
  t.after(async () => { streams.close(); backend.dispose(); });
  const started = await backend.start("auth-test-device");
  const args: string[] = JSON.parse(await readFile(join(directory, "args.json"), "utf8"));
  const token = args[args.indexOf("--token") + 1];
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(started.token, token);

  assert.deepEqual(await backend.json(started, "/api/x"), { ok: true, value: 1 });
  assert.equal((await backend.fetchBytes(started, "/api/screenshot", { maxBytes: 64 })).length, 8);
  assert.equal((await backend.definition("auth-test-device")).screen.rect.width, 1080);
  const sessionId = await streams.open("auth-test-device");
  streams.closeSession(sessionId);

  const requests = (await readFile(join(directory, "requests.log"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(new Set(requests.map(request => request.path)), new Set(["/health", "/api/x", "/api/screenshot", "/ws?frame-meta=1"]));
  for (const request of requests) assert.equal(request.authorized, true, request.path);
  // An unauthenticated client is refused.
  assert.equal((await fetch(new URL("/health", started.url))).status, 401);

  // Each backend gets its own token.
  backend.dispose();
  const restarted = new runtime.ServeEmu();
  t.after(() => restarted.dispose());
  assert.notEqual((await restarted.start("auth-test-device")).token, token);
});
