import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { PassThrough } from "node:stream";
import { LinkPacer, ThrottleProxy, isLocalDestination, relay } from "../packages/core/src/network-throttle/proxy.ts";
import { AndroidNetworkThrottle, parseThrottleState } from "../packages/core/src/network-throttle/android.ts";
import type { Commands } from "../packages/core/src/app-control/commands.ts";
import { expectedOutcome } from "../packages/shared/src/error-reporting.ts";

const marker = "mobile_dev_network_throttle";

// A device whose global settings answer the shell commands the throttle sends.
function device() {
  const settings = new Map<string, string>();
  const calls: string[][] = [];
  const commands = {
    adb: async () => "adb",
    async run(_file: string, args: string[]) {
      calls.push(args.slice(2));
      if (args[2] !== "shell") return "";
      const output: string[] = [];
      for (const command of args[3].split(/\s*(?:&&|;)\s*/)) {
        const [, action, name, value] = /^settings (get|put|delete) global (\S+)(?: (.+))?$/.exec(command)!;
        if (action === "get") output.push(settings.get(name) ?? "null");
        else if (action === "put") settings.set(name, value);
        else settings.delete(name);
      }
      return output.join("\n");
    },
  } as unknown as Commands;
  return { settings, calls, commands };
}

test("a link pacer queues bytes behind each other and adds half the round trip", () => {
  let now = 0;
  const pacer = new LinkPacer({ latencyMs: 50, bandwidthKbps: 1000 }, () => now);
  assert.equal(pacer.arrival(1250), 35);
  assert.equal(pacer.arrival(1250), 45, "a second chunk waits for the first");
  now = 100;
  assert.equal(pacer.arrival(1250), 135, "an idle link starts fresh");
});

test("a paced relay holds a transfer to the link's bandwidth and keeps the bytes in order", async () => {
  const source = new PassThrough();
  const destination = new PassThrough();
  const received: Buffer[] = [];
  destination.on("data", (data: Buffer) => received.push(data));
  const ended = new Promise(resolve => destination.once("end", resolve));
  const payload = Buffer.from(Array.from({ length: 40 * 1024 }, (_, index) => index % 251));
  const started = performance.now();
  relay(source, destination, new LinkPacer({ latencyMs: 20, bandwidthKbps: 1600 }));
  source.end(payload);
  await ended;
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 200, `40 KB at 1.6 Mbps takes about 215 ms, took ${elapsed.toFixed(0)} ms`);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)} ms`);
  assert.deepEqual(Buffer.concat(received), payload);
});

test("development servers on the Mac or local network are never throttled", () => {
  for (const host of ["localhost", "10.0.2.2", "127.0.0.1", "192.168.1.20", "172.20.0.4", "[::1]", "my-mac.local", "169.254.3.1"]) assert.ok(isLocalDestination(host), host);
  for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "[2606:4700::1111]"]) assert.ok(!isLocalDestination(host), host);
});

test("throttle state separates the device proxy from the plugin's marker", () => {
  const token = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
  assert.deepEqual(parseThrottleState(`10.0.2.2:5000\n${token}:5000:edge\n`), { proxy: "10.0.2.2:5000", owner: { token, port: 5000, preset: "edge" } });
  assert.deepEqual(parseThrottleState("null\nnull\n"), { proxy: null, owner: null });
  assert.deepEqual(parseThrottleState(":0\n\n"), { proxy: null, owner: null }, "a cleared proxy reads as none");
  assert.deepEqual(parseThrottleState("proxy.corp:3128\ngarbage\n"), { proxy: "proxy.corp:3128", owner: null });
});

test("an emulator points at the Mac's proxy and goes back to normal without leftovers", async () => {
  const { settings, calls, commands } = device();
  const throttle = new AndroidNetworkThrottle(commands, async port => (await fetch(`http://127.0.0.1:${port}/mobile-dev-network-throttle`)).text());
  try {
    await throttle.set("emulator-5554", "edge");
    const [, port] = /^10\.0\.2\.2:(\d+)$/.exec(settings.get("http_proxy")!)!;
    assert.match(settings.get(marker)!, new RegExp(`^[0-9a-f-]{36}:${port}:edge$`));
    assert.ok(!calls.some(args => args[0] === "reverse"), "an emulator reaches the Mac without adb reverse");
    assert.deepEqual(await throttle.read("emulator-5554"), { preset: "edge" });
    await throttle.set("emulator-5554", "3g");
    assert.equal(settings.get("http_proxy"), `10.0.2.2:${port}`, "changing presets reuses the proxy");
    await throttle.set("emulator-5554", null);
    assert.deepEqual([...settings], []);
    assert.deepEqual(await throttle.read("emulator-5554"), { preset: null });
  } finally { await throttle.close(); }
});

test("a phone reaches the proxy through adb reverse, and shutdown clears it", async () => {
  const { settings, calls, commands } = device();
  const throttle = new AndroidNetworkThrottle(commands, async () => null);
  await throttle.set("R5CT1234", "lte");
  const [, port] = /^127\.0\.0\.1:(\d+)$/.exec(settings.get("http_proxy")!)!;
  assert.deepEqual(calls.find(args => args[0] === "reverse"), ["reverse", `tcp:${port}`, `tcp:${port}`]);
  await throttle.close();
  assert.deepEqual([...settings], []);
  assert.deepEqual(calls.at(-1), ["reverse", "--remove", `tcp:${port}`]);
});

test("the user's own proxy is reported and never replaced", async () => {
  const { settings, commands } = device();
  const throttle = new AndroidNetworkThrottle(commands, async () => null);
  settings.set("http_proxy", "192.168.1.20:8888");
  assert.deepEqual(await throttle.read("emulator-5554"), { foreignProxy: "192.168.1.20:8888" });
  await assert.rejects(throttle.set("emulator-5554", "3g"), (error: unknown) => expectedOutcome(error) === "invalid_input" && /already uses the proxy 192\.168\.1\.20:8888/.test((error as Error).message));
  assert.deepEqual(await throttle.set("emulator-5554", null), { foreignProxy: "192.168.1.20:8888" });
  assert.equal(settings.get("http_proxy"), "192.168.1.20:8888", "going back to normal leaves it alone");

  settings.set(marker, "6f9619ff-8b86-4011-b42d-00c04fc964ff:5000:edge");
  assert.deepEqual(await throttle.read("emulator-5554"), { foreignProxy: "192.168.1.20:8888" }, "a marker for a replaced proxy is dropped");
  assert.equal(settings.get(marker), undefined);
  assert.equal(settings.get("http_proxy"), "192.168.1.20:8888");
});

test("a throttle left by a plugin process that exited is cleared so the device stays online", async () => {
  const { settings, commands } = device();
  const throttle = new AndroidNetworkThrottle(commands, async () => null);
  settings.set("http_proxy", "10.0.2.2:5000");
  settings.set(marker, "6f9619ff-8b86-4011-b42d-00c04fc964ff:5000:edge");
  assert.deepEqual(await throttle.read("emulator-5554"), { preset: null });
  assert.deepEqual([...settings], []);
});

test("concurrent changes to one device share a single proxy", async () => {
  const { settings, commands } = device();
  const throttle = new AndroidNetworkThrottle(commands, async () => null);
  try {
    await Promise.all([throttle.set("emulator-5554", "edge"), throttle.set("emulator-5554", "3g")]);
    assert.match(settings.get(marker)!, /:3g$/, "the later change wins");
    assert.equal((throttle as unknown as { proxies: Map<string, unknown> }).proxies.size, 1);
  } finally { await throttle.close(); }
  assert.deepEqual([...settings], []);
});

test("a device left on a dead proxy is recovered once when the plugin first reaches it", async () => {
  const { settings, calls, commands } = device();
  const throttle = new AndroidNetworkThrottle(commands, async () => null);
  settings.set("http_proxy", "10.0.2.2:5000");
  settings.set(marker, "6f9619ff-8b86-4011-b42d-00c04fc964ff:5000:edge");
  await throttle.recover("emulator-5554");
  assert.deepEqual([...settings], []);
  const count = calls.length;
  await throttle.recover("emulator-5554");
  assert.equal(calls.length, count, "later starts skip the check");
});

function listen(server: Server) {
  return new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

test("the proxy forwards plain requests and tunnels to local servers", async () => {
  const origin = createServer((incoming, response) => response.end(`hello ${encodeURIComponent(incoming.url ?? "")}`));
  const port = await listen(origin);
  const proxy = new ThrottleProxy({ latencyMs: 800, bandwidthKbps: 240 });
  const proxyPort = await proxy.listen();
  try {
    const plain = await new Promise<string>((resolve, reject) => {
      request({ host: "127.0.0.1", port: proxyPort, path: `http://10.0.2.2:${port}/status?x=1` }, response => {
        let body = "";
        response.on("data", data => { body += data; }).on("end", () => resolve(body));
      }).on("error", reject).end();
    });
    assert.equal(plain, "hello %2Fstatus%3Fx%3D1");

    const started = performance.now();
    const tunneled = await new Promise<string>((resolve, reject) => {
      const socket = connect(proxyPort, "127.0.0.1", () => socket.write(`CONNECT localhost:${port} HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`));
      let reply = "";
      socket.on("data", data => {
        reply += data;
        if (reply === "HTTP/1.1 200 Connection Established\r\n\r\n") socket.write("GET /tunnel HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      }).on("end", () => resolve(reply)).on("error", reject);
    });
    assert.match(tunneled, /hello %2Ftunnel$/);
    assert.ok(performance.now() - started < 400, "local destinations skip the 800 ms latency");
  } finally {
    await proxy.close();
    await new Promise(resolve => origin.close(resolve));
  }
});

test("a throttled tunnel delivers everything a server sends before it closes, in order", async () => {
  const payload = Buffer.from(Array.from({ length: 64 * 1024 }, (_, index) => index % 253));
  const origin = createNetServer(socket => { socket.end(payload); });
  await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", resolve));
  const port = (origin.address() as { port: number }).port;
  // Treat the local server as remote so the tunnel is paced.
  const proxy = new ThrottleProxy({ latencyMs: 200, bandwidthKbps: 2000 }, () => false);
  const proxyPort = await proxy.listen();
  try {
    const received = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = connect(proxyPort, "127.0.0.1", () => socket.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
      socket.on("data", (data: Buffer) => chunks.push(data)).on("close", () => resolve(Buffer.concat(chunks))).on("error", reject);
    });
    const header = Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n");
    assert.deepEqual(received.subarray(0, header.length), header);
    assert.deepEqual(received.subarray(header.length), payload, "paced bytes are not dropped when the server closes first");
  } finally {
    await proxy.close();
    await new Promise(resolve => origin.close(resolve));
  }
});

function fetchThrough(proxyPort: number, url: string) {
  return new Promise<{ status: number; body: string; aborted: boolean }>(resolve => {
    request({ host: "127.0.0.1", port: proxyPort, path: url }, response => {
      let body = "";
      response.on("data", data => { body += data; }).on("end", () => resolve({ status: response.statusCode ?? 0, body, aborted: false }))
        .on("aborted", () => resolve({ status: response.statusCode ?? 0, body, aborted: true })).on("error", () => resolve({ status: response.statusCode ?? 0, body, aborted: true }));
    }).on("error", () => resolve({ status: 0, body: "", aborted: true })).end();
  });
}

test("a throttled plain request takes one round trip, and a server that breaks off midway only ends that request", async () => {
  const origin = createServer((incoming, response) => {
    if (incoming.url === "/broken") { response.writeHead(200, { "Content-Length": "100" }); response.write("partial"); setTimeout(() => response.socket?.destroy(), 20); return; }
    response.end("hello");
  });
  const port = await listen(origin);
  // Treat the local server as remote so requests are paced.
  const proxy = new ThrottleProxy({ latencyMs: 400, bandwidthKbps: 1_000_000 }, () => false);
  const proxyPort = await proxy.listen();
  try {
    const started = performance.now();
    assert.deepEqual(await fetchThrough(proxyPort, `http://127.0.0.1:${port}/`), { status: 200, body: "hello", aborted: false });
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 380 && elapsed < 560, `one 400 ms round trip, took ${elapsed.toFixed(0)} ms`);
    const broken = await fetchThrough(proxyPort, `http://127.0.0.1:${port}/broken`);
    assert.equal(broken.aborted, true, "the app sees the connection end instead of the proxy crashing");
    assert.deepEqual(await fetchThrough(proxyPort, `http://127.0.0.1:${port}/`), { status: 200, body: "hello", aborted: false }, "the proxy keeps serving");
  } finally {
    await proxy.close();
    await new Promise(resolve => origin.close(resolve));
  }
});
