import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTestingTools } from "../src/testing-tools.ts";
import { TestingProjectChoices } from "../src/testing-projects.ts";
import { TestingDevices } from "../src/testing-device.ts";

async function connect(root: string, apps: Record<number, string>) {
  const server = new McpServer({ name: "t", version: "1" });
  const looked: number[] = [];
  registerTestingTools(server, new TestingProjectChoices(join(root, "state")), new TestingDevices(), undefined, {
    foregroundBundle: async (_deviceId, pid) => { looked.push(pid); return apps[pid]; },
  });
  const client = new Client({ name: "c", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, looked };
}

const targets = async (client: Client, args: Record<string, unknown>) =>
  ((await client.callTool({ name: "mobile_testing_project_config", arguments: args })).structuredContent as { targets: { bundleId: string }[] }).targets.map(target => target.bundleId);

test("an Apple app in front, known only by its pid, becomes the No project target", async () => {
  const root = await mkdtemp(join(tmpdir(), "foreground-target-"));
  const { client, looked } = await connect(root, { 9: "com.apple.Fitness", 1: "com.apple.springboard" });
  assert.deepEqual(await targets(client, { projectPath: root, foregroundPlatform: "ios", foregroundDeviceId: "SIM-1", foregroundPid: 9 }), ["com.apple.Fitness"]);
  assert.deepEqual(await targets(client, { projectPath: root, foregroundPlatform: "ios", foregroundDeviceId: "SIM-1", foregroundPid: 1 }), [], "the home screen is never a target");
  assert.deepEqual(await targets(client, { projectPath: root, foregroundPlatform: "ios", foregroundBundleId: "com.example.app" }), ["com.example.app"]);
  assert.deepEqual(looked, [9, 1], "a named bundle id needs no lookup");
});
