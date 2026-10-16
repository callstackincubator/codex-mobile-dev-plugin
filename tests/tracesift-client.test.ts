import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TraceSiftClient, TraceSiftError } from "../src/server/tracesift-client.ts";

const token = "integration-token-long-enough";
const instance = "service-instance";
const card = {
  id: "task-0", taskIndex: 0, startMs: 4, durationMs: 80, boundaries: "tasks", headline: "A measured task",
  percentOfProfile: 40, boundaryFrames: [{ name: "render", location: "src/Screen.tsx:20", nodeId: "b1", totalMs: 60, selfMs: 2, invocations: 2,
    longestCallMs: 40, shapeText: "ran 2 times in this task · 60 ms total · longest single call 40 ms",
    culprits: [{ name: "formatRow", frameClass: "app", nodeId: "c1", totalMs: 44, selfMs: 44, invocations: 12,
      longestCallMs: 9, shapeText: "ran 12 times · 44 ms total", callers: ["render"] }],
    inside: [{ name: "buildRows", frameClass: "app", nodeId: "i1", totalMs: 48, selfMs: 1, invocations: 2,
      longestCallMs: 30, shapeText: "ran 2 times · 48 ms total" }] }], boundaryTailCount: 0, boundaryTailMs: 0,
  outsideBoundariesMs: 5, culprits: [{ name: "render", frameClass: "app", selfMs: 50, totalMs: 60,
    invocations: 2, longestCallMs: 40, shapeText: "2 calls · 60 ms", nodeId: "1", callers: [], reachedVia: [], hotPath: [] }],
  subtreeFunctionCount: 1, confidence: "ok",
};

async function fixture(mode = 0o600, healthInstance = instance) {
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-tracesift-"));
  let currentHealthInstance = healthInstance;
  const requests: Array<{ path: string; authorization?: string; body?: string }> = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    requests.push({ path, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end('{"error":"Unauthorized"}'); return; }
    if (path.endsWith("/health")) response.end(JSON.stringify({ apiVersion: 1, instance: currentHealthInstance }));
    else if (path.endsWith("/analyze")) response.end(JSON.stringify({ apiVersion: 1, analysisId: "analysis-1", profileType: "cpu", title: "Profile", summary: { totalMs: 200, callCountIsExact: true, profileFunctions: { private: "removed" } }, cards: [card] }));
    else if (path.endsWith("/task")) {
      const query = new URL(request.url!, "http://localhost").searchParams;
      requests.at(-1)!.body = query.toString();
      response.end(JSON.stringify({ apiVersion: 1, analysisId: "analysis-1", totalMs: 200, title: "Profile",
        card: { ...card, tree: { id: "n0", name: "render", frameClass: "app", totalMs: 60, selfMs: 2, invocations: 2, children: [] },
          timeline: { boxes: [], durationMs: 80, coveredMs: 60, rows: 1, kept: ["app"], omittedBoxCount: 0, omittedBoxMs: 0 } } }));
    }
    else if (path.endsWith("/react-explore")) response.end(JSON.stringify({ apiVersion: 1, analysisId: "analysis-1", title: "Profile", explore: { commits: [{ index: 0 }] }, cards: [{ id: "react-commit-1-0" }] }));
    else if (path.endsWith("/handoff")) { let body = ""; for await (const chunk of request) body += chunk; requests.at(-1)!.body = body; response.end(JSON.stringify({ apiVersion: 1, handoff: "Investigate render using the measured stack." })); }
    else response.writeHead(404).end('{}');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address() as { port: number };
  const descriptor = { version: "1.2.3", apiVersion: 1, pid: process.pid, childPid: process.pid, instance, baseUrl: `http://127.0.0.1:${address.port}`, token, startedAt: Date.now() };
  const service = join(home, "service.json");
  await writeFile(service, JSON.stringify(descriptor), { mode }); await chmod(service, mode);
  return { home, requests, server, setHealthInstance(value: string) { currentHealthInstance = value; }, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test("TraceSift client reuses an authenticated service and preserves measured cards", async t => {
  const fake = await fixture(); t.after(fake.close);
  const profile = join(fake.home, "cpu profile.json"); await writeFile(profile, "{}");
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  const analysis = await client.analyze(profile, "auto");
  assert.equal(analysis.profileType, "cpu"); assert.equal(analysis.cards[0].headline, "A measured task");
  assert.equal("tree" in analysis.cards[0], false); assert.equal("timeline" in analysis.cards[0], false);
  assert.equal("profileFunctions" in analysis.summary, false);
  assert.equal(await client.handoff("analysis-1", "task-0"), "Investigate render using the measured stack.");
  assert.ok(fake.requests.every(request => request.authorization === `Bearer ${token}`));
  assert.deepEqual(JSON.parse(fake.requests.at(-1)!.body!), { analysisId: "analysis-1", cardId: "task-0" });
});

test("TraceSift client persists compact findings and invokes the Explore CLI without fetching task data", async t => {
  const fake = await fixture(); t.after(fake.close);
  const profile = join(fake.home, "cpu profile.json"); await writeFile(profile, "{}");
  const argsPath = join(fake.home, "explore-args.txt");
  const command = join(fake.home, "tracesift-test");
  await writeFile(command, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsPath)}\n`, { mode: 0o755 });
  await chmod(command, 0o755);
  const previousCommand = process.env.TRACE_SIFT_COMMAND;
  process.env.TRACE_SIFT_COMMAND = command;
  t.after(() => { if (previousCommand === undefined) delete process.env.TRACE_SIFT_COMMAND; else process.env.TRACE_SIFT_COMMAND = previousCommand; });
  const client = new TraceSiftClient(undefined, fake.home); t.after(() => client.close());
  await client.analyze(profile, "auto");
  await client.openExplore("analysis-1", 0, "b1");
  const args = (await readFile(argsPath, "utf8")).trim().split("\n");
  assert.equal(args[0], "explore");
  assert.equal((await stat(args[1])).mode & 0o777, 0o600);
  const persisted = JSON.parse(await readFile(args[1], "utf8"));
  assert.equal(persisted.analysisId, "analysis-1");
  assert.equal("tree" in persisted.cards[0], false);
  assert.deepEqual(args.slice(2), ["--task", "0", "--focus", "b1"]);
  assert.ok(fake.requests.every(request => request.authorization === `Bearer ${token}`));

  await client.openReactExplore("analysis-1", 7, 12);
  const reactArgs = (await readFile(argsPath, "utf8")).trim().split("\n");
  assert.deepEqual(reactArgs.slice(2), ["--commit", "7.12"]);
});

test("TraceSift client fetches one task's full tree through the integration API", async t => {
  const fake = await fixture(); t.after(fake.close);
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  const handoff = await client.exploreTask("analysis-1", 0);
  assert.equal(handoff.analysisId, "analysis-1");
  assert.equal(handoff.profileTitle, "Profile");
  assert.equal((handoff.card as { tree: { id: string } }).tree.id, "n0");
  const request = fake.requests.find(entry => entry.path.endsWith("/task"));
  assert.equal(request?.body, "analysisId=analysis-1&taskIndex=0");
  assert.equal(request?.authorization, `Bearer ${token}`);
});

test("TraceSift client fetches a React commit timeline and keeps its shape only at the seams", async t => {
  const fake = await fixture(); t.after(fake.close);
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  const handoff = await client.exploreReact("analysis-1");
  assert.equal(handoff.profileTitle, "Profile");
  assert.deepEqual(handoff.explore, { commits: [{ index: 0 }] });
  assert.deepEqual(handoff.cards, [{ id: "react-commit-1-0" }]);
  assert.ok(fake.requests.some(entry => entry.path.endsWith("/react-explore")));
});

test("TraceSift client refuses a task response with no tree to explore", async t => {
  const fake = await fixture(); t.after(fake.close);
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  const original = fake.server.listeners("request")[0] as (...args: unknown[]) => void;
  fake.server.removeAllListeners("request");
  fake.server.on("request", (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    if (path.endsWith("/task")) { response.setHeader("Content-Type", "application/json").end(JSON.stringify({ apiVersion: 1, analysisId: "analysis-1", totalMs: 1, title: "P", card: { id: "task-0" } })); return; }
    if (path.endsWith("/health")) { response.setHeader("Content-Type", "application/json").end(JSON.stringify({ apiVersion: 1, instance })); return; }
    void original(request, response);
  });
  await assert.rejects(client.exploreTask("analysis-1", 0), /invalid task response/);
});

test("TraceSift client keeps the expired-analysis error the card can act on", async t => {
  const fake = await fixture(); t.after(fake.close);
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  const original = fake.server.listeners("request")[0] as (...args: unknown[]) => void;
  fake.server.removeAllListeners("request");
  fake.server.on("request", (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    if (path.endsWith("/task")) { response.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"This analysis is no longer available (it may have expired)."}'); return; }
    void original(request, response);
  });
  await assert.rejects(client.exploreTask("gone", 0), (error: unknown) => error instanceof TraceSiftError && /no longer available/.test(error.message));
});

test("TraceSift client restores the analysis registered for a stable host view after restart", async t => {
  const fake = await fixture(); t.after(fake.close);
  const profile = join(fake.home, "cpu profile.json"); await writeFile(profile, "{}");
  const first = new TraceSiftClient("missing-tracesift", fake.home);
  const result = await first.analyze(profile, "auto");
  await first.remember("tool-view-17", result.analysisId);
  await first.close();

  const restarted = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => restarted.close());
  const restored = await restarted.restore("tool-view-17");
  assert.equal(restored?.analysisId, "analysis-1");
  assert.equal(restored?.cards[0].headline, "A measured task");
  assert.equal(await restarted.restore("another-tool-view"), undefined);
});

test("TraceSift client restores an analysis from replayed profile input when host view IDs are unavailable", async t => {
  const fake = await fixture(); t.after(fake.close);
  const profile = join(fake.home, "cpu profile.json"); await writeFile(profile, "{}");
  const first = new TraceSiftClient("missing-tracesift", fake.home);
  await first.analyze(profile, "auto");
  await first.close();

  const restarted = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => restarted.close());
  assert.equal((await restarted.restoreInput(profile, "auto"))?.analysisId, "analysis-1");
  assert.equal(await restarted.restoreInput(profile, "cpu"), undefined);
});

test("TraceSift client rejects unsafe descriptors without starting a CLI", async t => {
  const fake = await fixture(0o644); t.after(fake.close);
  const profile = join(fake.home, "profile.json"); await writeFile(profile, "{}");
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  await assert.rejects(client.analyze(profile, "auto"), (error: unknown) => error instanceof TraceSiftError && /permissions/.test(error.message));
});

test("TraceSift client validates profile paths before service startup", async () => {
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-tracesift-"));
  const client = new TraceSiftClient("missing-tracesift", home);
  await assert.rejects(client.analyze(join(home, "absent.json"), "auto"), /does not exist or is not readable/);
});

test("TraceSift client requires health identity to match service.json", async t => {
  const fake = await fixture(0o600, "different-instance"); t.after(fake.close);
  const profile = join(fake.home, "profile.json"); await writeFile(profile, "{}");
  const client = new TraceSiftClient("definitely-missing-tracesift", fake.home); t.after(() => client.close());
  await assert.rejects(client.analyze(profile, "auto"), /could not start|not installed/);
});

test("TraceSift startup loser waits for the winning service descriptor", async t => {
  const fake = await fixture(0o600, "not-ready"); t.after(fake.close);
  const profile = join(fake.home, "profile.json"); await writeFile(profile, "{}");
  const command = join(fake.home, "tracesift-race");
  await writeFile(command, "#!/bin/sh\necho 'Another TraceSift operation is recovering its lock. Retry shortly.' >&2\nexit 1\n", { mode: 0o755 });
  await chmod(command, 0o755);
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());
  setTimeout(() => fake.setHealthInstance(instance), 300);
  const result = await client.analyze(profile, "auto");
  assert.equal(result.analysisId, "analysis-1");
});
