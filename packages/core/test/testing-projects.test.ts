import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteTestFile, discardStagedTestFile, findConfig, inspectProject, listTestFiles, parseTargets, previewTestFile, readTestFile, resolveTestRunPaths, saveStagedTestFile, stageTestFile, readTestTarget, studioWorkspacePath, TestingProjectChoices, writeTestTarget, writeTestFile, storedTestsChangeRevision } from "../src/testing-projects.ts";

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

async function installCompatibleRuntime(path: string, versions = { e2e: "0.17.0", mobile: "0.9.2" }) {
  await mkdir(join(path, "node_modules/.bin"), { recursive: true });
  await mkdir(join(path, "node_modules/e2e"), { recursive: true });
  await mkdir(join(path, "node_modules/@e2e-dev/mobile/dist"), { recursive: true });
  await writeFile(join(path, "node_modules/.bin/e2e"), "");
  await writeFile(join(path, "node_modules/e2e/package.json"), JSON.stringify({ version: versions.e2e }));
  await writeFile(join(path, "node_modules/@e2e-dev/mobile/package.json"), JSON.stringify({ version: versions.mobile }));
  await writeFile(join(path, "node_modules/@e2e-dev/mobile/dist/nodes.js"), "export {};\n");
}

test("a configured project on another e2e version still uses its own runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-projects-"));
  try {
    await writeFile(join(root, "e2e.config.ts"), CONFIG, "utf-8");
    await installCompatibleRuntime(root, { e2e: "0.23.0", mobile: "0.12.6" });
    const inspected = await inspectProject(root);
    assert.equal(inspected.runtimeMode, "project");
    assert.equal(inspected.runtime.e2eVersion, "0.23.0");
    assert.equal(inspected.runtime.root, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a configured project without an installed e2e CLI falls back to bundled mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-projects-"));
  try {
    await writeFile(join(root, "e2e.config.ts"), CONFIG, "utf-8");
    const inspected = await inspectProject(root);
    assert.equal(inspected.runtimeMode, "bundled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configured projects stay authoritative and folders without config use bundled mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-projects-"));
  try {
    const project = join(root, "app");
    const empty = join(root, "empty");
    await mkdir(project);
    await mkdir(empty);
    await writeFile(join(project, "e2e.config.ts"), CONFIG, "utf-8");
    await installCompatibleRuntime(project);
    await writeFile(join(empty, "app.json"), JSON.stringify({ expo: { ios: { bundleIdentifier: "com.example.empty" } } }));

    assert.equal(await findConfig(project), join(project, "e2e.config.ts"));
    assert.equal(await findConfig(empty), undefined);

    const inspected = await inspectProject(project);
    assert.equal(inspected.name, "app");
    assert.equal(inspected.targets.at(-1)?.bundleId, "com.anonymous.expoapp57");
    assert.equal(inspected.runtimeMode, "project");

    const choices = new TestingProjectChoices(join(root, "state"), async () => empty);
    const zeroSetup = await inspectProject(empty);
    assert.equal(zeroSetup.runtimeMode, "bundled");
    assert.equal(zeroSetup.targets[0]?.bundleId, "com.example.empty");
    await choices.record(empty);
    await choices.record(project);
    assert.deepEqual(new Set((await choices.list()).map(entry => entry.path)), new Set([project, empty]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


async function project(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "testing-write-"));
  const path = join(root, "app");
  await mkdir(path);
  await writeFile(join(path, "e2e.config.ts"), CONFIG, "utf-8");
  await installCompatibleRuntime(path);
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

test("a run accepts only an existing test and the selected project's config", async () => {
  const { root, path } = await project();
  try {
    await writeTestFile(path, "tests/flow.e2e.ts", SOURCE);
    assert.deepEqual(await resolveTestRunPaths(path, "tests/flow.e2e.ts", join(path, "e2e.config.ts")), {
      projectPath: path,
      relativePath: "tests/flow.e2e.ts",
      configPath: join(path, "e2e.config.ts"),
    });
    await assert.rejects(resolveTestRunPaths(path, "../outside.e2e.ts"), /tests\//);
    await assert.rejects(resolveTestRunPaths(path, "tests/missing.e2e.ts"), /no longer there/);
    await writeFile(join(path, "other.config.ts"), "throw new Error('ran arbitrary code')\n");
    await assert.rejects(resolveTestRunPaths(path, "tests/flow.e2e.ts", join(path, "other.config.ts")), /own e2e config/);
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

test("a folder without project setup saves into Testing Studio state without modifying the project", async () => {
  const { root, path } = await project();
  const previous = process.env.MOBILE_DEV_TESTING_DIRECTORY;
  try {
    process.env.MOBILE_DEV_TESTING_DIRECTORY = join(root, "studio-state");
    const other = join(root, "not-a-project");
    await mkdir(other);
    const saved = await writeTestFile(other, "tests/flow.e2e.ts", SOURCE);
    assert.equal(saved.written, true);
    assert.equal(await readFile(join(other, "tests/flow.e2e.ts"), "utf8").catch(() => undefined), undefined);
    assert.equal(await readTestFile(other, "tests/flow.e2e.ts"), SOURCE);
    assert.ok(path);
  } finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TESTING_DIRECTORY;
    else process.env.MOBILE_DEV_TESTING_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("the Testing Studio workspace needs no project: it is created on demand, bundled, and not listed as a project", async () => {
  const { root } = await project();
  const previous = process.env.MOBILE_DEV_TESTING_DIRECTORY;
  try {
    process.env.MOBILE_DEV_TESTING_DIRECTORY = join(root, "studio-state");
    const studio = studioWorkspacePath();
    assert.ok(studio.startsWith(join(root, "studio-state")));
    const inspected = await inspectProject(studio, { platform: "ios", bundleId: "com.anonymous.expoapp57" });
    assert.equal(inspected.runtimeMode, "bundled");
    assert.deepEqual(inspected.targets, [{ name: "ios", platform: "ios", bundleId: "com.anonymous.expoapp57" }]);
    assert.equal((await writeTestFile(studio, "tests/flow.e2e.ts", SOURCE)).written, true);
    assert.equal(await readTestFile(studio, "tests/flow.e2e.ts"), SOURCE);
    assert.equal(await readFile(join(studio, "tests/flow.e2e.ts"), "utf8").catch(() => undefined), undefined, "tests stay in Mobile Dev's state");
    const choices = new TestingProjectChoices(join(root, "choices"));
    await choices.record(studio);
    assert.deepEqual(await choices.list(), []);
  } finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TESTING_DIRECTORY;
    else process.env.MOBILE_DEV_TESTING_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("every write to a stored test or its pinned app moves the change revision the panel polls", async () => {
  const { root } = await project();
  const previous = process.env.MOBILE_DEV_TESTING_DIRECTORY;
  try {
    process.env.MOBILE_DEV_TESTING_DIRECTORY = join(root, "studio-state");
    const studio = studioWorkspacePath();
    let seen = storedTestsChangeRevision();
    const moved = () => { const now = storedTestsChangeRevision(); const did = now > seen; seen = now; return did; };
    await writeTestFile(studio, "tests/flow.e2e.ts", SOURCE);
    assert.ok(moved(), "a new file");
    await writeTestFile(studio, "tests/flow.e2e.ts", SOURCE, false);
    assert.ok(!moved(), "a refused overwrite changes nothing");
    await writeTestFile(studio, "tests/flow.e2e.ts", SOURCE + "\n", true);
    assert.ok(moved(), "a rewrite such as branch_line");
    await writeTestTarget(studio, "tests/flow.e2e.ts", { platform: "ios", bundleId: "com.a" });
    assert.ok(moved(), "a pin");
    await writeTestTarget(studio, "tests/flow.e2e.ts", { platform: "android", bundleId: "com.b" }, "add");
    assert.ok(moved(), "an added app");
    await deleteTestFile(studio, "tests/flow.e2e.ts");
    assert.ok(moved(), "a delete");
  } finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TESTING_DIRECTORY;
    else process.env.MOBILE_DEV_TESTING_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a Testing Studio test is pinned to its app beside the source, listed, re-pinned and cleared on delete", async () => {
  const { root } = await project();
  const previous = process.env.MOBILE_DEV_TESTING_DIRECTORY;
  try {
    process.env.MOBILE_DEV_TESTING_DIRECTORY = join(root, "studio-state");
    const studio = studioWorkspacePath();
    await assert.rejects(writeTestTarget(studio, "tests/flow.e2e.ts", { platform: "ios", bundleId: "com.a" }), /Save the test/);
    await writeTestFile(studio, "tests/flow.e2e.ts", SOURCE);
    assert.equal(await readTestTarget(studio, "tests/flow.e2e.ts"), undefined);
    assert.equal(await writeTestTarget(studio, "tests/flow.e2e.ts", { platform: "ios", bundleId: "com.a" }), true);
    assert.deepEqual(await readTestTarget(studio, "tests/flow.e2e.ts"), { platform: "ios", bundleId: "com.a" });
    assert.deepEqual((await listTestFiles(studio))[0]?.target, { platform: "ios", bundleId: "com.a" });
    assert.equal(await readTestFile(studio, "tests/flow.e2e.ts"), SOURCE, "the source carries no target");
    await writeTestTarget(studio, "tests/flow.e2e.ts", { platform: "android", bundleId: "com.b" });
    assert.deepEqual(await readTestTarget(studio, "tests/flow.e2e.ts"), { platform: "android", bundleId: "com.b" });
    // Adding an app for the other platform keeps the recorded one, and re-pinning the recorded
    // platform keeps the added one.
    await writeTestTarget(studio, "tests/flow.e2e.ts", { platform: "ios", bundleId: "com.c" }, "add");
    assert.deepEqual(await readTestTarget(studio, "tests/flow.e2e.ts"), { platform: "android", bundleId: "com.b", apps: { ios: "com.c" } });
    await writeTestTarget(studio, "tests/flow.e2e.ts", { platform: "android", bundleId: "com.d" });
    assert.deepEqual(await readTestTarget(studio, "tests/flow.e2e.ts"), { platform: "android", bundleId: "com.d", apps: { ios: "com.c" } });
    await deleteTestFile(studio, "tests/flow.e2e.ts");
    await writeTestFile(studio, "tests/flow.e2e.ts", SOURCE);
    assert.equal(await readTestTarget(studio, "tests/flow.e2e.ts"), undefined, "a deleted test leaves no pin behind");
  } finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TESTING_DIRECTORY;
    else process.env.MOBILE_DEV_TESTING_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled mode lists only private Testing Studio tests and never leaks project tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-bundled-list-"));
  const previous = process.env.MOBILE_DEV_TESTING_DIRECTORY;
  try {
    process.env.MOBILE_DEV_TESTING_DIRECTORY = join(root, "studio-state");
    const selected = join(root, "selected");
    await mkdir(join(selected, "tests"), { recursive: true });
    await writeFile(join(selected, "tests", "project-only.e2e.ts"), SOURCE);
    assert.deepEqual(await listTestFiles(selected), [], "project files are outside bundled Testing Studio storage");

    await writeTestFile(selected, "tests/studio-only.e2e.ts", SOURCE);
    assert.deepEqual((await listTestFiles(selected)).map(entry => entry.relativePath), ["tests/studio-only.e2e.ts"]);
    assert.equal(await readFile(join(selected, "tests", "studio-only.e2e.ts"), "utf8").catch(() => undefined), undefined);
  } finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TESTING_DIRECTORY;
    else process.env.MOBILE_DEV_TESTING_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  }
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

test("saved test edits stay temporary until Save, and Undo restores the project file", async () => {
  const { root, path } = await project();
  try {
    const relativePath = "tests/flow.e2e.ts";
    await writeTestFile(path, relativePath, SOURCE);
    const opened = await previewTestFile(path, relativePath);
    await stageTestFile(path, relativePath, opened.originalHash, "edited\n");
    assert.equal(await readTestFile(path, relativePath), SOURCE, "staging never writes the project file");
    assert.deepEqual(await previewTestFile(path, relativePath), { source: "edited\n", originalHash: opened.originalHash, staged: true });
    await discardStagedTestFile(path, relativePath);
    assert.equal((await previewTestFile(path, relativePath)).source, SOURCE);

    await stageTestFile(path, relativePath, opened.originalHash, "saved\n");
    await saveStagedTestFile(path, relativePath);
    assert.equal(await readTestFile(path, relativePath), "saved\n");
    assert.equal((await previewTestFile(path, relativePath)).staged, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Save refuses to replace a project test changed outside the panel", async () => {
  const { root, path } = await project();
  try {
    const relativePath = "tests/flow.e2e.ts";
    await writeTestFile(path, relativePath, SOURCE);
    const opened = await previewTestFile(path, relativePath);
    await stageTestFile(path, relativePath, opened.originalHash, "panel edit\n");
    await writeTestFile(path, relativePath, "external edit\n", true);
    await assert.rejects(saveStagedTestFile(path, relativePath), /changed on disk/);
    assert.equal(await readTestFile(path, relativePath), "external edit\n");
    await discardStagedTestFile(path, relativePath);
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
