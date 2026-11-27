import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { chmod, copyFile, mkdir, readFile as readFileAsync, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { traceSiftAnalysisSchema, traceSiftHandoffSchema, traceSiftRnTargetsSchema, type TraceSiftAnalysis, type TraceSiftCapture, type TraceSiftProfileType, type TraceSiftReactHandoff, type TraceSiftSetupReason, type TraceSiftRnTargets, type TraceSiftTaskHandoff } from "@mobile-dev/shared/tracesift.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";

const STARTUP_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const EXPLORE_TIMEOUT_MS = 15_000;
const RECORD_LAUNCH_TIMEOUT_MS = 60_000;
const RECORD_START_TIMEOUT_MS = 60_000;
/** Chrome writes the whole trace through the protocol before `record stop` returns. */
const RECORD_STOP_TIMEOUT_MS = 4 * 60_000;
const RECORD_CLOSE_TIMEOUT_MS = 30_000;
/** A cold Gradle or xcodebuild release build, with pods, is many minutes. */
const PROFILE_BUILD_TIMEOUT_MS = 30 * 60_000;
/**
 * Listing React Native targets is one `/json/list` fetch behind a 5s timeout
 * of its own, and then — only when Metro showed nothing — a short window held
 * open for a release build to dial in. Both have to fit inside this.
 */
const RECORD_TARGETS_TIMEOUT_MS = 30_000;
/** A target list is a handful of short strings; anything larger is not one. */
const MAX_CLI_STDOUT_BYTES = 1024 * 1024;
const SETUP_TIMEOUT_MS = 5 * 60_000;
const SETUP_DIAGNOSTICS_MAX_BYTES = 16_384;
/** Health only proves integration API v1, which predates the Explore endpoints. */
const EXPLORE_UNSUPPORTED = "This TraceSift service cannot open findings in the panel. Update TraceSift and restart it, or use Open in browser.";
type Descriptor = { version: string; apiVersion: 1; pid: number; childPid: number; instance: string; baseUrl: string; token: string; startedAt: number };

export class TraceSiftError extends ExpectedOperationError {
  readonly kind: "setup" | "version" | "startup" | "request" | "response";
  readonly setupReason?: TraceSiftSetupReason;
  constructor(message: string, kind: "setup" | "version" | "startup" | "request" | "response",
    setupReason?: TraceSiftSetupReason) {
    super("invalid_input", message);
    this.kind = kind;
    this.setupReason = setupReason;
  }
}

function processAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error instanceof Error && "code" in error && error.code === "EPERM"; }
}

// The published @callstack/tracesift CLI declares macOS and Linux as its supported OSes.
function requireTraceSiftHost() {
  if (process.platform === "win32") throw new TraceSiftError("TraceSift profile analysis requires a macOS or Linux host.", "version", "unsupported");
}

async function parseDescriptor(path: string): Promise<Descriptor | undefined> {
  let raw: unknown;
  try {
    const metadata = await stat(path);
    if ((metadata.mode & 0o077) !== 0) throw new TraceSiftError("TraceSift service.json permissions are unsafe. Restart TraceSift so it recreates the file with mode 0600.", "setup", "startup_failed");
    raw = JSON.parse(await readFileAsync(path, "utf8"));
  } catch (error) {
    if (error instanceof TraceSiftError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw new TraceSiftError("TraceSift service.json could not be read. Stop TraceSift, remove the stale file if no process is running, and retry.", "setup", "startup_failed");
  }
  if (typeof raw !== "object" || raw === null) throw new TraceSiftError("TraceSift service.json is invalid. Restart TraceSift.", "setup", "startup_failed");
  const value = raw as Record<string, unknown>;
  if (value.apiVersion !== 1) throw new TraceSiftError("This TraceSift service uses an incompatible integration API. Update TraceSift and restart it.", "version", "unsupported");
  if (typeof value.baseUrl !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.baseUrl)
    || typeof value.token !== "string" || value.token.length < 16 || typeof value.instance !== "string"
    || typeof value.version !== "string" || typeof value.pid !== "number" || typeof value.childPid !== "number"
    || typeof value.startedAt !== "number") throw new TraceSiftError("TraceSift service.json is invalid. Restart TraceSift.", "setup", "startup_failed");
  return value as Descriptor;
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function health(descriptor: Descriptor, signal?: AbortSignal) {
  if (!processAlive(descriptor.pid) && !processAlive(descriptor.childPid)) return false;
  try {
    const response = await fetch(new URL("/api/integration/v1/health", descriptor.baseUrl), {
      headers: { Authorization: `Bearer ${descriptor.token}` }, cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1500)]) : AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body = await response.json() as { apiVersion?: unknown; instance?: unknown };
    return body.apiVersion === 1 && body.instance === descriptor.instance;
  } catch { return false; }
}

function responseError(status: number, body: unknown) {
  const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error : `TraceSift request failed with HTTP ${status}.`;
  return status < 500 ? new TraceSiftError(message, "request") : new Error(`TraceSift request failed with HTTP ${status}.`);
}

/** The one JSON object a `--json` subcommand prints, or nothing when it printed prose. */
function parseCliJson(output: string): Record<string, unknown> | undefined {
  const text = output.trim();
  if (!text.startsWith("{")) return;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return; }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

/**
 * Turn a non-zero `tracesift` exit into the sentence worth showing.
 *
 * A `--json` subcommand reports its own failure as `{ error }` on stdout, so
 * that is read before stderr. A CLI that rejects the verb or the flag is a
 * version to update rather than a recording that went wrong, and the two cases
 * differ: `record` itself is missing, or `record` is there without the React
 * Native options 0.6.0 added.
 */
function cliFailure(diagnostics: string, output: string, code: number | null, failed: (code: number | null) => string): Error {
  const said = diagnostics.trim().replace(/^tracesift:\s*/, "");
  if (/unknown command/i.test(said)) {
    return new TraceSiftError("This TraceSift cannot record. Update @callstack/tracesift, run `tracesift init`, and retry.", "version");
  }
  if (/unknown option '?-{0,2}(platform|metro|target-id)'?/i.test(said)) {
    return new TraceSiftError("This TraceSift cannot record React Native. Update @callstack/tracesift to 0.7.0 or newer (or point TRACE_SIFT_COMMAND at a newer build), run `tracesift init`, and retry.", "version");
  }
  const reported = parseCliJson(output)?.error;
  if (typeof reported === "string" && reported.trim()) return new TraceSiftError(reported.trim().slice(0, 1024), "request");
  if (/xcodebuild\b.*(?:exit code|exited with (?:code|status))\s*65/i.test(said)) {
    const errors = (output + "\n" + diagnostics).split(/\r?\n/)
      .map(line => line.trim()).filter(line => /\berror:|fatal error:/i.test(line) && !/^tracesift:/.test(line))
      .slice(-3).map(line => line.slice(0, 300));
    if (errors.length) return new TraceSiftError(`${said}\n${errors.join("\n")}`, "request");
  }
  return said ? new TraceSiftError(said, "request") : new Error(failed(code));
}

type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/** The lockfile decides, as it does in `tracesift profile build`: the wrong manager leaves two lockfiles. */
async function detectManager(present: (path: string) => Promise<boolean>): Promise<PackageManager> {
  for (const [lockfile, manager] of [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["package-lock.json", "npm"]] as const) {
    if (await present(lockfile)) return manager;
  }
  return "npm";
}

const PROFILER_PACKAGE = "@callstack/tracesift-profiler";
const PROFILER_INSTALL_SPEC = `${PROFILER_PACKAGE}@0.7.0`;

function profilerInstallArgs(manager: PackageManager, source = PROFILER_INSTALL_SPEC) {
  const flag = manager === "yarn" || manager === "bun" ? "--dev" : "--save-dev";
  return [manager === "npm" ? "install" : "add", flag, source];
}

/** CocoaPods can retain a lockfile entry after its generated project points at an old package. */
async function profilerPodLinked(root: string): Promise<boolean> {
  const ios = join(root, "ios");
  try {
    const [lock, manifest, project, installedSpec, packageJson] = await Promise.all([
      readFileAsync(join(ios, "Podfile.lock"), "utf8"),
      readFileAsync(join(ios, "Pods", "Manifest.lock"), "utf8"),
      readFileAsync(join(ios, "Pods", "Pods.xcodeproj", "project.pbxproj"), "utf8"),
      readFileAsync(join(ios, "Pods", "Local Podspecs", "TracesiftProfiler.podspec.json"), "utf8"),
      readFileAsync(join(root, "node_modules", "@callstack", "tracesift-profiler", "package.json"), "utf8"),
    ]);
    const podPath = ':path: "../node_modules/@callstack/tracesift-profiler"';
    const version = (JSON.parse(packageJson) as { version?: unknown }).version;
    const specVersion = (JSON.parse(installedSpec) as { version?: unknown }).version;
    return lock.trim() === manifest.trim()
      && lock.includes(`TracesiftProfiler:\n    ${podPath}`)
      && project.includes('path = "../../node_modules/@callstack/tracesift-profiler";')
      && typeof version === "string" && version === specVersion;
  } catch { return false; }
}

export class TraceSiftClient {
  private ready?: Promise<Descriptor>;
  private child?: ChildProcess;
  private readonly home: string;
  private readonly command: string;
  private readonly recordingsDirectory: string;
  private recordingProject?: string;
  constructor(command = process.env.TRACE_SIFT_COMMAND ?? "tracesift", home?: string, recordingsDirectory = join(homedir(), "Library/Application Support/mobile-dev/tracesift")) {
    this.command = command;
    this.home = home ?? process.env.TRACE_SIFT_HOME ?? join(homedir(), ".tracesift");
    this.recordingsDirectory = recordingsDirectory;
  }

  /** Recorded traces belong to Mobile Dev so they survive TraceSift service restarts. */
  async listRecordedProfiles() {
    const entries = await readdir(this.recordingsDirectory, { withFileTypes: true }).catch(error => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    const profiles = await Promise.all(entries.filter(entry => entry.isFile() && /^profile-.*\.json(?:\.gz)?$/.test(entry.name)).map(async entry => {
      const path = join(this.recordingsDirectory, entry.name);
      const info = await stat(path);
      const metadata = await readFileAsync(`${path}.metadata`, "utf8").then(value => {
        try { return JSON.parse(value) as unknown; } catch { return undefined; }
      }, () => undefined);
      const projectName = typeof metadata === "object" && metadata !== null && "projectName" in metadata && typeof metadata.projectName === "string" ? metadata.projectName : undefined;
      return { path, name: entry.name, recordedAt: info.mtime.toISOString(), sizeBytes: info.size, ...(projectName ? { projectName } : {}) };
    }));
    return profiles.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 100);
  }

  async deleteRecordedProfile(path: string) {
    if (dirname(path) !== this.recordingsDirectory || !/^profile-.*\.json(?:\.gz)?$/.test(basename(path))) {
      throw new TraceSiftError("That recording is not in the saved profiles folder.", "request");
    }
    await rm(path);
    await rm(`${path}.metadata`, { force: true });
  }

  private async keepRecording(path: string) {
    await mkdir(this.recordingsDirectory, { recursive: true, mode: 0o700 });
    const extension = path.endsWith(".json.gz") ? ".json.gz" : ".json";
    const destination = join(this.recordingsDirectory, `profile-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}${extension}`);
    await copyFile(path, destination);
    await chmod(destination, 0o600);
    const project = this.recordingProject ?? await this.readProject().catch(() => undefined);
    if (project) await this.writePrivateJson(`${destination}.metadata`, { projectName: basename(project) });
    this.recordingProject = undefined;
    return destination;
  }

  private async existing(signal?: AbortSignal) {
    const descriptor = await parseDescriptor(join(this.home, "service.json"));
    return descriptor && await health(descriptor, signal) ? descriptor : undefined;
  }

  private async start(signal?: AbortSignal): Promise<Descriptor> {
    requireTraceSiftHost();
    const reusable = await this.existing(signal);
    if (reusable) return reusable;
    const port = await freePort();
    let child: ChildProcess;
    try {
      child = spawn(this.command, ["start", "--port", String(port), "--no-open"], {
        stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TRACE_SIFT_HOME: this.home },
      });
    } catch { throw new TraceSiftError("TraceSift is not installed. Run `npm install -g @callstack/tracesift@0.7.0`, then `tracesift init`.", "setup", "missing_cli"); }
    this.child = child;
    let spawnError: unknown;
    let exited = false;
    let diagnostics = "";
    child.once("error", error => { spawnError = error; });
    child.once("exit", () => { exited = true; });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => { if (diagnostics.length < 16_384) diagnostics += String(chunk).slice(0, 16_384 - diagnostics.length); });
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (spawnError) {
        const missing = spawnError instanceof Error && "code" in spawnError && spawnError.code === "ENOENT";
        if (missing) throw new TraceSiftError("TraceSift is not installed or is not available to Mobile Dev. Run `npm install -g @callstack/tracesift@0.7.0`, then `tracesift init`.", "setup", "missing_cli");
        throw new TraceSiftError("TraceSift could not start. Check the installation and retry.", "startup", "startup_failed");
      }
      const descriptor = await this.existing(signal);
      if (descriptor) return descriptor;
      if (exited && /another tracesift operation/i.test(diagnostics) === false) {
        if (/node\.js|unsupported|platform|architecture/i.test(diagnostics)) throw new TraceSiftError("This TraceSift installation does not support the current Node.js version or platform. Update Node and TraceSift, run `tracesift init`, then retry.", "version", "unsupported");
        if (/tracesift init|install the app|installation is incomplete|matching this cli release/i.test(diagnostics)) {
          throw new TraceSiftError("TraceSift is installed, but its app is missing or does not match this CLI. Run `tracesift init`, then retry.", "setup", "needs_init");
        }
        throw new TraceSiftError("TraceSift could not start. Retry, or run `tracesift start --no-open` in a terminal to see its startup error.", "startup", "startup_failed");
      }
      await delay(200, undefined, { signal });
    }
    throw new TraceSiftError("TraceSift did not become ready within 60 seconds. Retry, or run `tracesift start --no-open` in a terminal to see its startup error.", "startup", "startup_failed");
  }

  private service(signal?: AbortSignal) {
    return this.ready ??= this.start(signal).catch(error => { this.ready = undefined; throw error; });
  }

  async readyService(signal?: AbortSignal) { await this.service(signal); }

  private runSetupCommand(command: string, args: string[], label: string, signal?: AbortSignal,
    env: NodeJS.ProcessEnv = process.env, cwd?: string, timeoutMs = SETUP_TIMEOUT_MS) {
    return new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try { child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env, ...(cwd ? { cwd } : {}) }); }
      catch { reject(new TraceSiftError(`${label} could not start because ${command} is not available to Mobile Dev. Run the command in a terminal instead.`, "setup", "missing_cli")); return; }
      let diagnostics = "";
      let settled = false;
      const append = (chunk: unknown) => {
        if (diagnostics.length < SETUP_DIAGNOSTICS_MAX_BYTES) diagnostics += String(chunk).slice(0, SETUP_DIAGNOSTICS_MAX_BYTES - diagnostics.length);
      };
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => { child.kill("SIGTERM"); finish(signal?.reason instanceof Error ? signal.reason : new Error(`${label} was cancelled.`)); };
      const timeout = setTimeout(() => { child.kill("SIGTERM"); finish(new TraceSiftError(`${label} did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`, "setup", "startup_failed")); }, timeoutMs);
      child.once("error", error => {
        const missing = "code" in error && error.code === "ENOENT";
        finish(missing
          ? new TraceSiftError(`${label} could not start because ${command} is not available to Mobile Dev. Run the command in a terminal instead.`, "setup", "missing_cli")
          : new TraceSiftError(`${label} could not start.`, "setup", "startup_failed"));
      });
      child.once("exit", code => {
        const detail = diagnostics.trim();
        finish(code === 0 ? undefined : new TraceSiftError(detail || `${label} exited with code ${code}.`, "setup", "startup_failed"));
      });
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async installCli(signal?: AbortSignal) {
    requireTraceSiftHost();
    await this.runSetupCommand("npm", ["install", "-g", "@callstack/tracesift@0.7.0"], "TraceSift installation", signal);
  }

  async initialize(signal?: AbortSignal) {
    requireTraceSiftHost();
    await this.runSetupCommand(this.command, ["init"], "TraceSift initialization", signal,
      { ...process.env, TRACE_SIFT_HOME: this.home });
  }

  private analysisPath(analysisId: string) {
    return join(this.home, "integrations", "mobile-dev", `${createHash("sha256").update(analysisId).digest("hex")}.json`);
  }

  private viewPath(viewId: string | number) {
    const key = createHash("sha256").update(JSON.stringify(viewId)).digest("hex");
    return join(this.home, "integrations", "mobile-dev", `view-${key}.json`);
  }

  private inputPath(path: string, profileType: TraceSiftProfileType) {
    const key = createHash("sha256").update(JSON.stringify({ path, profileType })).digest("hex");
    return join(this.home, "integrations", "mobile-dev", `input-${key}.json`);
  }

  private async writePrivateJson(file: string, value: unknown) {
    const directory = join(this.home, "integrations", "mobile-dev");
    const temporary = join(directory, `.analysis-${randomUUID()}`);
    try {
      await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }

  private async persistAnalysis(analysis: TraceSiftAnalysis) {
    const directory = join(this.home, "integrations", "mobile-dev");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.writePrivateJson(this.analysisPath(analysis.analysisId), analysis);
  }

  async remember(viewId: string | number, analysisId: string) {
    const analysis = await stat(this.analysisPath(analysisId)).catch(() => undefined);
    if (!analysis?.isFile()) throw new TraceSiftError("This TraceSift analysis is no longer available. Run it again.", "request");
    const directory = join(this.home, "integrations", "mobile-dev");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.writePrivateJson(this.viewPath(viewId), { apiVersion: 1, analysisId });
  }

  private async rememberInput(path: string, profileType: TraceSiftProfileType, analysisId: string) {
    const directory = join(this.home, "integrations", "mobile-dev");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await this.writePrivateJson(this.inputPath(path, profileType), { apiVersion: 1, analysisId });
  }

  // The investigation's source folder: the plugin's choice, not TraceSift's, stored beside the analyses to inherit their 0700 directory.
  private projectPath() { return join(this.home, "integrations", "mobile-dev", "project.json"); }

  async readProject(): Promise<string | undefined> {
    let stored: unknown;
    try { stored = JSON.parse(await readFileAsync(this.projectPath(), "utf8")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw new TraceSiftError("The saved project could not be read.", "request");
    }
    const path = typeof stored === "object" && stored !== null && "path" in stored
      && typeof stored.path === "string" ? stored.path : undefined;
    if (!path) throw new TraceSiftError("The saved project is invalid. Choose it again.", "request");
    // A moved or deleted folder is no longer a project; don't hand the chat a dead path.
    const directory = await stat(path).catch(() => undefined);
    return directory?.isDirectory() ? path : undefined;
  }

  async writeProject(path: string) {
    const directory = await stat(path).catch(() => undefined);
    if (!directory?.isDirectory()) throw new TraceSiftError("That project folder does not exist.", "request");
    const resolved = await realpath(path);
    await mkdir(join(this.home, "integrations", "mobile-dev"), { recursive: true, mode: 0o700 });
    await this.writePrivateJson(this.projectPath(), { apiVersion: 1, path: resolved });
    return resolved;
  }

  private async restoreReference(referencePath: string): Promise<TraceSiftAnalysis | undefined> {
    let reference: unknown;
    try { reference = JSON.parse(await readFileAsync(referencePath, "utf8")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw new Error("The saved TraceSift analysis reference could not be read.");
    }
    const analysisId = typeof reference === "object" && reference !== null && "analysisId" in reference
      && typeof reference.analysisId === "string" ? reference.analysisId : undefined;
    if (!analysisId) throw new Error("The saved TraceSift analysis reference is invalid.");
    let stored: unknown;
    try { stored = JSON.parse(await readFileAsync(this.analysisPath(analysisId), "utf8")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw new Error("The saved TraceSift analysis could not be read.");
    }
    const parsed = traceSiftAnalysisSchema.safeParse(stored);
    if (!parsed.success) throw new Error("The saved TraceSift analysis is invalid.");
    return parsed.data;
  }

  async restore(viewId: string | number): Promise<TraceSiftAnalysis | undefined> {
    return this.restoreReference(this.viewPath(viewId));
  }

  async restoreInput(path: string, profileType: TraceSiftProfileType): Promise<TraceSiftAnalysis | undefined> {
    return this.restoreReference(this.inputPath(path, profileType));
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal, unsupported?: string): Promise<unknown> {
    let descriptor = await this.service(signal);
    const send = (requestSignal: AbortSignal) => fetch(new URL(path, descriptor.baseUrl), {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${descriptor.token}` },
      signal: requestSignal, redirect: "error",
    });
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      response = await send(signal ? AbortSignal.any([signal, timeout]) : timeout);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && error.name === "TimeoutError") throw new Error("TraceSift did not respond to the request in time. Restart it and retry.");
      this.ready = undefined;
      descriptor = await this.service(signal);
      try {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        response = await send(signal ? AbortSignal.any([signal, timeout]) : timeout);
      } catch (retryError) {
        signal?.throwIfAborted();
        if (retryError instanceof Error && retryError.name === "TimeoutError") throw new Error("TraceSift did not respond to the request in time. Restart it and retry.");
        throw new Error("TraceSift stopped while handling the request. Restart it and retry.");
      }
    }
    let body: unknown;
    let unreadable = false;
    try { body = await response.json(); }
    catch { unreadable = true; }
    // A route this service does not have is a service older than the feature.
    // The service answers its own 404s with a message naming the failure (an
    // expired analysis, say); an absent route names nothing, or is not JSON at all.
    if (unsupported !== undefined && !response.ok && (response.status === 404 || response.status === 405 || response.status === 501)
      && (unreadable || !(typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"))) {
      throw new TraceSiftError(unsupported, "version");
    }
    if (unreadable) throw new Error("TraceSift returned an invalid response.");
    if (!response.ok) throw responseError(response.status, body);
    return body;
  }

  async analyze(path: string, profileType: TraceSiftProfileType, signal?: AbortSignal,
    ready?: (outcome: "success" | "failed", duration: number) => void): Promise<TraceSiftAnalysis> {
    const resolved = await realpath(path).catch(() => { throw new TraceSiftError("The profile path does not exist or is not readable.", "setup"); });
    const metadata = await stat(resolved).catch(() => { throw new TraceSiftError("The profile path does not exist or is not readable.", "setup"); });
    if (!metadata.isFile()) throw new TraceSiftError("The profile path must point to a regular file.", "setup");
    let form: FormData;
    try {
      const file = await openAsBlob(resolved);
      form = new FormData();
      form.set("profile", file, basename(resolved));
      form.set("profileType", profileType);
    } catch { throw new TraceSiftError("The profile could not be opened for upload. Check its permissions and retry.", "setup"); }
    const readyAt = performance.now();
    try { await this.service(signal); ready?.("success", performance.now() - readyAt); }
    catch (error) { ready?.("failed", performance.now() - readyAt); throw error; }
    const parsed = traceSiftAnalysisSchema.safeParse(await this.request("/api/integration/v1/analyze", { method: "POST", body: form }, signal));
    if (!parsed.success) throw new Error("TraceSift returned an invalid analysis response.");
    await this.persistAnalysis(parsed.data);
    await this.rememberInput(path, profileType, parsed.data.analysisId);
    return parsed.data;
  }

  /** Has the TraceSift CLI open its own loopback Explore URL. The tree and timeline stay in the running service; the persisted analysis carries only card ids. */
  async openExplore(analysisId: string, taskIndex: number, focus?: string, signal?: AbortSignal) {
    await this.service(signal);
    const analysisPath = this.analysisPath(analysisId);
    const analysisFile = await stat(analysisPath).catch(() => undefined);
    if (!analysisFile?.isFile()) throw new TraceSiftError("This analysis is no longer available to Explore. Run it again.", "request");
    const args = ["explore", analysisPath, "--task", String(taskIndex), ...(focus ? ["--focus", focus] : [])];
    await this.launchExplore(args, signal);
  }

  async openReactExplore(analysisId: string, rootId: number, commitIndex: number, signal?: AbortSignal) {
    await this.service(signal);
    const analysisPath = this.analysisPath(analysisId);
    const analysisFile = await stat(analysisPath).catch(() => undefined);
    if (!analysisFile?.isFile()) throw new TraceSiftError("This analysis is no longer available to Explore. Run it again.", "request");
    await this.launchExplore(["explore", analysisPath, "--commit", `${rootId}.${commitIndex}`], signal);
  }

  private async launchExplore(args: string[], signal?: AbortSignal) {
    await this.runCommand(args, {
      timeoutMs: EXPLORE_TIMEOUT_MS, signal,
      cancelled: "TraceSift Explore was cancelled.",
      timedOut: "TraceSift Explore did not open within 15 seconds.",
      missing: "TraceSift is not installed or could not run `tracesift explore`.",
      failed: code => `TraceSift Explore exited with code ${code}.`,
    });
  }

  /**
   * Run one `tracesift` subcommand to completion and hand back what it printed.
   *
   * The CLI reports its own failures on stderr as `tracesift: <message>`, so a
   * non-zero exit carries the sentence worth showing; only when it says nothing
   * does the caller's own wording stand in. Stdout is captured rather than
   * discarded because the `--json` subcommands answer there, and a failing one
   * puts its message there too.
   */
  private async runCommand(args: string[], messages: {
    timeoutMs: number; signal?: AbortSignal; cancelled: string; timedOut: string; missing: string;
    failed: (code: number | null) => string;
    /** Working directory for the child; only set where the CLI resolves project-relative paths. */
    cwd?: string;
    /** Keep the end of the output, not the start: a long build reports its failure last. */
    maxOutputTail?: boolean;
    env?: NodeJS.ProcessEnv;
  }): Promise<string> {
    const { signal } = messages;
    return await new Promise<string>((resolve, reject) => {
      let diagnostics = "";
      let output = "";
      let settled = false;
      const child = spawn(this.command, args, {
        stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...messages.env, TRACE_SIFT_HOME: this.home },
        ...(messages.cwd ? { cwd: messages.cwd } : {}),
      });
      child.stdout?.setEncoding("utf8");
      const tail = messages.maxOutputTail === true;
      child.stdout?.on("data", chunk => {
        if (tail) output = (output + String(chunk)).slice(-MAX_CLI_STDOUT_BYTES);
        else if (output.length < MAX_CLI_STDOUT_BYTES) output += String(chunk).slice(0, MAX_CLI_STDOUT_BYTES - output.length);
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", chunk => {
        if (tail) diagnostics = (diagnostics + String(chunk)).slice(-16_384);
        else if (diagnostics.length < 16_384) diagnostics += String(chunk).slice(0, 16_384 - diagnostics.length);
      });
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(output);
      };
      const abort = () => { child.kill("SIGTERM"); finish(signal?.reason instanceof Error ? signal.reason : new Error(messages.cancelled)); };
      const timeout = setTimeout(() => { child.kill("SIGTERM"); finish(new Error(messages.timedOut)); }, messages.timeoutMs);
      child.once("error", () => finish(new TraceSiftError(messages.missing, "setup")));
      child.once("exit", code => {
        if (code === 0) { finish(); return; }
        // The CLI's own verdict is its last `tracesift:` line; what precedes it is build noise.
        const verdict = tail ? [...diagnostics.matchAll(/^tracesift:.*$/gm)].at(-1)?.[0] : undefined;
        finish(cliFailure(verdict ?? (tail ? diagnostics.slice(-1024) : diagnostics), output, code, messages.failed));
      });
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /** One `--json` subcommand, with its object parsed. */
  private async runCommandJson(args: string[], messages: Parameters<TraceSiftClient["runCommand"]>[1]): Promise<unknown> {
    const output = await this.runCommand(args, messages);
    const parsed = parseCliJson(output);
    if (parsed === undefined) throw new TraceSiftError("TraceSift answered with something other than JSON. Update @callstack/tracesift and retry.", "response");
    return parsed;
  }

  /** One task with its call tree and timeline, which `/analyze` never ships. Checked at its seams only. */
  async exploreTask(analysisId: string, taskIndex: number, signal?: AbortSignal): Promise<TraceSiftTaskHandoff> {
    const body = await this.request(`/api/integration/v1/task?analysisId=${encodeURIComponent(analysisId)}&taskIndex=${taskIndex}`, { method: "GET" }, signal, EXPLORE_UNSUPPORTED);
    if (typeof body !== "object" || body === null) throw new Error("TraceSift returned an invalid task response.");
    const value = body as Record<string, unknown>;
    if (value.apiVersion !== 1 || typeof value.analysisId !== "string"
      || typeof value.title !== "string" || typeof value.totalMs !== "number" || !Number.isFinite(value.totalMs)
      || typeof value.card !== "object" || value.card === null || typeof (value.card as Record<string, unknown>).tree !== "object"
      || (value.card as Record<string, unknown>).tree === null || typeof (value.card as Record<string, unknown>).timeline !== "object"
      || (value.card as Record<string, unknown>).timeline === null) throw new Error("TraceSift returned an invalid task response.");
    // The service names the profile `title`, the explorer's hand-off `profileTitle`.
    return { analysisId: value.analysisId, profileTitle: value.title, totalMs: value.totalMs, card: value.card as Record<string, unknown> };
  }

  /** Every commit timeline of one React analysis. */
  async exploreReact(analysisId: string, signal?: AbortSignal): Promise<TraceSiftReactHandoff> {
    const body = await this.request(`/api/integration/v1/react-explore?analysisId=${encodeURIComponent(analysisId)}`, { method: "GET" }, signal, EXPLORE_UNSUPPORTED);
    if (typeof body !== "object" || body === null) throw new Error("TraceSift returned an invalid commit timeline response.");
    const value = body as Record<string, unknown>;
    if (value.apiVersion !== 1 || typeof value.analysisId !== "string" || typeof value.title !== "string"
      || typeof value.explore !== "object" || value.explore === null || !Array.isArray(value.cards)) {
      throw new Error("TraceSift returned an invalid commit timeline response.");
    }
    return { analysisId: value.analysisId, profileTitle: value.title, explore: value.explore, cards: value.cards };
  }

  async handoff(analysisId: string, cardId: string, signal?: AbortSignal) {
    const parsed = traceSiftHandoffSchema.safeParse(await this.request("/api/integration/v1/handoff", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId, cardId }),
    }, signal));
    if (!parsed.success) throw new Error("TraceSift returned an invalid handoff response.");
    return parsed.data.handoff;
  }

  /**
   * The recorder's own state files.
   *
   * `tracesift record` keeps `browser.json` and `record.json` in its home for
   * exactly this: a second process can see what the first one left. Reading
   * them beats parsing the sentences the CLI prints for a person, and it means
   * a panel reopened mid-recording finds the recording still there.
   */
  private async readRecordFile(name: string): Promise<Record<string, unknown> | undefined> {
    let raw: string;
    try { raw = await readFileAsync(join(this.home, name), "utf8"); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw new TraceSiftError("The TraceSift recording state could not be read.", "setup");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new TraceSiftError("The TraceSift recording state is invalid. Run `tracesift record close` and retry.", "setup"); }
    if (typeof parsed !== "object" || parsed === null) throw new TraceSiftError("The TraceSift recording state is invalid. Run `tracesift record close` and retry.", "setup");
    return parsed as Record<string, unknown>;
  }

  /** What the panel needs to draw the capture control, without starting anything. */
  async captureState(): Promise<TraceSiftCapture> {
    const browser = await this.readRecordFile("browser.json");
    const record = await this.readRecordFile("record.json");
    const open = browser !== undefined && typeof browser.pid === "number" && processAlive(browser.pid);
    const state = typeof record?.state === "string" ? record.state : undefined;
    const exported = typeof record?.export === "object" && record.export !== null ? record.export as Record<string, unknown> : undefined;
    // `starting` and `flushing` are as busy as `recording`: a control that
    // offered Start during either would race the recorder that owns the lock.
    const recording = state === "starting" || state === "recording" || state === "flushing";
    // Only a React Native recording labels its target, so the label is also
    // what says which of the two sources a live recording belongs to.
    const targetLabel = recording && typeof record?.targetLabel === "string" ? record.targetLabel.slice(0, 512) : undefined;
    return {
      apiVersion: 1,
      ...(open ? { browser: { url: typeof browser.url === "string" ? browser.url : "" } } : {}),
      ...(targetLabel ? { app: { targetLabel } } : {}),
      recording,
      ...(state === "captured" && typeof exported?.path === "string"
        ? { capture: { path: exported.path, sizeBytes: typeof exported.sizeBytes === "number" ? exported.sizeBytes : 0,
          eventCount: typeof exported.eventCount === "number" ? exported.eventCount : 0 } }
        : {}),
    };
  }

  /** Open a Chrome that outlives this command, so a person can sign in before recording. */
  async launchBrowser(url: string, signal?: AbortSignal): Promise<TraceSiftCapture> {
    await this.runCommand(["record", "launch", "--url", url], {
      timeoutMs: RECORD_LAUNCH_TIMEOUT_MS, signal,
      cancelled: "Launching the browser was cancelled.",
      timedOut: "Chrome did not open within 60 seconds.",
      missing: "TraceSift is not installed or could not run `tracesift record`.",
      failed: code => `TraceSift could not launch Chrome (exit code ${code}).`,
    });
    const state = await this.captureState();
    if (!state.browser) throw new TraceSiftError("Chrome did not stay open. Retry, or record without launching first.", "startup");
    return state;
  }

  /**
   * Begin tracing whatever that browser is already showing.
   *
   * No `--url`, so the recording covers the signed-in state the person reached
   * rather than a fresh page load, and `--sink local` so the trace lands as a
   * file this plugin can hand to `analyze` even while a TraceSift is running.
   */
  async startRecording(signal?: AbortSignal) {
    await this.runCommand(["record", "start", "--sink", "local"], {
      timeoutMs: RECORD_START_TIMEOUT_MS, signal,
      cancelled: "Starting the recording was cancelled.",
      timedOut: "Chrome did not start recording within 60 seconds.",
      missing: "TraceSift is not installed or could not run `tracesift record`.",
      failed: code => `TraceSift could not start recording (exit code ${code}).`,
    });
    this.recordingProject = await this.readProject().catch(() => undefined);
  }

  /** End the recording and wait for Chrome to flush it; the browser stays open. */
  async stopRecording(signal?: AbortSignal): Promise<{ path: string; sizeBytes: number; eventCount: number }> {
    await this.runCommand(["record", "stop"], {
      // Flushing a long trace is minutes of work in Chrome, not seconds.
      timeoutMs: RECORD_STOP_TIMEOUT_MS, signal,
      cancelled: "Stopping the recording was cancelled.",
      timedOut: "Chrome did not finish writing the trace in time.",
      missing: "TraceSift is not installed or could not run `tracesift record`.",
      failed: code => `TraceSift could not stop the recording (exit code ${code}).`,
    });
    const state = await this.captureState();
    if (!state.capture) throw new TraceSiftError("The recording stopped without writing a trace. Try recording again.", "response");
    return { ...state.capture, path: await this.keepRecording(state.capture.path) };
  }

  /**
   * Whether the resolved CLI can record release builds, read from its own usage text.
   *
   * A version number cannot say: the CLI that added release support still
   * reports 0.6.0, the same as the one that only knew Metro. The usage text
   * names `--profiler-port` only on the newer one. A probe that fails says
   * nothing, so it is not cached and not blamed on the CLI.
   */
  private releaseSupport?: Promise<boolean | undefined>;
  private probeReleaseSupport() {
    return this.releaseSupport ??= this.runCommand(["--help"], {
      timeoutMs: 10_000, cancelled: "cancelled", timedOut: "timed out", missing: "missing", failed: () => "failed",
    }).then(output => /--profiler-port/.test(output), () => undefined).then(supported => {
      if (supported === undefined) this.releaseSupport = undefined;
      return supported;
    });
  }

  /** The sentence that names the fix, when the CLI in use predates release-build recording. */
  private async staleCliHint(): Promise<string | undefined> {
    if (await this.probeReleaseSupport() !== false) return;
    return `The TraceSift CLI in use (${this.command}) is too old to record release builds: it has no \`profile\` command or \`--profiler-port\`. Install @callstack/tracesift@0.7.0, run \`tracesift init\`, and restart Mobile Dev.`;
  }

  /**
   * The React Native apps a recording could attach to, over either route: a
   * debug build on Metro, or a release build that dials the CLI from the
   * profiler package it carries.
   *
   * Asked of the CLI rather than fetched from `/json/list` here, even though
   * `metroTargets` would answer: `recommended` is the target `record start`
   * would pick on its own, so going through the CLI keeps the list and the
   * silent choice from disagreeing, and a TraceSift too old to know
   * `--platform` says so here rather than when someone presses Start.
   */
  async reactNativeTargets(metro?: string, signal?: AbortSignal): Promise<TraceSiftRnTargets> {
    const body = await this.runCommandJson(["record", "targets", "--platform", "rn", "--json",
      ...(metro ? ["--metro", metro] : [])], {
      timeoutMs: RECORD_TARGETS_TIMEOUT_MS, signal,
      cancelled: "Listing the React Native apps was cancelled.",
      timedOut: "No React Native app answered within 30 seconds.",
      missing: "TraceSift is not installed or could not run `tracesift record`.",
      failed: code => `TraceSift could not list the React Native apps (exit code ${code}).`,
    });
    // The CLI reads these off a running app, so bound them before zod sees them.
    const reported = body as Record<string, unknown>;
    const targets = Array.isArray(reported.targets) ? reported.targets : [];
    const string = (value: unknown) => typeof value === "string" ? value.slice(0, 512) : undefined;
    const parsed = traceSiftRnTargetsSchema.safeParse({
      ...reported,
      targets: targets.slice(0, 100).flatMap(item => {
        if (typeof item !== "object" || item === null) return [];
        const target = item as Record<string, unknown>;
        if (typeof target.id !== "string") return [];
        return [{
          id: target.id.slice(0, 512), title: string(target.title) ?? target.id.slice(0, 512),
          ...(string(target.appId) ? { appId: string(target.appId) } : {}),
          ...(string(target.deviceName) ? { deviceName: string(target.deviceName) } : {}),
          ...(string(target.deviceId) ? { deviceId: string(target.deviceId) } : {}),
          ...(string(target.vm) ? { vm: string(target.vm) } : {}),
          // Carried through, or zod's default calls every release build Metro.
          ...(target.deviceKind === "simulator" || target.deviceKind === "device" || target.deviceKind === "emulator" ? { deviceKind: target.deviceKind } : {}),
          ...(target.transport === "release" ? { transport: "release" as const } : {}),
          ...(typeof target.port === "number" && Number.isInteger(target.port)
            && target.port > 0 && target.port < 65_536 ? { port: target.port } : {}),
          supportsMultipleDebuggers: target.supportsMultipleDebuggers === true,
          recommended: target.recommended === true,
        }];
      }),
    });
    if (!parsed.success) throw new TraceSiftError("TraceSift returned an invalid React Native target list.", "response");
    // An old CLI never lists a release build, so an empty list is where it shows.
    if (!parsed.data.targets.length) {
      const hint = await this.staleCliHint();
      if (hint) throw new TraceSiftError(hint, "version");
    }
    return parsed.data;
  }

  /**
   * Begin a Hermes CPU profile of an app that is already running.
   *
   * Nothing is launched and no window opens, which is what lets an agent drive
   * this itself. No `--target-id` means the CLI picks the app it recommends,
   * matching what `reactNativeTargets` reported. `--sink local` for the same
   * reason the Chrome path forces it: the trace must land as a file `analyze`
   * can take by path even while a TraceSift service is running.
   */
  async startReactNativeRecording(options: { metro?: string; targetId?: string; projectPath?: string } = {}, signal?: AbortSignal) {
    // A release build has no Metro to serve a source map, so the CLI reads the
    // Gradle one relative to its working directory: the app's project, not ours.
    const cwd = options.projectPath ? await this.projectRoot(options.projectPath) : await this.readProject().catch(() => undefined);
    try {
      await this.runCommand(["record", "start", "--platform", "rn", "--sink", "local",
        ...(options.metro ? ["--metro", options.metro] : []),
        ...(options.targetId ? ["--target-id", options.targetId] : [])], {
        timeoutMs: RECORD_START_TIMEOUT_MS, signal, ...(cwd ? { cwd } : {}),
        cancelled: "Starting the recording was cancelled.",
        timedOut: "The app did not start recording within 60 seconds.",
        missing: "TraceSift is not installed or could not run `tracesift record`.",
        failed: code => `TraceSift could not start recording (exit code ${code}).`,
      });
      this.recordingProject = cwd;
    } catch (error) {
      if (signal?.aborted || (error instanceof TraceSiftError && error.kind === "version")) throw error;
      const hint = await this.staleCliHint();
      if (hint) throw new TraceSiftError(hint, "version");
      throw error;
    }
  }

  /**
   * Whether a project already carries the profiler, and the command that adds it if not.
   *
   * The same signal `tracesift profile build` reads: the package directory in
   * the project's `node_modules`. The package manager comes from the lockfile,
   * as it does there, so the command shown is the one the build would run.
   * Native linking (pod install, autolinking) is left to the build, which
   * redoes it itself and needs no confirmation.
   */
  async profilerSetup(projectPath: string): Promise<{ installed: boolean; manager: PackageManager; command: string; platforms: ("ios" | "android")[] }> {
    const root = await this.projectRoot(projectPath);
    const present = (path: string) => stat(join(root, path)).then(() => true, () => false);
    const manager = await detectManager(present);
    return {
      installed: await present(join("node_modules", "@callstack", "tracesift-profiler")),
      manager, command: `${manager} ${profilerInstallArgs(manager).join(" ")}`,
      platforms: [...(await present(join("ios", "Podfile")) ? ["ios" as const] : []), ...(await present(join("android", "gradlew")) ? ["android" as const] : [])],
    };
  }

  private async projectRoot(path: string) {
    const directory = await stat(path).catch(() => undefined);
    if (!directory?.isDirectory()) throw new TraceSiftError("That project folder does not exist.", "request");
    const root = await realpath(path);
    if (!await stat(join(root, "package.json")).then(() => true, () => false)) {
      throw new TraceSiftError("That folder has no package.json. Choose the root of a React Native app.", "request");
    }
    return root;
  }

  /** Run the package manager's own add command in the project: the one the panel displays. */
  async installProfiler(projectPath: string, signal?: AbortSignal, packagePath?: string) {
    const { manager } = await this.profilerSetup(projectPath);
    let source: string | undefined;
    if (packagePath) {
      const directory = await stat(packagePath).catch(() => undefined);
      if (!directory?.isDirectory()) throw new TraceSiftError("The local profiler package folder does not exist.", "request");
      source = await realpath(packagePath);
      let manifest: { name?: unknown };
      try { manifest = JSON.parse(await readFileAsync(join(source, "package.json"), "utf8")) as { name?: unknown }; }
      catch { throw new TraceSiftError("The local profiler package has no valid package.json.", "request"); }
      if (manifest.name !== PROFILER_PACKAGE) throw new TraceSiftError(`The local folder is not ${PROFILER_PACKAGE}.`, "request");
    }
    await this.runSetupCommand(manager, profilerInstallArgs(manager, source), "Installing the profiler package", signal, process.env, await this.projectRoot(projectPath));
  }

  /** What `tracesift profile devices` can build for, parsed from its one-row-per-device output. */
  async profileDevices(signal?: AbortSignal): Promise<{ kind: "device" | "simulator" | "android"; id: string; name: string; note: string }[]> {
    const output = await this.runCommand(["profile", "devices"], {
      timeoutMs: 30_000, signal, cancelled: "Listing devices was cancelled.", timedOut: "Listing devices took longer than 30 seconds.",
      missing: "TraceSift is not installed or could not run `tracesift profile`.",
      failed: code => `TraceSift could not list devices (exit code ${code}).`,
    });
    return output.split("\n").flatMap(line => {
      const row = /^(device|simulator|android)\s+(\S+)\s{2}(.+?)\s{2}\((.+)\)\s*$/.exec(line);
      return row ? [{ kind: row[1] as "device" | "simulator" | "android", id: row[2], name: row[3], note: row[4] }] : [];
    }).slice(0, 50);
  }

  /**
   * Build, install and launch a profiling build through the CLI.
   *
   * Run in the app's own directory because that is how the CLI finds the
   * project. The CLI streams Gradle and xcodebuild output on stdout, which is
   * returned as a bounded tail: a failing build's useful line is the last one.
   */
  async profileBuild(options: { projectPath: string; platform: "ios" | "android"; device?: string }, signal?: AbortSignal): Promise<{ log: string }> {
    const cwd = await this.projectRoot(options.projectPath);
    const args = ["profile", "build", "--platform", options.platform, ...(options.device ? ["--device", options.device] : [])];
    try {
      // Desktop hosts often launch without the login shell's CocoaPods/Ruby paths.
      const iosPath = options.platform === "ios" ? [dirname(process.execPath), join(homedir(), ".rbenv/shims"), join(homedir(), ".rbenv/bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(delimiter) : process.env.PATH;
      if (options.platform === "ios") {
        const profiler = await stat(join(cwd, "node_modules", "@callstack", "tracesift-profiler")).catch(() => undefined);
        const podfile = await stat(join(cwd, "ios", "Podfile")).catch(() => undefined);
        const rootGemfile = await stat(join(cwd, "Gemfile")).catch(() => undefined);
        const iosGemfile = await stat(join(cwd, "ios", "Gemfile")).catch(() => undefined);
        // Relink only when the generated pod state is absent or stale. An
        // unconditional pod install rewrites the Xcode project and invalidates
        // the incremental build on every Run with TraceSift press.
        if (profiler?.isDirectory() && podfile?.isFile() && !await profilerPodLinked(cwd)) {
          const gemfile = rootGemfile?.isFile() ? join(cwd, "Gemfile") : iosGemfile?.isFile() ? join(cwd, "ios", "Gemfile") : undefined;
          await this.runSetupCommand(gemfile ? "bundle" : "pod", gemfile ? ["exec", "pod", "install"] : ["install"], "Linking the TraceSift profiler pod", signal,
            { ...process.env, PATH: iosPath, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", ...(gemfile ? { BUNDLE_GEMFILE: gemfile } : {}) }, join(cwd, "ios"), PROFILE_BUILD_TIMEOUT_MS);
        }
      }
      const output = await this.runCommand(args, {
        timeoutMs: PROFILE_BUILD_TIMEOUT_MS, signal, cwd, maxOutputTail: true,
        ...(iosPath ? { env: { PATH: iosPath } } : {}),
        cancelled: "The build was cancelled.", timedOut: "The build did not finish within 30 minutes.",
        missing: "TraceSift is not installed or could not run `tracesift profile build`.",
        failed: code => `The profiling build failed (exit code ${code}).`,
      });
      return { log: output.slice(-4096) };
    } catch (error) {
      if (signal?.aborted || (error instanceof TraceSiftError && error.kind === "version")) throw error;
      const hint = await this.staleCliHint();
      if (hint) throw new TraceSiftError(hint, "version");
      throw error;
    }
  }

  /** Quit the launched browser and delete the throwaway profile it used. */
  async closeBrowser(signal?: AbortSignal) {
    await this.runCommand(["record", "close"], {
      timeoutMs: RECORD_CLOSE_TIMEOUT_MS, signal,
      cancelled: "Closing the browser was cancelled.",
      timedOut: "Chrome did not quit within 30 seconds.",
      missing: "TraceSift is not installed or could not run `tracesift record`.",
      failed: code => `TraceSift could not close the browser (exit code ${code}).`,
    });
  }

  async close() {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(3000, undefined, { ref: false })]);
  }
}
