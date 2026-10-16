import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { AppFlowRunStore } from "../src/server/app-flow-run-store.ts";
import { createAppFlowHost } from "../src/server/app-flow-host.ts";
import { configureAppFlowHost } from "../src/app-flow/host.ts";
import { getProjectId } from "../src/app-flow/storage.ts";
import { createSweepLog, sweepLogDir } from "../src/app-flow/sweep-log.ts";

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

async function appFlowDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-log-"));
  temporary.push(directory);
  configureAppFlowHost({ dataDir: directory, emit() {}, loadAgentDevice: async () => ({ createAgentDeviceClient: () => ({}) }) });
  return directory;
}

test("the Fast run log appends one record per node and closes with the sweep's phase summary", async () => {
  await appFlowDataDir();
  const projectId = getProjectId("/projects/demo");
  const log = await createSweepLog({ projectId, runId: "0833de792f331ff7", startedAt: new Date("2026-10-16T09:30:12.000Z") });
  assert.ok(log);
  assert.equal(basename(log.path), "fast-20261016T093012Z-0833de79.jsonl");
  assert.equal(dirname(log.path), join(sweepLogDir(projectId)));

  // The rung writes the first three parts, the orchestrator the last two — both reach the same
  // record, which is the whole reason `node(id)` is shared rather than per-caller.
  log.node("HomeTab/Profile").route("HomeTab/Profile", ["HomeTab", "Profile"]);
  log.node("HomeTab/Profile").dispatch({ ok: true, action: "navigate", reason: "Dispatched HomeTab > Profile.", ms: 118 });
  log.node("HomeTab/Profile").settle({ polls: 6, stop: "settled", ms: 340, content: 48 });
  log.node("HomeTab/Profile").verify({ path: "runtime", verdict: "match", ms: 21 });
  log.node("HomeTab/Profile").delivery({ screenshotMs: 880, pressables: 31 });
  log.node("HomeTab/Profile").finish({ status: "ok", totalMs: 1392 });
  log.node("Settings").finish({ status: "missing", totalMs: 45000 });
  await log.close(["[app-flow] sweep wall clock — 18.4s"]);

  const lines = (await readFile(log.path, "utf-8")).trim().split("\n").map(line => JSON.parse(line) as Record<string, any>);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], {
    nodeId: "HomeTab/Profile",
    routeRequested: "HomeTab/Profile",
    routeResolved: ["HomeTab", "Profile"],
    dispatch: { ok: true, action: "navigate", reason: "Dispatched HomeTab > Profile.", ms: 118 },
    settle: { polls: 6, stop: "settled", ms: 340, content: 48 },
    verify: { path: "runtime", verdict: "match", ms: 21 },
    delivery: { screenshotMs: 880, pressables: 31 },
    status: "ok",
    totalMs: 1392,
  });
  assert.equal(lines[1].nodeId, "Settings");
  assert.deepEqual(lines[2], { summary: ["[app-flow] sweep wall clock — 18.4s"] });
});

test("the run log records an unavailable transport once, however many nodes skip for it", async () => {
  await appFlowDataDir();
  const projectId = getProjectId("/projects/demo");
  const log = await createSweepLog({ projectId, runId: "11112222", startedAt: new Date("2026-10-16T10:00:00.000Z") });
  assert.ok(log);
  const reason = "No unambiguous Metro runtime supports Fast capture.";
  log.transportUnavailable(reason);
  log.transportUnavailable(reason);
  log.transportUnavailable("a later, different-looking failure");
  await log.close();

  const lines = (await readFile(log.path, "utf-8")).trim().split("\n").map(line => JSON.parse(line) as Record<string, any>);
  assert.deepEqual(lines, [{ transport: "unavailable", reason }]);
});

test("a failed run-log write disables the log once instead of costing a capture", async () => {
  await appFlowDataDir();
  const projectId = getProjectId("/projects/demo");
  const messages: string[] = [];
  let attempts = 0;
  const log = await createSweepLog({
    projectId,
    runId: "0833de792f331ff7",
    startedAt: Date.now(),
    append: async () => { attempts++; throw new Error("ENOSPC"); },
    log: message => messages.push(message),
  });
  assert.ok(log);
  log.node("A").finish({ status: "ok", totalMs: 10 });
  await log.flush();
  log.node("B").finish({ status: "ok", totalMs: 10 });
  await log.close(["summary"]);
  assert.equal(attempts, 1, "One failure disables the log rather than retrying per node.");
  assert.equal(messages.filter(message => message.includes("run log disabled")).length, 1);
});

test("the run log keeps only the newest run files", async () => {
  await appFlowDataDir();
  const projectId = getProjectId("/projects/demo");
  const directory = sweepLogDir(projectId);
  await mkdir(directory, { recursive: true });
  for (let index = 1; index <= 9; index++) {
    await writeFile(join(directory, `fast-2026010${index}T000000Z-aaaaaaa.jsonl`), "{}\n", "utf-8");
  }
  await writeFile(join(directory, "keep-me.txt"), "not a run log", "utf-8");

  const log = await createSweepLog({ projectId, runId: "0833de792f331ff7", startedAt: new Date("2026-10-16T09:30:12.000Z"), keep: 3 });
  assert.ok(log);
  log.node("A").finish({ status: "ok", totalMs: 1 });
  await log.close();

  const remaining = (await readdir(directory)).sort();
  assert.deepEqual(remaining.filter(entry => entry.endsWith(".jsonl")), [
    "fast-20260107T000000Z-aaaaaaa.jsonl",
    "fast-20260108T000000Z-aaaaaaa.jsonl",
    "fast-20260109T000000Z-aaaaaaa.jsonl",
    "fast-20261016T093012Z-0833de79.jsonl",
  ]);
  assert.ok(remaining.includes("keep-me.txt"), "Pruning touches only this run log's own files.");
});
