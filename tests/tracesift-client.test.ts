import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TraceSiftClient, TraceSiftError } from "../src/server/tracesift-client.ts";

const token = "integration-token-long-enough";
const instance = "service-instance";
const card = {
  id: "task-0", taskIndex: 0, startMs: 4, durationMs: 80, boundaries: "tasks", headline: "A measured task",
  percentOfProfile: 40, boundaryFrames: [{ name: "render" }], boundaryTailCount: 0, boundaryTailMs: 0,
  outsideBoundariesMs: 5, culprits: [{ name: "render", frameClass: "app", selfMs: 50, totalMs: 60,
    invocations: 2, longestCallMs: 40, shapeText: "2 calls · 60 ms", nodeId: "1", callers: [], reachedVia: [], hotPath: [] }],
  tree: {}, timeline: {}, subtreeFunctionCount: 1, confidence: "ok",
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
