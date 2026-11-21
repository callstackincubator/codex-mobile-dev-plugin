import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { createLaunchHome, probeLauncher, systemPath } from "../tooling/mcp-launch-fixture.mjs";
import mcp from "../.mcp.json" with { type: "json" };

const config = mcp.mcpServers["mobile-dev"];
const plugin = resolve("apps/codex-plugin");

async function fixture(t: TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-launch-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return directory;
}

function launch(fixtureHome: string, args: string[], path = systemPath) {
  const env = { PATH: path, HOME: fixtureHome, USERPROFILE: fixtureHome, SYSTEMROOT: process.env.SystemRoot, SHELL: "/missing/user-shell" };
  return probeLauncher(config.command, args, { env, cwd: plugin, encoding: "utf8" });
}

test("the launcher uses Codex's cached Node with spaces, no Node on PATH, and no usable shell", async t => {
  const directory = await fixture(t);
  const fixtureHome = await createLaunchHome(directory, process.execPath);
  const homeForwarded = config.env_vars.includes("HOME");
  const telemetryForwarded = config.env_vars.includes("MOBILE_DEV_TELEMETRY");
  const traceSiftHomeForwarded = config.env_vars.includes("TRACE_SIFT_HOME");
  const traceSiftCommandForwarded = config.env_vars.includes("TRACE_SIFT_COMMAND");
  const profileForwarded = config.env_vars.includes("CODEX_HOME");
  const panelForwarded = config.env_vars.includes("MOBILE_DEV_PANEL");
  assert.ok(homeForwarded);
  for (const name of ["USERPROFILE", "LOCALAPPDATA", "ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_AVD_HOME", "ANDROID_USER_HOME"]) assert.ok(config.env_vars.includes(name));
  assert.ok(telemetryForwarded);
  assert.ok(traceSiftHomeForwarded);
  assert.ok(traceSiftCommandForwarded);
  assert.ok(profileForwarded);
  assert.ok(panelForwarded);
  const entry = join(directory, "server probe.cjs");
  await writeFile(entry, "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));");
  const args = process.platform === "win32" ? [] : ["a b", "literal$argument"];
  const result = launch(fixtureHome, [entry, ...args]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const probe = JSON.parse(result.stdout);
  assert.deepEqual(probe.args, args);
  assert.equal(probe.cwd, process.platform === "win32" ? fixtureHome : plugin);
});

test("the launcher uses Codex's cached Node even when PATH contains another runtime", async t => {
  const directory = await fixture(t);
  const fixtureHome = await createLaunchHome(directory, process.execPath);
  const windows = process.platform === "win32";
  const pathRuntime = join(directory, windows ? "node.cmd" : "node");
  await writeFile(pathRuntime, windows ? "@echo wrong runtime started\r\n" : "#!/bin/sh\nprintf 'wrong runtime started\\n'\n", { mode: 0o755 });
  const entry = join(directory, "version.cjs");
  await writeFile(entry, "console.log(process.version);");
  const result = launch(fixtureHome, [entry], directory);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), process.version);
  assert.equal(result.stderr, "");
});
