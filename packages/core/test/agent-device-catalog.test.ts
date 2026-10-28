import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { agentDeviceCatalog, compactAgentDeviceTool } from "../src/agent-device-catalog.ts";
import { agentDeviceCatalogFile, agentDeviceGuideFile, runtimeUrl, upstreamCatalog } from "../../test-support/agent-device-fixtures.ts";

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
  const configUrl = new URL("../../runtimes/agent-device/config.json", import.meta.url);
  const text = await readFile(configUrl, "utf8");
  const config = JSON.parse(text);
  assert.deepEqual(config, {}, "Global platform and form selectors must not override a named session");
});

test("packaged defaults do not bypass native session device binding", async () => {
  const configUrl = new URL("../../runtimes/agent-device/config.json", import.meta.url);
  const cliConfigUrl = new URL("../../runtimes/agent-device/node_modules/agent-device/dist/src/cli-config.js", import.meta.url);
  // These exports belong to the pinned 0.20.9 runtime; keep this check with its version update.
  const configuration = await import(cliConfigUrl.href);
  assert.equal(typeof configuration.t, "function");
  for (const command of ["snapshot", "press", "close"]) {
    const defaults = configuration.t({ command, cwd: "/", cliFlags: { session: "android-task" }, env: { AGENT_DEVICE_CONFIG: configUrl.pathname } });
    assert.deepEqual(defaults, {}, `${command} defaults must reuse the existing native session`);
  }
});

test("the committed catalog is the pinned runtime's commands that Mobile Dev serves", async () => {
  // Regenerate it with npm run catalog:agent-device after changing the pin.
  const committed = JSON.parse(await readFile(agentDeviceCatalogFile, "utf8"));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(agentDeviceCatalog(upstreamCatalog.tools))));
  const names = committed.map((entry: { name: string }) => entry.name);
  for (const name of ["logs", "perf", "install-from-source", "artifacts", "viewport", "tv-remote", "audio"]) assert.equal(names.includes(name), false, name);
  assert.ok(committed.every((entry: { outputSchema?: unknown }) => entry.outputSchema === undefined), "The tools return agent-device's own results.");
});

test("the agent-device skill's workflow guide is the pinned runtime's own", async () => {
  // Regenerate it with npm run catalog:agent-device after changing the pin.
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1" };
  const help = execFileSync(process.execPath, [runtimeUrl.pathname, "help", "workflow"], { env, encoding: "utf8" });
  assert.equal(await readFile(agentDeviceGuideFile, "utf8"), help);
});
