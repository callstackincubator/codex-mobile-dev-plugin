import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentDeviceCatalog } from "../packages/core/src/agent-device-catalog.ts";

// Writes the agent-device commands Mobile Dev serves, from the pinned runtime, to the
// catalog its server registers them from, and the runtime's own workflow guide to the
// agent-device skill. Run it after `npm run vendor:agent-device` installs a new pin;
// unit tests check both against the runtime.
//   npm run catalog:agent-device
const runtime = resolve("packages/runtimes/agent-device");
const stateDir = await mkdtemp(join(tmpdir(), "mobile-dev-agent-device-catalog-"));
const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? stateDir, AGENT_DEVICE_CONFIG: join(runtime, "config.json"), AGENT_DEVICE_STATE_DIR: stateDir, AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1" };
const cli = join(runtime, "node_modules/agent-device/bin/agent-device.mjs");
const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], cwd: stateDir, env, stderr: "inherit" });
const client = new Client({ name: "mobile-dev-catalog", version: "1" });
try {
  await client.connect(transport);
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools({ cursor });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  await writeFile(join(runtime, "tools.json"), JSON.stringify(agentDeviceCatalog(tools), null, 1) + "\n");
  console.log(`Wrote ${join(runtime, "tools.json")}.`);
  const guide = resolve("packages/skills/agent-device/references/workflow.md");
  await writeFile(guide, execFileSync(process.execPath, [cli, "help", "workflow"], { cwd: stateDir, env, encoding: "utf8" }));
  console.log(`Wrote ${guide}.`);
} finally {
  await client.close();
  await rm(stateDir, { recursive: true, force: true });
}
