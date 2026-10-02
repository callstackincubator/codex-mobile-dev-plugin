import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
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

function launch(shellPath?: string, args: string[] = []) {
  const env: Record<string, string> = { PATH: systemPath, SHELL: "" };
  if (shellPath !== undefined) env.SHELL = shellPath;
  return spawnSync(config.command, [launcher, ...args], { env, encoding: "utf8" });
}

test("the manifest launcher discovers Node despite startup output, spaces, and no desktop Node on PATH", async t => {
  const directory = await fixture(t);
  const runtime = join(directory, "discovered node");
  await symlink(process.execPath, runtime);
  const shell = await shellFixture(directory, runtime);
  assert.ok(config.env_vars.includes("SHELL"));
  assert.ok(config.env_vars.includes("MOBILE_DEV_TELEMETRY"));
  const script = 'const args = process.argv.slice(1); const text = JSON.stringify(args); console.log(text);';
  const result = launch(shell, ["--eval", script, "a b", "literal$argument"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(result.stdout);
  assert.deepEqual(args, ["a b", "literal$argument"]);
});

test("a missing configured shell reports an actionable setup error", () => {
  const result = launch();
  assert.equal(result.status, 127);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /did not provide the configured user shell/);
});

test("missing and non-executable discovered runtimes fail before launching the server", async t => {
  const directory = await fixture(t);
  const runtime = join(directory, "runtime");
  for (const present of [false, true]) {
    if (present) await writeFile(runtime, "unusable runtime", { mode: 0o644 });
    const shell = await shellFixture(directory, runtime);
    const result = launch(shell);
    assert.equal(result.status, 127);
    assert.match(result.stderr, /Node executable discovered in the user shell is missing or not executable/);
    assert.equal(result.stderr.includes(directory), false);
  }
});

function quote(value: string) {
  const escaped = value.replaceAll("'", "'\\''");
  return `'${escaped}'`;
}

test("the launcher rejects Node versions below 22.18 with an actionable error", async t => {
  const directory = await fixture(t);
  const evaluator = join(directory, "old-node.cjs");
  const source = 'Object.defineProperty(process.versions, "node", { value: "22.17.0" }); const vm = require("node:vm"); vm.runInThisContext(process.argv[3]);';
  await writeFile(evaluator, source);
  const executable = quote(process.execPath);
  const script = quote(evaluator);
  const runtime = join(directory, "old-node");
  await writeFile(runtime, `#!/bin/sh\nexec ${executable} ${script} "$@"\n`, { mode: 0o755 });
  const shell = await shellFixture(directory, runtime);
  const result = launch(shell, ["--eval", 'console.log("server started")']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Node.js 22.17.0; version 22.18 or later is required/);
});

test("a discovered runtime that cannot execute its startup check reports a setup failure", async t => {
  const directory = await fixture(t);
  const shell = await shellFixture(directory, "/usr/bin/false");
  const result = launch(shell);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not pass its startup check/);
});

async function shellFixture(directory: string, executable: string) {
  const quoted = quote(executable);
  const shell = join(directory, "configured shell");
  const source = `#!/bin/sh\nprintf 'shell startup banner\\n\\036mobile-dev-node:%s\\n' ${quoted}\n`;
  await writeFile(shell, source, { mode: 0o755 });
  return shell;
}

test("a user shell without Node reports the install requirement", async t => {
  const directory = await fixture(t);
  const shell = join(directory, "configured shell");
  await writeFile(shell, "#!/bin/sh\nexit 127\n", { mode: 0o755 });
  const result = launch(shell);
  assert.equal(result.status, 127);
  assert.match(result.stderr, /Node was not found in the configured user login shell/);
});

test("aliases and ambiguous shell output are rejected without executing them", async t => {
  const directory = await fixture(t);
  for (const candidate of ["node=some-command", "node", "/usr/bin/false\nextra output"]) {
    const shell = await shellFixture(directory, candidate);
    const result = launch(shell);
    assert.equal(result.status, 127);
    assert.match(result.stderr, /ambiguous Node path|alias, function, or relative path/);
  }
});
