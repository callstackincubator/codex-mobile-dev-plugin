import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compactAgentDeviceTool } from "../src/server/agent-device-catalog.ts";
import { adapterClient, upstreamCatalog } from "./agent-device-fixtures.ts";

const tools = upstreamCatalog.tools.map(compactAgentDeviceTool);
function tool(name: string) {
  const found = tools.find(candidate => candidate.name === name);
  assert.ok(found, `Expected ${name} in the catalog`);
  return found;
}

test("compact catalog keeps all official operations, output contracts and typed targets", () => {
  assert.equal(tools.length, 55);
  for (const [index, current] of tools.entries()) {
    const original = upstreamCatalog.tools[index];
    assert.equal(current.name, original.name);
    assert.equal(current.description, original.description);
    assert.deepEqual(current.outputSchema, original.outputSchema);
    assert.deepEqual(current.annotations, original.annotations);
    assert.deepEqual(current._meta, original._meta);
    for (const name of ["stateDir", "mcpOutputFormat", "includeCost", "responseLevel", "daemonBaseUrl", "daemonAuthToken", "tenant", "runId", "leaseId", "iosXctestrunFile", "iosSimulatorDeviceSet", "debug", "deviceTarget"]) {
      assert.equal(current.inputSchema.properties?.[name], undefined, `${current.name} exposes ${name}`);
    }
    assert.ok(original.inputSchema.properties?.stateDir, "The source catalog must remain intact");
  }
  const press = tool("press");
  const upstreamPress = upstreamCatalog.tools.find(candidate => candidate.name === "press");
  assert.ok(upstreamPress);
  const target = press.inputSchema.properties?.target;
  assert.ok(target && "oneOf" in target);
  const originalTarget = upstreamPress.inputSchema.properties?.target;
  assert.ok(originalTarget && "oneOf" in originalTarget);
  assert.deepEqual(target.oneOf, originalTarget.oneOf);
  assert.deepEqual(press.inputSchema.properties?.timeoutMs, upstreamPress.inputSchema.properties?.timeoutMs);
});

test("device selection belongs to setup and discovery while interactions require only a session", async () => {
  for (const name of ["open", "apps", "devices", "boot", "install", "replay", "test"]) {
    const current = tool(name);
    assert.ok(current.inputSchema.properties?.platform);
    assert.ok(current.inputSchema.properties?.udid);
    assert.equal(current.inputSchema.properties?.target, undefined);
  }
  for (const name of ["snapshot", "press", "fill", "scroll", "close", "batch"]) {
    const schema = tool(name).inputSchema;
    const requiresSession = schema.required?.includes("session");
    assert.ok(requiresSession);
    for (const option of ["platform", "device", "udid", "serial"]) {
      assert.equal(schema.properties?.[option], undefined);
    }
  }
  const configUrl = new URL("../runtimes/agent-device/config.json", import.meta.url);
  const text = await readFile(configUrl, "utf8");
  const config = JSON.parse(text);
  assert.deepEqual(config, {}, "Global platform and form selectors must not override a named session");
});

test("packaged defaults do not bypass native session device binding", async () => {
  const configUrl = new URL("../runtimes/agent-device/config.json", import.meta.url);
  const cliConfigUrl = new URL("../runtimes/agent-device/node_modules/agent-device/dist/src/cli-config.js", import.meta.url);
  // These exports belong to the pinned 0.20.9 runtime; keep this check with its version update.
  const configuration = await import(cliConfigUrl.href);
  assert.equal(typeof configuration.t, "function");
  for (const command of ["snapshot", "press", "close"]) {
    const defaults = configuration.t({ command, cwd: "/", cliFlags: { session: "android-task" }, env: { AGENT_DEVICE_CONFIG: configUrl.pathname } });
    assert.deepEqual(defaults, {}, `${command} defaults must reuse the existing native session`);
  }
});

test("forwarding preserves named sessions, metadata and native results without repeating selectors", async t => {
  const { client, calls, result } = await adapterClient(t);
  const metadata = { "sentry-trace": "1234567890abcdef1234567890abcdef-1234567890abcdef-0" };
  await client.callTool({ name: "open", arguments: { session: "ios-task", app: "Example", platform: "ios", udid: "selected-ios" } });
  await client.callTool({ name: "open", arguments: { session: "android-task", app: "Example", platform: "android", serial: "selected-android" } });
  const target = { kind: "ref", ref: "@e1" };
  const input = { session: "android-task", target, settle: true };
  const returned = await client.callTool({ name: "press", arguments: input, _meta: metadata });
  assert.deepEqual(returned, result);
  assert.deepEqual(calls[2], { name: "press", arguments: input, _meta: metadata });
  const iosInput = { session: "ios-task", interactiveOnly: true };
  await client.callTool({ name: "snapshot", arguments: iosInput });
  assert.deepEqual(calls[3].arguments, iosInput);
});

test("invalid and hidden options fail before reaching the runtime", async t => {
  const { client, calls } = await adapterClient(t);
  const invalid = [
    { name: "open", arguments: { platform: "ios", udid: "selected" } },
    { name: "open", arguments: { session: "task", app: "Example" } },
    { name: "snapshot", arguments: {} },
    { name: "snapshot", arguments: { session: "  " } },
    { name: "snapshot", arguments: { session: "task", udid: "other-device" } },
    { name: "snapshot", arguments: { session: "task", stateDir: "/other-state" } },
    { name: "snapshot", arguments: { session: "task", daemonBaseUrl: "http://other-daemon" } },
    { name: "snapshot", arguments: { session: "task", responseLevel: "full" } },
    { name: "press", arguments: { session: "task", target: { kind: "ref", x: 1, y: 2 } } },
    { name: "press", arguments: { session: "task", target: { kind: "point", x: 1, y: 2 }, timeoutMs: 0 } },
    { name: "session", arguments: { action: "save-script" } },
  ];
  for (const params of invalid) {
    const result = await client.callTool(params);
    assert.equal(result.isError, true, params.name);
  }
  assert.equal(calls.length, 0);
});

test("batch inputs obey each compact tool contract and inherit the outer session", async t => {
  const { client, calls } = await adapterClient(t);
  const steps = [{ command: "snapshot", input: { interactiveOnly: true } }];
  const result = await client.callTool({ name: "batch", arguments: { session: "task", steps } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls[0].arguments, { session: "task", steps });
  for (const input of [{ udid: "other-device" }, { stateDir: "/other-state" }, { unsupported: true }]) {
    const invalidSteps = [{ command: "snapshot", input }];
    const rejected = await client.callTool({ name: "batch", arguments: { session: "task", steps: invalidSteps } });
    assert.equal(rejected.isError, true);
  }
  assert.equal(calls.length, 1);
});

test("read-only discovery and state lookup remain available before opening an app", async t => {
  const { client, calls } = await adapterClient(t);
  await client.callTool({ name: "devices", arguments: { platform: "ios" } });
  await client.callTool({ name: "session", arguments: { action: "state-dir" } });
  await client.callTool({ name: "session", arguments: { action: "list" } });
  assert.equal(calls.length, 3);
});

test("MCP cancellation reaches the native runtime request", async t => {
  let entered: (() => void) | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let wasCancelled = false;
  const { client } = await adapterClient(t, async (_params, options) => {
    entered?.();
    await new Promise<void>(resolve => {
      options.signal?.addEventListener("abort", () => { wasCancelled = true; resolve(); }, { once: true });
    });
    options.signal?.throwIfAborted();
    return { content: [] };
  });
  const controller = new AbortController();
  const pending = client.callTool({ name: "wait", arguments: { session: "task", kind: "duration", durationMs: 10000 } }, undefined, { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending);
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(wasCancelled, true);
});
