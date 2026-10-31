import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { codexCliResolver, createCodexRunner, resolveCodexCli } from "../server/codex-cli.ts";
import type { RunCodex } from "../server/codex-cli.ts";
import { readPluginStore } from "../server/plugin-store.ts";
import type { ReadStore } from "../server/plugin-store.ts";
import { registerPluginUpdateTools } from "../server/plugin-update-tools.ts";
import { PluginUpdates, recordPluginUpdate } from "../server/plugin-updates.ts";
import { scrubErrorEvent, scrubMetric } from "@mobile-dev/shared/telemetry.ts";
import { compareReleaseVersions, PLUGIN_STORE_ID, pluginUpdateSchema } from "../shared/plugin-updates.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

const githubList = ["plugin", "list", "--marketplace", "mobile-dev", "--available", "--json"];
const installedList = ["plugin", "list", "--json"];

async function profile(t: test.TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-updates-test-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function storeManifest(directory: string, version: string, manifestVersion = version) {
  const cache = join(directory, "plugins/cache/openai-curated-remote/mobile-dev", version, ".codex-plugin");
  await mkdir(cache, { recursive: true });
  const text = JSON.stringify({ name: "mobile-dev", version: manifestVersion });
  const path = join(cache, "plugin.json");
  await writeFile(path, text);
}

type FixtureOptions = {
  github?: boolean; storeVersion?: string; installedVersion?: string; storeInstalled?: boolean;
  storeEnabled?: boolean; storeId?: string; source?: string; keepGithub?: boolean;
  removeFails?: boolean; marketplaceRemoveFails?: boolean; manifestVersion?: string;
};

function cliFixture(directory: string, calls: string[][], options: FixtureOptions = {}) {
  let github = options.github ?? true;
  let marketplace = github;
  const source = options.source ?? "https://github.com/callstackincubator/codex-mobile-dev-plugin.git";
  const run: RunCodex = async args => {
    calls.push(args);
    if (args[1] === "marketplace") {
      if (args[2] === "list") return { marketplaces: marketplace ? [{ name: "mobile-dev", marketplaceSource: { sourceType: "git", source } }] : [] };
      if (options.marketplaceRemoveFails) throw new Error("Marketplace removal failed");
      marketplace = false;
      return { marketplaceName: "mobile-dev" };
    }
    if (args[1] === "remove") {
      if (options.removeFails) throw new Error("Removal failed");
      if (options.keepGithub !== true) github = false;
      return { pluginId: "mobile-dev@mobile-dev" };
    }
    const version = options.storeVersion ?? "0.1.167";
    if (options.storeInstalled) await storeManifest(directory, options.installedVersion ?? version, options.manifestVersion);
    const store = {
      pluginId: "mobile-dev@openai-curated-remote", name: "mobile-dev", marketplaceName: "openai-curated-remote",
      version, installed: options.storeInstalled ?? false, enabled: options.storeEnabled ?? true,
      source: { source: "remote", id: options.storeId ?? PLUGIN_STORE_ID },
    };
    const installed = [];
    const available = [];
    const legacy = {
      pluginId: "mobile-dev@mobile-dev", name: "mobile-dev", marketplaceName: "mobile-dev", version: "0.1.167", installed: true, enabled: true,
      source: { source: "local", path: "fixture" }, marketplaceSource: { sourceType: "git", source },
    };
    legacy.installed = github;
    if (github) installed.push(legacy);
    else if (marketplace) available.push(legacy);
    if (args.includes("--marketplace") === false && store.installed) installed.push({ ...store, version: options.installedVersion ?? store.version });
    return { installed, available };
  };
  const readStore: ReadStore = async () => ({
    remotePluginId: options.storeId ?? PLUGIN_STORE_ID, name: "mobile-dev", version: options.storeVersion ?? "0.1.167",
  });
  return { run, readStore };
}

function githubRoot(directory: string) {
  return join(directory, "plugins/cache/mobile-dev/mobile-dev/0.1.167");
}

test("update comparisons use numerical release versions", () => {
  const numeric = compareReleaseVersions("0.1.100", "0.1.99");
  const equal = compareReleaseVersions("0.1.167", "0.1.167");
  const older = compareReleaseVersions("0.1.167", "0.2.0");
  assert.equal(numeric, 1);
  assert.equal(equal, 0);
  assert.equal(older, -1);
});

test("the store catalog is the sole update source and checks are shared across chats", async t => {
  const directory = await profile(t);
  const calls: string[][] = [];
  const fixture = { github: false, storeVersion: "0.1.167", storeInstalled: true, installedVersion: "0.1.166" };
  const { run, readStore } = cliFixture(directory, calls, fixture);
  let now = 1000000;
  const options = { enabled: true, currentVersion: "0.1.166", profile: directory, run, readStore, now: () => now };
  const updates = new PluginUpdates(options);
  const pending = [updates.check(), updates.check()];
  const initial = await Promise.all(pending);
  assert.equal(initial[0].status, "available");
  assert.equal(initial[0].latestVersion, "0.1.167");
  assert.equal(initial[1].status, "available");
  const another = new PluginUpdates(options);
  await another.check();
  assert.deepEqual(calls, [githubList, installedList]);
  fixture.storeVersion = "0.1.168";
  now += 60 * 60 * 1000;
  const next = await another.check();
  assert.equal(next.latestVersion, "0.1.168");
  assert.equal(calls.length, 4);
});

test("pending review and a newer GitHub build never offer an older store migration", async t => {
  for (const version of ["0.1.163", "0.1.167"]) {
    const directory = await profile(t);
    const calls: string[][] = [];
    const { run, readStore } = cliFixture(directory, calls, { storeVersion: version, storeInstalled: true });
    const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.168", run, readStore });
    const status = await updates.check();
    assert.equal(status.status, "current");
    const migration = updates.migrate();
    await assert.rejects(migration, /Install and enable/);
    assert.equal(calls.length, 4);
  }
  const directory = await profile(t);
  const calls: string[][] = [];
  const { run, readStore } = cliFixture(directory, calls, { storeVersion: "0.1.163" });
  const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.166", run, readStore });
  const status = await updates.check();
  assert.equal(status.status, "current");
});

test("legacy GitHub update caches cannot advertise unpublished store versions", async t => {
  const directory = await profile(t);
  const cacheDirectory = join(directory, "mobile-dev");
  await mkdir(cacheDirectory);
  const path = join(cacheDirectory, "updates.json");
  const text = JSON.stringify({ checkedAt: Date.now(), latestVersion: "9.9.9", installedVersion: "9.9.9" });
  await writeFile(path, text);
  const calls: string[][] = [];
  const { run, readStore } = cliFixture(directory, calls, { github: false, storeVersion: "0.1.167" });
  const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore });
  const status = await updates.check();
  assert.equal(status.status, "current");
  assert.equal(status.latestVersion, "0.1.167");
  assert.equal(calls.length, 2);
});

test("update caches keep the flat format earlier releases read and write", async t => {
  const directory = await profile(t);
  const path = join(directory, "mobile-dev/updates.json");
  await mkdir(join(directory, "mobile-dev"));
  const migrated = { source: PLUGIN_STORE_ID, checkedAt: 1000000, latestVersion: "0.1.168", githubConfigured: false, storeInstalled: true, migratedVersion: "0.1.167" };
  await writeFile(path, JSON.stringify(migrated));
  const calls: string[][] = [];
  const { run, readStore } = cliFixture(directory, calls, { github: false, storeVersion: "0.1.169" });
  const options = { enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore, now: () => 1000000 };
  const github = new PluginUpdates({ ...options, pluginRoot: githubRoot(directory) });
  assert.deepEqual(await github.check(), { status: "migrated", currentVersion: "0.1.167", latestVersion: "0.1.167", storeInstalled: true });
  const store = new PluginUpdates(options);
  assert.equal((await store.check()).status, "available");
  assert.equal(calls.length, 0);
  const later = new PluginUpdates({ ...options, now: () => 1000000 + 60 * 60 * 1000 });
  assert.equal((await later.check()).latestVersion, "0.1.169");
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(saved, { source: PLUGIN_STORE_ID, checkedAt: 1000000 + 60 * 60 * 1000, latestVersion: "0.1.169", githubConfigured: false, storeInstalled: false });
});

test("unavailable catalogs, wrong identities and invalid versions stay quiet; development does no CLI work", async t => {
  for (const fixture of [{ storeId: "another-plugin" }, { storeVersion: "../bad" }, { storeInstalled: true, installedVersion: "invalid" }]) {
    const directory = await profile(t);
    const calls: string[][] = [];
    const { run, readStore } = cliFixture(directory, calls, fixture);
    const updates = new PluginUpdates({ enabled: true, profile: directory, run, readStore });
    const status = await updates.check();
    assert.equal(status.status, "unavailable");
  }
  const directory = await profile(t);
  let now = 1000000;
  let checks = 0;
  const run = async () => { checks++; throw new Error("Offline"); };
  const readStore = async () => { throw new Error("Offline"); };
  const updates = new PluginUpdates({ enabled: true, profile: directory, run, readStore, now: () => now });
  const unavailable = await updates.check();
  assert.equal(unavailable.status, "unavailable");
  await updates.check();
  assert.equal(checks, 2);
  now += 15 * 60 * 1000;
  await updates.check();
  assert.equal(checks, 4);
  const dev = new PluginUpdates({ enabled: false, run: async () => { assert.fail("Development must not run update commands"); } });
  const disabled = await dev.check();
  assert.equal(disabled.status, "disabled");
  const migration = dev.migrate();
  await assert.rejects(migration, /Development builds/);
});

test("failed checks keep the last known status and retry after the failed interval", async t => {
  const directory = await profile(t);
  const calls: string[][] = [];
  const cli = cliFixture(directory, calls, { storeInstalled: true });
  let offline = false;
  const run: RunCodex = async args => { if (offline) throw new Error("Offline"); return cli.run(args); };
  let now = 1000000;
  const options = { enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore: cli.readStore, now: () => now };
  const updates = new PluginUpdates(options);
  assert.equal((await updates.check()).status, "migration");
  offline = true;
  now += 60 * 60 * 1000;
  const failed = await updates.check();
  assert.deepEqual(failed, { status: "migration", currentVersion: "0.1.167", latestVersion: "0.1.167", storeInstalled: true });
  const path = join(directory, "mobile-dev/updates.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.checkedAt, 1000000);
  assert.equal(saved.failedAt, now);
  assert.equal(saved.latestVersion, "0.1.167");
  const anotherChat = new PluginUpdates(options);
  assert.equal((await anotherChat.check()).status, "migration");
  assert.deepEqual(calls, [githubList, installedList]);
  now += 15 * 60 * 1000;
  assert.equal((await anotherChat.check()).status, "migration");
  assert.equal(JSON.parse(await readFile(path, "utf8")).checkedAt, 1000000);
  offline = false;
  now += 15 * 60 * 1000;
  assert.equal((await anotherChat.check()).status, "migration");
  assert.equal(calls.length, 4);
  const recovered = JSON.parse(await readFile(path, "utf8"));
  assert.equal(recovered.failedAt, undefined);
  assert.equal(recovered.checkedAt, now);
});

test("checks that cannot be saved still report and reuse their result", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSend: scrubErrorEvent });
  const directory = await profile(t);
  // A directory at the cache path makes every write fail.
  await mkdir(join(directory, "mobile-dev/updates.json/blocked"), { recursive: true });
  const calls: string[][] = [];
  const { run, readStore } = cliFixture(directory, calls, { storeInstalled: true });
  let now = 1000000;
  const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore, now: () => now });
  const notice = await updates.check();
  assert.deepEqual(notice, { status: "migration", currentVersion: "0.1.167", latestVersion: "0.1.167", storeInstalled: true });
  assert.ok((await sentry.text()).includes("Could not save the plugin update check."));
  now += 30 * 60 * 1000;
  assert.equal((await updates.check()).status, "migration");
  assert.deepEqual(calls, [githubList, installedList]);
  now += 30 * 60 * 1000;
  await updates.check();
  assert.equal(calls.length, 4);
});

test("migration is offered for the same version and verifies the store before any deletion", async t => {
  for (const fixture of [{}, { storeInstalled: true, installedVersion: "0.1.163" }, { storeInstalled: true, storeEnabled: false }]) {
    const directory = await profile(t);
    const calls: string[][] = [];
    const { run, readStore } = cliFixture(directory, calls, fixture);
    const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore });
    const notice = await updates.check();
    assert.equal(notice.status, "migration");
    assert.equal(notice.storeInstalled, false);
    const migration = updates.migrate();
    await assert.rejects(migration, /Install and enable/);
    assert.deepEqual(calls, [githubList, installedList, githubList, installedList]);
  }
});

test("migration removes only GitHub, preserves data, deduplicates clicks and persists the restart notice", async t => {
  const directory = await profile(t);
  const calls: string[][] = [];
  const { run, readStore } = cliFixture(directory, calls, { storeInstalled: true });
  const pluginRoot = githubRoot(directory);
  const options = { enabled: true, profile: directory, pluginRoot, currentVersion: "0.1.167", run, readStore };
  const dataPath = join(directory, "recording.json");
  await writeFile(dataPath, "saved recording");
  const updates = new PluginUpdates(options);
  const initial = await updates.check();
  assert.equal(initial.status, "migration");
  assert.equal(initial.storeInstalled, true);
  const migrations = [updates.migrate(), updates.migrate()];
  const results = await Promise.all(migrations);
  assert.equal(results[0].status, "migrated");
  assert.equal(results[1].status, "migrated");
  assert.deepEqual(calls, [
    githubList, installedList,
    githubList, installedList,
    ["plugin", "remove", "mobile-dev@mobile-dev", "--json"],
    ["plugin", "marketplace", "list", "--json"],
    ["plugin", "marketplace", "remove", "mobile-dev", "--json"],
    githubList, installedList,
  ]);
  const another = new PluginUpdates(options);
  const restart = await another.check();
  assert.equal(restart.status, "migrated");
  const storeRoot = join(directory, "plugins/cache/openai-curated-remote/mobile-dev/0.1.167");
  const restarted = new PluginUpdates({ ...options, pluginRoot: storeRoot });
  const current = await restarted.check();
  assert.equal(current.status, "current");
  const data = await readFile(dataPath, "utf8");
  assert.equal(data, "saved recording");
  const cachePath = join(directory, "mobile-dev/updates.json");
  const cacheText = await readFile(cachePath, "utf8");
  const includesProfile = cacheText.includes(directory);
  assert.equal(includesProfile, false);
});

test("wrong marketplaces, failed deletion and unremoved GitHub installations never report success", async t => {
  for (const fixture of [{ source: "https://github.com/other/repo" }, { removeFails: true }, { keepGithub: true }]) {
    const directory = await profile(t);
    const calls: string[][] = [];
    const { run, readStore } = cliFixture(directory, calls, { ...fixture, storeInstalled: true });
    const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore });
    const migration = updates.migrate();
    await assert.rejects(migration);
    if (fixture.source !== undefined) assert.equal(calls.some(call => call[1] === "remove"), false);
  }
});

test("migration failures report the failed step and cause without CLI output", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSend: scrubErrorEvent });
  const cases = [
    { fixture: { source: "https://github.com/other/repo" }, step: "remove-marketplace", failure: "foreign-marketplace" },
    { fixture: { keepGithub: true }, step: "verify", failure: "not-verified" },
    { fixture: {}, failRemoval: true, step: "remove-plugin", failure: "command-failed" },
    { fixture: {}, invalidStore: true, step: "catalog", failure: "invalid-response" },
  ];
  for (const { fixture, failRemoval, invalidStore, step, failure } of cases) {
    sentry.clear();
    const directory = await profile(t);
    const calls: string[][] = [];
    const cli = cliFixture(directory, calls, { ...fixture, storeInstalled: true });
    // A real runner around a command that exits non-zero, so the failure is classified where Codex fails.
    const failing = createCodexRunner(directory, { path: "/usr/bin/false" });
    const run: RunCodex = args => failRemoval && args[1] === "remove" ? failing(args) : cli.run(args);
    const readStore: ReadStore = invalidStore ? async () => ({ name: "mobile-dev" }) : cli.readStore;
    const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore });
    await assert.rejects(updates.migrate());
    const sent = await sentry.text();
    assert.ok(sent.includes("The plugin store migration failed."), step);
    assert.ok(sent.includes(`"plugin_update_step":"${step}"`), sent);
    assert.ok(sent.includes(`"plugin_update_failure":"${failure}"`), sent);
    assert.equal(sent.includes(directory), false);
  }
});

test("cleanup can resume when plugin removal succeeded but marketplace removal failed", async t => {
  const directory = await profile(t);
  const calls: string[][] = [];
  const fixture = { storeInstalled: true, marketplaceRemoveFails: true };
  const { run, readStore } = cliFixture(directory, calls, fixture);
  const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore });
  const migration = updates.migrate();
  await assert.rejects(migration);
  const anotherChat = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore });
  const notice = await anotherChat.check();
  assert.equal(notice.status, "migration");
  fixture.marketplaceRemoveFails = false;
  const retried = await anotherChat.migrate();
  assert.equal(retried.status, "migrated");
  const removals = calls.filter(call => call[1] === "remove");
  assert.equal(removals.length, 1);
});

test("a test deployment's prerelease build compares as the release it precedes", () => {
  assert.equal(compareReleaseVersions("0.1.172", "0.1.172-test.1"), 0);
  assert.equal(compareReleaseVersions("0.1.173", "0.1.172-test.1"), 1);
  assert.equal(pluginUpdateSchema.parse({ status: "current", currentVersion: "0.1.172-test.1", latestVersion: "0.1.171" }).currentVersion, "0.1.172-test.1");
  assert.throws(() => pluginUpdateSchema.parse({ status: "available", currentVersion: "0.1.171", latestVersion: "0.1.172-test.1" }));
});

test("update tools remain app-only and the GitHub upgrade tool is removed", async t => {
  const server = new McpServer({ name: "updates-test", version: "1" });
  const updates = new PluginUpdates({ enabled: false });
  registerPluginUpdateTools(server, updates);
  t.after(() => updates.close());
  const client = await connectClient(t, server, { name: "updates-test" });
  const tools = await client.listTools();
  for (const tool of tools.tools) {
    assert.deepEqual(tool._meta?.ui, { visibility: ["app"] });
    assert.deepEqual(tool.inputSchema.properties, {});
    assert.notEqual(tool.name, "mobile_install_plugin_update");
  }
  const check = await client.callTool({ name: "mobile_check_plugin_update", arguments: {} });
  const checkedUpdate = pluginUpdateSchema.parse(check.structuredContent?.update);
  assert.equal(checkedUpdate.status, "disabled");
  const migrate = await client.callTool({ name: "mobile_migrate_plugin_to_store", arguments: {} });
  assert.equal(migrate.isError, true);
});

test("CLI resolution rejects processes other than the launching Codex executable", async () => {
  const resolution = resolveCodexCli(process.pid);
  await assert.rejects(resolution, /Could not locate the Codex executable/);
});

test("CLI resolution runs once per launching process and retries failed lookups", async t => {
  const directory = await profile(t);
  const executable = join(directory, "codex-fixture");
  await writeFile(executable, "#!/bin/sh\necho '{}'\n", { mode: 0o755 });
  const lookups: number[] = [];
  const resolveCli = codexCliResolver(directory, async parentPid => {
    lookups.push(parentPid);
    if (lookups.length === 1) throw new Error("ps failed");
    return executable;
  });
  const run = createCodexRunner(directory, { resolveCli });
  await assert.rejects(run(["plugin", "list"]), /ps failed/);
  await Promise.all([run(["plugin", "list"]), run(["plugin", "marketplace", "list"])]);
  const result = await run(["plugin", "list"]);
  assert.deepEqual(result, {});
  assert.deepEqual(lookups, [process.ppid, process.ppid]);
});

test("published versions are read directly without user authentication or installation state", async () => {
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, `https://chatgpt.com/backend-api/ps/plugins/${PLUGIN_STORE_ID}`);
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("OAI-Product-Sku"), "codex");
    return Response.json({ id: PLUGIN_STORE_ID, name: "mobile-dev", status: "ENABLED", release: { version: "0.1.168" }, localVersion: "9.9.9" });
  };
  const plugin = await readPluginStore({ fetch: request });
  assert.deepEqual(plugin, { remotePluginId: PLUGIN_STORE_ID, name: "mobile-dev", version: "0.1.168" });
});

test("HTTP failures, unpublished releases and malformed store responses use fixed errors", async () => {
  const valid = { id: PLUGIN_STORE_ID, name: "mobile-dev", status: "ENABLED", release: { version: "0.1.168" } };
  const responses = [
    new Response("PRIVATE_CATALOG_ERROR", { status: 503 }),
    new Response("PRIVATE_CATALOG_ERROR"),
    Response.json({ ...valid, id: "another-plugin" }),
    Response.json({ ...valid, name: "another-plugin" }),
    Response.json({ ...valid, status: "DRAFT" }),
    Response.json({ ...valid, release: { version: "../bad" } }),
    Response.json({ ...valid, release: null }),
  ];
  for (const response of responses) {
    const reading = readPluginStore({ fetch: async () => response });
    await assert.rejects(reading, error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Could not read|invalid update response/);
      const leaked = error.message.includes("PRIVATE_CATALOG_ERROR");
      assert.equal(leaked, false);
      return true;
    });
  }
});

test("anonymous check failures preserve timing, classify the cause and exclude private response data", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSendMetric: scrubMetric });
  const directory = await profile(t);
  const calls: string[][] = [];
  const cli = cliFixture(directory, calls);
  const request: typeof fetch = async () => new Response("PRIVATE_CATALOG_ERROR", { status: 503 });
  const readStore = () => readPluginStore({ fetch: request });
  const updates = new PluginUpdates({ enabled: true, profile: directory, run: cli.run, readStore });
  const result = await updates.check();
  assert.equal(result.status, "unavailable");
  const sent = await sentry.text();
  for (const fragment of ["plugin.update.operations", "plugin.update.duration", "millisecond", '"outcome":{"value":"unavailable"', '"failure":{"value":"store-unavailable"']) assertFragment(sent, fragment);
  const recorded = (await sentry.metrics()).length;
  await updates.check();
  assert.equal((await sentry.metrics()).length, recorded);
  for (const fragment of ["PRIVATE_CATALOG_ERROR", directory]) assertFragment(await sentry.text(), fragment, false);
});

test("store requests stop when the caller cancels or the deadline expires", async t => {
  for (const cause of ["caller", "deadline"]) {
    await t.test(cause, async t => {
      const caller = new AbortController();
      const deadline = new AbortController();
      t.mock.method(AbortSignal, "timeout", () => deadline.signal);
      const request: typeof fetch = async (_url, options) => {
        const signal = options?.signal;
        assert.ok(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("PRIVATE_CATALOG_ERROR")), { once: true });
        });
      };
      const reading = readPluginStore({ fetch: request, signal: caller.signal });
      const controller = cause === "caller" ? caller : deadline;
      controller.abort();
      await assert.rejects(reading, /Could not read the Codex plugin store catalog/);
    });
  }
});

test("migration verifies the local installed identity, version, enabled state and manifest", async t => {
  const fixtures = [
    { storeInstalled: true, storeId: "another-plugin" },
    { storeInstalled: true, storeEnabled: false },
    { storeInstalled: true, installedVersion: "0.1.163" },
    { storeInstalled: true, manifestVersion: "0.1.166" },
    { storeInstalled: false },
  ];
  for (const fixture of fixtures) {
    const directory = await profile(t);
    const calls: string[][] = [];
    const cli = cliFixture(directory, calls, fixture);
    const readStore = async () => ({ remotePluginId: PLUGIN_STORE_ID, name: "mobile-dev", version: "0.1.167", installed: true, enabled: true, localVersion: "0.1.167" });
    const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run: cli.run, readStore });
    const notice = await updates.check();
    assert.equal(notice.status, "migration");
    assert.equal(notice.storeInstalled, false);
    const migration = updates.migrate();
    await assert.rejects(migration, /Install and enable/);
    const removals = calls.filter(call => call[1] === "remove" || call[1] === "marketplace");
    assert.equal(removals.length, 0);
  }
});

test("migration recognizes the renamed official GitHub repository", async t => {
  const directory = await profile(t);
  const calls: string[][] = [];
  const { run, readStore } = cliFixture(directory, calls, { storeInstalled: true, source: "https://github.com/callstackincubator/mobile-dev.git" });
  const updates = new PluginUpdates({ enabled: true, profile: directory, currentVersion: "0.1.167", run, readStore });
  const notice = await updates.check();
  assert.equal(notice.status, "migration");
  const migrated = await updates.migrate();
  assert.equal(migrated.status, "migrated");
  const removed = calls.some(call => call[1] === "remove" && call[2] === "mobile-dev@mobile-dev");
  assert.equal(removed, true);
});

test("plugin update metrics measure plugin work without device context and honor opt-out", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSendMetric: scrubMetric });
  recordPluginUpdate("check", "available", 80);
  recordPluginUpdate("migrate", "migrated", 2000);
  recordPluginUpdate("migrate", "failed", 3000);
  const sent = await sentry.text();
  for (const fragment of ["plugin.update.operations", "plugin.update.duration", "millisecond", '"operation":{"value":"check"', '"outcome":{"value":"migrated"', '"outcome":{"value":"failed"']) assertFragment(sent, fragment);
  for (const fragment of ["device_platform", "device_kind", "latestVersion", "currentVersion", "user.id", "telemetry_session"]) assertFragment(sent, fragment, false);
  sentry.setTelemetry("off");
  recordPluginUpdate("migrate", "migrated", 999);
  const afterOptOut = await sentry.text();
  assert.equal(afterOptOut, sent);
});
