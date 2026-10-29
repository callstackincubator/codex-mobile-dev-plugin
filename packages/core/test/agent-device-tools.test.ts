import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentDeviceClient } from "@mobile-dev/test-support/agent-device-fixtures.ts";
import { PNG } from "@mobile-dev/test-support/fixtures.ts";

function text(result: { content: unknown }) {
  return (result.content as { text: string }[])[0].text;
}

test("agent-device commands are device_ tools with their compact schemas, and listing them starts nothing", async t => {
  const { client, counts } = await agentDeviceClient(t);
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name);
  for (const name of ["device_open", "device_snapshot", "device_press", "device_fill", "device_batch", "device_devices"]) assert.ok(names.includes(name), name);
  for (const name of ["device_logs", "device_perf", "open", "logs"]) assert.equal(names.includes(name), false, name);
  const press = tools.find(tool => tool.name === "device_press");
  assert.deepEqual(press?.inputSchema.required?.toSorted(), ["session", "target"]);
  assert.equal(counts().connections, 0);
});

test("forwarding preserves named sessions, metadata and native results without repeating selectors", async t => {
  const { client, calls, result } = await agentDeviceClient(t);
  const metadata = { "sentry-trace": "1234567890abcdef1234567890abcdef-1234567890abcdef-0" };
  await client.callTool({ name: "device_open", arguments: { session: "ios-task", app: "Example", platform: "ios", udid: "selected-ios" } });
  await client.callTool({ name: "device_open", arguments: { session: "android-task", app: "Example", platform: "android", serial: "selected-android" } });
  const target = { kind: "ref", ref: "@e1" };
  const input = { session: "android-task", target, settle: true };
  const returned = await client.callTool({ name: "device_press", arguments: input, _meta: metadata });
  assert.deepEqual(returned, result);
  assert.deepEqual(calls[2], { name: "press", arguments: input, _meta: metadata });
  const iosInput = { session: "ios-task", interactiveOnly: true };
  await client.callTool({ name: "device_snapshot", arguments: iosInput });
  assert.deepEqual(calls[3].arguments, iosInput);
});

test("shutting a device down closes the plugin's sessions on it first", async t => {
  const { client, calls, closedDevices } = await agentDeviceClient(t);
  await client.callTool({ name: "device_shutdown", arguments: { platform: "ios", udid: "selected-ios" } });
  await client.callTool({ name: "device_shutdown", arguments: { platform: "android", serial: "emulator-5554" } });
  await client.callTool({ name: "device_shutdown", arguments: { session: "named" } });
  assert.deepEqual(closedDevices, ["selected-ios", "emulator-5554"]);
  assert.equal(calls.length, 3);
});

test("a screenshot returns the saved image beside agent-device's own result", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-agent-device-screenshot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "screenshot.png");
  await writeFile(path, PNG);
  const saved = { content: [{ type: "text" as const, text: path }], structuredContent: { path, width: 402, height: 874 } };
  const { client } = await agentDeviceClient(t, async () => saved);
  const shot = await client.callTool({ name: "device_screenshot", arguments: { session: "ios-task" } });
  assert.deepEqual(shot.content, [...saved.content, { type: "image", mimeType: "image/png", data: PNG.toString("base64") }]);
  assert.deepEqual(shot.structuredContent, saved.structuredContent);

  await writeFile(path, "not an image");
  assert.deepEqual((await client.callTool({ name: "device_screenshot", arguments: { session: "ios-task" } })).content, saved.content);
  await rm(path);
  assert.deepEqual((await client.callTool({ name: "device_screenshot", arguments: { session: "ios-task" } })).content, saved.content);
});

test("invalid and hidden options fail before reaching the runtime", async t => {
  const { client, calls, counts } = await agentDeviceClient(t);
  const invalid = [
    { name: "device_open", arguments: { platform: "ios", udid: "selected" } },
    { name: "device_open", arguments: { session: "task", app: "Example" } },
    { name: "device_snapshot", arguments: {} },
    { name: "device_snapshot", arguments: { session: "  " } },
    { name: "device_snapshot", arguments: { session: "task", udid: "other-device" } },
    { name: "device_snapshot", arguments: { session: "task", stateDir: "/other-state" } },
    { name: "device_snapshot", arguments: { session: "task", daemonBaseUrl: "http://other-daemon" } },
    { name: "device_snapshot", arguments: { session: "task", responseLevel: "full" } },
    { name: "device_press", arguments: { session: "task", target: { kind: "ref", x: 1, y: 2 } } },
    { name: "device_press", arguments: { session: "task", target: { kind: "point", x: 1, y: 2 }, timeoutMs: 0 } },
    { name: "device_session", arguments: { action: "save-script" } },
  ];
  for (const params of invalid) {
    const result = await client.callTool(params);
    assert.equal(result.isError, true, `${params.name} ${JSON.stringify(params.arguments)}`);
  }
  assert.equal(calls.length, 0);
  assert.equal(counts().connections, 0);
});

test("batch steps obey each command's schema and inherit the outer session", async t => {
  const { client, calls } = await agentDeviceClient(t);
  const steps = [{ command: "snapshot", input: { interactiveOnly: true } }];
  const result = await client.callTool({ name: "device_batch", arguments: { session: "task", steps } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls[0].arguments, { session: "task", steps });
  for (const input of [{ udid: "other-device" }, { stateDir: "/other-state" }, { unsupported: true }]) {
    const rejected = await client.callTool({ name: "device_batch", arguments: { session: "task", steps: [{ command: "snapshot", input }] } });
    assert.equal(rejected.isError, true);
  }
  const press = await client.callTool({ name: "device_batch", arguments: { session: "task", steps: [{ command: "press", input: {} }] } });
  assert.match(text(press), /Batch step 1: Invalid press arguments/);
  const omitted = await client.callTool({ name: "device_batch", arguments: { session: "task", steps: [{ command: "logs", input: {} }] } });
  assert.match(text(omitted), /Unknown Agent Device command: logs/);
  assert.equal(calls.length, 1);
});

test("read-only discovery and state lookup work before opening an app", async t => {
  const { client, calls } = await agentDeviceClient(t);
  await client.callTool({ name: "device_devices", arguments: { platform: "ios" } });
  await client.callTool({ name: "device_session", arguments: { action: "state-dir" } });
  await client.callTool({ name: "device_session", arguments: { action: "list" } });
  assert.equal(calls.length, 3);
});

test("MCP cancellation reaches the runtime's request", async t => {
  let entered: (() => void) | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let wasCancelled = false;
  const { client } = await agentDeviceClient(t, async (_params, options) => {
    entered?.();
    await new Promise<void>(resolve => {
      options.signal?.addEventListener("abort", () => { wasCancelled = true; resolve(); }, { once: true });
    });
    options.signal?.throwIfAborted();
    return { content: [] };
  });
  const controller = new AbortController();
  const pending = client.callTool({ name: "device_wait", arguments: { session: "task", kind: "duration", durationMs: 10000 } }, undefined, { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending);
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(wasCancelled, true);
});

test("a runtime that cannot start returns an error result, and closing the server closes the runtime", async t => {
  const { client, cleanup, counts } = await agentDeviceClient(t, undefined, async () => { throw new Error("spawn node ENOENT"); });
  const result = await client.callTool({ name: "device_devices", arguments: { platform: "ios" } });
  assert.equal(result.isError, true);
  assert.match(text(result), /Agent Device could not start/);
  await cleanup?.();
  assert.equal(counts().closed, 1);
});
