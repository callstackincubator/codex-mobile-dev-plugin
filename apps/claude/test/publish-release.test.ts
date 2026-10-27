import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { publishRelease } from "../tooling/publish-release.mjs";

function git(directory: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-claude-publish-test-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const remote = join(directory, "remote.git");
  const plugin = join(directory, "plugin");
  git(directory, ["init", "--bare", remote]);
  await mkdir(`${plugin}/dist`, { recursive: true });
  await mkdir(`${plugin}/scripts`, { recursive: true });
  await mkdir(`${plugin}/hooks`, { recursive: true });
  await mkdir(`${plugin}/.claude-plugin`, { recursive: true });
  await writeFile(`${plugin}/scripts/launch-node.sh`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(`${plugin}/hooks/hooks.json`, '{"hooks":{}}');
  await writeFile(`${plugin}/dist/server.mjs`, "console.log('bundled server');\n");
  await writeFile(`${plugin}/dist/telemetry-environment.json`, '{"environment":"release"}');
  await writeFile(`${plugin}/dist/app.html`, '<meta name="mobile-dev-environment" content="release">');
  async function version(value: string) {
    const manifest = { name: "mobile-dev", version: value, description: "Prebuilt release fixture", author: { name: "Callstack", email: "hello@callstack.com" } };
    await writeFile(`${plugin}/.claude-plugin/plugin.json`, JSON.stringify(manifest));
    await writeFile(`${plugin}/payload.txt`, value);
  }
  await version("1.2.3");
  return { remote, plugin, version };
}

test("publishing puts the plugin and a root marketplace listing it on release/claude and tags it", async t => {
  const { remote, plugin } = await fixture(t);
  const result = await publishRelease(plugin, "v1.2.3", remote);
  assert.equal(result.published, true);
  const catalog = JSON.parse(git(remote, ["show", "release/claude:.claude-plugin/marketplace.json"]));
  assert.equal(catalog.name, "mobile-dev");
  assert.deepEqual(catalog.owner, { name: "Callstack", email: "hello@callstack.com" });
  assert.equal(catalog.plugins[0].name, "mobile-dev");
  assert.equal(catalog.plugins[0].source, "./plugins/mobile-dev");
  const files = git(remote, ["ls-tree", "-r", "--name-only", "release/claude"]).trim().split("\n").sort();
  assert.deepEqual(files, [".claude-plugin/marketplace.json", ...[".claude-plugin/plugin.json", "dist/app.html", "dist/server.mjs", "dist/telemetry-environment.json", "hooks/hooks.json", "payload.txt", "scripts/launch-node.sh"].map(path => `plugins/mobile-dev/${path}`)]);
  assert.match(git(remote, ["ls-tree", "release/claude", "plugins/mobile-dev/scripts/launch-node.sh"]), /^100755/);
  assert.equal(git(remote, ["rev-parse", "claude-v1.2.3^{commit}"]), git(remote, ["rev-parse", "release/claude"]));
});

test("a newer release advances the branch, removes obsolete files, and older or repeated ones change nothing", async t => {
  const { remote, plugin, version } = await fixture(t);
  await writeFile(`${plugin}/obsolete.txt`, "old payload");
  await publishRelease(plugin, "v1.2.3", remote);
  const previousHead = git(remote, ["rev-parse", "release/claude"]);
  await rm(`${plugin}/obsolete.txt`);
  await version("1.2.4");
  await publishRelease(plugin, "v1.2.4", remote);
  assert.equal(git(remote, ["rev-parse", "release/claude^"]), previousHead);
  assert.equal(git(remote, ["show", "release/claude:plugins/mobile-dev/payload.txt"]), "1.2.4");
  assert.doesNotMatch(git(remote, ["ls-tree", "-r", "--name-only", "release/claude"]), /obsolete.txt/);
  const head = git(remote, ["rev-parse", "release/claude"]);
  assert.equal((await publishRelease(plugin, "v1.2.4", remote)).published, false);
  await version("1.2.2");
  assert.deepEqual(await publishRelease(plugin, "v1.2.2", remote), { published: false, version: "1.2.2", latest: "1.2.4" });
  assert.equal(git(remote, ["rev-parse", "release/claude"]), head);
});

test("a mismatched tag or development build fails before creating the branch", async t => {
  const { remote, plugin } = await fixture(t);
  await assert.rejects(publishRelease(plugin, "v1.2.4", remote), /version must match/);
  await writeFile(`${plugin}/dist/telemetry-environment.json`, '{"environment":"development"}');
  await assert.rejects(publishRelease(plugin, "v1.2.3", remote), /requires a release build/);
  assert.equal(git(remote, ["for-each-ref"]), "");
});
