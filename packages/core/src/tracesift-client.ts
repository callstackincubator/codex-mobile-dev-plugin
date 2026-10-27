import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdir, readFile as readFileAsync, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { traceSiftAnalysisSchema, traceSiftHandoffSchema, type TraceSiftAnalysis, type TraceSiftProfileType, type TraceSiftReactHandoff, type TraceSiftTaskHandoff } from "@mobile-dev/shared/tracesift.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";

const STARTUP_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const EXPLORE_TIMEOUT_MS = 15_000;
/** Health only proves integration API v1, which predates the Explore endpoints. */
const EXPLORE_UNSUPPORTED = "This TraceSift service cannot open findings in the panel. Update TraceSift and restart it, or use Open in browser.";
type Descriptor = { version: string; apiVersion: 1; pid: number; childPid: number; instance: string; baseUrl: string; token: string; startedAt: number };

export class TraceSiftError extends ExpectedOperationError {
  readonly kind: "setup" | "version" | "startup" | "request" | "response";
  constructor(message: string, kind: "setup" | "version" | "startup" | "request" | "response") {
    super("invalid_input", message);
    this.kind = kind;
  }
}

function processAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error instanceof Error && "code" in error && error.code === "EPERM"; }
}

async function parseDescriptor(path: string): Promise<Descriptor | undefined> {
  let raw: unknown;
  try {
    const metadata = await stat(path);
    if ((metadata.mode & 0o077) !== 0) throw new TraceSiftError("TraceSift service.json permissions are unsafe. Restart TraceSift so it recreates the file with mode 0600.", "setup");
    raw = JSON.parse(await readFileAsync(path, "utf8"));
  } catch (error) {
    if (error instanceof TraceSiftError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw new TraceSiftError("TraceSift service.json could not be read. Stop TraceSift, remove the stale file if no process is running, and retry.", "setup");
  }
  if (typeof raw !== "object" || raw === null) throw new TraceSiftError("TraceSift service.json is invalid. Restart TraceSift.", "setup");
  const value = raw as Record<string, unknown>;
  if (value.apiVersion !== 1) throw new TraceSiftError("This TraceSift service uses an incompatible integration API. Update TraceSift and restart it.", "version");
  if (typeof value.baseUrl !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.baseUrl)
    || typeof value.token !== "string" || value.token.length < 16 || typeof value.instance !== "string"
    || typeof value.version !== "string" || typeof value.pid !== "number" || typeof value.childPid !== "number"
    || typeof value.startedAt !== "number") throw new TraceSiftError("TraceSift service.json is invalid. Restart TraceSift.", "setup");
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

export class TraceSiftClient {
  private ready?: Promise<Descriptor>;
  private child?: ChildProcess;
  private readonly home: string;
  private readonly command: string;
  constructor(command = process.env.TRACE_SIFT_COMMAND ?? "tracesift", home?: string) {
    this.command = command;
    this.home = home ?? process.env.TRACE_SIFT_HOME ?? join(homedir(), ".tracesift");
  }

  private async existing(signal?: AbortSignal) {
    const descriptor = await parseDescriptor(join(this.home, "service.json"));
    return descriptor && await health(descriptor, signal) ? descriptor : undefined;
  }

  private async start(signal?: AbortSignal): Promise<Descriptor> {
    const reusable = await this.existing(signal);
    if (reusable) return reusable;
    const port = await freePort();
    let child: ChildProcess;
    try {
      child = spawn(this.command, ["start", "--port", String(port), "--no-open"], {
        stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TRACE_SIFT_HOME: this.home },
      });
    } catch { throw new TraceSiftError("TraceSift is not installed. Install @callstack/tracesift, run `tracesift init`, and retry.", "setup"); }
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
      if (spawnError) throw new TraceSiftError("TraceSift could not start. Install @callstack/tracesift, run `tracesift init`, and retry.", "setup");
      const descriptor = await this.existing(signal);
      if (descriptor) return descriptor;
      if (exited && /another tracesift operation/i.test(diagnostics) === false) {
        if (/node\.js|unsupported|platform|architecture/i.test(diagnostics)) throw new TraceSiftError("This TraceSift installation does not support the current Node.js version or platform. Update Node and TraceSift, then retry.", "version");
        throw new TraceSiftError("TraceSift could not start. Run `tracesift init`, then retry or start `tracesift start --no-open` manually.", "setup");
      }
      await delay(200, undefined, { signal });
    }
    throw new TraceSiftError("TraceSift did not become ready within 60 seconds. Run `tracesift init`, then retry or start `tracesift start --no-open` manually.", "startup");
  }

  private service(signal?: AbortSignal) {
    return this.ready ??= this.start(signal).catch(error => { this.ready = undefined; throw error; });
  }

  async readyService(signal?: AbortSignal) { await this.service(signal); }

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

  /**
   * The source folder an investigation lands in. It is the plugin's own choice,
   * not TraceSift's, but it belongs beside the analyses it qualifies and inherits
   * their 0700 directory.
   */
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
    // A folder that moved or was deleted is not a project any more, and saying so
    // beats handing the chat a path that is no longer there.
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

  /**
   * Let the TraceSift CLI open its own loopback URL. The tree and timeline stay
   * in the running service; the persisted analysis carries only card ids.
   */
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
    await new Promise<void>((resolve, reject) => {
      let diagnostics = "";
      let settled = false;
      const child = spawn(this.command, args, {
        stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TRACE_SIFT_HOME: this.home },
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", chunk => { if (diagnostics.length < 16_384) diagnostics += String(chunk).slice(0, 16_384 - diagnostics.length); });
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => { child.kill("SIGTERM"); finish(signal?.reason instanceof Error ? signal.reason : new Error("TraceSift Explore was cancelled.")); };
      const timeout = setTimeout(() => { child.kill("SIGTERM"); finish(new Error("TraceSift Explore did not open within 15 seconds.")); }, EXPLORE_TIMEOUT_MS);
      child.once("error", () => finish(new TraceSiftError("TraceSift is not installed or could not run `tracesift explore`.", "setup")));
      child.once("exit", code => finish(code === 0 ? undefined : new Error(diagnostics.trim() || `TraceSift Explore exited with code ${code}.`)));
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /**
   * One task with its call tree and timeline, which `/analyze` never ships.
   * Checked at its seams only; the explorer that draws it parses the rest.
   */
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

  /** Every commit timeline of one React analysis, which the explorer switches between itself. */
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
