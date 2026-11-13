import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestDraftStore } from "../src/testing-drafts.ts";
import type { RecordedStep } from "@mobile-dev/shared/test-recording.ts";

const PROJECT = "/Users/someone/projects/expoapp";

function steps(count: number): RecordedStep[] {
  return Array.from({ length: count }, (unused, index) => ({
    id: `step-${index}`,
    label: `Tap "Explore ${index}" (tab)`,
    kind: "tap" as const,
    selector: { kind: "role" as const, role: "tab", name: `Explore ${index}` },
  }));
}

async function store() {
  return new TestDraftStore(await mkdtemp(join(tmpdir(), "mobile-dev-drafts-")));
}

test("keeps a recording and reads its steps back", async () => {
  const drafts = await store();
  const saved = await drafts.save({ projectPath: PROJECT, title: "the explore screen", steps: steps(3) });
  assert.equal(saved.steps.length, 3);
  const read = await drafts.read(saved.id);
  assert.deepEqual(read?.steps, steps(3));
  assert.equal(read?.title, "the explore screen");
  assert.equal(read?.origin, "user");
});

test("keeps edited source as the authority for a reopened draft", async () => {
  const drafts = await store();
  const source = 'test("edited", async ({ screen }) => {\n  await screen.getByText("Done").tap();\n});';
  const saved = await drafts.save({ projectPath: PROJECT, title: "edited", steps: steps(1), source });
  assert.equal((await drafts.read(saved.id))?.source, source);
  assert.equal((await drafts.list(PROJECT))[0]?.stepCount, 1);
});

test("replaces a draft in place rather than listing it twice", async () => {
  const drafts = await store();
  const first = await drafts.save({ projectPath: PROJECT, title: "a flow", steps: steps(1) });
  const second = await drafts.save({ id: first.id, projectPath: PROJECT, title: "a flow", steps: steps(4) });
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  const listed = await drafts.list(PROJECT);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].stepCount, 4);
});

test("lists one project's drafts, newest first, and leaves another project's alone", async () => {
  const drafts = await store();
  const old = await drafts.save({ projectPath: PROJECT, title: "older", steps: steps(1) });
  // Written second, so it is the newer of the two whatever the clock's resolution is.
  await new Promise(resolve => setTimeout(resolve, 5));
  const recent = await drafts.save({ projectPath: PROJECT, title: "newer", steps: steps(2) });
  await drafts.save({ projectPath: "/Users/someone/projects/other", title: "elsewhere", steps: steps(1) });
  const listed = await drafts.list(PROJECT);
  assert.deepEqual(listed.map(entry => entry.id), [recent.id, old.id]);
  assert.equal((await drafts.list()).length, 3);
});

test("a trailing slash is the same project", async () => {
  const drafts = await store();
  await drafts.save({ projectPath: `${PROJECT}/`, title: "a flow", steps: steps(1) });
  assert.equal((await drafts.list(PROJECT)).length, 1);
});

test("deleting one forgets it and says whether it was there", async () => {
  const drafts = await store();
  const saved = await drafts.save({ projectPath: PROJECT, title: "a flow", steps: steps(1) });
  assert.equal(await drafts.remove(saved.id), true);
  assert.equal(await drafts.remove(saved.id), false);
  assert.equal(await drafts.read(saved.id), undefined);
  assert.deepEqual(await drafts.list(PROJECT), []);
});

test("an unreadable file is skipped rather than taking the list down", async () => {
  const drafts = await store();
  const saved = await drafts.save({ projectPath: PROJECT, title: "a flow", steps: steps(1) });
  await writeFile(join(drafts.directory, "99999999-9999-4999-8999-999999999999.json"), "{ truncated", "utf-8");
  const listed = await drafts.list(PROJECT);
  assert.deepEqual(listed.map(entry => entry.id), [saved.id]);
});

test("a flow with no steps is refused, and a project path is required", async () => {
  const drafts = await store();
  await assert.rejects(() => drafts.save({ projectPath: PROJECT, title: "empty", steps: [] }), /Record a step/);
  await assert.rejects(() => drafts.save({ projectPath: "  ", title: "no project", steps: steps(1) }), /project folder/);
});

test("the oldest drafts are dropped past the cap", async () => {
  const drafts = await store();
  for (let index = 0; index < 33; index += 1) {
    await drafts.save({ projectPath: PROJECT, title: `flow ${index}`, steps: steps(1) });
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  const files = (await readdir(drafts.directory)).filter(name => name.endsWith(".json"));
  assert.equal(files.length, 30);
  const listed = await drafts.list(PROJECT);
  assert.equal(listed[0].title, "flow 32");
  assert.ok(!listed.some(entry => entry.title === "flow 0"));
});

test("an agent's steps round-trip, instructions and params included", async () => {
  const drafts = await store();
  const flow: RecordedStep[] = [
    { id: "a", label: "Act", kind: "agentAct", instruction: "dismiss the onboarding sheet", params: { city: "Paris" } },
    { id: "b", label: "Assert", kind: "agentAssert", instruction: "the heatmap is shown", vision: "only" },
    { id: "c", label: "Fill", kind: "fill", selector: { kind: "placeholder", placeholder: "Search reviews" }, value: "quiet" },
    { id: "d", label: "Tap", kind: "tap", selector: { kind: "nth", inner: { kind: "text", text: "Paris" }, index: 1, matches: 2 } },
    { id: "e", label: "Swipe", kind: "swipe", selector: { kind: "point", point: { x: 10, y: 20 } }, direction: "left",
      anchor: { kind: "testId", testId: "list" }, ambiguous: true, target: { role: "other", text: "Paris" } },
  ];
  const saved = await drafts.save({ projectPath: PROJECT, title: "agent flow", origin: "agent", steps: flow });
  assert.deepEqual((await drafts.read(saved.id))?.steps, flow);
  assert.equal((await drafts.list(PROJECT))[0].origin, "agent");
});
