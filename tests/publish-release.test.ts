import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { publishRelease } from "../scripts/publish-release.mjs";

function git(directory: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

async function fixture(t: TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-publish-test-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const remote = join(directory, "remote.git");
  const plugin = join(directory, "plugin");
  git(directory, ["init", "--bare", remote]);
  await mkdir(`${plugin}/dist/runtime/node_modules/dependency`, { recursive: true });
  await mkdir(`${plugin}/scripts`, { recursive: true });
  await writeFile(`${plugin}/scripts/launch-mcp.sh`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(`${plugin}/dist/runtime/node_modules/dependency/index.js`, "export const bundled = true;\n");
  await writeFile(`${plugin}/dist/server.mjs`, "console.log('bundled server');\n");
  await chmod(`${plugin}/dist/server.mjs`, 0o755);
  await writeFile(`${plugin}/dist/telemetry-environment.json`, '{"environment":"release"}');
  await writeFile(`${plugin}/dist/app.html`, '<meta name="mobile-dev-environment" content="release">');
  await writeFile(`${plugin}/.mcp.json`, '{"mcpServers":{"mobile-dev":{"command":"/bin/sh","args":["./scripts/launch-mcp.sh","./dist/server.mjs"],"cwd":"${PLUGIN_ROOT}","env_vars":["SHELL"]}}}');
  await mkdir(`${plugin}/.codex-plugin`, { recursive: true });
  async function version(value: string) {
    const manifest = {
      name: "mobile-dev", version: value, description: "Prebuilt release fixture",
      skills: "./skills/", mcpServers: "./.mcp.json",
    };
    const text = JSON.stringify(manifest);
    await writeFile(`${plugin}/.codex-plugin/plugin.json`, text);
    await writeFile(`${plugin}/payload.txt`, value);
  }
  await version("1.2.3");
  return { directory, remote, plugin, version };
}

test("publishing creates an independent branch with built files, runtime dependencies, and executable modes", async t => {
  const { directory, remote, plugin } = await fixture(t);
  const source = join(directory, "source");
  git(directory, ["init", "--initial-branch=main", source]);
  git(source, ["config", "user.name", "Release test"]);
  git(source, ["config", "user.email", "release@example.test"]);
  git(source, ["config", "commit.gpgsign", "false"]);
  await writeFile(`${source}/.gitignore`, "dist/\nnode_modules/\n");
  await writeFile(`${source}/source-only.txt`, "development files");
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "Source repository"]);
  git(source, ["push", remote, "main"]);
  const sourceHead = git(remote, ["rev-parse", "main"]);
  const result = await publishRelease(plugin, "v1.2.3", remote);
  assert.equal(result.published, true);
  const catalogText = git(remote, ["show", "release/latest:.agents/plugins/marketplace.json"]);
  const catalog = JSON.parse(catalogText);
  assert.equal(catalog.name, "mobile-dev");
  assert.deepEqual(catalog.plugins[0].source, { source: "local", path: "./plugins/mobile-dev" });
  const filesText = git(remote, ["ls-tree", "-r", "--name-only", "release/latest"]);
  assert.match(filesText, /plugins\/mobile-dev\/dist\/runtime\/node_modules\/dependency\/index.js/);
  assert.doesNotMatch(filesText, /source-only|\.gitignore/);
  const executable = git(remote, ["ls-tree", "release/latest", "plugins/mobile-dev/dist/server.mjs"]);
  assert.match(executable, /^100755/);
  const launcher = git(remote, ["ls-tree", "release/latest", "plugins/mobile-dev/scripts/launch-mcp.sh"]);
  assert.match(launcher, /^100755/);
  const commits = git(remote, ["rev-list", "--count", "release/latest"]);
  assert.equal(commits.trim(), "1");
  const currentSourceHead = git(remote, ["rev-parse", "main"]);
  assert.equal(currentSourceHead, sourceHead);
});

test("publishing a newer release advances the branch and removes obsolete files", async t => {
  const { remote, plugin, version } = await fixture(t);
  await writeFile(`${plugin}/obsolete.txt`, "old payload");
  await publishRelease(plugin, "v1.2.3", remote);
  const previousHead = git(remote, ["rev-parse", "release/latest"]);
  await rm(`${plugin}/obsolete.txt`);
  await version("1.2.4");
  await publishRelease(plugin, "v1.2.4", remote);
  const parent = git(remote, ["rev-parse", "release/latest^"]);
  assert.equal(parent, previousHead);
  const payload = git(remote, ["show", "release/latest:plugins/mobile-dev/payload.txt"]);
  assert.equal(payload, "1.2.4");
  const files = git(remote, ["ls-tree", "-r", "--name-only", "release/latest"]);
  assert.doesNotMatch(files, /obsolete.txt/);
});

test("publishing advances an existing portable release without retaining its manifests", async t => {
  const { directory, remote, plugin } = await fixture(t);
  const legacy = join(directory, "legacy");
  await mkdir(`${legacy}/.agents/plugins`, { recursive: true });
  await mkdir(`${legacy}/plugins/mobile-dev`, { recursive: true });
  git(legacy, ["init"]);
  git(legacy, ["config", "user.name", "Release test"]);
  git(legacy, ["config", "user.email", "release@example.test"]);
  git(legacy, ["config", "commit.gpgsign", "false"]);
  await writeFile(`${legacy}/.agents/plugins/marketplace.json`, '{"name":"mobile-dev"}');
  await writeFile(`${legacy}/plugins/mobile-dev/plugin.json`, '{"name":"mobile-dev","version":"1.2.2"}');
  await writeFile(`${legacy}/plugins/mobile-dev/mcp.json`, '{}');
  git(legacy, ["add", "."]);
  git(legacy, ["commit", "-m", "Release Mobile Dev 1.2.2"]);
  git(legacy, ["push", remote, "HEAD:refs/heads/release/latest"]);
  const previousHead = git(remote, ["rev-parse", "release/latest"]);
  const result = await publishRelease(plugin, "v1.2.3", remote);
  assert.equal(result.published, true);
  const parent = git(remote, ["rev-parse", "release/latest^"]);
  assert.equal(parent, previousHead);
  const files = git(remote, ["ls-tree", "-r", "--name-only", "release/latest"]);
  assert.match(files, /plugins\/mobile-dev\/\.codex-plugin\/plugin.json/);
  assert.doesNotMatch(files, /plugins\/mobile-dev\/(?:plugin|mcp)\.json/);
});

test("older and repeated releases never replace the latest payload", async t => {
  const { remote, plugin, version } = await fixture(t);
  await publishRelease(plugin, "v1.2.3", remote);
  const head = git(remote, ["rev-parse", "release/latest"]);
  await writeFile(`${plugin}/payload.txt`, "rebuilt payload");
  const repeated = await publishRelease(plugin, "v1.2.3", remote);
  assert.equal(repeated.published, false);
  await version("1.2.2");
  const older = await publishRelease(plugin, "v1.2.2", remote);
  assert.equal(older.published, false);
  assert.equal(older.latest, "1.2.3");
  const current = git(remote, ["rev-parse", "release/latest"]);
  assert.equal(current, head);
});

test("prerelease ordering follows semantic versions and cannot replace the same stable version", async t => {
  const { remote, plugin, version } = await fixture(t);
  await version("1.2.3-rc.2");
  await publishRelease(plugin, "v1.2.3-rc.2", remote);
  await version("1.2.3-rc.10");
  const next = await publishRelease(plugin, "v1.2.3-rc.10", remote);
  assert.equal(next.published, true);
  await version("1.2.3");
  const stable = await publishRelease(plugin, "v1.2.3", remote);
  assert.equal(stable.published, true);
  await version("1.2.3-rc.11");
  const prerelease = await publishRelease(plugin, "v1.2.3-rc.11", remote);
  assert.equal(prerelease.published, false);
});

test("a mismatched tag or development build fails before creating the branch", async t => {
  const { remote, plugin } = await fixture(t);
  const mismatched = publishRelease(plugin, "v1.2.4", remote);
  await assert.rejects(mismatched, /version must match/);
  await writeFile(`${plugin}/dist/telemetry-environment.json`, '{"environment":"development"}');
  const development = publishRelease(plugin, "v1.2.3", remote);
  await assert.rejects(development, /requires a release build/);
  const refs = git(remote, ["for-each-ref"]);
  assert.equal(refs, "");
});

test("an inaccessible remote fails without being treated as an empty branch", async t => {
  const { directory, plugin } = await fixture(t);
  const inaccessible = join(directory, "missing.git");
  const publishing = publishRelease(plugin, "v1.2.3", inaccessible);
  await assert.rejects(publishing, /Cannot inspect release\/latest/);
});

test("Codex installs and refreshes the tracked branch in an isolated profile", {
  skip: process.env.MOBILE_DEV_TEST_CODEX !== "1",
}, async t => {
  const { directory, remote, plugin, version } = await fixture(t);
  const profile = join(directory, "codex-profile");
  await mkdir(profile);
  const env = {
    ...process.env,
    CODEX_HOME: profile,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file://${remote}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://example.test/mobile-dev.git",
  };
  function codex(args: string[]) {
    const output = execFileSync("codex", args, {
      cwd: directory, env, encoding: "utf8", timeout: 30000,
    });
    return JSON.parse(output);
  }
  await publishRelease(plugin, "v1.2.3", remote);
  codex(["plugin", "marketplace", "add", "https://example.test/mobile-dev.git", "--ref", "release/latest", "--json"]);
  const installed = codex(["plugin", "add", "mobile-dev@mobile-dev", "--json"]);
  assert.equal(installed.version, "1.2.3");
  const payloadPath = join(installed.installedPath, "payload.txt");
  const initial = await readFile(payloadPath, "utf8");
  assert.equal(initial, "1.2.3");
  await version("1.2.4");
  await publishRelease(plugin, "v1.2.4", remote);
  const refresh = codex(["plugin", "marketplace", "upgrade", "mobile-dev", "--json"]);
  assert.deepEqual(refresh.errors, []);
  const listing = codex(["plugin", "list", "--json"]);
  assert.equal(listing.installed[0].version, "1.2.4");
  const updatedPath = join(profile, "plugins/cache/mobile-dev/mobile-dev/1.2.4/payload.txt");
  const updated = await readFile(updatedPath, "utf8");
  assert.equal(updated, "1.2.4");
  const config = await readFile(`${profile}/config.toml`, "utf8");
  assert.match(config, /release\/latest/);
});
