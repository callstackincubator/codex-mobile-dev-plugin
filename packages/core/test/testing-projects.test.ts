import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteTestFile, findConfig, inspectProject, listTestFiles, parseTargets, readTestFile, TestingProjectChoices, writeTestFile } from "../src/testing-projects.ts";

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

test("the project's own tests are listed, newest first, and nothing else is", async () => {
  const { root, path } = await project();
  try {
    // Nothing saved yet is an empty list, not an error: there is no tests/ folder at all.
    assert.deepEqual(await listTestFiles(path), []);

    await writeTestFile(path, "tests/first.e2e.ts", SOURCE);
    await writeTestFile(path, "tests/checkout/pay.e2e.ts", SOURCE);
    // Not a recorded test, and not listed: the panel's list is of tests, not of the folder.
    await writeFile(join(path, "tests", "helpers.ts"), SOURCE, "utf-8");
    // Written last, so it is first: the list is ordered by when each file was written.
    await writeFile(join(path, "tests", "latest.e2e.ts"), SOURCE, "utf-8");

    const listed = await listTestFiles(path);
    assert.deepEqual([...listed].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map(entry => entry.relativePath),
    ["tests/checkout/pay.e2e.ts", "tests/first.e2e.ts", "tests/latest.e2e.ts"]);
    assert.deepEqual(listed.map(entry => entry.updatedAt), [...listed.map(entry => entry.updatedAt)].sort().reverse(),
      "newest first");
    const first = listed.find(entry => entry.name === "first.e2e.ts")!;
    assert.equal(first.sizeBytes, Buffer.byteLength(SOURCE, "utf-8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a project test can be previewed without reading outside tests", async () => {
  const { root, path } = await project();
  try {
    await writeTestFile(path, "tests/flow.e2e.ts", SOURCE);
    assert.equal(await readTestFile(path, "tests/flow.e2e.ts"), SOURCE);
    await assert.rejects(readTestFile(path, "tests/missing.e2e.ts"), /no longer there/);
    await assert.rejects(readTestFile(path, "tests/../../outside.e2e.ts"), /file name|tests\//);
    await writeFile(join(path, "tests", "oversized.e2e.ts"), "x".repeat(256 * 1024 + 1));
    await assert.rejects(readTestFile(path, "tests/oversized.e2e.ts"), /too large/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a symlink under tests is skipped rather than followed out of the project", async () => {
  const { root, path } = await project();
  try {
    await writeTestFile(path, "tests/flow.e2e.ts", SOURCE);
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "elsewhere.e2e.ts"), SOURCE, "utf-8");
    await symlink(outside, join(path, "tests", "linked"));
    await symlink(join(outside, "elsewhere.e2e.ts"), join(path, "tests", "linked.e2e.ts"));

    assert.deepEqual((await listTestFiles(path)).map(entry => entry.relativePath), ["tests/flow.e2e.ts"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("one of the project's tests can be deleted, and only from inside tests/", async () => {
  const { root, path } = await project();
  try {
    await writeTestFile(path, "tests/flow.e2e.ts", SOURCE);
    await writeFile(join(root, "outside.e2e.ts"), SOURCE, "utf-8");

    const removed = await deleteTestFile(path, "tests/flow.e2e.ts");
    assert.equal(removed.removed, true);
    assert.equal(removed.path, join(path, "tests", "flow.e2e.ts"));
    assert.deepEqual(await listTestFiles(path), []);

    // A file that is already gone is not an error: the list the user clicked may be out of date.
    assert.equal((await deleteTestFile(path, "tests/flow.e2e.ts")).removed, false);

    // The same boundary the write goes through, so a delete cannot climb out of the folder.
    for (const bad of ["../outside.e2e.ts", "tests/../../outside.e2e.ts", "src/flow.e2e.ts", "tests/flow.ts"]) {
      await assert.rejects(deleteTestFile(path, bad), /tests\/|file name|\.e2e\.ts/, `${bad} must be refused`);
    }
    assert.ok(await readFile(join(root, "outside.e2e.ts"), "utf-8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
