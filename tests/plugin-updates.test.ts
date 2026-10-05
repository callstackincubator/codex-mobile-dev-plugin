import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PluginUpdates, registerPluginUpdateTools, resolveCodexCli } from "../src/server/plugin-updates.ts";
import type { RunCodex } from "../src/server/plugin-updates.ts";
import { compareReleaseVersions, pluginUpdateSchema } from "../src/shared/plugin-updates.ts";

async function profile(t: test.TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-updates-test-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function releaseFetch(version = "0.1.132", marketplaceVersion = version): typeof fetch {
  return async input => {
    const url = String(input);
    const data = url.includes("api.github.com")
      ? { tag_name: `v${version}`, draft: false, prerelease: false }
      : { name: "mobile-dev", version: marketplaceVersion };
    const text = JSON.stringify(data);
    return new Response(text);
  };
}

async function installedManifest(directory: string, version: string) {
  const cache = join(directory, "plugins/cache/mobile-dev/mobile-dev", version, ".codex-plugin");
  await mkdir(cache, { recursive: true });
  const text = JSON.stringify({ name: "mobile-dev", version });
  const path = join(cache, "plugin.json");
  await writeFile(path, text);
}

function cliFixture(directory: string, calls: string[][], options: { source?: string; errors?: unknown[]; version?: string } = {}): RunCodex {
  const root = join(directory, ".tmp/marketplaces/mobile-dev");
  return async args => {
    calls.push(args);
    if (args[2] === "list") return { marketplaces: [{ name: "mobile-dev", root, marketplaceSource: {
      sourceType: "git", source: options.source ?? "https://github.com/callstackincubator/codex-mobile-dev-plugin.git",
    } }] };
    if (args[2] === "upgrade") {
      const version = options.version ?? "0.1.132";
      await installedManifest(directory, version);
      return { selectedMarketplaces: ["mobile-dev"], upgradedRoots: [root], errors: options.errors ?? [] };
    }
    return { installed: [{ pluginId: "mobile-dev@mobile-dev", installed: true, version: options.version ?? "0.1.132" }] };
  };
}

test("update comparisons use numerical release versions", () => {
  const numeric = compareReleaseVersions("0.1.100", "0.1.99");
  const equal = compareReleaseVersions("0.1.132", "0.1.132");
  const older = compareReleaseVersions("0.1.132", "0.2.0");
  assert.equal(numeric, 1);
  assert.equal(equal, 0);
  assert.equal(older, -1);
});

test("checks cache across plugin processes and require a ready marketplace release", async t => {
  const directory = await profile(t);
  let requests = 0;
  let now = 1000000;
  let marketplaceVersion = "0.1.131";
  const fetchRelease: typeof fetch = async input => {
    requests++;
    const fetcher = releaseFetch("0.1.132", marketplaceVersion);
    return fetcher(input);
  };
  const options = { enabled: true, currentVersion: "0.1.99", profile: directory, fetch: fetchRelease, now: () => now };
  const updates = new PluginUpdates(options);
  const pending = [updates.check(), updates.check()];
  const initial = await Promise.all(pending);
  assert.equal(initial[0].status, "unavailable");
  assert.equal(initial[1].status, "unavailable");
  assert.equal(requests, 2);
  const another = new PluginUpdates(options);
  const cached = await another.check();
  assert.equal(cached.status, "unavailable");
  assert.equal(requests, 2);
  marketplaceVersion = "0.1.132";
  now += 15 * 60 * 1000;
  const ready = await another.check();
  assert.equal(ready.status, "available");
  assert.equal(requests, 4);
  const fresh = new PluginUpdates(options);
  await fresh.check();
  assert.equal(requests, 4);
  now += 60 * 60 * 1000;
  await fresh.check();
  assert.equal(requests, 6);
});

test("offline checks remain quiet, invalid tags cannot advertise updates, and development does no work", async t => {
  const directory = await profile(t);
  const offline: typeof fetch = async () => { throw new Error("Offline"); };
  const updates = new PluginUpdates({ enabled: true, profile: directory, fetch: offline });
  const unavailable = await updates.check();
  assert.equal(unavailable.status, "unavailable");
  const dev = new PluginUpdates({ enabled: false, profile: directory, fetch: async () => { assert.fail("Development must not fetch updates"); } });
  const disabled = await dev.check();
  assert.equal(disabled.status, "disabled");
  const installation = dev.install();
  await assert.rejects(installation, /Development builds/);
  const otherDirectory = await profile(t);
  const invalid = new PluginUpdates({ enabled: true, profile: otherDirectory, fetch: releaseFetch("../bad", "0.1.132") });
  const malformed = await invalid.check();
  assert.equal(malformed.status, "unavailable");
  const newerDirectory = await profile(t);
  const newer = new PluginUpdates({ enabled: true, profile: newerDirectory, currentVersion: "0.2.0", fetch: releaseFetch() });
  const current = await newer.check();
  assert.equal(current.status, "current");
});

test("installation is deduplicated, verifies cache files, and retains the restart notice across chats", async t => {
  const directory = await profile(t);
  const calls: string[][] = [];
  const run = cliFixture(directory, calls);
  const options = { enabled: true, profile: directory, currentVersion: "0.1.131", fetch: releaseFetch(), run };
  const updates = new PluginUpdates(options);
  const existingChat = new PluginUpdates(options);
  await existingChat.check();
  const installations = [updates.install(), updates.install()];
  const results = await Promise.all(installations);
  assert.equal(results[0].status, "updated");
  assert.equal(results[1].status, "updated");
  const existingNotice = await existingChat.check();
  assert.equal(existingNotice.status, "updated");
  assert.deepEqual(calls, [
    ["plugin", "marketplace", "list", "--json"],
    ["plugin", "marketplace", "upgrade", "mobile-dev", "--json"],
    ["plugin", "list", "--json"],
  ]);
  const another = new PluginUpdates(options);
  const restart = await another.check();
  assert.equal(restart.status, "updated");
  const restarted = new PluginUpdates({ ...options, currentVersion: "0.1.132" });
  const current = await restarted.check();
  assert.equal(current.status, "current");
  const cachePath = join(directory, "mobile-dev/updates.json");
  const cacheText = await readFile(cachePath, "utf8");
  const includesProfile = cacheText.includes(directory);
  assert.equal(includesProfile, false);
});

test("wrong marketplaces, JSON upgrade errors, and stale installs never report success", async t => {
  for (const options of [{ source: "https://github.com/other/repo" }, { errors: ["failed"] }, { version: "0.1.131" }]) {
    const directory = await profile(t);
    const calls: string[][] = [];
    const run = cliFixture(directory, calls, options);
    const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.131", fetch: releaseFetch(), run });
    const installation = updates.install();
    await assert.rejects(installation);
    const status = await updates.check();
    assert.equal(status.status, "available");
    if (options.source !== undefined) assert.equal(calls.length, 1);
  }
});

test("update tools are app-only, have no command arguments, and enforce development mode", async t => {
  const server = new McpServer({ name: "updates-test", version: "1" });
  const updates = new PluginUpdates({ enabled: false });
  registerPluginUpdateTools(server, updates);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "updates-test", version: "1" });
  t.after(async () => { updates.close(); await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  for (const tool of tools.tools) {
    assert.deepEqual(tool._meta?.ui, { visibility: ["app"] });
    assert.deepEqual(tool.inputSchema.properties, {});
  }
  const check = await client.callTool({ name: "mobile_check_plugin_update", arguments: {} });
  const checkedUpdate = pluginUpdateSchema.parse(check.structuredContent?.update);
  assert.equal(checkedUpdate.status, "disabled");
  const install = await client.callTool({ name: "mobile_install_plugin_update", arguments: {} });
  assert.equal(install.isError, true);
});

test("CLI resolution rejects processes that are not the launching Codex executable", async () => {
  const resolution = resolveCodexCli(process.pid);
  await assert.rejects(resolution, /Could not locate the Codex executable/);
});
