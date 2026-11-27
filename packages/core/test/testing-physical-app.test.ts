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
import type { DeviceOps } from "../src/testing-prepare.ts";

test("the physical app check answers for an Android phone through adb, not the iPhone path", async () => {
  const root = await mkdtemp(join(tmpdir(), "physical-app-"));
  const asked: string[] = [];
  const ops = {
    physicalAndroid: { ready: async () => undefined, hasApp: async (serial: string, appId: string) => { asked.push(`${serial}:${appId}`); return appId === "com.example.app"; }, launch: async () => undefined },
  } as unknown as DeviceOps;
  const server = new McpServer({ name: "t", version: "1" });
  registerTestingTools(server, new TestingProjectChoices(join(root, "state")), new TestingDevices(), undefined, { ops });
  const client = new Client({ name: "c", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const check = async (bundleId: string) => {
    const result = await client.callTool({ name: "mobile_testing_physical_app", arguments: { platform: "android", deviceId: "R5CT1234ABC", bundleId } });
    assert.equal(result.isError ?? false, false, JSON.stringify(result.content));
    return (result.structuredContent as { installed: boolean }).installed;
  };
  assert.equal(await check("com.example.app"), true);
  assert.equal(await check("com.example.missing"), false);
  assert.deepEqual(asked, ["R5CT1234ABC:com.example.app", "R5CT1234ABC:com.example.missing"]);
});
