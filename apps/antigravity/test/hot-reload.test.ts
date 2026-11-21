import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

test("hot-reload supervisor swaps worker when dist entry changes and notifies client", async t => {
  const dir = await mkdtemp(join(tmpdir(), "mobile-dev-hot-reload-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const supervisorUrl = pathToFileURL(resolve("apps/antigravity/server/supervisor.ts")).href;
  const mcpServerUrl = import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  const stdioTransportUrl = import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js");

  const entryPath = join(dir, "server.ts");
  const renderEntry = (toolName: string) => `
if (process.env.MOBILE_DEV_SERVER_WORKER === "1") {
  const { McpServer } = await import(${JSON.stringify(mcpServerUrl)});
  const { StdioServerTransport } = await import(${JSON.stringify(stdioTransportUrl)});
  const server = new McpServer({ name: "hot-reload-test", version: "1.0.0" });
  server.registerTool(${JSON.stringify(toolName)}, { inputSchema: {} }, async () => ({
    content: [{ type: "text", text: ${JSON.stringify(toolName)} }],
  }));
  await server.connect(new StdioServerTransport());
} else {
  const { runHotReloadSupervisor } = await import(${JSON.stringify(supervisorUrl)});
  await runHotReloadSupervisor(import.meta.url);
}
`;

  await writeFile(entryPath, renderEntry("version_v1"));

  const client = new Client({ name: "hot-reload-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPath],
    cwd: dir,
    stderr: "pipe",
  });

  let resolveListChanged!: () => void;
  const listChanged = new Promise<void>(resolvePromise => {
    resolveListChanged = resolvePromise;
  });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    resolveListChanged();
  });

  t.after(async () => {
    await client.close();
    await transport.close();
  });

  await client.connect(transport);

  const before = await client.listTools();
  assert.deepEqual(before.tools.map(tool => tool.name), ["version_v1"]);

  // Ensure mtime granularity ticks forward cleanly, then overwrite entry script.
  await new Promise(r => setTimeout(r, 50));
  await writeFile(entryPath, renderEntry("version_v2"));

  await Promise.race([
    listChanged,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for tools/list_changed notification")), 12_000),
    ),
  ]);

  const after = await client.listTools();
  assert.deepEqual(after.tools.map(tool => tool.name), ["version_v2"]);
});
