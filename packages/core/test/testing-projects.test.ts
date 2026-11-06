import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConfig, inspectProject, parseTargets, TestingProjectChoices, writeTestFile } from "../src/testing-projects.ts";

const CONFIG = `import { mobile } from "@e2e-dev/mobile";
import type { E2EConfig } from "e2e";

export default {
  agents: { default: { model: chatgpt("gpt-6-luna") } },
  targets: [
    {
      name: "web",
      engine: playwright({ browser: "chromium" }),
    },
    {
      name: "ios",
      engine: mobile({ platform: "ios" }),
      app: { bundleId: "com.anonymous.expoapp57" },
    },
  ],
  workers: 1,
} satisfies E2EConfig;
`;

test("the config read names each target and attributes its bundle id", () => {
  const targets = parseTargets(CONFIG);
  assert.deepEqual(targets, [
    { name: "web" },
    { name: "ios", platform: "ios", bundleId: "com.anonymous.expoapp57" },
  ]);
});

test("a config with no targets reads as none rather than throwing", () => {
  assert.deepEqual(parseTargets("export default { workers: 1 };"), []);
});

test("a project is the folder holding an e2e config, and one without is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-projects-"));
  try {
    const project = join(root, "app");
    const empty = join(root, "empty");
    await mkdir(project);
    await mkdir(empty);
    await writeFile(join(project, "e2e.config.ts"), CONFIG, "utf-8");

    assert.equal(await findConfig(project), join(project, "e2e.config.ts"));
    assert.equal(await findConfig(empty), undefined);

    const inspected = await inspectProject(project);
    assert.equal(inspected.name, "app");
    assert.equal(inspected.targets.at(-1)?.bundleId, "com.anonymous.expoapp57");

    // A folder the recorder could not write a test for never reaches the panel's list.
    const choices = new TestingProjectChoices(join(root, "state"), async () => empty);
    await assert.rejects(choices.record(empty), /no e2e.config.ts/);
    await choices.record(project);
    assert.deepEqual((await choices.list()).map(entry => entry.path), [project]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


async function project(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "testing-write-"));
  const path = join(root, "app");
  await mkdir(path);
  await writeFile(join(path, "e2e.config.ts"), CONFIG, "utf-8");
  return { root, path };
}

const SOURCE = 'test("x", async () => {});\n';

test("a recorded test is written into the project's tests folder", async () => {
  const { root, path } = await project();
  try {
    const result = await writeTestFile(path, "tests/tab-navigation.e2e.ts", SOURCE);
    assert.equal(result.written, true);
    assert.equal(result.existed, false);
    assert.equal(result.path, join(path, "tests", "tab-navigation.e2e.ts"));
    assert.equal(await readFile(result.path, "utf-8"), SOURCE);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an existing file is reported back untouched until the user says to replace it", async () => {
  const { root, path } = await project();
  try {
    await writeTestFile(path, "tests/flow.e2e.ts", "first\n");
    const refused = await writeTestFile(path, "tests/flow.e2e.ts", SOURCE);
    assert.equal(refused.written, false);
    assert.equal(refused.existed, true);
    assert.equal(await readFile(refused.path, "utf-8"), "first\n");

    const replaced = await writeTestFile(path, "tests/flow.e2e.ts", SOURCE, true);
    assert.equal(replaced.written, true);
    assert.equal(await readFile(replaced.path, "utf-8"), SOURCE);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a path that leaves the tests folder is refused", async () => {
  const { root, path } = await project();
  try {
    for (const bad of ["../escaped.e2e.ts", "tests/../../escaped.e2e.ts", "/etc/passwd", "src/flow.e2e.ts", "tests/flow.ts", "tests/"]) {
      await assert.rejects(writeTestFile(path, bad, SOURCE), /tests\/|file name|Name the test file|\.e2e\.ts/, `${bad} must be refused`);
    }
    // Nothing escaped into the project root or above it.
    assert.equal(await readFile(join(root, "escaped.e2e.ts"), "utf-8").catch(() => undefined), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a symlinked tests folder is refused rather than followed", async () => {
  const { root, path } = await project();
  try {
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(path, "tests"));
    await assert.rejects(writeTestFile(path, "tests/flow.e2e.ts", SOURCE), /symbolic link/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a folder that is not an e2e project cannot be written to", async () => {
  const { root, path } = await project();
  try {
    const other = join(root, "not-a-project");
    await mkdir(other);
    await assert.rejects(writeTestFile(other, "tests/flow.e2e.ts", SOURCE), /no e2e.config.ts/);
    assert.ok(path);
  } finally { await rm(root, { recursive: true, force: true }); }
});
