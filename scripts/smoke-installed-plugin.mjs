import { verifyPackagedFlowScan } from "./smoke-app-flow-scan.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Use Codex's resolved configuration, including its real installed working folder.
// Do not substitute package variables or replace the user's configured shell.
const configuration = JSON.parse(execFileSync("codex", ["mcp", "get", "mobile-dev", "--json"], { encoding: "utf8" }));
assert.equal(configuration.enabled, true);
const resolved = configuration.transport;
assert.equal(resolved.type, "stdio");
await access(resolved.cwd);
const env = { ...resolved.env };
for (const name of resolved.env_vars ?? []) if (process.env[name] !== undefined) env[name] = process.env[name];
const transport = new StdioClientTransport({ command: resolved.command, args: resolved.args, cwd: resolved.cwd, env, stderr: "pipe" });
transport.stderr?.on("data", chunk => process.stderr.write(chunk));
const client = new Client({ name: "mobile-dev-installed-smoke", version: "1" });
try {
  await client.connect(transport);
  await verifyPackagedFlowScan(client, process.argv[2]);
  const { tools } = await client.listTools();
  const setup = await client.callTool({ name: "mobile_app_flow", arguments: { action: "discover" } });
  assert.ok(!setup.isError && Array.isArray(setup.structuredContent?.servers));
  assert.ok(Array.isArray(setup.structuredContent.targets));
  console.log("App Flow automatic setup discovery responded.");
  for (const name of ["mobile_open_simulator", "mobile_open_workspace"]) {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool, `Missing installed entrypoint: ${name}`);
    const resource = await client.readResource({ uri: tool._meta.ui.resourceUri });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(resource.contents[0].text, /id="root"/);
    const result = await client.callTool({ name, arguments: {} }, undefined, { timeout: 30000 });
    assert.ok(!result.isError && result.structuredContent?.connected, `Installed entrypoint failed: ${name}`);
    console.log(`${name}: installed server, UI resource, and device backend responded.`);
  }
} finally {
  await transport.close();
}
