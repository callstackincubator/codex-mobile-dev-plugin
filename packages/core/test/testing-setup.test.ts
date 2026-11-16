import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerTestingSetup, applyTestingSetup, cancelTestingSetup, planTestingSetup, setupConfigSource, startTestingLogin, testingSetupProgress } from "../src/testing-setup.ts";

const options = {
  targets: [
    { name: "ios", platform: "ios" as const, bundleId: "com.example.app" },
    { name: "android", platform: "android" as const, bundleId: "com.example.app" },
  ],
  provider: "none" as const,
  installDependencies: false,
  installSkill: false,
  registerMcp: false,
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), "testing-setup-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true }, null, 2) + "\n");
  return root;
}

async function terminal(id: string) {
  for (let index = 0; index < 200; index++) {
    const operation = testingSetupProgress(id)!;
    if (!["running", "waiting"].includes(operation.status)) return operation;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("operation did not finish");
}

test("the setup preview is immutable and apply creates a complete mobile scaffold", async () => {
  const root = await project();
  try {
    const plan = await planTestingSetup(root, options);
    assert.equal(await readFile(join(root, "e2e.config.ts"), "utf8").catch(() => undefined), undefined, "preview writes nothing");
    assert.ok(plan.actions.some(action => action.path === "e2e.config.ts" && action.action === "create"));
    const started = applyTestingSetup(plan.id);
    const done = await terminal(started.id);
    assert.equal(done.status, "succeeded");
    const config = await readFile(join(root, "e2e.config.ts"), "utf8");
    assert.match(config, /platform: "ios"/);
    assert.match(config, /platform: "android"/);
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(manifest.scripts["test:e2e"], "e2e run");
    assert.equal(manifest.devDependencies.e2e, "^0.17.0");
    assert.match(await readFile(join(root, ".gitignore"), "utf8"), /\.e2e\/artifacts\//);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("setup preserves an existing config and refuses a stale plan", async () => {
  const root = await project();
  try {
    await writeFile(join(root, "e2e.config.ts"), "// user config\n");
    const plan = await planTestingSetup(root, options);
    assert.ok(plan.actions.some(action => action.path === "e2e.config.ts" && action.action === "skip"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "changed" }));
    const done = await terminal(applyTestingSetup(plan.id).id);
    assert.equal(done.status, "failed");
    assert.match(done.message, /changed after the preview/);
    assert.equal(await readFile(join(root, "e2e.config.ts"), "utf8"), "// user config\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a setup can be cancelled before writes and reports partial work instead of rolling it back", async () => {
  const root = await project();
  try {
    const plan = await planTestingSetup(root, { ...options, installDependencies: true });
    const started = applyTestingSetup(plan.id);
    assert.equal(cancelTestingSetup(started.id), true);
    const done = await terminal(started.id);
    assert.equal(done.status, "cancelled");
    assert.ok(Array.isArray(done.applied));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("subscription login is driven through E2E callbacks and keeps prompt answers in memory", async () => {
  let received = "";
  const started = startTestingLogin("openai", async (_provider, callbacks) => {
    callbacks.onAuth({ url: "https://example.test/login", instructions: "Open the browser", userCode: "ABCD" });
    received = await callbacks.onPrompt({ message: "Paste the code", placeholder: "code" });
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const waiting = testingSetupProgress(started.id)!;
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.auth?.userCode, "ABCD");
  assert.equal(answerTestingSetup(started.id, "synthetic-code"), true);
  const done = await terminal(started.id);
  assert.equal(done.status, "succeeded");
  assert.equal(received, "synthetic-code");
});

test("generated config includes only a chosen supported provider", () => {
  const source = setupConfigSource({ ...options, provider: "chatgpt", model: "gpt-6-luna" });
  assert.match(source, /e2e\/oauth\/chatgpt/);
  assert.match(source, /chatgpt\("gpt-6-luna"\)/);
  assert.doesNotMatch(source, /API_KEY/);
});
