import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CodexAppFlowDecisionProvider,
  DecisionSuspendedError,
  type AppFlowDecisionRequest,
} from "../src/server/app-flow-host.ts";

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
