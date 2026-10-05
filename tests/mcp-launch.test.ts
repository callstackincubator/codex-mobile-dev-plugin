import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { createLaunchHome } from "../scripts/mcp-launch-fixture.mjs";
import mcp from "../.mcp.json" with { type: "json" };

const config = mcp.mcpServers["mobile-dev"];
const launcher = resolve(config.args[0]);
const systemPath = "/usr/bin:/bin:/usr/sbin:/sbin";

async function fixture(t: TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-launch-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return directory;
}

function launch(fixtureHome: string, args: string[], path = systemPath) {
  const env = { PATH: path, HOME: fixtureHome, SHELL: "/missing/user-shell" };
  return spawnSync(config.command, [launcher, ...args], { env, encoding: "utf8" });
}

test("the launcher uses Codex's cached Node with spaces, no Node on PATH, and no usable shell", async t => {
  const directory = await fixture(t);
  const fixtureHome = await createLaunchHome(directory, process.execPath);
  const homeForwarded = config.env_vars.includes("HOME");
  const telemetryForwarded = config.env_vars.includes("MOBILE_DEV_TELEMETRY");
  const profileForwarded = config.env_vars.includes("CODEX_HOME");
  assert.ok(homeForwarded);
  assert.ok(telemetryForwarded);
  assert.ok(profileForwarded);
  const script = 'const args = process.argv.slice(1); const text = JSON.stringify(args); console.log(text);';
  const result = launch(fixtureHome, ["--eval", script, "a b", "literal$argument"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const args = JSON.parse(result.stdout);
  assert.deepEqual(args, ["a b", "literal$argument"]);
});

test("the launcher uses Codex's cached Node even when PATH contains another runtime", async t => {
  const directory = await fixture(t);
  const fixtureHome = await createLaunchHome(directory, process.execPath);
  const pathRuntime = join(directory, "node");
  await writeFile(pathRuntime, "#!/bin/sh\nprintf 'wrong runtime started\\n'\n", { mode: 0o755 });
  const result = launch(fixtureHome, ["--eval", 'console.log("Codex runtime started")'], directory);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Codex runtime started\n");
  assert.equal(result.stderr, "");
});
