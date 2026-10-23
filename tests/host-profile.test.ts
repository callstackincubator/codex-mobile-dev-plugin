import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { configuredHost } from "../src/shared/host.ts";
import { APP_URI } from "../src/server/plugin.ts";
import { createTestPlugin } from "./fixtures.ts";

test("unknown host configuration fails instead of enabling Codex features", () => {
  assert.equal(configuredHost(undefined), "codex");
  assert.throws(() => configuredHost("unknown"), /Unsupported/);
});

for (const host of ["cursor", "vscode", "claude-desktop"] as const) {
  test(`${host} disables Codex updates and elicitation while preserving app resources`, async t => {
    const previous = process.env.MOBILE_DEV_HOST;
    process.env.MOBILE_DEV_HOST = host;
    t.after(() => {
      if (previous === undefined) delete process.env.MOBILE_DEV_HOST;
      else process.env.MOBILE_DEV_HOST = previous;
    });
    const plugin = await createTestPlugin('<html data-view="panel"><meta name="mobile-dev-environment" content="development"></html>');
    const client = new Client({ name: "host-test", version: "1" });
    t.after(async () => { await client.close(); await plugin.close(); });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await plugin.server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === "mobile_open_workspace"));
    assert.ok(!tools.some(tool => tool.name === "mobile_choose_devices"));
    const update = await client.callTool({ name: "mobile_check_plugin_update", arguments: {} });
    assert.equal((update.structuredContent?.update as { status: string }).status, "disabled");
    const install = await client.callTool({ name: "mobile_install_plugin_update", arguments: {} });
    assert.equal(install.isError, true);
    const resource = await client.readResource({ uri: APP_URI });
    assert.match(resource.contents[0].text as string, new RegExp(`data-host="${host}"`));
    assert.match(resource.contents[0].text as string, /mobile-dev-environment" content="development"/);
    assert.ok(resource.contents[0]._meta?.ui);
    assert.match(client.getInstructions() ?? "", /ask the user in chat/);
  });
}
