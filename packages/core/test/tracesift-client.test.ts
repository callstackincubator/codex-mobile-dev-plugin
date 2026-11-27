import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TraceSiftClient, TraceSiftError } from "../src/tracesift-client.ts";

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

async function fixture(mode = 0o600, healthInstance = instance, exploreRoutes = true) {
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
    else if (path.endsWith("/task") && exploreRoutes) {
      const query = new URL(request.url!, "http://localhost").searchParams;
      requests.at(-1)!.body = query.toString();
      response.end(JSON.stringify({ apiVersion: 1, analysisId: "analysis-1", totalMs: 200, title: "Profile",
        card: { ...card, tree: { id: "n0", name: "render", frameClass: "app", totalMs: 60, selfMs: 2, invocations: 2, children: [] },
          timeline: { boxes: [], durationMs: 80, coveredMs: 60, rows: 1, kept: ["app"], omittedBoxCount: 0, omittedBoxMs: 0 } } }));
    }
    else if (path.endsWith("/react-explore") && exploreRoutes) response.end(JSON.stringify({ apiVersion: 1, analysisId: "analysis-1", title: "Profile", explore: { commits: [{ index: 0 }] }, cards: [{ id: "react-commit-1-0" }] }));
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

test("TraceSift readiness distinguishes a missing CLI from other startup failures", async t => {
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-tracesift-"));
  const client = new TraceSiftClient("definitely-missing-tracesift", home); t.after(() => client.close());
  await assert.rejects(client.readyService(), (error: unknown) =>
    error instanceof TraceSiftError && error.setupReason === "missing_cli" && /npm install -g/.test(error.message));
});

test("TraceSift readiness identifies an installed CLI that still needs init", async t => {
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-tracesift-"));
  const command = join(home, "tracesift-needs-init");
  await writeFile(command, "#!/bin/sh\necho 'Run tracesift init to install the app matching this CLI release.' >&2\nexit 1\n", { mode: 0o755 });
  await chmod(command, 0o755);
  const client = new TraceSiftClient(command, home); t.after(() => client.close());
  await assert.rejects(client.readyService(), (error: unknown) =>
    error instanceof TraceSiftError && error.setupReason === "needs_init" && /tracesift init/.test(error.message));
});

test("TraceSift CLI installation pins version 0.7.0", async () => {
  const client = new TraceSiftClient("missing-tracesift");
  let command: string | undefined;
  let args: string[] | undefined;
  (client as unknown as { runSetupCommand: (executable: string, arguments_: string[]) => Promise<void> }).runSetupCommand = async (executable, arguments_) => {
    command = executable;
    args = arguments_;
  };
  await client.installCli();
  assert.equal(command, "npm");
  assert.deepEqual(args, ["install", "-g", "@callstack/tracesift@0.7.0"]);
});

test("TraceSift initialization runs the fixed init argument with its private home", async t => {
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-tracesift-"));
  const command = join(home, "tracesift-init");
  await writeFile(command, "#!/bin/sh\ntest \"$1\" = init || exit 2\ntouch \"$TRACE_SIFT_HOME/initialized\"\n", { mode: 0o755 });
  await chmod(command, 0o755);
  const client = new TraceSiftClient(command, home); t.after(() => client.close());
  await client.initialize();
  assert.equal((await stat(join(home, "initialized"))).isFile(), true);
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

test("TraceSift client names a service too old for the Explore endpoints", async t => {
  // Health only proves integration API v1, which predates `/task` and `/react-explore`; the 404 must read as an update prompt.
  const fake = await fixture(0o600, instance, false); t.after(fake.close);
  const profile = join(fake.home, "profile.json"); await writeFile(profile, "{}");
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  await client.analyze(profile, "auto");
  const requests = [
    () => client.exploreTask("analysis-1", 0),
    () => client.exploreReact("analysis-1"),
  ];
  for (const explore of requests) {
    await assert.rejects(explore, (error: unknown) =>
      error instanceof TraceSiftError && error.kind === "version" && /Update TraceSift/.test(error.message));
  }
});

test("the saved project is a real folder, resolved once and dropped when it goes away", async t => {
  const fake = await fixture(); t.after(fake.close);
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  assert.equal(await client.readProject(), undefined);
  // A file or missing path is not a project.
  const file = join(fake.home, "not-a-folder.json"); await writeFile(file, "{}");
  for (const bad of [file, join(fake.home, "missing")]) {
    await assert.rejects(client.writeProject(bad), (error: unknown) =>
      error instanceof TraceSiftError && /does not exist/.test(error.message));
  }
  const project = await mkdtemp(join(tmpdir(), "mobile-dev-project-"));
  const saved = await client.writeProject(project);
  assert.equal(saved, await realpath(project));
  assert.equal(await client.readProject(), saved);
  // Written beside the analyses it qualifies, with their private mode.
  const stored = await stat(join(fake.home, "integrations", "mobile-dev", "project.json"));
  assert.equal(stored.mode & 0o777, 0o600);
  // A folder that moved reads as no project, and the next choice replaces it.
  await rm(project, { recursive: true, force: true });
  assert.equal(await client.readProject(), undefined);
  const second = await mkdtemp(join(tmpdir(), "mobile-dev-project-"));
  t.after(() => rm(second, { recursive: true, force: true }));
  assert.equal(await client.writeProject(second), await realpath(second));
  assert.equal(await client.readProject(), await realpath(second));
});

/**
 * A stand-in for `tracesift record`. The real one leaves `browser.json` and
 * `record.json` behind for a later process to read, which is exactly the
 * contract these tests hold it to.
 */
async function fakeRecorder(home: string, body: string) {
  const command = join(home, "tracesift-record");
  await writeFile(command, `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(join(home, "record-args.txt"))}\n${body}\n`, { mode: 0o755 });
  await chmod(command, 0o755);
  return command;
}

test("a recording launches a browser, traces what is on screen, and reports the trace it wrote", async t => {
  const fake = await fixture(); t.after(fake.close);
  const trace = join(fake.home, "one.json.gz"); await writeFile(trace, "trace");
  const recordings = join(fake.home, "mobile-dev", "tracesift");
  const browser = join(fake.home, "browser.json");
  const record = join(fake.home, "record.json");
  const command = await fakeRecorder(fake.home, [
    `case "$2" in`,
    // `record launch` publishes the live browser; `start` and `stop` publish the
    // recorder's state, exactly as the CLI's own state files do.
    `  launch) printf '%s' '{"apiVersion":1,"pid":'$PPID',"url":"https://example.com/","userDataDir":"/tmp/p","ownsProfile":true,"port":1,"webSocketDebuggerUrl":"ws://x","startedAt":1}' > ${JSON.stringify(browser)} ;;`,
    `  start) printf '%s' '{"apiVersion":1,"pid":'$PPID',"state":"recording","mode":"local"}' > ${JSON.stringify(record)} ;;`,
    `  stop) printf '%s' '{"apiVersion":1,"pid":'$PPID',"state":"captured","mode":"local","export":{"path":"${trace}","sizeBytes":612345,"eventCount":35924}}' > ${JSON.stringify(record)} ;;`,
    `  close) rm -f ${JSON.stringify(browser)} ;;`,
    `esac`,
  ].join("\n"));
  const client = new TraceSiftClient(command, fake.home, recordings); t.after(() => client.close());

  assert.deepEqual(await client.captureState(), { apiVersion: 1, recording: false });
  const launched = await client.launchBrowser("https://example.com");
  assert.deepEqual(launched.browser, { url: "https://example.com/" });

  await client.writeProject(fake.home);
  await client.startRecording();
  assert.equal((await client.captureState()).recording, true);

  const capture = await client.stopRecording();
  assert.match(capture.path, /mobile-dev\/tracesift\/profile-.*\.json\.gz$/);
  assert.equal(await readFile(capture.path, "utf8"), "trace");
  assert.deepEqual((await client.listRecordedProfiles()).map(profile => profile.path), [capture.path]);
  assert.equal((await client.listRecordedProfiles())[0]?.projectName, fake.home.split("/").at(-1));
  await assert.rejects(client.deleteRecordedProfile(join(fake.home, "other.json")), /saved profiles folder/);
  await client.deleteRecordedProfile(capture.path);
  assert.deepEqual(await client.listRecordedProfiles(), []);
  assert.equal(capture.sizeBytes, 612345);
  assert.equal(capture.eventCount, 35924);
  // Stopping leaves the browser open, so another recording can follow.
  assert.equal((await client.captureState()).browser?.url, "https://example.com/");
  assert.equal((await client.captureState()).recording, false);

  await client.closeBrowser();
  assert.equal((await client.captureState()).browser, undefined);

  const args = (await readFile(join(fake.home, "record-args.txt"), "utf8")).trim().split("\n");
  // `start` carries no --url: the trace is of the state the person reached. It
  // forces the local sink so a trace exists as a file even while a TraceSift runs.
  assert.deepEqual(args, ["record", "launch", "--url", "https://example.com",
    "record", "start", "--sink", "local", "record", "stop", "record", "close"]);
});

test("a TraceSift without the record verb reads as a version to update", async t => {
  const fake = await fixture(); t.after(fake.close);
  const command = await fakeRecorder(fake.home, "echo 'tracesift: Unknown command. Run tracesift --help.' >&2\nexit 1");
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());
  await assert.rejects(client.launchBrowser("https://example.com"), (error: unknown) =>
    error instanceof TraceSiftError && error.kind === "version" && /Update @callstack\/tracesift/.test(error.message));
});

test("a recording that fails says what the CLI said, and a stop that wrote nothing is not a capture", async t => {
  const fake = await fixture(); t.after(fake.close);
  const refuse = await fakeRecorder(fake.home, "echo 'tracesift: A recording is already running. Stop it with `tracesift record stop`.' >&2\nexit 1");
  const refusing = new TraceSiftClient(refuse, fake.home); t.after(() => refusing.close());
  await assert.rejects(refusing.startRecording(), (error: unknown) =>
    error instanceof TraceSiftError && /already running/.test(error.message));

  // A `record stop` that exits clean but leaves no export is a trace that went
  // missing, not a capture to hand on to the analyzer.
  const silent = await fakeRecorder(fake.home, "exit 0");
  const silently = new TraceSiftClient(silent, fake.home); t.after(() => silently.close());
  await assert.rejects(silently.stopRecording(), (error: unknown) =>
    error instanceof TraceSiftError && /without writing a trace/.test(error.message));
});

test("a recorder state file that is not readable JSON is named rather than treated as idle", async t => {
  const fake = await fixture(); t.after(fake.close);
  await writeFile(join(fake.home, "record.json"), "{ not json");
  const client = new TraceSiftClient("missing-tracesift", fake.home); t.after(() => client.close());
  await assert.rejects(client.captureState(), (error: unknown) =>
    error instanceof TraceSiftError && error.kind === "setup" && /recording state is invalid/.test(error.message));
});

test("a React Native recording lists the connected apps, attaches to one, and reports the trace it wrote", async t => {
  const fake = await fixture(); t.after(fake.close);
  const trace = join(fake.home, "rn.json.gz"); await writeFile(trace, "trace");
  const recordings = join(fake.home, "mobile-dev", "tracesift");
  const record = join(fake.home, "record.json");
  const targets = JSON.stringify({
    apiVersion: 1, platform: "rn", metro: "http://127.0.0.1:8081",
    targets: [{ id: "device-1", title: "AwesomeApp", appId: "com.awesome", deviceName: "iPhone 17 Pro",
      supportsMultipleDebuggers: true, recommended: true }],
  });
  const command = await fakeRecorder(fake.home, [
    `case "$2" in`,
    // No browser.json: React Native launches nothing, so only the recorder's
    // own state file is ever written.
    `  targets) printf '%s' ${JSON.stringify(targets)} ;;`,
    `  start) printf '%s' '{"apiVersion":1,"pid":'$PPID',"state":"recording","mode":"local","targetLabel":"AwesomeApp (Hermes) — iPhone 17 Pro"}' > ${JSON.stringify(record)} ;;`,
    `  stop) printf '%s' '{"apiVersion":1,"pid":'$PPID',"state":"captured","mode":"local","export":{"path":"${trace}","sizeBytes":90210,"eventCount":1204}}' > ${JSON.stringify(record)} ;;`,
    `esac`,
  ].join("\n"));
  const client = new TraceSiftClient(command, fake.home, recordings); t.after(() => client.close());

  const listed = await client.reactNativeTargets();
  assert.equal(listed.metro, "http://127.0.0.1:8081");
  assert.deepEqual(listed.targets.map(target => [target.id, target.recommended]), [["device-1", true]]);
  // The real CLI omits `vm` on a React Native that does not name its engine.
  assert.equal(listed.targets[0]?.vm, undefined);

  await client.startReactNativeRecording({ targetId: "device-1" });
  const running = await client.captureState();
  assert.equal(running.recording, true);
  // Nothing was launched, so the browser stays absent; the target label is what
  // says this recording belongs to React Native rather than Chrome.
  assert.equal(running.browser, undefined);
  assert.deepEqual(running.app, { targetLabel: "AwesomeApp (Hermes) — iPhone 17 Pro" });

  const saved = await client.stopRecording();
  assert.match(saved.path, /mobile-dev\/tracesift\/profile-.*\.json\.gz$/);
  assert.equal(await readFile(saved.path, "utf8"), "trace");
  assert.equal(saved.eventCount, 1204);
  // A finished recording is no longer attached to anything.
  assert.equal((await client.captureState()).app, undefined);

  const args = (await readFile(join(fake.home, "record-args.txt"), "utf8")).trim().split("\n");
  // `start` forces the local sink for the same reason the Chrome path does, and
  // carries the chosen target so the list and the recording cannot disagree.
  assert.deepEqual(args, ["record", "targets", "--platform", "rn", "--json",
    "record", "start", "--platform", "rn", "--sink", "local", "--target-id", "device-1",
    "record", "stop"]);
});

test("a React Native recording with no target named lets the CLI choose, and a Metro URL is passed through", async t => {
  const fake = await fixture(); t.after(fake.close);
  const command = await fakeRecorder(fake.home, "exit 0");
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());

  await client.startReactNativeRecording({ metro: "http://127.0.0.1:9000" });
  const args = (await readFile(join(fake.home, "record-args.txt"), "utf8")).trim().split("\n");
  assert.deepEqual(args, ["record", "start", "--platform", "rn", "--sink", "local", "--metro", "http://127.0.0.1:9000"]);
});

test("a targets command that fails says what it reported on stdout rather than an exit code", async t => {
  const fake = await fixture(); t.after(fake.close);
  // `record targets --json` reports its own failure as JSON on stdout and exits
  // 1, so there is no stderr prose to read.
  const command = await fakeRecorder(fake.home,
    `printf '%s' '{"apiVersion":1,"error":"No Metro dev server is listening on http://127.0.0.1:8081."}'\nexit 1`);
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());

  await assert.rejects(client.reactNativeTargets(), error =>
    error instanceof TraceSiftError && error.kind === "request"
    && error.message === "No Metro dev server is listening on http://127.0.0.1:8081.");
});

test("a TraceSift that knows record but not --platform reads as a version to update", async t => {
  const fake = await fixture(); t.after(fake.close);
  const command = await fakeRecorder(fake.home, "echo \"tracesift: Unknown option '--platform'.\" >&2\nexit 1");
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());

  await assert.rejects(client.reactNativeTargets(), error =>
    error instanceof TraceSiftError && error.kind === "version" && /cannot record React Native/.test(error.message));
  await assert.rejects(client.startReactNativeRecording(), error =>
    error instanceof TraceSiftError && error.kind === "version" && /0\.7\.0 or newer/.test(error.message));
});

test("a targets command that answers with prose rather than JSON is named, not guessed at", async t => {
  const fake = await fixture(); t.after(fake.close);
  const command = await fakeRecorder(fake.home, "echo 'Metro on http://127.0.0.1:8081'");
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());

  await assert.rejects(client.reactNativeTargets(), error =>
    error instanceof TraceSiftError && error.kind === "response" && /other than JSON/.test(error.message));
});

test("a React Native recording runs in the saved project, so a release build finds its source map", async t => {
  const fake = await fixture(); t.after(fake.close);
  const project = await realpath(await mkdtemp(join(tmpdir(), "mobile-dev-rn-project-")));
  t.after(() => rm(project, { recursive: true, force: true }));
  const cwdPath = join(fake.home, "cwd.txt");
  const command = await fakeRecorder(fake.home, `pwd -P >> ${JSON.stringify(cwdPath)}`);
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());

  // No project saved: the CLI keeps the plugin's own directory, as before.
  await client.startReactNativeRecording();
  assert.equal((await readFile(cwdPath, "utf8")).trim(), await realpath(process.cwd()));

  await client.writeProject(project);
  await rm(cwdPath);
  await client.startReactNativeRecording();
  assert.equal((await readFile(cwdPath, "utf8")).trim(), project);

  const explicitProject = await realpath(await mkdtemp(join(tmpdir(), "mobile-dev-rn-explicit-")));
  t.after(() => rm(explicitProject, { recursive: true, force: true }));
  await writeFile(join(explicitProject, "package.json"), "{}");
  await rm(cwdPath);
  await client.startReactNativeRecording({ projectPath: explicitProject });
  assert.equal((await readFile(cwdPath, "utf8")).trim(), explicitProject);

  // A saved project that has since been deleted falls back rather than failing the spawn.
  await rm(project, { recursive: true, force: true });
  await rm(cwdPath);
  await client.startReactNativeRecording();
  assert.equal((await readFile(cwdPath, "utf8")).trim(), await realpath(process.cwd()));
});

test("web recording and the app list never move to the project folder", async t => {
  const fake = await fixture(); t.after(fake.close);
  const project = await realpath(await mkdtemp(join(tmpdir(), "mobile-dev-rn-project-")));
  t.after(() => rm(project, { recursive: true, force: true }));
  const cwdPath = join(fake.home, "cwd.txt");
  const command = await fakeRecorder(fake.home, `pwd -P >> ${JSON.stringify(cwdPath)}\nprintf '%s' '{"apiVersion":1,"platform":"rn","metro":"http://127.0.0.1:8081","targets":[{"id":"a","title":"App"}]}'`);
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());
  await client.writeProject(project);

  await client.reactNativeTargets();
  await client.startRecording();
  const here = await realpath(process.cwd());
  assert.deepEqual((await readFile(cwdPath, "utf8")).trim().split("\n"), [here, here]);
});

/** A recorder whose usage text does, or does not, mention release-build support. */
async function usageRecorder(home: string, usage: string, body: string) {
  return await fakeRecorder(home, `if [ "$1" = "--help" ]; then printf '%s' ${JSON.stringify(usage)}; exit 0; fi\n${body}`);
}

test("a CLI without release-build support names TRACE_SIFT_COMMAND when no app is found or start fails", async t => {
  const fake = await fixture(); t.after(fake.close);
  const old = await usageRecorder(fake.home, "tracesift record start [--platform rn]",
    `case "$2" in targets) printf '%s' '{"apiVersion":1,"platform":"rn","metro":"http://127.0.0.1:8081","targets":[]}' ;; start) echo "tracesift: no app" >&2; exit 1 ;; esac`);
  const client = new TraceSiftClient(old, fake.home); t.after(() => client.close());
  const stale = (error: unknown) => error instanceof TraceSiftError && error.kind === "version"
    && /too old to record release builds/.test(error.message) && /@callstack\/tracesift@0\.7\.0/.test(error.message);
  await assert.rejects(client.reactNativeTargets(), stale);
  await assert.rejects(client.startReactNativeRecording(), stale);
});

test("a CLI with release-build support keeps its own errors and its empty list", async t => {
  const fake = await fixture(); t.after(fake.close);
  const current = await usageRecorder(fake.home, "tracesift record start --platform rn [--profiler-port 8089]",
    `case "$2" in targets) printf '%s' '{"apiVersion":1,"platform":"rn","metro":"http://127.0.0.1:8081","targets":[]}' ;; start) echo "tracesift: no app" >&2; exit 1 ;; esac`);
  const client = new TraceSiftClient(current, fake.home); t.after(() => client.close());
  assert.deepEqual((await client.reactNativeTargets()).targets, []);
  await assert.rejects(client.startReactNativeRecording(), error => error instanceof TraceSiftError && error.kind === "request" && error.message === "no app");
});

test("a release target keeps its transport and port through the client", async t => {
  // The sanitizer rebuilds each target field by field, and zod defaults
  // `transport` to "metro". Dropping either field here made the panel label
  // every release build as Metro, naming a dev server that is not running.
  const fake = await fixture(); t.after(fake.close);
  const targets = JSON.stringify({
    apiVersion: 1, platform: "rn", metro: "http://127.0.0.1:8081", profilerPort: 8089,
    targets: [{ id: "release", title: "com.example.spike (Android, release)", appId: "com.example.spike",
      deviceName: "Google sdk_gphone16k_arm64", transport: "release", port: 8089,
      supportsMultipleDebuggers: false, recommended: true }],
  });
  const command = await fakeRecorder(fake.home, [
    `case "$2" in`,
    `  targets) printf '%s' ${JSON.stringify(targets)} ;;`,
    `esac`,
  ].join("\n"));
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());

  const listed = await client.reactNativeTargets();
  assert.equal(listed.targets[0]?.transport, "release");
  assert.equal(listed.targets[0]?.port, 8089);
});

test("a Metro target without a transport still reads as Metro", async t => {
  const fake = await fixture(); t.after(fake.close);
  const targets = JSON.stringify({
    apiVersion: 1, platform: "rn", metro: "http://127.0.0.1:8081",
    targets: [{ id: "device-1", title: "AwesomeApp", supportsMultipleDebuggers: true, recommended: true }],
  });
  const command = await fakeRecorder(fake.home, [
    `case "$2" in`,
    `  targets) printf '%s' ${JSON.stringify(targets)} ;;`,
    `esac`,
  ].join("\n"));
  const client = new TraceSiftClient(command, fake.home); t.after(() => client.close());

  const listed = await client.reactNativeTargets();
  assert.equal(listed.targets[0]?.transport, "metro");
  assert.equal(listed.targets[0]?.port, undefined);
});

test("a project is set up when the profiler package is in its node_modules, and the install command follows its lockfile", async t => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-profiler-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const client = new TraceSiftClient("missing-tracesift", root);
  await assert.rejects(client.profilerSetup(join(root, "nope")), /does not exist/);
  await assert.rejects(client.profilerSetup(root), /no package.json/);
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "yarn.lock"), "");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, "ios")); await writeFile(join(root, "ios", "Podfile"), "");
  assert.deepEqual(await client.profilerSetup(root), {
    installed: false, manager: "yarn", command: "yarn add --dev @callstack/tracesift-profiler@0.7.0", platforms: ["ios"],
  });
  await assert.rejects(client.installProfiler(root, undefined, join(root, "missing-profiler")), /folder does not exist/);
  const wrongPackage = join(root, "wrong-profiler");
  await mkdir(wrongPackage); await writeFile(join(wrongPackage, "package.json"), '{"name":"another-package"}');
  await assert.rejects(client.installProfiler(root, undefined, wrongPackage), /not @callstack\/tracesift-profiler/);
  await mkdir(join(root, "node_modules", "@callstack", "tracesift-profiler"), { recursive: true });
  assert.equal((await client.profilerSetup(root)).installed, true);
});

test("profile devices are parsed from the CLI's rows, and a failing build reports the CLI's last verdict", async t => {
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-profile-cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const command = join(home, "tracesift");
  await writeFile(command, `#!/bin/sh
if [ "$2" = devices ]; then
  printf 'device     00008150-AAA  Hur iPhone  (USB, tunnel up)\\nsimulator  UUID-1  iPhone 17 Pro  (booted)\\nandroid    R5CT83DJM1Z  SM-S908E  (USB)\\nnoise\\n'
else
  echo 'xcodebuild chatter' >&2
  echo 'tracesift: No provisioning profile covers this phone.' >&2
  exit 1
fi
`, { mode: 0o755 });
  await chmod(command, 0o755);
  await writeFile(join(home, "package.json"), "{}");
  const client = new TraceSiftClient(command, home);
  assert.deepEqual(await client.profileDevices(), [
    { kind: "device", id: "00008150-AAA", name: "Hur iPhone", note: "USB, tunnel up" },
    { kind: "simulator", id: "UUID-1", name: "iPhone 17 Pro", note: "booted" },
    { kind: "android", id: "R5CT83DJM1Z", name: "SM-S908E", note: "USB" },
  ]);
  await assert.rejects(client.profileBuild({ projectPath: home, platform: "ios" }), /No provisioning profile covers this phone\./);
});

test("an iOS build exit 65 includes the Xcode error behind the CLI verdict", async t => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-xcode-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), "{}");
  const command = join(root, "tracesift");
  await writeFile(command, `#!/bin/sh\nprintf '%s\\n' '/app/ios/App.swift:12:3: error: cannot find Widget in scope' 'BUILD FAILED'\necho 'tracesift: xcodebuild -workspace failed with exit code 65.' >&2\nexit 1\n`, { mode: 0o755 });
  const client = new TraceSiftClient(command, root);
  await assert.rejects(client.profileBuild({ projectPath: root, platform: "ios" }), error =>
    error instanceof Error && /xcodebuild -workspace failed with exit code 65/.test(error.message)
      && /cannot find Widget in scope/.test(error.message));
});

test("an iOS profiling build refreshes stale profiler pods with the project's Bundler", async t => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-bundled-pods-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ios"));
  await writeFile(join(root, "ios", "Podfile"), "platform :ios, '15.0'");
  await mkdir(join(root, "node_modules", "@callstack", "tracesift-profiler"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "Gemfile"), "gem 'cocoapods'");
  await writeFile(join(root, "ios", "Podfile.lock"), "PODS:\n  - TracesiftProfiler (0.1.0)\nEXTERNAL SOURCES:\n  TracesiftProfiler:\n    :path: ../node_modules/@callstack/tracesift-rn-profiler\n");
  const cli = join(root, "tracesift");
  await writeFile(cli, `#!/bin/sh\ngrep -q '@callstack/tracesift-profiler' ios/Podfile.lock || exit 127\nprintf 'built\\n'\n`, { mode: 0o755 });
  const client = new TraceSiftClient(cli, root);
  let bundled: { command: string; args: string[]; cwd: string | undefined; path: string | undefined } | undefined;
  (client as unknown as { runSetupCommand: (command: string, args: string[], label: string, signal: AbortSignal | undefined, env: NodeJS.ProcessEnv, cwd: string) => Promise<void> }).runSetupCommand = async (command, args, _label, _signal, env, cwd) => {
    bundled = { command, args, cwd, path: env.PATH };
    await writeFile(join(root, "ios", "Podfile.lock"), "TracesiftProfiler: ../node_modules/@callstack/tracesift-profiler\n");
  };
  assert.deepEqual(await client.profileBuild({ projectPath: root, platform: "ios" }), { log: "built\n" });
  assert.deepEqual(bundled?.command, "bundle");
  assert.deepEqual(bundled?.args, ["exec", "pod", "install"]);
  assert.equal(bundled?.cwd, join(await realpath(root), "ios"));
  assert.match(bundled?.path ?? "", /\.rbenv\/shims/);
  bundled = undefined;
  await client.profileBuild({ projectPath: root, platform: "ios" });
  assert.equal(bundled?.command, "bundle");
});

test("an iOS profiling build links a GUI-installed profiler without a Gemfile", async t => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-system-pods-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ios"));
  await writeFile(join(root, "ios", "Podfile"), "platform :ios, '15.0'");
  await mkdir(join(root, "node_modules", "@callstack", "tracesift-profiler"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  const cli = join(root, "tracesift");
  await writeFile(cli, "#!/bin/sh\nprintf 'built\\n'\n", { mode: 0o755 });
  const client = new TraceSiftClient(cli, root);
  let linked: { command: string; args: string[]; cwd: string | undefined } | undefined;
  (client as unknown as { runSetupCommand: (command: string, args: string[], label: string, signal: AbortSignal | undefined, env: NodeJS.ProcessEnv, cwd: string) => Promise<void> }).runSetupCommand = async (command, args, _label, _signal, _env, cwd) => {
    linked = { command, args, cwd };
  };
  assert.deepEqual(await client.profileBuild({ projectPath: root, platform: "ios" }), { log: "built\n" });
  assert.deepEqual(linked, { command: "pod", args: ["install"], cwd: await realpath(join(root, "ios")) });
});
