import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AppFlowHost,
  CodexAppFlowDecisionProvider,
  DecisionSuspendedError,
  type AppFlowDecisionRequest,
  type AppFlowHostServices,
} from "../src/server/app-flow-host.ts";
import { getProjectId } from "../src/app-flow/storage.ts";
import { AppFlowRunStore } from "../src/server/app-flow-run-store.ts";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function pending(provider: CodexAppFlowDecisionProvider): Promise<AppFlowDecisionRequest> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const next = await provider.next();
    if (next.request) return next.request;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Decision was not queued.");
}

const navigation = {
  cwd: "/project",
  systemPrompt: "Return navigation JSON.",
  userPrompt: "Choose a control.",
  tools: [] as string[],
};

describe("CodexAppFlowDecisionProvider", () => {
  it("delivers an inline screenshot and accepts only role-valid JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-"));
    temporary.push(directory);
    const imagePath = join(directory, "screen.png");
    await writeFile(imagePath, Buffer.from("png-data"));
    const provider = new CodexAppFlowDecisionProvider("247c68ed-1d66-4994-bbc3-e524251f625c", "/project");
    const outcome = provider.run({ ...navigation, imagePath }, "navigate Home step 1");
    const request = await pending(provider);
    assert.equal(request.screenshot?.data, Buffer.from("png-data").toString("base64"));
    assert.throws(() => provider.submit(request.requestId, '{"decision":"act"}'), /expected schema/);
    const response = '{"decision":"blocked","reason":"none"}';
    assert.deepEqual(provider.submit(request.requestId, response), { accepted: true, duplicate: false });
    assert.equal((await outcome).text, response);
  });

  it("rejects stale and conflicting submissions while exact duplicates are idempotent", async () => {
    const provider = new CodexAppFlowDecisionProvider("247c68ed-1d66-4994-bbc3-e524251f625c", "/project");
    const outcome = provider.run(navigation, "navigate Home step 1");
    const request = await pending(provider);
    const response = '{"decision":"blocked","reason":"none"}';
    provider.submit(request.requestId, response);
    await outcome;
    assert.deepEqual(provider.submit(request.requestId, response), { accepted: true, duplicate: true });
    assert.throws(() => provider.submit(request.requestId, '{}'), /different response/);
    assert.throws(() => provider.submit("93b3826a-6ca3-458a-9498-2a639ea8196d", response), /stale/);
  });

  it("cancels a parked request without resurrecting it", async () => {
    const provider = new CodexAppFlowDecisionProvider("247c68ed-1d66-4994-bbc3-e524251f625c", "/project");
    const outcome = provider.run(navigation, "navigate Home step 1");
    await pending(provider);
    provider.cancel();
    await assert.rejects(outcome, /Cancelled/);
    assert.deepEqual(await provider.next(), { state: "cancelled" });
  });

  it("suspends after inactivity and can be resumed", async () => {
    let suspended: DecisionSuspendedError | undefined;
    const provider = new CodexAppFlowDecisionProvider(
      "247c68ed-1d66-4994-bbc3-e524251f625c",
      "/project",
      { inactivityMs: 10, onSuspended: error => { suspended = error; } },
    );
    const outcome = provider.run(navigation, "navigate Home step 1");
    await pending(provider);
    await assert.rejects(outcome, DecisionSuspendedError);
    assert.ok(suspended);
    assert.deepEqual(await provider.next(), { state: "suspended" });
    provider.resume();
    assert.deepEqual(await provider.next(), { state: "waiting" });
  });

  it("keeps the first session briefing while compacting recent history", async () => {
    const provider = new CodexAppFlowDecisionProvider("247c68ed-1d66-4994-bbc3-e524251f625c", "/project");
    const session = await provider.createSession({
      cwd: "/project", systemPrompt: "Navigate.", tools: [], compactHistory: { keepRecentUserTurns: 2 },
    });
    for (let index = 0; index < 5; index += 1) {
      const outcome = session.prompt(
        { userPrompt: index === 0 ? "TARGET BRIEFING" : `observation ${index}` },
        `navigate step ${index + 1}`,
      );
      const request = await pending(provider);
      if (index === 4) {
        assert.deepEqual(request.history.map(item => item.request), ["TARGET BRIEFING", "observation 2", "observation 3"]);
        assert.equal(session.historyLength(), 6);
      }
      provider.submit(request.requestId, '{"decision":"blocked","reason":"test"}');
      await outcome;
    }
  });

  it("excludes host wait from the active clock", async context => {
    let now = 1_000;
    context.mock.method(Date, "now", () => now);
    const provider = new CodexAppFlowDecisionProvider("247c68ed-1d66-4994-bbc3-e524251f625c", "/project");
    const outcome = provider.run(navigation, "navigate Home step 1");
    const request = await pending(provider);
    now += 120_000;
    assert.equal(provider.activeNow(), 1_000);
    provider.submit(request.requestId, '{"decision":"blocked","reason":"none"}');
    await outcome;
    assert.equal(provider.activeNow(), 1_000);
    now += 500;
    assert.equal(provider.activeNow(), 1_500);
  });

  it("enforces the specialized auth, arrival, and runtime-screen schemas", async () => {
    const cases: Array<[string, string, string]> = [
      ["auth-gate launch", '{"verdict":"maybe","reason":"x"}', '{"verdict":"uncertain","reason":"x"}'],
      ["arrival target", '{"verdict":"match","status":"loading","reason":"x"}', '{"verdict":"match","status":"ok","reason":"x"}'],
      ["runtime-screen inspect", '{"distinct":true}', '{"distinct":true,"key":"settings","info":"Settings"}'],
    ];
    for (const [role, invalid, valid] of cases) {
      const provider = new CodexAppFlowDecisionProvider(crypto.randomUUID(), "/project");
      const outcome = provider.run(navigation, role);
      const request = await pending(provider);
      assert.throws(() => provider.submit(request.requestId, invalid), /expected schema/);
      provider.submit(request.requestId, valid);
      await outcome;
    }
  });
});

describe("launchApp", () => {
  it("raises a failed launch instead of answering a success-shaped result", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-"));
    const projectDir = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-project-"));
    temporary.push(dataDir, projectDir);
    const { createAppFlowHost } = await import("../src/server/app-flow-host.ts");
    const host = await createAppFlowHost({ dataDir });
    // A folder with no routes is the cheapest launch failure to reach without a simulator; what is
    // under test is the channel, not this particular cause. Returned as `{ ok: false }` it reached
    // the panel through `dataResult`, which never sets `isError`, so the panel took its success
    // path and the user saw a booted simulator with no app.
    await assert.rejects(
      host.services.launchApp(projectDir),
      /no supported expo router or react navigation routes/i,
    );
    await host.services.close?.();
  });

  it("keeps a local path out of the raised message", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-"));
    const projectDir = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-project-"));
    temporary.push(dataDir, projectDir);
    const { createAppFlowHost } = await import("../src/server/app-flow-host.ts");
    const host = await createAppFlowHost({ dataDir });
    // The raised error now reaches the error reporter through the tool wrapper's `safe()`.
    const error = await host.services.launchApp(projectDir).then(() => undefined, (cause: unknown) => cause);
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(projectDir), `message leaked a local path: ${error.message}`);
    await host.services.close?.();
  });
});

describe("clear", () => {
  it("rejects resumable work, then removes artifacts without losing the project registry", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-"));
    temporary.push(dataDir);
    const projectPath = "/projects/demo";
    const projectId = getProjectId(projectPath);
    const projectDir = join(dataDir, "app-flows", projectId);
    const registry = JSON.stringify([{ id: projectId, path: projectPath }]);
    await mkdir(join(projectDir, "screens"), { recursive: true });
    await Promise.all([
      writeFile(join(dataDir, "app-flows", "projects.json"), registry),
      writeFile(join(projectDir, "manifest.json"), "{}"),
      writeFile(join(projectDir, "app-flow.json"), "{}"),
      writeFile(join(projectDir, "screens", "home.png"), "screen"),
    ]);
    const runStore = new AppFlowRunStore(dataDir);
    await runStore.writeRun({ runId: "run-1", projectPath, state: "suspended", ownerPid: process.pid });
    const { createAppFlowHost } = await import("../src/server/app-flow-host.ts");
    const host = await createAppFlowHost({ dataDir });

    await assert.rejects(host.services.clear(projectPath), /stop the active app flow run/i);
    await runStore.writeRun({ runId: "run-1", projectPath, state: "completed", ownerPid: process.pid });
    assert.deepEqual(await host.services.clear(projectPath), { cleared: true, projectId });

    await assert.rejects(access(projectDir));
    assert.equal(await readFile(join(dataDir, "app-flows", "projects.json"), "utf8"), registry);
    assert.equal((await host.services.status({ projectPath })).state, "idle");
    await host.services.close?.();
  });
});

describe("AppFlowHost.start", () => {
  function host() {
    const started: Array<{ input: Record<string, unknown>; hasDecisions: boolean }> = [];
    const services = {
      async start(input: Record<string, unknown>, context: { runId: string; decisions?: unknown }) {
        started.push({ input, hasDecisions: Boolean(context.decisions) });
      },
      async pause() {}, async resume() {}, async cancel() {},
      async status() { return {}; }, async result() { return {}; },
      async screenshot() { return Buffer.alloc(0); }, async poll() { return []; },
    } as unknown as AppFlowHostServices;
    return { started, host: new AppFlowHost(services) };
  }

  it("gives a Fast sweep no decision provider, so nothing can block on a loop nobody services", async () => {
    // Fast's ladder is the render rung alone and its auth gate is skipped, so the only model role
    // left is the arrival judge — which the orchestrator degrades to `uncertain` when there is no
    // provider. Handing it one instead would queue a decision for an agent that is not listening,
    // because the panel starts a Fast sweep directly rather than through chat.
    const { started, host: subject } = host();
    const answer = await subject.start({ projectPath: "/projects/demo", mode: "screen-ui-and-structure", explorationMode: "fast" });
    assert.equal(started.at(-1)!.hasDecisions, false);
    assert.equal(answer.instructions, undefined, "no decision loop means no instructions to service one");
  });

  it("still gives every model-driven sweep its provider", async () => {
    const { started, host: subject } = host();
    for (const explorationMode of ["auto", "thorough", undefined]) {
      const answer = await subject.start({ projectPath: "/projects/demo", mode: "screen-ui-and-structure", explorationMode });
      assert.equal(started.at(-1)!.hasDecisions, true, `${explorationMode} is model-driven end to end`);
      assert.match(answer.instructions ?? "", /mobile_appflow_next_decision/);
    }
  });

  it("gives a structure-only build none, whatever exploration mode rides along", async () => {
    const { started, host: subject } = host();
    await subject.start({ projectPath: "/projects/demo", mode: "structure-only", explorationMode: "auto" });
    assert.equal(started.at(-1)!.hasDecisions, false);
  });
});
