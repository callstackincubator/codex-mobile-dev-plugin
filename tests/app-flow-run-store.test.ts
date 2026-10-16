import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { AppFlowRunStore } from "../src/server/app-flow-run-store.ts";
import { createAppFlowHost } from "../src/server/app-flow-host.ts";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function store(): Promise<AppFlowRunStore> {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-run-"));
  temporary.push(directory);
  return new AppFlowRunStore(directory);
}

test("a separate MCP process can recover the active run and its prompt", async () => {
  const owner = await store();
  const projectPath = "/projects/demo";
  await owner.writeRun({
    runId: "533dd84d-9564-4ebc-a7e5-425f0ee0875c",
    projectPath,
    state: "needs-user-action",
    ownerPid: process.pid,
    event: {
      type: "prompt",
      phase: "capture",
      message: "Review",
      prompt: { id: "prompt-1", kind: "review", detail: "Review this screen", screenshot: null, remaining: 2 },
    },
  });

  const recovered = await owner.readRun(projectPath);
  assert.equal(recovered?.runId, "533dd84d-9564-4ebc-a7e5-425f0ee0875c");
  assert.equal(recovered?.state, "needs-user-action");
  assert.equal((recovered?.event as { prompt?: { id?: string } })?.prompt?.id, "prompt-1");
  assert.match(recovered?.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("a legacy panel event poll can replay the durable prompt once", async () => {
  const owner = await store();
  const projectPath = "/projects/demo";
  const runId = "533dd84d-9564-4ebc-a7e5-425f0ee0875c";
  await owner.writeRun({
    runId,
    projectPath,
    state: "needs-user-action",
    ownerPid: process.pid,
    event: {
      type: "prompt",
      phase: "capture",
      message: "Review",
      prompt: { id: "prompt-1", kind: "review", detail: "Review this screen", screenshot: null, remaining: 2 },
    },
  });

  const replay = await owner.readEvent(projectPath, runId, 0);
  assert.equal((replay?.event as { type?: string }).type, "prompt");
  assert.equal(await owner.readEvent(projectPath, runId, replay?.seq ?? 0), null);
});

test("a prompt response is delivered once to the owning process", async () => {
  const relay = await store();
  const projectPath = "/projects/demo";
  const runId = "533dd84d-9564-4ebc-a7e5-425f0ee0875c";
  await relay.requestResolution(projectPath, { runId, promptId: "prompt-1", resolution: "continue" });

  assert.equal(await relay.takeResolution(projectPath, runId, "prompt-1"), "continue");
  assert.equal(await relay.takeResolution(projectPath, runId, "prompt-1"), null);
});

test("a stale prompt cannot consume a newer prompt's response", async () => {
  const relay = await store();
  const projectPath = "/projects/demo";
  const runId = "533dd84d-9564-4ebc-a7e5-425f0ee0875c";
  await relay.requestResolution(projectPath, { runId, promptId: "prompt-2", resolution: "stop" });

  assert.equal(await relay.takeResolution(projectPath, runId, "prompt-1"), null);
  assert.equal(await relay.takeResolution(projectPath, runId, "prompt-2"), "stop");
});

test("status reconciles a running record whose Codex worker exited", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-run-"));
  temporary.push(directory);
  const runStore = new AppFlowRunStore(directory);
  const projectPath = "/projects/demo";
  const runId = "533dd84d-9564-4ebc-a7e5-425f0ee0875c";
  await runStore.writeRun({
    runId,
    projectPath,
    state: "running",
    ownerPid: 2_147_483_647,
    event: { type: "step", phase: "capture", message: "Reaching route 9", completed: 9, total: 79 },
  });

  const host = await createAppFlowHost({ dataDir: directory });
  const status = await host.services.status({ projectPath });
  assert.equal(status.runId, runId);
  assert.equal(status.state, "failed");
  assert.match(status.error ?? "", /worker exited/i);
  assert.equal((status.event as { type?: string }).type, "error");
  assert.equal((await runStore.readRun(projectPath))?.state, "failed");
  await host.services.close?.();
});
