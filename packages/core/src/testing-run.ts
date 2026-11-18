import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  /** How long the run itself took, in milliseconds. See `reportDuration`. */
  durationMs?: number;
  /** Set when the report could not be read at all, so the panel can say why rather than go quiet. */
  output?: string;
  /** Why the run failed, in one line, when the report says so: see `reportError`. */
  error?: string;
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

/**
 * Why a failed run failed, in one line, from the report: the failing step's error, including a
 * step with no line of its own such as `app.open`, else the attempt's error, else the run's.
 * A step's line mark carries its own error, so this is what is left when no line could.
 */
export function reportError(report: unknown, file: string): string | undefined {
  const run = record(record(report)?.run);
  for (const entry of list(run?.results)) {
    const result = record(entry);
    if (!result || str(result.status) === "passed" || str(result.status) === "skipped") continue;
    const attempts = list(result.attempts);
    const attempt = record(attempts[attempts.length - 1]);
    for (const item of list(attempt?.steps)) {
      const step = record(item);
      const source = record(step?.source);
      if (!step || (str(source?.file) && str(source?.file) !== file)) continue;
      const error = errorMessageOf(step.error);
      if (error) return error;
    }
    const error = errorMessageOf(attempt?.error);
    if (error) return error;
  }
  for (const item of list(run?.errors)) { const error = errorMessageOf(item); if (error) return error; }
  return undefined;
}

/**
 * How long the run took, from the report itself rather than from the panel's own clock.
 *
 * The report has no run-level duration: `run.startedAt` is required and `run.finishedAt` is
 * optional, so the span between them is the number when both are there. When the run was cut short
 * — interrupted, or a reporter that never saw the end — there is no `finishedAt`, and the attempts
 * are what is left: `attempt.durationMs` is required of every one, so their sum is the time the
 * runner actually spent. It is the lower bound of the two, which is the honest way round: it
 * undercounts the runner's own setup rather than inventing a span from a clock nobody recorded.
 *
 * This is deliberately not the panel's `ui.testing.run` timing, which brackets the whole call
 * including spawning the CLI and resolving the project. The two answer different questions and
 * neither should be read as the other.
 */
export function reportDuration(report: unknown): number | undefined {
  const run = record(record(report)?.run);
  if (!run) return;
  const started = Date.parse(str(run.startedAt));
  const finished = Date.parse(str(run.finishedAt));
  if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) return finished - started;
  let total = 0;
  let seen = false;
  for (const entry of list(run.results)) {
    for (const item of list(record(entry)?.attempts)) {
      const duration = record(item)?.durationMs;
      if (typeof duration !== "number" || !Number.isFinite(duration)) continue;
      total += duration;
      seen = true;
    }
  }
  return seen ? total : undefined;
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
export function progressConfigSource(configPath: string, projectRoot?: string): string {
  return [
    `// Generated by the mobile-dev Testing panel for one run, then deleted. Do not edit or commit.`,
    `import base from ${JSON.stringify(pathToFileURL(configPath).href)};`,
    ...(projectRoot ? [`import { isAbsolute, resolve as resolvePath } from "node:path";`] : []),
    ``,
    `const resolved = typeof base === "function" ? await base() : base;`,
    ...(projectRoot ? [
      `const projectRoot = ${JSON.stringify(projectRoot)};`,
      `const targets = resolved.targets?.map(target => target?.app?.command ? { ...target, app: { ...target.app, command: { ...target.app.command, cwd: target.app.command.cwd === undefined ? projectRoot : isAbsolute(target.app.command.cwd) ? target.app.command.cwd : resolvePath(projectRoot, target.app.command.cwd) } } } : target);`,
    ] : []),
    ``,
    `export default {`,
    `  ...resolved,`,
    ...(projectRoot ? [`  targets,`] : []),
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
  /**
   * A truncated copy of the test to run instead of the file itself — Play until here.
   *
   * The panel re-emits the flow from its first *n* steps, which is the saved file's own text with
   * the later steps and nothing else removed, so every line it keeps is still at the line number
   * it has in the file: the report's lines land on the preview's lines with no translation, and
   * `EmittedTest.calls` indexes the same way because the truncated call list is a prefix of the
   * full one. Project-mode previews run at the same relative path inside an isolated temporary
   * mirror, so the project's discovery patterns and imports keep working without writing into the
   * selected project.
   */
  untilSource?: string;
  /** The e2e target to run against; without it the runner takes the config's first, whatever platform that is. */
  target?: string;
  /** Explicit runner/projection runtime. Project mode remains authoritative when compatible. */
  runtime?: { mode: "project" | "bundled"; root: string };
  /** Required only for a bundled run, whose ephemeral config cannot read a project target. */
  bundledTarget?: BundledTarget;
  /** Non-secret preference for a bundled test containing agent.* calls. */
  model?: { provider: BundledModelProvider; model: string; endpoint?: string };
}

/**
 * The app a bundled run drives. `device` pins the run to one simulator UDID or emulator serial, which is
 * what lets a test matrix run the same test on several devices at once; without it the runner takes
 * whichever booted device it finds, as a single run always has.
 */
export interface BundledTarget { platform: "ios" | "android"; bundleId: string; device?: string }

export type BundledModelProvider = "vercel" | "openrouter" | "openai-compatible" | "chatgpt" | "copilot" | "opencode-console" | "grok";

/**
 * Where the generated config goes: beside the project's own, at the project root.
 *
 * Not in `.e2e/`, tidy as that would be. **The runner takes the project root from the config
 * file's own directory**, so a config one level down makes that directory the root and the run
 * ends in `NO_TESTS: no test file matched "tests/**" under <project>/.e2e`. It is written for one
 * run and removed when the run ends, so it is never a file anyone has to think about.
 */
const PROGRESS_CONFIG = "e2e.config.mobile-dev-progress.mts";

/**
 * Where a Play-until-here run's truncated copy goes: beside the test it was cut from.
 *
 * The name is marked and the file is deleted when the run ends, so it is never a file anyone has
 * to think about — and it keeps the `.e2e.ts` suffix because the project's own test patterns are
 * what make a file discoverable at all; naming the selection does not exempt it from them.
 */
export function untilTestPath(relativePath: string): string {
  return relativePath.endsWith(".e2e.ts")
    ? `${relativePath.slice(0, -".e2e.ts".length)}.mobile-dev-until.e2e.ts`
    : `${relativePath}.mobile-dev-until.e2e.ts`;
}

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
  /** Kills the run's process when aborted, for a matrix lane the user cancels. */
  signal?: AbortSignal;
  release?: () => Promise<void>;
  /** Called for each live `step` event, as it arrives. */
  onProgress?: (progress: TestRunProgress) => void;
  /** The working directory a workspace run spawns from; {@link RUNNER_CWD} unless a test overrides it. */
  runnerCwd?: string;
}

/**
 * The working directory of every run that is not spawned in the user's project.
 *
 * It is a folder that is never deleted, not the run's temp workspace. The first run to need a device
 * starts agent-device's daemon, which is detached, outlives the run and inherits its cwd. Once that
 * cwd is removed every `spawn` the daemon makes fails with `ENOENT`, which agent-device reports as
 * "xcodebuild not found in PATH" before retrying its runner for the whole 240 s `prepare` timeout: the
 * next matrix lane hangs on a fresh device. The workspace keeps the generated config, the test and the
 * output, and reaches the CLI as absolute paths: `--config` is the only path it resolves from cwd; the
 * test and `--output` resolve from the config's folder and the test's imports from its own.
 */
export const RUNNER_CWD = join(homedir(), "Library/Application Support/mobile-dev/e2e-runner");

async function runnerCwd(deps: TestRunDeps): Promise<string> {
  const cwd = deps.runnerCwd ?? RUNNER_CWD;
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  return cwd;
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
  if (request.runtime?.mode === "bundled") return runBundledTest(request, deps);
  if (request.untilSource !== undefined) return runProjectPreview(request, deps);
  const result = await runOnce(request, deps);
  if (!refusedTheConfig(result) || !request.configPath || !deps.onProgress) return result;
  // Without the progress sink nothing is generated, so this is the plain run.
  const { onProgress: _dropped, ...plain } = deps;
  const retried = await runOnce(request, plain);
  // The retry is the answer only if it got further; otherwise the first failure is the real one.
  return retried.steps.length > 0 || retried.status !== result.status ? retried : result;
}

/** Mirrors the project with symlinks while reserving the preview test and config as real temp files. */
async function mirrorProject(source: string, destination: string, reserved: Set<string>, relativePath = ""): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (reserved.has(childRelative) || childRelative === ".e2e") continue;
    const hasReservedChild = [...reserved].some(path => path.startsWith(`${childRelative}/`));
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory() && hasReservedChild) await mirrorProject(from, to, reserved, childRelative);
    else await symlink(from, to, entry.isDirectory() ? "dir" : "file");
  }
}

/** Runs the exact preview from an isolated temp root; the selected project remains read-only. */
async function runProjectPreview(request: TestRunRequest, deps: TestRunDeps): Promise<TestRunResult> {
  if (!request.configPath || request.untilSource === undefined) throw new ExpectedOperationError("invalid_input", "Open the project's e2e config before running this preview.");
  const bin = runnerBin(request.projectPath);
  await deps.release?.();
  // The real path, for the reason `runBundledTest` gives.
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "mobile-dev-e2e-preview-")));
  const configName = "e2e.config.mts";
  try {
    await mirrorProject(request.projectPath, workspace, new Set([request.relativePath, configName]));
    await mkdir(dirname(join(workspace, request.relativePath)), { recursive: true, mode: 0o700 });
    await writeFile(join(workspace, request.relativePath), request.untilSource, { mode: 0o600 });
    await writeFile(join(workspace, configName), progressConfigSource(request.configPath, request.projectPath), { mode: 0o600 });
    // The project's own folder, as in a plain run: it outlives any daemon this run starts.
    return await spawnRun({ command: bin, cwd: request.projectPath, runPath: request.relativePath, configName: join(workspace, configName),
      target: request.target, timeoutMs: request.timeoutMs, spawner: deps.spawner ?? spawn, onProgress: deps.onProgress });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function quoted(value: string): string { return JSON.stringify(value); }

function bundledModelSource(model: TestRunRequest["model"]): { imports: string[]; field: string } | undefined {
  if (!model) return;
  const id = quoted(model.model);
  switch (model.provider) {
    case "vercel": return { imports: ["import { gateway } from 'ai';"], field: `gateway(${id})` };
    case "openrouter": return { imports: ["import { openrouter } from '@openrouter/ai-sdk-provider';"], field: `openrouter(${id})` };
    case "openai-compatible": return {
      imports: ["import { createOpenAICompatible } from '@ai-sdk/openai-compatible';"],
      field: `createOpenAICompatible({ name: 'openai-compatible', baseURL: ${quoted(model.endpoint ?? "http://127.0.0.1:11434/v1")}, apiKey: process.env.LLM_API_KEY }).chatModel(${id})`,
    };
    case "chatgpt": return { imports: ["import { chatgpt } from 'e2e/oauth/chatgpt';"], field: `chatgpt(${id})` };
    case "copilot": return { imports: ["import { copilot } from 'e2e/oauth/copilot';"], field: `copilot(${id})` };
    case "opencode-console": return { imports: ["import { opencodeConsole } from 'e2e/oauth/opencode-console';"], field: `opencodeConsole(${id})` };
    case "grok": return { imports: ["import { grok } from 'e2e/oauth/grok';"], field: `grok(${id})` };
  }
}

/**
 * The target name a bundled run uses and passes to `--target`. A pinned device gets its own name because
 * the engine names its agent-device session after the target (`e2e-<target>-<n>`), and two concurrent
 * runs must never share a session.
 */
export function bundledTargetName(target: BundledTarget): string {
  if (!target.device) return target.platform;
  return `${target.platform}-${target.device.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64)}`;
}

export function bundledConfigSource(target: BundledTarget, model?: TestRunRequest["model"]): string {
  const selected = bundledModelSource(model);
  return [
    "import { mobile } from '@e2e-dev/mobile';",
    ...(selected?.imports ?? []),
    "",
    "export default {",
    ...(selected ? ["  agents: { default: {", `    model: ${selected.field},`, "    system: 'You are a thorough QA agent. Verify every outcome.',", "  } },"] : []),
    `  targets: [{ name: ${quoted(bundledTargetName(target))}, engine: mobile({ platform: ${quoted(target.platform)}${target.device ? `, device: ${quoted(target.device)}` : ""} }), app: { bundleId: ${quoted(target.bundleId)} } }],`,
    "  workers: 1,",
    "};",
    "",
  ].join("\n");
}

export function requiresModel(source: string): boolean { return /\bagent\s*\.\s*(act|assert|waitFor|extract)\s*\(/.test(source); }

/** Runs from an isolated workspace; only the saved test source crosses out of the user's project. */
async function runBundledTest(request: TestRunRequest, deps: TestRunDeps): Promise<TestRunResult> {
  if (!request.runtime || !request.bundledTarget) throw new ExpectedOperationError("invalid_input", "Choose the mirrored app before running in bundled mode.");
  const source = request.untilSource ?? await readFile(join(request.projectPath, request.relativePath), "utf8");
  if (requiresModel(source) && !request.model)
    throw new ExpectedOperationError("invalid_input", "This test contains agent steps. Choose a provider and model in Testing, then run it again.");
  const requiredKey = request.model?.provider === "vercel" ? "AI_GATEWAY_API_KEY" : request.model?.provider === "openrouter" ? "OPENROUTER_API_KEY" : undefined;
  if (requiredKey && !process.env[requiredKey]) throw new ExpectedOperationError("invalid_input", `${requiredKey} is not set. Add it to Mobile Dev's environment, then run again.`);
  await deps.release?.();
  // The real path: macOS's tmpdir is under /var, a symlink to /private/var. The runner sees the
  // test at its real path but the config at the linked one, cannot place its steps in the test,
  // and reports every step at "unknown" line 1, which leaves the preview with no line marks.
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "mobile-dev-e2e-run-")));
  const runPath = request.untilSource === undefined ? request.relativePath : untilTestPath(request.relativePath);
  const config = join(workspace, "e2e.config.mts");
  const progressConfig = join(workspace, PROGRESS_CONFIG);
  try {
    await mkdir(dirname(join(workspace, runPath)), { recursive: true, mode: 0o700 });
    await writeFile(join(workspace, runPath), source, { mode: 0o600 });
    await writeFile(config, bundledConfigSource(request.bundledTarget, request.model), { mode: 0o600 });
    if (deps.onProgress) await writeFile(progressConfig, progressConfigSource(config), { mode: 0o600 });
    await symlink(join(request.runtime.root, "node_modules"), join(workspace, "node_modules"), "dir");
    return await spawnRun({
      command: process.execPath,
      commandArgs: [join(request.runtime.root, "node_modules/e2e/dist/cli/bin.js")],
      cwd: await runnerCwd(deps), runPath, configName: deps.onProgress ? progressConfig : config,
      // Reports and artifacts go beside the run's own config, so concurrent lanes never share a directory
      // and the workspace removal below takes them away.
      output: join(workspace, "output"),
      target: bundledTargetName(request.bundledTarget), timeoutMs: request.timeoutMs, spawner: deps.spawner ?? spawn,
      onProgress: deps.onProgress, signal: deps.signal,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function spawnRun(input: { command: string; commandArgs?: string[]; cwd: string; runPath: string; configName?: string; target?: string; output?: string; timeoutMs?: number; spawner: Spawner; signal?: AbortSignal; onProgress?: (progress: TestRunProgress) => void }): Promise<TestRunResult> {
  input.signal?.throwIfAborted();
  const child = input.spawner(input.command, [
    ...(input.commandArgs ?? []), "run", input.runPath, "--reporter", "json",
    ...(input.output ? ["--output", input.output] : []),
    ...(input.target ? ["--target", input.target] : []), ...(input.configName ? ["--config", input.configName] : []),
  ], { cwd: input.cwd, stdio: ["ignore", "pipe", "pipe"], env: runnerEnv() });
  let stdout = "", stderr = "", pending = "";
  child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", chunk => { stdout += chunk; });
  child.stderr?.on("data", chunk => {
    stderr += chunk;
    if (!input.onProgress) return;
    pending += chunk;
    const lines = pending.split("\n"); pending = lines.pop() ?? "";
    for (const line of lines) { const progress = parseProgressLine(line); if (progress) input.onProgress(progress); }
  });
  const timeoutMs = input.timeoutMs ?? 10 * 60_000;
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new ExpectedOperationError("resource_limit", `The test run did not finish within ${Math.round(timeoutMs / 1000)}s.`)); }, timeoutMs);
    const cancel = () => { child.kill("SIGTERM"); reject(new ExpectedOperationError("cancelled", "The test run was cancelled.")); };
    input.signal?.addEventListener("abort", cancel, { once: true });
    const done = () => { clearTimeout(timer); input.signal?.removeEventListener("abort", cancel); };
    timer.unref?.(); child.on("error", error => { done(); reject(error); }); child.on("close", code => { done(); resolve(code ?? 1); });
  });
  const report = parseReport(stdout);
  const steps = report ? reportSteps(report, input.runPath) : [];
  const durationMs = report ? reportDuration(report) : undefined;
  const status = reportStatus(report, exitCode);
  const error = report && status !== "passed" ? reportError(report, input.runPath) : undefined;
  return { status, exitCode, steps, ...(durationMs === undefined ? {} : { durationMs }), ...(error ? { error } : {}), ...(steps.length === 0 ? { output: tail(`${stdout}\n${stderr}`) } : {}) };
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
  // Play until here runs a truncated copy of the file, not the file: see `untilSource`. The real
  // test stays exactly as the user saved it, and the copy goes when the run does.
  const runPath = request.untilSource === undefined ? request.relativePath : untilTestPath(request.relativePath);
  const partial = request.untilSource === undefined ? undefined : join(request.projectPath, runPath);
  if (partial && request.untilSource !== undefined) await writeFile(partial, request.untilSource);
  const discard = () => {
    if (generated) void rm(generated, { force: true });
    if (partial) void rm(partial, { force: true });
  };
  const child = spawner(bin, [
    "run", runPath, "--reporter", "json",
    ...(request.target ? ["--target", request.target] : []),
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
      discard();
      reject(new ExpectedOperationError("resource_limit", `The test run did not finish within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    timer.unref?.();
    child.on("error", error => { clearTimeout(timer); discard(); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  if (generated) await rm(generated, { force: true });
  if (partial) await rm(partial, { force: true });
  const report = parseReport(stdout);
  // The report attributes its steps to the file the runner actually ran, which for a partial run
  // is the copy; its line numbers are the real file's, so the panel needs no translation.
  const steps = report ? reportSteps(report, runPath) : [];
  const durationMs = report ? reportDuration(report) : undefined;
  const status = reportStatus(report, exitCode);
  const error = report && status !== "passed" ? reportError(report, runPath) : undefined;
  return {
    status,
    exitCode,
    steps,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(error ? { error } : {}),
    // Only when there is nothing to show on the lines: an exit with no report is the runner
    // refusing before it got to the test, and its own words are the only explanation there is.
    ...(steps.length === 0 ? { output: tail(`${stdout}\n${stderr}`) } : {}),
  };
}
