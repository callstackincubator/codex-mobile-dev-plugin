import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { publishRelease } from "../tooling/publish-release.mjs";

function git(directory: string, args: string[]) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-claude-publish-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = join(directory, "remote.git");
  const plugin = join(directory, "plugin");
  git(directory, ["init", "--bare", remote]);
  await mkdir(`${plugin}/.claude-plugin`, { recursive: true });
  await mkdir(`${plugin}/dist/ios-fps`, { recursive: true });
  await writeFile(`${plugin}/dist/server.mjs`, "console.log('server');\n");
  await writeFile(`${plugin}/dist/ios-fps/mobile-dev-ios-fps`, "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(`${plugin}/dist/telemetry-environment.json`, '{"environment":"release"}');
  await writeFile(`${plugin}/dist/app.html`, '<meta name="mobile-dev-environment" content="release">');
  async function version(value: string, environment = "release") {
    await writeFile(`${plugin}/dist/telemetry-environment.json`, JSON.stringify({ environment }));
    await writeFile(`${plugin}/.claude-plugin/plugin.json`, JSON.stringify({
      name: "mobile-dev", version: value, description: "Release fixture", author: { name: "Callstack", email: "hello@callstack.com" },
    }));
  }
  async function checkout() {
    const clone = join(directory, `clone-${Math.random().toString(36).slice(2)}`);
    git(directory, ["clone", "--branch", "release/claude", remote, clone]);
    return clone;
  }
  return { remote, plugin, version, checkout };
}

test("publishing puts the plugin beside its marketplace on release/claude, as the local package does", async t => {
  const { remote, plugin, version, checkout } = await fixture(t);
  await version("1.2.3");
  assert.deepEqual(await publishRelease(plugin, "v1.2.3", remote), { published: true, version: "1.2.3", latest: "1.2.3" });
  const clone = await checkout();
  const catalog = JSON.parse(await readFile(join(clone, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(catalog.name, "mobile-dev");
  assert.deepEqual(catalog.owner, { name: "Callstack", email: "hello@callstack.com" });
  assert.deepEqual(catalog.plugins.map((entry: { name: string; source: string }) => [entry.name, entry.source]), [["mobile-dev", "./mobile-dev"]]);
  assert.equal(JSON.parse(await readFile(join(clone, "mobile-dev/.claude-plugin/plugin.json"), "utf8")).version, "1.2.3");
  assert.equal((await stat(join(clone, "mobile-dev/dist/ios-fps/mobile-dev-ios-fps"))).mode & 0o111, 0o111);
  assert.equal(git(clone, ["log", "-1", "--format=%s"]).trim(), "chore(release): release mobile-dev 1.2.3");
});

test("only a release build matching its tag is published", async t => {
  const { remote, plugin, version } = await fixture(t);
  await version("1.3.0");
  await assert.rejects(publishRelease(plugin, "v1.2.9", remote), /must match the release tag/);
  await version("1.3.0", "development");
  await assert.rejects(publishRelease(plugin, "v1.3.0", remote), /requires a release build/);
});
