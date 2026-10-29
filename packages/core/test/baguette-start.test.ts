import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { Baguette } from "../src/baguette.ts";
import { isRepeatedFailure } from "../../shared/src/error-reporting.ts";
import { deviceCommandTags } from "../../shared/src/device-command-diagnostics.ts";
import { UDID } from "../../test-support/fixtures.ts";

const DEVICES = JSON.stringify({ running: [], available: [{ udid: UDID, name: "iPhone 17", state: "Shutdown", runtime: "iOS 26.0" }] });
// What Baguette prints before it exits when another process holds its port.
const PORT_TAKEN = 'process.stderr.write("Error: bind(descriptor:ptr:bytes:): Address already in use) (errno: 48)\\n"); process.exitCode = 1;';

async function listen(t: TestContext, port: number, handler: RequestListener): Promise<number> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return (server.address() as AddressInfo).port;
}

/** A process that stands in for Baguette's own; it runs until the test ends unless the script exits. */
function baguetteProcess(t: TestContext, script = "setInterval(() => {}, 60000)") {
  const spawned = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { spawned.kill(); });
  return spawned;
}

/** A started bundled Baguette whose device list answers with `backend.status` after `backend.latency` ms. */
async function startedBaguette(t: TestContext) {
  const backend = { status: 200, latency: 0, requests: 0, launches: [] as string[] };
  const baguette = new Baguette(undefined, undefined, async (_host, port) => {
    backend.launches.push(port);
    await listen(t, Number(port), (_request, response) => {
      backend.requests++;
      response.statusCode = backend.status;
      setTimeout(() => response.end(DEVICES), backend.latency);
    });
    return baguetteProcess(t);
  });
  t.after(() => baguette.dispose());
  assert.equal((await baguette.start()).managed, true);
  return { baguette, backend };
}

test("a running Baguette whose device list is slow or fails is never treated as a port conflict", async t => {
  const { baguette, backend } = await startedBaguette(t);
  // CoreSimulator can take seconds to list devices while one boots.
  backend.latency = 2500;
  assert.equal((await baguette.start()).connected, true);

  backend.latency = 0;
  backend.status = 500;
  const requests = backend.requests;
  const failed = await baguette.start().then(() => assert.fail("The start should fail."), (error: unknown) => error);
  assert.match(String(failed), /^Error: Cannot reach Baguette at .*HTTP 500/);
  // The failure keeps how the device list request failed.
  assert.deepEqual(deviceCommandTags(failed), { device_command: "baguette_simulators", device_command_failure: "http_status", device_command_status: "500" });
  // Only the device list was read: the backend's own port is never probed as a foreign listener.
  assert.equal(backend.requests - requests, 1);
  assert.deepEqual(backend.launches, [baguette.baseUrl.port]);
});

test("a continuing Baguette start failure is reported once until a start succeeds", async t => {
  const { baguette, backend } = await startedBaguette(t);
  const outcomes: string[] = [];
  for (const status of [500, 500, 500, 200, 500]) {
    backend.status = status;
    // The first failure's caller only logs it, so the next caller that captures one still reports.
    const capture = outcomes.length > 0;
    const outcome = await baguette.start().then(() => "started", error => capture ? (isRepeatedFailure(error) ? "repeated" : "reported") : "logged");
    outcomes.push(outcome);
  }
  assert.deepEqual(outcomes, ["logged", "reported", "repeated", "started", "reported"]);
});

test("the bundled Baguette retries on a new port when another process binds it first", async t => {
  let taken = 1;
  const launches: string[] = [];
  const launch = async (_host: string, port: string) => {
    launches.push(port);
    if (launches.length <= taken) {
      // The other process accepts connections on the port but never answers.
      await listen(t, Number(port), () => {});
      return baguetteProcess(t, PORT_TAKEN);
    }
    await listen(t, Number(port), (_request, response) => response.end(DEVICES));
    return baguetteProcess(t);
  };
  const baguette = new Baguette(undefined, undefined, launch);
  t.after(() => baguette.dispose());
  const started = performance.now();
  assert.equal((await baguette.start()).connected, true);
  // The exit is noticed without waiting for the silent listener's request timeout.
  assert.ok(performance.now() - started < 5000);
  assert.equal(launches.length, 2);
  assert.equal(baguette.baseUrl.port, launches[1]);

  taken = Infinity;
  launches.length = 0;
  const crowded = new Baguette(undefined, undefined, launch);
  t.after(() => crowded.dispose());
  const failed = await crowded.start().then(() => assert.fail("The start should fail."), (error: unknown) => error);
  assert.match(String(failed), /^Error: Baguette exited before it became ready\. .*Address already in use/);
  assert.deepEqual(deviceCommandTags(failed), { device_command: "baguette_serve", device_command_failure: "exit", device_command_status: "1" });
  assert.equal(launches.length, 3);
});

test("an external Baguette address reports a port that another listener holds without moving", async t => {
  const port = await listen(t, 0, (_request, response) => response.end("not baguette"));
  const baguette = new Baguette(`http://127.0.0.1:${port}`, undefined, async () => { throw new Error("An occupied port must not launch Baguette."); });
  t.after(() => baguette.dispose());
  await assert.rejects(baguette.start(), new RegExp(`^Error: Port ${port} is in use, but its listener did not return a Baguette device list\\.$`));
  assert.equal(baguette.baseUrl.port, String(port));
});
