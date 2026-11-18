import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { readFileSync } from "node:fs";
import { RUNNER_CWD, bundledConfigSource, bundledTargetName, parseProgressLine, parseReport, progressConfigSource, reportDuration, reportError, reportSteps, reportStatus, runRecordedTest, runnerBin, runnerEnv, untilTestPath } from "../src/testing-run.ts";
import { bundledE2eRoot } from "../src/e2e-runtime.ts";

const FILE = "tests/a-recorded-flow.e2e.ts";

/** A report as the runner's `json` reporter writes one; only the fields a line mark depends on. */
function report(steps: { line: number; status: string; api?: string; error?: unknown }[], status = "passed") {
  return {
    schemaVersion: "report-1",
    run: {
      status,
      results: [{
        testId: `${FILE}::a-recorded-flow`,
        attempts: [{
          index: 0, status,
          steps: steps.map((step, index) => ({
            id: `a:${index}`, index, kind: "locator", api: step.api ?? "locator.tap",
            label: 'getByRole("tab", name: "Explore")', status: step.status, durationMs: 12,
            source: { file: FILE, line: step.line, column: 10 },
            ...(step.error ? { error: step.error } : {}),
          })),
        }],
      }],
    },
  };
}

test("every reported step lands on the line it came from", () => {
  const steps = reportSteps(report([{ line: 8, status: "passed" }, { line: 9, status: "failed", error: { message: "Timed out\nat tests" } }], "failed"), FILE);
  assert.deepEqual(steps.map(step => [step.line, step.status]), [[8, "passed"], [9, "failed"]]);
  assert.equal(steps[1].error, "Timed out", "one line of the failure is what a mark can show");
  assert.equal(reportStatus(report([], "failed"), 1), "failed");
});

test("a step with no line of its own is not attributed to one", () => {
  // `app.open` is a real step the runner reports and has no source line; marking line 0 would put
  // a checkmark on the import at the top of the file.
  const raw = report([{ line: 8, status: "passed" }]);
  raw.run.results[0].attempts[0].steps.unshift({
    id: "a:open", index: 0, kind: "app", api: "app.open", label: "", status: "passed", durationMs: 90,
    source: { file: "", line: 0, column: 0 },
  } as never);
  assert.deepEqual(reportSteps(raw, FILE).map(step => step.line), [8]);
});

test("a failure no line can carry is still the run's reason", () => {
  // `app.open` failing on a device has no source line, so no mark can show it; the reason must not
  // be lost with the mark.
  const raw = report([], "failed");
  raw.run.results[0].attempts[0].steps.push({
    id: "a:open", index: 0, kind: "app", api: "app.open", label: "", status: "failed", durationMs: 90,
    source: { file: "", line: 0, column: 0 }, error: { message: "App com.example.android is not installed\nstack" },
  } as never);
  assert.equal(reportError(raw, FILE), "App com.example.android is not installed");
  // With no failing step, the attempt's own error is the reason, then the run's.
  const attempt = report([], "failed");
  (attempt.run.results[0].attempts[0] as Record<string, unknown>).error = { message: "Device disconnected" };
  assert.equal(reportError(attempt, FILE), "Device disconnected");
  const run = report([], "failed");
  (run.run as Record<string, unknown>).errors = [{ message: "No target matched android" }];
  assert.equal(reportError(run, FILE), "No target matched android");
  assert.equal(reportError(report([{ line: 8, status: "passed" }], "passed"), FILE), undefined);
});

test("a retried test is read from the attempt that decided it", () => {
  const raw = report([{ line: 8, status: "failed" }], "passed");
  raw.run.results[0].attempts.push({
    index: 1, status: "passed",
    steps: [{ id: "b:1", index: 1, kind: "locator", api: "locator.tap", label: "", status: "passed", durationMs: 8, source: { file: FILE, line: 8, column: 10 } }],
  } as never);
  assert.deepEqual(reportSteps(raw, FILE).map(step => step.status), ["passed"]);
});

test("the report is found even when something else wrote to the same stream", () => {
  const document = JSON.stringify(report([{ line: 8, status: "passed" }]));
  assert.notEqual(parseReport(`npm warn exec something\n${document}\n`), undefined);
  assert.equal(parseReport("no report here"), undefined);
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "testing-run-"));
  await mkdir(join(root, "node_modules/.bin"), { recursive: true });
  await writeFile(join(root, "node_modules/.bin/e2e"), "#!/bin/sh\n");
  return root;
}

/** A spawn that answers with one canned stdout, and records how it was called. */
function spawner(stdout: string, exitCode = 0, seen: { command?: string; args?: readonly string[]; cwd?: string } = {}) {
  return ((command: string, args: readonly string[], options: { cwd?: string }) => {
    seen.command = command; seen.args = args; seen.cwd = options.cwd;
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => void };
    child.stdout = Readable.from([stdout]);
    child.stderr = Readable.from([""]);
    child.kill = () => undefined;
    queueMicrotask(() => setTimeout(() => child.emit("close", exitCode), 0));
    return child;
  }) as never;
}

test("the project's own runner is spawned, never a downloaded one", async () => {
  const root = await project();
  const seen: { command?: string; args?: readonly string[]; cwd?: string } = {};
  const result = await runRecordedTest({ projectPath: root, relativePath: FILE },
    { spawner: spawner(JSON.stringify(report([{ line: 8, status: "passed" }])), 0, seen) });
  assert.equal(seen.command, join(root, "node_modules/.bin/e2e"), "npx would go to the network for a missing package");
  assert.deepEqual(seen.args, ["run", FILE, "--reporter", "json"]);
  assert.equal(seen.cwd, root);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.steps.map(step => step.line), [8]);
  assert.equal(result.output, undefined, "there are lines to mark, so the raw output is not needed");
});

test("a preview run uses an isolated temporary project and leaves the project untouched", async () => {
  const root = await project();
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, FILE), "the whole flow\n");
  const configPath = join(root, "e2e.config.ts");
  await writeFile(configPath, "export default { targets: [] };\n");
  const document = JSON.stringify(report([{ line: 8, status: "passed" }]));
  const seen: { command?: string; args?: readonly string[]; cwd?: string } = {};
  let copy: string | undefined;
  let workspace: string | undefined;
  const result = await runRecordedTest({ projectPath: root, relativePath: FILE, configPath, untilSource: "the current preview\n" }, {
    spawner: ((command: string, args: readonly string[], options: { cwd?: string }) => {
      workspace = dirname(args[args.indexOf("--config") + 1]);
      copy = readFileSync(join(workspace, FILE), "utf8");
      return spawner(document, 0, seen)(command, args, options as never);
    }) as never,
  });
  assert.deepEqual(seen.args, ["run", FILE, "--reporter", "json", "--config", join(workspace!, "e2e.config.mts")]);
  assert.notEqual(workspace, root);
  assert.equal(seen.cwd, root, "a daemon the run starts inherits a folder that outlives the run");
  assert.equal(copy, "the current preview\n");
  assert.deepEqual(result.steps.map(step => step.line), [8]);
  assert.equal(existsSync(workspace!), false, "the isolated workspace is removed after the run");
  assert.equal(existsSync(root), true);
  assert.equal(readFileSync(join(root, FILE), "utf8"), "the whole flow\n");
});

test("a run that produced no report explains itself with the runner's own words", async () => {
  const root = await project();
  const result = await runRecordedTest({ projectPath: root, relativePath: FILE }, { spawner: spawner("No tests matched\n", 1) });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.steps, []);
  assert.match(result.output ?? "", /No tests matched/);
});

test("a project with no runner installed says so instead of failing obscurely", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-run-"));
  assert.throws(() => runnerBin(root), /no e2e CLI installed/);
});

test("the device is released before the runner is spawned, never after", async () => {
  const root = await project();
  // The one correctness point of the whole feature: agent-device allows a single session per
  // device, so a recorder session still open when the runner starts fails the run with "Device is
  // already in use" — a refusal the user cannot connect to anything they did.
  const order: string[] = [];
  await runRecordedTest({ projectPath: root, relativePath: FILE }, {
    release: async () => { order.push("release"); },
    spawner: ((command: string, args: readonly string[], options: { cwd?: string }) => {
      order.push("spawn");
      return spawner(JSON.stringify(report([{ line: 8, status: "passed" }])))(command, args, options as never);
    }) as never,
  });
  assert.deepEqual(order, ["release", "spawn"]);
});

test("a project with no runner is refused before the recording session is given up", async () => {
  const root = await mkdtemp(join(tmpdir(), "testing-run-"));
  let released = false;
  await assert.rejects(runRecordedTest({ projectPath: root, relativePath: FILE }, {
    release: async () => { released = true; },
    spawner: spawner(""),
  }), /no e2e CLI installed/);
  assert.equal(released, false, "a run that cannot start must not cost the user their recording");
});

test("the runner is not handed the app's pinned agent-device state directory", () => {
  // The server pins one state directory so its own daemons are peers. The project's runner is a
  // different build of agent-device, and pointing it at the app's directory makes it refuse before
  // it reaches a test: "Daemon (pid …, v0.21.33) is newer than this client (v0.21.20)". Run exists
  // to be the run the user would get from a terminal, so it gets a terminal's state directory.
  const environment = runnerEnv({ PATH: "/usr/bin", AGENT_DEVICE_STATE_DIR: "/app/state", HOME: "/home/someone" });
  assert.equal("AGENT_DEVICE_STATE_DIR" in environment, false);
  assert.equal(environment.PATH, "/usr/bin", "everything else the project needs is still there");
  assert.equal(environment.HOME, "/home/someone");
  assert.equal(environment.NO_COLOR, "1", "the json reporter's output must not carry escape codes");
});

test("a bundled run gets the app's own state directory, never agent-device's shared default", () => {
  const environment = runnerEnv({ PATH: "/usr/bin", AGENT_DEVICE_STATE_DIR: "/elsewhere" }, "/app/own-state");
  assert.equal(environment.AGENT_DEVICE_STATE_DIR, "/app/own-state");
  assert.equal(environment.PATH, "/usr/bin");
});

test("the generated config adds a reporter and changes nothing else", () => {
  const source = progressConfigSource("/app/e2e.config.ts");
  // The project's own config is spread, so its targets, agents and workers all stand.
  assert.match(source, /import base from "file:\/\/\/app\/e2e\.config\.ts";/);
  assert.match(source, /\.\.\.resolved,/);
  // A config can export a function; the runner resolves one, so the generated config does too.
  assert.match(source, /typeof base === "function" \? await base\(\) : base/);
  // Its own reporters come first: `--reporter` replaces the built-ins, never the configured objects.
  assert.match(source, /\.\.\.\(resolved\.reporters \?\? \[\]\),/);
  assert.match(source, /name: "mobile-dev-progress"/);
  // Construction must have no side effects — workers load the config too — so the only write is
  // inside onEvent, wrapped, because a reporter that throws is quarantined for the rest of the run.
  const constructed = source.slice(0, source.indexOf("onEvent"));
  assert.doesNotMatch(constructed, /process\.stderr/);
  assert.match(source, /try \{\s*\n\s*process\.stderr\.write/);
});

test("live step events are read back off a stream the runner also writes to", () => {
  const line = '@@mobile-dev-step {"stepIndex":2,"phase":"end","api":"locator.tap","label":"getByText(\\"Open\\")","status":"failed","error":"Timed out\\nat tests"}';
  assert.deepEqual(parseProgressLine(line), {
    stepIndex: 2, phase: "end", api: "locator.tap", label: 'getByText("Open")',
    status: "failed", error: "Timed out",
  });
  // Everything else on stderr is the runner's own and must pass through untouched.
  assert.equal(parseProgressLine("ℹ booting 3ECD29F0 (1 of 1)"), undefined);
  assert.equal(parseProgressLine("@@mobile-dev-step not json"), undefined);
  // A phase with no identity cannot be placed on a line, so it is not a mark.
  assert.equal(parseProgressLine('@@mobile-dev-step {"phase":"start","api":"locator.tap"}'), undefined);
  assert.equal(parseProgressLine('@@mobile-dev-step {"stepIndex":0,"phase":"activity","api":"agent.act"}'), undefined);
});

test("a run with a config path asks the runner to use the generated one", async () => {
  const root = await project();
  const seen: { args?: readonly string[] } = {};
  await runRecordedTest({ projectPath: root, relativePath: FILE, configPath: join(root, "e2e.config.ts") }, {
    spawner: spawner(JSON.stringify(report([{ line: 8, status: "passed" }])), 0, seen),
    onProgress: () => undefined,
  });
  // Beside the project's own config, because the runner takes the project root from the config's
  // own directory — one level down and the run ends in `NO_TESTS ... under <project>/.e2e`.
  assert.deepEqual(seen.args, ["run", FILE, "--reporter", "json", "--config", "e2e.config.mobile-dev-progress.mts"]);
  // The generated config is the run's, not the project's: it is gone once the run is.
  assert.equal(existsSync(join(root, "e2e.config.mobile-dev-progress.mts")), false);
});

test("without a progress sink the run is left exactly as it was", async () => {
  const root = await project();
  const seen: { args?: readonly string[] } = {};
  await runRecordedTest({ projectPath: root, relativePath: FILE, configPath: join(root, "e2e.config.ts") },
    { spawner: spawner(JSON.stringify(report([{ line: 8, status: "passed" }])), 0, seen) });
  assert.deepEqual(seen.args, ["run", FILE, "--reporter", "json"], "no listener, so nothing is generated");
});

test("a config the runner will not take costs the progress, not the run", async () => {
  const root = await project();
  const calls: (readonly string[])[] = [];
  const spawnBoth = ((command: string, args: readonly string[], options: { cwd?: string }) => {
    calls.push(args);
    // First attempt: the runner refuses the generated config. Second: the plain run, which works.
    const body = args.includes("--config")
      ? "INVALID_CONFIG: could not load config e2e.config.mobile-dev-progress.mts\n"
      : JSON.stringify(report([{ line: 8, status: "passed" }]));
    return spawner(body, args.includes("--config") ? 2 : 0)(command, args, options as never);
  }) as never;

  const result = await runRecordedTest({ projectPath: root, relativePath: FILE, configPath: join(root, "e2e.config.ts") },
    { spawner: spawnBoth, onProgress: () => undefined });

  assert.equal(calls.length, 2, "the run is retried the way it worked before live progress existed");
  assert.equal(calls[1].includes("--config"), false);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.steps.map(step => step.line), [8]);
});

test("a test that really failed is not retried into a different answer", async () => {
  const root = await project();
  const calls: (readonly string[])[] = [];
  const failing = ((command: string, args: readonly string[], options: { cwd?: string }) => {
    calls.push(args);
    return spawner(JSON.stringify(report([{ line: 8, status: "failed" }], "failed")), 1)(command, args, options as never);
  }) as never;

  const result = await runRecordedTest({ projectPath: root, relativePath: FILE, configPath: join(root, "e2e.config.ts") },
    { spawner: failing, onProgress: () => undefined });

  assert.equal(calls.length, 1, "there are steps, so the config was fine and the failure is the test's");
  assert.equal(result.status, "failed");
});

test("the generated config is syntactically whole, line by line", () => {
  // It is source written by source, so an escape that survives one level and not the other produces
  // a file the runner refuses with `CONFIG_LOAD_FAILED: Unterminated string literal` — and a run
  // that cannot start. Every line must close every string it opens.
  const source = progressConfigSource("/app/e2e.config.ts");
  for (const [index, line] of source.split("\n").entries()) {
    const quotes = (line.match(/(?<!\\)"/g) ?? []).length;
    assert.equal(quotes % 2, 0, `line ${index + 1} leaves a string open: ${line}`);
  }
  // The newline the reporter writes has to reach the file as an escape, not as a newline.
  assert.match(source, /\}\) \+ "\\n"\);/);
});

test("the run's own duration comes from the report, with the attempts as the fallback", () => {
  const run = (fields: Record<string, unknown>) => ({ schemaVersion: "report-1", run: { status: "passed", results: [], ...fields } });
  // `run.startedAt` is required and `run.finishedAt` is optional, so the span between them is the
  // number whenever the run reached its end.
  assert.equal(reportDuration(run({ startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:08.410Z" })), 8410);
  // Cut short, so there is no `finishedAt` — but `attempt.durationMs` is required of every attempt,
  // and their sum is the time the runner actually spent.
  assert.equal(reportDuration(run({
    startedAt: "2026-01-01T00:00:00.000Z",
    results: [{ attempts: [{ index: 0, durationMs: 1200 }, { index: 1, durationMs: 300 }] }, { attempts: [{ index: 0, durationMs: 40 }] }],
  })), 1540);
  // A clock that went backwards is not a duration; the attempts answer instead.
  assert.equal(reportDuration(run({
    startedAt: "2026-01-01T00:00:09.000Z", finishedAt: "2026-01-01T00:00:00.000Z",
    results: [{ attempts: [{ index: 0, durationMs: 7 }] }],
  })), 7);
  // Nothing to go on at all is left undefined rather than reported as a run that took no time.
  assert.equal(reportDuration(run({ startedAt: "not a date" })), undefined);
  assert.equal(reportDuration(run({ startedAt: "2026-01-01T00:00:00.000Z", results: [{ attempts: [{ index: 0 }] }] })), undefined);
  assert.equal(reportDuration(undefined), undefined);
  // The whole path, as the tool returns it: the steps' own durations are parsed too, and are
  // there if the gutter ever wants them.
  assert.equal(reportSteps(report([{ line: 8, status: "passed" }]), FILE)[0].durationMs, 12);
});

test("the selected target reaches the runner, so an Android recording does not run on iOS", async () => {
  const root = await project();
  const seen: { command?: string; args?: readonly string[]; cwd?: string } = {};
  await runRecordedTest({ projectPath: root, relativePath: FILE, target: "android" },
    { spawner: spawner(JSON.stringify(report([{ line: 8, status: "passed" }])), 0, seen) });
  assert.deepEqual(seen.args, ["run", FILE, "--reporter", "json", "--target", "android"]);
});

test("bundled mode runs and cleans an isolated Studio workspace", async () => {
  const root = await project();
  const runnerCwd = join(await mkdtemp(join(tmpdir(), "testing-run-cwd-")), "e2e-runner");
  const seen: { command?: string; args?: readonly string[]; cwd?: string } = {};
  const result = await runRecordedTest({
    projectPath: root, relativePath: FILE, untilSource: 'test("x", async () => {});\n',
    runtime: { mode: "bundled", root: bundledE2eRoot() },
    bundledTarget: { platform: "ios", bundleId: "com.example.app" },
  }, { spawner: spawner(JSON.stringify(report([{ line: 1, status: "passed" }])), 0, seen), runnerCwd });
  assert.equal(result.status, "passed");
  assert.match(seen.args?.[0] ?? "", /e2e\/dist\/cli\/bin\.js$/);
  assert.ok(seen.args?.some((value, index) => value === "--target" && seen.args?.[index + 1] === "ios"));
  const config = seen.args![seen.args!.indexOf("--config") + 1];
  assert.ok(isAbsolute(config) && dirname(config).includes("mobile-dev-e2e-run-"), "the CLI gets the workspace's config by absolute path");
  // macOS's tmpdir is a symlink; a linked config path makes the runner report every step at "unknown".
  assert.ok(config.startsWith(realpathSync(tmpdir())), "the workspace is given by its real path");
  assert.equal(existsSync(dirname(config)), false, "temporary config, test and node_modules link are cleaned");
  assert.equal(seen.cwd, runnerCwd, "the daemon a run starts must not inherit the workspace it outlives");
  assert.equal(existsSync(seen.cwd!), true, "the spawn cwd survives the workspace's removal");
});

test("a bundled run spawns from the app's stable runner folder by default", async () => {
  const seen: { command?: string; args?: readonly string[]; cwd?: string } = {};
  await runRecordedTest({
    projectPath: await project(), relativePath: FILE, untilSource: 'test("x", async () => {});\n',
    runtime: { mode: "bundled", root: bundledE2eRoot() }, bundledTarget: { platform: "ios", bundleId: "com.example.app" },
  }, { spawner: spawner(JSON.stringify(report([{ line: 1, status: "passed" }])), 0, seen) });
  assert.equal(seen.cwd, RUNNER_CWD);
  assert.ok(!seen.cwd.startsWith(tmpdir()));
  assert.equal(existsSync(RUNNER_CWD), true);
});

test("bundled deterministic tests need no model and agent tests request one", async () => {
  assert.doesNotMatch(bundledConfigSource({ platform: "android", bundleId: "com.example.app" }), /agents:/);
  await assert.rejects(runRecordedTest({
    projectPath: "/unused", relativePath: FILE, untilSource: 'test("x", async ({ agent }) => { await agent.extract("title"); });\n',
    runtime: { mode: "bundled", root: bundledE2eRoot() }, bundledTarget: { platform: "android", bundleId: "com.example.app" },
  }), /Choose a provider and model/);
});

test("a device-pinned bundled config names the device and gives the target its own name", () => {
  const source = bundledConfigSource({ platform: "ios", bundleId: "com.example.app", device: "A1B2-C3" });
  assert.match(source, /name: "ios-A1B2-C3"/);
  assert.match(source, /mobile\(\{ platform: "ios", device: "A1B2-C3" \}\)/);
  assert.match(source, /workers: 1/);
  assert.equal(bundledTargetName({ platform: "android", bundleId: "x", device: "emulator-5554" }), "android-emulator-5554");
  assert.equal(bundledTargetName({ platform: "android", bundleId: "x", device: "avd:Pixel 8" }), "android-avd-Pixel-8");
  // Without a device nothing changes from a single run.
  const plain = bundledConfigSource({ platform: "ios", bundleId: "com.example.app" });
  assert.match(plain, /name: "ios"/);
  assert.doesNotMatch(plain, /device:/);
});

test("a pinned bundled run passes its own target and output directory, removed afterwards", async () => {
  const root = await project();
  const seen: { command?: string; args?: readonly string[]; cwd?: string } = {};
  await runRecordedTest({
    projectPath: root, relativePath: FILE, untilSource: 'test("x", async () => {});\n',
    runtime: { mode: "bundled", root: bundledE2eRoot() },
    bundledTarget: { platform: "android", bundleId: "com.example.app", device: "emulator-5554" },
  }, { spawner: spawner(JSON.stringify(report([{ line: 1, status: "passed" }])), 0, seen) });
  const args = seen.args ?? [];
  assert.equal(args[args.indexOf("--target") + 1], "android-emulator-5554");
  const output = args[args.indexOf("--output") + 1];
  const workspace = dirname(args[args.indexOf("--config") + 1]);
  assert.ok(output?.startsWith(workspace), "the output lives inside the lane's own workspace");
  assert.notEqual(seen.cwd, workspace);
  assert.equal(existsSync(output!), false);
});

test("aborting a run kills its process and reports it as cancelled", async () => {
  const root = await project();
  let killed = false;
  const controller = new AbortController();
  const hanging = (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: () => void };
    child.stdout = Readable.from([]); child.stderr = Readable.from([]);
    child.kill = () => { killed = true; };
    return child;
  }) as never;
  const run = runRecordedTest({
    projectPath: root, relativePath: FILE, untilSource: 'test("x", async () => {});\n',
    runtime: { mode: "bundled", root: bundledE2eRoot() }, bundledTarget: { platform: "ios", bundleId: "a.b" },
  }, { spawner: hanging, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(run, /cancelled/);
  assert.equal(killed, true);
});
