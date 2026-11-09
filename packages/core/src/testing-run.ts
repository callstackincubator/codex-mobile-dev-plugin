import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";

/**
 * Runs one recorded test with the project's own `e2e` CLI, live per-step, and turns its report into
 * per-line status.
 *
 * None of the CLI's four reporters gives live per-step output: `list` prints a permanent line only
 * for *agent* steps and repaints deterministic ones inside a TTY window, `json` prints the whole
 * document once at the end, and `report.json` is written from `onRunFinished`. But the runner's own
 * event spine does carry per-step `start` and `end`, and `e2e.config.ts` takes **reporter objects**
 * with an `onEvent` handler — so a consumer can have the events without any change to the runner.
 *
 * So the run is given a generated config that spreads the project's own and appends one reporter
 * whose `onEvent` writes each `step` event to stderr as a tagged line. The config is written into
 * the project's `.e2e/` — the runner's own scratch directory, and the only place from which `e2e`
 * and `@e2e-dev/mobile` resolve — and removed when the run ends. It adds a reporter; it changes
 * nothing else, and `--reporter` replaces only the built-in reporters, so the normal output stands.
 *
 * A `step` event carries no source position; only the finished report does. It carries
 * `identity.stepIndex`, and the runner reports one step per awaited call in order, so the caller
 * maps the index to a line through `EmittedTest.calls` and the report reconciles it at the end.
 */

/** One step of the run, as the panel shows it against a line of the preview. */
export interface TestRunStep {
  /** The 1-based line in the test file the step came from. */
  line: number;
  /** The runner's own name for the call, e.g. `locator.tap`. */
  api: string;
  label: string;
  status: string;
  durationMs?: number;
  error?: string;
}

/** One live `step` event, flattened to what a line mark needs. */
export interface TestRunProgress {
  /** The step's position in its test, which is its position in `EmittedTest.calls`. */
  stepIndex: number;
  phase: "start" | "end";
  api: string;
  label: string;
  /** Only on `end`. */
  status?: string;
  error?: string;
}

export interface TestRunResult {
  /** The runner's own verdict: `passed`, `failed`, `timedOut`, … */
  status: string;
  exitCode: number;
  steps: TestRunStep[];
  /** Set when the report could not be read at all, so the panel can say why rather than go quiet. */
  output?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function str(value: unknown): string { return typeof value === "string" ? value : ""; }

/** The last stretch of output, for the case where there is no report to explain the exit code. */
function tail(text: string, limit = 4000): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `…${trimmed.slice(-limit)}` : trimmed;
}

/**
 * The runner's error shapes carry a message somewhere; the panel only ever shows one line of it.
 * A step whose error cannot be read still reports its status, which is the part a mark depends on.
 */
function errorMessageOf(value: unknown): string | undefined {
  const error = record(value);
  if (!error) return;
  const message = str(error.message) || str(error.value) || str(error.name);
  return message ? message.split("\n")[0]!.slice(0, 400) : undefined;
}

/** The steps of the attempt that decided each result — the last one, after any retries. */
export function reportSteps(report: unknown, file: string): TestRunStep[] {
  const run = record(record(report)?.run);
  const steps: TestRunStep[] = [];
  for (const entry of list(run?.results)) {
    const result = record(entry);
    if (!result) continue;
    const attempts = list(result.attempts);
    const attempt = record(attempts[attempts.length - 1]);
    for (const item of list(attempt?.steps)) {
      const step = record(item);
      const source = record(step?.source);
      const line = typeof source?.line === "number" ? source.line : 0;
      // A step the runner attributes to another file is another test's; `app.open` has no line.
      if (!step || line <= 0 || (str(source?.file) && str(source?.file) !== file)) continue;
      const error = errorMessageOf(step.error);
      steps.push({
        line, api: str(step.api), label: str(step.label), status: str(step.status) || "unknown",
        ...(typeof step.durationMs === "number" ? { durationMs: step.durationMs } : {}),
        ...(error ? { error } : {}),
      });
    }
  }
  return steps;
}

export function reportStatus(report: unknown, exitCode: number): string {
  const run = record(record(report)?.run);
  return str(run?.status) || (exitCode === 0 ? "passed" : "failed");
}

/**
 * The `json` reporter prints the report document and nothing else, but a package manager, a
 * postinstall notice or a warning can still reach the same stream, so the document is taken as the
 * outermost braces rather than as the whole of stdout.
 */
export function parseReport(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(stdout.slice(start, end + 1)); } catch { return undefined; }
}

/** The tag the generated reporter prefixes its lines with, so the runner's own stderr is untouched. */
const PROGRESS_TAG = "@@mobile-dev-step ";

/**
 * The generated config: the project's own, plus one reporter.
 *
 * Reporter *construction* must have no side effects — workers load the config too — so every write
 * happens inside `onEvent`, which must also never throw and never block. A tagged line on stderr
 * needs no socket, no temp output file and no cleanup beyond this config itself.
 */
export function progressConfigSource(configPath: string): string {
  return [
    `// Generated by the mobile-dev Testing panel for one run, then deleted. Do not edit or commit.`,
    `import base from ${JSON.stringify(pathToFileURL(configPath).href)};`,
    ``,
    `const resolved = typeof base === "function" ? await base() : base;`,
    ``,
    `export default {`,
    `  ...resolved,`,
    `  reporters: [`,
    `    ...(resolved.reporters ?? []),`,
    `    {`,
    `      name: "mobile-dev-progress",`,
    `      onEvent(event) {`,
    `        if (event?.type !== "step") return;`,
    `        const progress = event.progress ?? {};`,
    `        if (progress.phase !== "start" && progress.phase !== "end") return;`,
    `        try {`,
    `          process.stderr.write(${JSON.stringify(PROGRESS_TAG)} + JSON.stringify({`,
    `            stepIndex: progress.identity?.stepIndex,`,
    `            phase: progress.phase,`,
    `            api: progress.api,`,
    `            label: progress.label,`,
    `            status: progress.status,`,
    `            error: progress.error?.message,`,
    // The emitted file needs a literal backslash-n inside its own string, so this is escaped twice.
    `          }) + "\\n");`,
    `        } catch {`,
    `          // A reporter that throws is quarantined for the rest of the run; progress is not`,
    `          // worth losing the run's own output over.`,
    `        }`,
    `      },`,
    `    },`,
    `  ],`,
    `};`,
    ``,
  ].join("\n");
}

/** Reads one tagged stderr line back. Anything else on that stream is the runner's own. */
export function parseProgressLine(line: string): TestRunProgress | undefined {
  if (!line.startsWith(PROGRESS_TAG)) return;
  try {
    const parsed = JSON.parse(line.slice(PROGRESS_TAG.length)) as Record<string, unknown>;
    const stepIndex = typeof parsed.stepIndex === "number" ? parsed.stepIndex : undefined;
    const phase = parsed.phase === "start" || parsed.phase === "end" ? parsed.phase : undefined;
    if (stepIndex === undefined || phase === undefined) return;
    return {
      stepIndex, phase, api: str(parsed.api), label: str(parsed.label),
      ...(str(parsed.status) ? { status: str(parsed.status) } : {}),
      ...(str(parsed.error) ? { error: str(parsed.error).split("\n")[0]!.slice(0, 400) } : {}),
    };
  } catch { return; }
}

export interface TestRunRequest {
  projectPath: string;
  /** The test to run, relative to the project, e.g. `tests/a-recorded-flow.e2e.ts`. */
  relativePath: string;
  /** The project's own `e2e.config.ts`, which the generated progress config spreads. */
  configPath?: string;
  timeoutMs?: number;
}

/**
 * Where the generated config goes: beside the project's own, at the project root.
 *
 * Not in `.e2e/`, tidy as that would be. **The runner takes the project root from the config
 * file's own directory**, so a config one level down makes that directory the root and the run
 * ends in `NO_TESTS: no test file matched "tests/**" under <project>/.e2e`. It is written for one
 * run and removed when the run ends, so it is never a file anyone has to think about.
 */
const PROGRESS_CONFIG = "e2e.config.mobile-dev-progress.mts";

type Spawner = typeof spawn;

/**
 * What a run needs doing before it may spawn anything.
 *
 * `release` gives the recorder's agent-device session back. The runner allows exactly one session
 * per device, so a run started while the recorder holds it fails with `Device is already in use by
 * session "mobile-dev-recorder"` — a refusal the user cannot connect to anything they did. It is a
 * dependency of the run rather than something the caller is trusted to have done, because a caller
 * who forgets produces exactly that failure.
 */
export interface TestRunDeps {
  spawner?: Spawner;
  release?: () => Promise<void>;
  /** Called for each live `step` event, as it arrives. */
  onProgress?: (progress: TestRunProgress) => void;
}

/**
 * Spawns the project's own runner, not a global one: the test imports the project's
 * `@e2e-dev/mobile`, and a different CLI is a different runner. `npx` is deliberately avoided —
 * it will go to the network for a package that is not installed, which is a download the user did
 * not ask for in the middle of a test run.
 */
export function runnerBin(projectPath: string): string {
  const bin = join(projectPath, "node_modules/.bin/e2e");
  if (!existsSync(bin)) {
    throw new ExpectedOperationError("invalid_input",
      "This project has no e2e CLI installed, so the panel cannot run the test. Install the project's dependencies, then run it again.");
  }
  return bin;
}

/**
 * The environment the runner gets: the server's, minus `AGENT_DEVICE_STATE_DIR`.
 *
 * The server pins that variable so every daemon *this app* starts shares one state directory and
 * they can take the device lease from one another (`pinStateDir` in `testing-device.ts`). Handing
 * it to the project's own runner points the project's agent-device client at the app's state
 * directory, and the two are not the same build:
 *
 * ```
 * ENGINE_FAILURE (launch): devices failed: Daemon (pid …, v0.21.33) is newer than this client
 * (v0.21.20); refusing to replace it.
 * ```
 *
 * The runner refuses before it reaches a test, and the user sees a run that cannot start for a
 * reason that has nothing to do with their test. Run exists to be the same run they would get from
 * a terminal, so it gets the state directory a terminal would give it: its own.
 */
export function runnerEnv(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { AGENT_DEVICE_STATE_DIR: _pinned, ...rest } = environment;
  return { ...rest, FORCE_COLOR: "0", NO_COLOR: "1" };
}

/**
 * Whether the run died over the generated config rather than over the test.
 *
 * Live progress is worth having and not worth losing a run over: if the runner will not take the
 * generated config — an extension its loader does not accept, a project config that does not
 * survive being spread — the run is retried exactly as it was before this feature existed. A
 * progress spinner must never be the reason Run stopped working.
 */
function refusedTheConfig(result: TestRunResult): boolean {
  return result.steps.length === 0 && /config/i.test(result.output ?? "");
}

export async function runRecordedTest(request: TestRunRequest, deps: TestRunDeps = {}): Promise<TestRunResult> {
  const result = await runOnce(request, deps);
  if (!refusedTheConfig(result) || !request.configPath || !deps.onProgress) return result;
  // Without the progress sink nothing is generated, so this is the plain run.
  const { onProgress: _dropped, ...plain } = deps;
  const retried = await runOnce(request, plain);
  // The retry is the answer only if it got further; otherwise the first failure is the real one.
  return retried.steps.length > 0 || retried.status !== result.status ? retried : result;
}

async function runOnce(request: TestRunRequest, deps: TestRunDeps): Promise<TestRunResult> {
  const spawner = deps.spawner ?? spawn;
  // Before the binary is even resolved: a project with no runner installed must not cost the user
  // their recording session, and a release that happens after the spawn is no release at all.
  const bin = runnerBin(request.projectPath);
  await deps.release?.();
  // Live progress needs the generated config; without a config path to spread there is nothing to
  // generate from, and the run still happens — it just lands all at once, from the report.
  const generated = request.configPath && deps.onProgress
    ? join(request.projectPath, PROGRESS_CONFIG)
    : undefined;
  if (generated && request.configPath) await writeFile(generated, progressConfigSource(request.configPath));
  const child = spawner(bin, [
    "run", request.relativePath, "--reporter", "json",
    ...(generated ? ["--config", PROGRESS_CONFIG] : []),
  ], {
    cwd: request.projectPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: runnerEnv(),
  });
  let stdout = "", stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", chunk => { stdout += chunk; });
  // Progress arrives a line at a time, interleaved with the runner's own stderr, so the stream is
  // split on newlines and a partial tail is held over for the next chunk.
  let pending = "";
  child.stderr?.on("data", chunk => {
    stderr += chunk;
    if (!deps.onProgress) return;
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const progress = parseProgressLine(line);
      if (progress) deps.onProgress(progress);
    }
  });
  const timeoutMs = request.timeoutMs ?? 10 * 60_000;
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (generated) void rm(generated, { force: true });
      reject(new ExpectedOperationError("resource_limit", `The test run did not finish within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    timer.unref?.();
    child.on("error", error => { clearTimeout(timer); if (generated) void rm(generated, { force: true }); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  if (generated) await rm(generated, { force: true });
  const report = parseReport(stdout);
  const steps = report ? reportSteps(report, request.relativePath) : [];
  return {
    status: reportStatus(report, exitCode),
    exitCode,
    steps,
    // Only when there is nothing to show on the lines: an exit with no report is the runner
    // refusing before it got to the test, and its own words are the only explanation there is.
    ...(steps.length === 0 ? { output: tail(`${stdout}\n${stderr}`) } : {}),
  };
}
