import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Sentry from "@sentry/node";
import type { AppFlowHostEvent, AppFlowHostPorts } from "../app-flow/host.ts";

const DEFAULT_INACTIVITY_MS = 15 * 60_000;
const MAX_HISTORY_ITEMS = 6;

export interface AppFlowDecisionOptions {
  cwd: string;
  systemPrompt: string;
  userPrompt: string;
  tools?: string[];
  imagePath?: string;
  compactHistory?: { keepRecentUserTurns?: number };
}

export type AppFlowDecisionCallOptions = Omit<
  AppFlowDecisionOptions,
  "cwd" | "systemPrompt" | "tools" | "compactHistory"
>;

export interface AppFlowDecisionResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  timedOut: boolean;
  filesChanged: string[];
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    total: number;
    cost: number;
  };
  diagnostics: [];
}

export interface AppFlowDecisionSession {
  prompt(options: AppFlowDecisionCallOptions, label: string): Promise<AppFlowDecisionResult>;
  historyLength(): number;
  dispose(): void;
}

/** Structural match for src/app-flow/decision-provider.ts, kept here to avoid a runtime import. */
export interface AppFlowDecisionProvider {
  run(options: AppFlowDecisionOptions, label: string): Promise<AppFlowDecisionResult>;
  createSession(options: Omit<AppFlowDecisionOptions, "userPrompt" | "imagePath">): Promise<AppFlowDecisionSession>;
  activeNow(): number;
}

export interface AppFlowDecisionRequest {
  runId: string;
  requestId: string;
  feature: "app-flow";
  capabilities: AppFlowDecisionCapability[];
  projectPath: string;
  role: string;
  systemPrompt: string;
  userPrompt: string;
  expectedResponse: string;
  history: Array<{ role: string; request: string; response: string }>;
  screenshot: { mimeType: "image/png"; data: string } | null;
  createdAt: string;
}

export type AppFlowDecisionCapability =
  | "list-files"
  | "read-file"
  | "search"
  | "apply-patch"
  | "run-command";

export interface DecisionPollResult {
  state: "pending" | "waiting" | "needs-user-action" | "suspended" | "cancelled";
  request?: AppFlowDecisionRequest;
}

export class DecisionSuspendedError extends Error {
  constructor(message = "Codex did not answer for 15 minutes. The run was suspended and can be resumed.") {
    super(message);
    this.name = "DecisionSuspendedError";
  }
}

interface PendingDecision {
  request: AppFlowDecisionRequest;
  resolve(result: AppFlowDecisionResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
}

function recordDecisionWait(startedAt: number, outcome: "answered" | "suspended" | "cancelled"): void {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const attributes = { component: "server", surface: "app-flow", outcome };
  Sentry.metrics.count("app_flow.decision_wait.samples", 1, { attributes });
  Sentry.metrics.distribution("app_flow.decision_wait.duration", Math.max(0, Date.now() - startedAt), {
    unit: "millisecond",
    attributes,
  });
}

function emptyResult(text: string): AppFlowDecisionResult {
  return {
    text,
    toolCalls: [],
    timedOut: false,
    filesChanged: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, cost: 0 },
    diagnostics: [],
  };
}

function trimSessionHistory(
  history: Array<{ role: string; request: string; response: string }>,
  keepRecentUserTurns: number | undefined,
): void {
  const recent = Math.max(1, keepRecentUserTurns ?? MAX_HISTORY_ITEMS - 1);
  const limit = recent + 1;
  if (history.length > limit) history.splice(1, history.length - limit);
}

function capabilitiesFor(tools: readonly string[] | undefined): AppFlowDecisionCapability[] {
  const requested = new Set(tools ?? []);
  const capabilities: AppFlowDecisionCapability[] = [];
  if (requested.has("ls") || requested.has("find")) capabilities.push("list-files");
  if (requested.has("read")) capabilities.push("read-file");
  if (requested.has("grep")) capabilities.push("search");
  if (requested.has("edit") || requested.has("write") || requested.has("apply_patch")) capabilities.push("apply-patch");
  if (requested.has("bash")) capabilities.push("run-command");
  return capabilities;
}

function locator(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return ["text", "label", "id"].includes(String(candidate.by)) &&
    typeof candidate.value === "string" && candidate.value.trim().length > 0;
}

function action(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!["tap", "swipe", "input", "wait"].includes(String(candidate.type))) return false;
  if ((candidate.type === "tap" || candidate.type === "input") && !locator(candidate.locator)) return false;
  if (candidate.type === "input" && typeof candidate.value !== "string") return false;
  if (candidate.type === "swipe" && candidate.direction !== undefined &&
      !["up", "down", "left", "right"].includes(String(candidate.direction))) return false;
  return candidate.duration === undefined || typeof candidate.duration === "number";
}

function validResponse(object: Record<string, unknown>, role: string): boolean {
  if (role.startsWith("auth-gate")) {
    return ["auth", "clear", "uncertain"].includes(String(object.verdict)) && typeof object.reason === "string";
  }
  if (role.startsWith("arrival")) {
    return ["match", "mismatch", "uncertain"].includes(String(object.verdict)) &&
      (object.status === null || ["ok", "empty-state", "not-found"].includes(String(object.status))) &&
      typeof object.reason === "string" &&
      (object.key === undefined || typeof object.key === "string") &&
      (object.info === undefined || typeof object.info === "string");
  }
  if (role.startsWith("navigate")) {
    if (object.decision === "arrived" || object.decision === "blocked") return typeof object.reason === "string";
    return object.decision === "act" && action(object.action);
  }
  if (role.startsWith("runtime-screen")) {
    return typeof object.distinct === "boolean" &&
      (!object.distinct || (typeof object.key === "string" && typeof object.info === "string"));
  }
  if (role.startsWith("state-trigger")) {
    return Array.isArray(object.actions) && object.actions.every(action) &&
      typeof object.stateName === "string" && locator(object.destinationLocator) &&
      (object.note === null || typeof object.note === "string");
  }
  return true;
}

export function validateAppFlowDecisionResponse(value: string, role: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Decision response must be a valid JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Decision response must be a JSON object.");
  }
  if (!validResponse(parsed as Record<string, unknown>, role)) {
    throw new Error(`Decision response does not match the expected schema for ${role}.`);
  }
}

/**
 * Parks App Flow model calls until the active Codex conversation answers through the decision
 * tools. Exactly one request can be pending per run, so callers must disable speculative hedges.
 */
export class CodexAppFlowDecisionProvider implements AppFlowDecisionProvider {
  readonly runId: string;
  readonly supportsConcurrentRequests = false;
  readonly hedgeAfterMs = Number.POSITIVE_INFINITY;
  private readonly inactivityMs: number;
  private readonly onSuspended?: (error: DecisionSuspendedError) => void;
  private readonly projectPath: string;
  private pending: PendingDecision | null = null;
  private completed: { requestId: string; response: string } | null = null;
  private waiters = new Set<() => void>();
  private state: "active" | "suspended" | "cancelled" = "active";
  private readonly history: Array<{ role: string; request: string; response: string }> = [];
  private excludedWaitMs = 0;

  constructor(
    runId: string,
    projectPath: string,
    options: { inactivityMs?: number; onSuspended?: (error: DecisionSuspendedError) => void } = {},
  ) {
    this.runId = runId;
    this.projectPath = projectPath;
    this.inactivityMs = options.inactivityMs ?? DEFAULT_INACTIVITY_MS;
    this.onSuspended = options.onSuspended;
  }

  activeNow(): number {
    const pendingWait = this.pending ? Date.now() - this.pending.startedAt : 0;
    return Date.now() - this.excludedWaitMs - pendingWait;
  }

  run(options: AppFlowDecisionOptions, label: string): Promise<AppFlowDecisionResult> {
    return this.enqueue(options.systemPrompt, options, label, [], options.tools, options.cwd);
  }

  async createSession(
    options: Omit<AppFlowDecisionOptions, "userPrompt" | "imagePath">,
  ): Promise<AppFlowDecisionSession> {
    const history: Array<{ role: string; request: string; response: string }> = [];
    return {
      prompt: async (callOptions, label) => {
        const response = await this.enqueue(
          options.systemPrompt,
          callOptions,
          label,
          history,
          options.tools,
          options.cwd,
        );
        history.push({
          role: label,
          request: history.length === 0 ? callOptions.userPrompt : callOptions.userPrompt.slice(0, 1_500),
          response: response.text.slice(0, 1_500),
        });
        trimSessionHistory(history, options.compactHistory?.keepRecentUserTurns);
        return response;
      },
      historyLength: () => history.length * 2,
      dispose: () => undefined,
    };
  }

  async next(waitMs = 0): Promise<DecisionPollResult> {
    if (this.pending) return { state: "pending", request: this.pending.request };
    if (this.state === "suspended") return { state: "suspended" };
    if (this.state === "cancelled") return { state: "cancelled" };
    if (waitMs <= 0) return { state: "waiting" };
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(waitMs, 20_000));
      this.waiters.add(done);
    });
    return this.next(0);
  }

  submit(requestId: string, response: string): { accepted: true; duplicate: boolean } {
    if (this.completed?.requestId === requestId) {
      if (this.completed.response !== response) throw new Error("That decision was already submitted with a different response.");
      return { accepted: true, duplicate: true };
    }
    if (!this.pending || this.pending.request.requestId !== requestId) {
      throw new Error("That decision request is stale or does not belong to the active run.");
    }
    validateAppFlowDecisionResponse(response, this.pending.request.role);
    const pending = this.pending;
    clearTimeout(pending.timer);
    this.excludedWaitMs += Date.now() - pending.startedAt;
    this.pending = null;
    this.completed = { requestId, response };
    recordDecisionWait(pending.startedAt, "answered");
    this.history.push({
      role: pending.request.role,
      request: pending.request.userPrompt.slice(0, 1_500),
      response: response.slice(0, 1_500),
    });
    if (this.history.length > MAX_HISTORY_ITEMS) this.history.splice(1, 1);
    pending.resolve(emptyResult(response));
    this.notify();
    return { accepted: true, duplicate: false };
  }

  suspend(reason?: string): void {
    if (this.state !== "active") return;
    this.state = "suspended";
    this.rejectPending(new DecisionSuspendedError(reason));
  }

  resume(): void {
    if (this.state === "suspended") {
      this.state = "active";
      this.notify();
    }
  }

  cancel(): void {
    this.state = "cancelled";
    this.rejectPending(new Error("Cancelled"));
  }

  private async enqueue(
    systemPrompt: string,
    options: Pick<AppFlowDecisionOptions, "userPrompt" | "imagePath">,
    label: string,
    sessionHistory: Array<{ role: string; request: string; response: string }>,
    tools: readonly string[] | undefined,
    cwd: string,
  ): Promise<AppFlowDecisionResult> {
    this.assertActive();
    if (this.pending) throw new Error("A Codex decision is already pending for this run.");
    const screenshot = options.imagePath
      ? { mimeType: "image/png" as const, data: (await readFile(options.imagePath)).toString("base64") }
      : null;
    this.assertActive();
    if (this.pending) throw new Error("A Codex decision is already pending for this run.");
    const request: AppFlowDecisionRequest = {
      runId: this.runId,
      requestId: randomUUID(),
      feature: "app-flow",
      capabilities: capabilitiesFor(tools),
      projectPath: this.projectPath || cwd,
      role: label,
      systemPrompt,
      userPrompt: options.userPrompt,
      expectedResponse: "Return one strict JSON object that follows the schema and rules in systemPrompt.",
      history: (sessionHistory.length ? sessionHistory : this.history).slice(-MAX_HISTORY_ITEMS),
      screenshot,
      createdAt: new Date().toISOString(),
    };
    return new Promise<AppFlowDecisionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.request.requestId !== request.requestId) return;
        this.state = "suspended";
        this.excludedWaitMs += Date.now() - this.pending.startedAt;
        recordDecisionWait(this.pending.startedAt, "suspended");
        this.pending = null;
        const error = new DecisionSuspendedError();
        reject(error);
        this.onSuspended?.(error);
        this.notify();
      }, this.inactivityMs);
      this.pending = { request, resolve, reject, timer, startedAt: Date.now() };
      this.notify();
    });
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.excludedWaitMs += Date.now() - pending.startedAt;
      recordDecisionWait(pending.startedAt, error instanceof DecisionSuspendedError ? "suspended" : "cancelled");
      this.pending = null;
      pending.reject(error);
    }
    this.notify();
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter();
  }

  private assertActive(): void {
    if (this.state === "suspended") throw new DecisionSuspendedError();
    if (this.state === "cancelled") throw new Error("Cancelled");
  }
}

export type AppFlowRunState =
  | "idle"
  | "running"
  | "needs-user-action"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export interface AppFlowRunSnapshot {
  runId?: string;
  projectPath: string;
  state: AppFlowRunState;
  projectId?: string;
  exists?: boolean;
  manifest?: unknown;
  event?: unknown;
  error?: string;
}

export interface AppFlowHostServices {
  start(input: Record<string, unknown>, context: { runId: string; decisions?: CodexAppFlowDecisionProvider }): Promise<unknown>;
  status(query: { runId?: string; projectPath?: string }): Promise<AppFlowRunSnapshot>;
  result(query: { runId?: string; projectPath?: string }): Promise<unknown>;
  pause(runId: string): Promise<unknown>;
  cancel(runId: string): Promise<unknown>;
  launchApp(projectPath: string): Promise<unknown>;
  resolvePrompt(runId: string, resolution: "stop" | "override" | "continue", promptId?: string): Promise<unknown>;
  manualStart(projectPath: string, nodeId: string): Promise<unknown>;
  manualAct(projectPath: string, action: unknown): Promise<unknown>;
  manualStop(projectPath: string): Promise<unknown>;
  manualCancel(projectPath: string): Promise<unknown>;
  manualReplay?(projectPath: string, nodeId: string): Promise<unknown>;
  screenshot(projectId: string, path: string): Promise<Buffer>;
  subscribe?(listener: (message: { runId?: string; event: unknown }) => void): () => void;
  close?(): void | Promise<void>;
}

/** Owns per-run providers while leaving the engine lifecycle behind an injectable service seam. */
export class AppFlowHost {
  private readonly providers = new Map<string, CodexAppFlowDecisionProvider>();
  readonly services: AppFlowHostServices;

  constructor(services: AppFlowHostServices) {
    this.services = services;
  }

  async start(input: Record<string, unknown>): Promise<{ runId: string; state: "running"; instructions?: string }> {
    const projectPath = String(input.projectPath ?? "");
    const mode = input.mode === "screen-ui-and-structure" ? "screen-ui-and-structure" : "structure-only";
    const runId = randomUUID();
    const decisions = mode === "screen-ui-and-structure"
      ? new CodexAppFlowDecisionProvider(runId, projectPath, {
          onSuspended: () => { void this.services.pause(runId); },
        })
      : undefined;
    if (decisions) this.providers.set(runId, decisions);
    try {
      await this.services.start({ ...input, mode }, { runId, decisions });
    } catch (error) {
      decisions?.cancel();
      this.providers.delete(runId);
      throw error;
    }
    return {
      runId,
      state: "running",
      ...(decisions ? {
        instructions: "Call mobile_appflow_next_decision until the run completes, suspends, or needs user action. Submit each response as one strict JSON object.",
      } : {}),
    };
  }

  provider(runId: string): CodexAppFlowDecisionProvider {
    const provider = this.providers.get(runId);
    if (!provider) throw new Error("That decision run is not active or does not use agent decisions.");
    return provider;
  }

  async nextDecision(runId: string, waitMs = 0): Promise<DecisionPollResult | AppFlowRunSnapshot> {
    const provider = this.providers.get(runId);
    if (provider) {
      const polled = await provider.next(waitMs);
      if (polled.state !== "waiting") return polled;
    }
    const status = await this.services.status({ runId });
    if (status.state === "running") return { state: "waiting" };
    if (status.state === "needs-user-action" || status.state === "suspended" || status.state === "cancelled") {
      return { state: status.state };
    }
    this.providers.delete(runId);
    return status;
  }

  async submitDecision(runId: string, requestId: string, response: string): Promise<DecisionPollResult | AppFlowRunSnapshot> {
    this.provider(runId).submit(requestId, response);
    return this.nextDecision(runId, 15_000);
  }

  async cancel(runId: string): Promise<unknown> {
    this.providers.get(runId)?.cancel();
    this.providers.delete(runId);
    return this.services.cancel(runId);
  }

  async close(): Promise<void> {
    for (const provider of this.providers.values()) provider.cancel();
    this.providers.clear();
    await this.services.close?.();
  }
}

export const APP_FLOW_DIRECTORY = join(homedir(), "Library/Application Support/mobile-dev/app-flow");

interface MutableRun extends AppFlowRunSnapshot {
  runId: string;
  event?: AppFlowHostEvent;
}

function vendoredAgentDeviceRoot(): string | undefined {
  const roots = [
    join(dirname(fileURLToPath(import.meta.url)), "agent-device/node_modules/agent-device"),
    resolve(process.cwd(), "runtimes/agent-device/node_modules/agent-device"),
    resolve(process.cwd(), "../ai-harness/node_modules/agent-device"),
  ];
  return roots.find(root => existsSync(join(root, "dist/src/index.js")));
}

async function loadVendoredAgentDevice(): Promise<{ createAgentDeviceClient(config?: Record<string, unknown>): any }> {
  const root = vendoredAgentDeviceRoot();
  const entry = root ? join(root, "dist/src/index.js") : undefined;
  if (!entry) throw new Error("The bundled agent-device runtime is unavailable. Reinstall or rebuild Mobile Dev.");
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return dynamicImport(pathToFileURL(entry).href) as Promise<{ createAgentDeviceClient(config?: Record<string, unknown>): any }>;
}

/**
 * Creates the concrete Node host for the ported engine. The mutable host-port object lets the
 * single active run install its provider without reconfiguring engine modules mid-operation.
 */
export async function createAppFlowHost(options: {
  dataDir?: string;
  loadAgentDevice?: AppFlowHostPorts["loadAgentDevice"];
} = {}): Promise<AppFlowHost> {
  const [{ createAppFlowService }, { createManualRecordingService }] = await Promise.all([
    import("../app-flow/index.ts"),
    import("../app-flow/manual/index.ts"),
  ]);
  const listeners = new Set<(message: { runId?: string; event: AppFlowHostEvent }) => void>();
  const runs = new Map<string, MutableRun>();
  let activeDecisions: CodexAppFlowDecisionProvider | undefined;
  const agentDeviceRoot = vendoredAgentDeviceRoot();
  const agentDeviceCli = agentDeviceRoot
    ? `${JSON.stringify(process.execPath)} ${JSON.stringify(join(agentDeviceRoot, "bin/agent-device.mjs"))}`
    : undefined;
  const getProjectId = (selectedProjectPath: string): string =>
    createHash("sha256").update(selectedProjectPath).digest("hex").slice(0, 16);
  const dataDir = options.dataDir ?? APP_FLOW_DIRECTORY;
  const getProjectDir = (selectedProjectId: string): string => join(dataDir, "app-flows", selectedProjectId);
  const ports: AppFlowHostPorts = {
    dataDir,
    get decisions() { return activeDecisions; },
    emit(event) {
      const eventProjectId = "projectId" in event ? event.projectId : undefined;
      const run = [...runs.values()].find(candidate =>
        candidate.state === "running" && (!eventProjectId || getProjectId(candidate.projectPath) === eventProjectId));
      if (run) {
        run.event = event;
        if (event.type === "prompt") run.state = "needs-user-action";
        else if (event.type === "error") {
          run.state = "failed";
          run.error = event.message;
        } else if (event.type === "complete") run.state = "completed";
        else if (run.state === "needs-user-action") run.state = "running";
      }
      for (const listener of listeners) listener({ ...(run ? { runId: run.runId } : {}), event });
    },
    loadAgentDevice: options.loadAgentDevice ?? loadVendoredAgentDevice,
    agentDeviceCli,
    screenshotUri(project, slug) {
      return `appflow-image://mobile-dev/${project}/${Buffer.from(slug).toString("base64url")}`;
    },
  };
  const flow = createAppFlowService(ports);
  const manual = createManualRecordingService(ports);

  const projectFor = (query: { runId?: string; projectPath?: string }): string => {
    if (query.projectPath) return query.projectPath;
    const run = query.runId ? runs.get(query.runId) : undefined;
    if (!run) throw new Error("That App Flow run does not exist.");
    return run.projectPath;
  };

  const services: AppFlowHostServices = {
    async start(input, context) {
      if ([...runs.values()].some(run => run.state === "running" || run.state === "needs-user-action")) {
        throw new Error("Another App Flow run is already active.");
      }
      const selectedProjectPath = String(input.projectPath ?? "");
      const run: MutableRun = { runId: context.runId, projectPath: selectedProjectPath, state: "running" };
      runs.set(run.runId, run);
      activeDecisions = context.decisions;
      const started = await flow.start(input as never);
      if (!started.ok) {
        runs.delete(run.runId);
        activeDecisions = undefined;
        throw new Error(started.error);
      }
      return started;
    },
    async status(query) {
      if (query.runId) {
        const run = runs.get(query.runId);
        if (!run) throw new Error("That App Flow run does not exist.");
        return { ...run };
      }
      const selectedProjectPath = projectFor(query);
      const active = [...runs.values()].find(run => run.projectPath === selectedProjectPath &&
        (run.state === "running" || run.state === "needs-user-action" || run.state === "suspended"));
      const saved = await flow.getStatus(selectedProjectPath);
      if (active) {
        return {
          ...active,
          exists: saved.exists,
          projectId: saved.projectId,
          ...(saved.manifest === undefined ? {} : { manifest: saved.manifest }),
        };
      }
      return {
        projectPath: selectedProjectPath,
        state: saved.exists ? "completed" : "idle",
        exists: saved.exists,
        projectId: saved.projectId,
        ...(saved.manifest === undefined ? {} : { manifest: saved.manifest }),
      };
    },
    async result(query) {
      const selectedProjectPath = projectFor(query);
      return {
        ...(query.runId ? { runId: query.runId } : {}),
        projectPath: selectedProjectPath,
        projectId: getProjectId(selectedProjectPath),
        result: await flow.getResult(selectedProjectPath),
      };
    },
    async pause(selectedRunId) {
      const run = runs.get(selectedRunId);
      if (!run) throw new Error("That App Flow run does not exist.");
      const result = await flow.pause(run.projectPath);
      if ((result as { paused?: boolean }).paused) run.state = "suspended";
      activeDecisions?.suspend("App Flow was paused and can be resumed.");
      return result;
    },
    async cancel(selectedRunId) {
      const run = runs.get(selectedRunId);
      if (!run) throw new Error("That App Flow run does not exist.");
      const result = await flow.cancel(run.projectPath);
      run.state = "cancelled";
      activeDecisions = undefined;
      return result;
    },
    launchApp: selectedProjectPath => flow.launchApp(selectedProjectPath),
    async resolvePrompt(selectedRunId, selectedResolution, promptId) {
      const run = runs.get(selectedRunId);
      if (!run) throw new Error("That App Flow run does not exist.");
      const result = await flow.resolvePrompt(run.projectPath, selectedResolution, promptId);
      if ((result as { resolved?: boolean }).resolved && selectedResolution !== "stop") run.state = "running";
      if ((result as { resolved?: boolean }).resolved && selectedResolution === "stop") run.state = "completed";
      return result;
    },
    manualStart: (selectedProjectPath, nodeId) => manual.start(selectedProjectPath, nodeId),
    manualAct: (selectedProjectPath, selectedAction) => manual.act(selectedProjectPath, selectedAction as never),
    manualStop: selectedProjectPath => manual.stop(selectedProjectPath),
    manualCancel: selectedProjectPath => manual.cancel(selectedProjectPath),
    manualReplay: (selectedProjectPath, nodeId) => manual.replay(selectedProjectPath, nodeId),
    async screenshot(selectedProjectId, encodedPath) {
      const decoded = Buffer.from(encodedPath, "base64url").toString("utf8");
      if (!decoded || isAbsolute(decoded)) throw new Error("Invalid App Flow screenshot path.");
      const root = getProjectDir(selectedProjectId);
      const candidate = resolve(root, decoded);
      const local = relative(root, candidate);
      if (local.startsWith("..") || isAbsolute(local)) throw new Error("App Flow screenshot path escapes its project.");
      return readFile(candidate);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return new AppFlowHost(services);
}
