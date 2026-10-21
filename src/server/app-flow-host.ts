import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Sentry from "@sentry/node";
import type { AppFlowHostEvent, AppFlowHostPorts } from "../app-flow/host.ts";
import { requiresDecisionProvider } from "../app-flow/start-request.ts";
import type { ExplorationMode } from "../shared/app-flow.ts";
import { AppFlowRunStore, type SharedAppFlowRun } from "./app-flow-run-store.ts";
import { captureServerError } from "./telemetry.ts";
import { ExpectedOperationError } from "../shared/error-reporting.ts";

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
  /**
   * Whether this project's app is up on the App Flow device right now, as the engine knows it —
   * not as one panel session remembers it. The panel's own "I launched it" flag cannot see an app
   * launched externally or in a previous session, which is exactly the case `exploreUi` accepts
   * and the button used to refuse. Reported on every status read so the UI's gate matches the
   * server's.
   */
  appLaunched?: boolean;
}

export interface AppFlowHostServices {
  start(input: Record<string, unknown>, context: { runId: string; decisions?: CodexAppFlowDecisionProvider }): Promise<unknown>;
  status(query: { runId?: string; projectPath?: string }): Promise<AppFlowRunSnapshot>;
  result(query: { runId?: string; projectPath?: string }): Promise<unknown>;
  clear(projectPath: string): Promise<{ cleared: true; projectId: string }>;
  pause(runId: string): Promise<unknown>;
  cancel(runId: string): Promise<unknown>;
  launchApp(projectPath: string): Promise<unknown>;
  /**
   * Start a non-blocking explore-UI pass over the already-launched app and register it as a run,
   * so `status`, `result`, `events` and `cancel` work on it exactly as they do for a sweep.
   */
  exploreUi(projectPath: string, options: { limit?: number }, context: { runId: string }): Promise<unknown>;
  resolvePrompt(runId: string, resolution: "stop" | "override" | "continue", promptId?: string, projectPath?: string): Promise<unknown>;
  manualStart(projectPath: string, nodeId: string): Promise<unknown>;
  manualAct(projectPath: string, action: unknown): Promise<unknown>;
  manualStop(projectPath: string): Promise<unknown>;
  manualCancel(projectPath: string): Promise<unknown>;
  manualReplay?(projectPath: string, nodeId: string): Promise<unknown>;
  /** The runtime replay variant — navigates by route and params instead of replaying a recording. */
  runtimeReplay?(projectPath: string, nodeId: string): Promise<unknown>;
  screenshot(projectId: string, path: string): Promise<Buffer>;
  /** Replays buffered events for one run or manual session whose seq is newer than `since`. */
  poll(query: { runId?: string; projectPath?: string }, since: number): Promise<Array<{ seq: number; runId?: string; event: unknown }>>;
  subscribe?(listener: (message: { runId?: string; seq?: number; event: unknown }) => void): () => void;
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
    /* A sweep only gets a decision provider when some model role can actually be asked something
       (`requiresDecisionProvider`). Fast navigates through the app's own runtime navigator and
       skips the auth-gate classifier, so handing it a provider only created a trap: the arrival
       judge on a node with incomplete runtime evidence would enqueue a decision, and if nobody is
       servicing `mobile_appflow_next_decision` the sweep blocks on an answer that never comes.
       Without one the orchestrator installs the `uncertain` judge instead and the run is
       deterministic end to end — which is what lets a Fast sweep start from the panel directly,
       with no chat round trip. */
    const explorationMode = typeof input.explorationMode === "string" ? input.explorationMode as ExplorationMode : undefined;
    const decisions = requiresDecisionProvider(mode, explorationMode)
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

  /** Starts an explore-UI pass and returns its run id, for the same poll/cancel loop as a sweep. */
  async exploreUi(projectPath: string, options: { limit?: number }): Promise<{ runId: string; state: "running" }> {
    const runId = randomUUID();
    await this.services.exploreUi(projectPath, options, { runId });
    return { runId, state: "running" };
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
  const listeners = new Set<(message: { runId?: string; seq?: number; event: AppFlowHostEvent }) => void>();
  const runs = new Map<string, MutableRun>();
  // Hosts are not required to forward server logging notifications into an app panel (the logs
  // panel polls for the same reason), so every event is also buffered here with a monotonic seq
  // for the panel's `mobile_appflow_events` poll. Manual snapshots arrive every couple of seconds,
  // so each key keeps only its most recent events; a panel that fell behind re-reads from its seq.
  const MAX_BUFFERED_EVENTS = 64;
  const recentEvents = new Map<string, Array<{ seq: number; runId?: string; event: AppFlowHostEvent }>>();
  const dataDir = options.dataDir ?? APP_FLOW_DIRECTORY;
  const runStore = new AppFlowRunStore(dataDir);
  // A panel-side MCP process has no in-memory run object for a Codex-owned sweep. Remember the
  // project learned during status lookup so its subsequent legacy runId event polls can replay
  // the durable event (notably the human prompt) from the shared store.
  const remoteRunProjects = new Map<string, string>();
  const promptRelays = new Map<string, ReturnType<typeof setInterval>>();
  const runWrites = new Map<string, Promise<void>>();
  let eventSeq = 0;
  const bufferEvent = (key: string, runId: string | undefined, event: AppFlowHostEvent): number => {
    const seq = ++eventSeq;
    const buffered = recentEvents.get(key) ?? [];
    buffered.push({ seq, ...(runId ? { runId } : {}), event });
    if (buffered.length > MAX_BUFFERED_EVENTS) buffered.splice(0, buffered.length - MAX_BUFFERED_EVENTS);
    recentEvents.set(key, buffered);
    return seq;
  };
  let activeDecisions: CodexAppFlowDecisionProvider | undefined;
  let flow: Awaited<ReturnType<typeof createAppFlowService>>;
  const sharedRun = (run: MutableRun): Omit<SharedAppFlowRun, "updatedAt"> => ({ ...run, ownerPid: process.pid });
  const persistRun = (run: MutableRun) => {
    const snapshot = sharedRun(run);
    const previous = runWrites.get(run.runId) ?? Promise.resolve();
    const pending = previous.then(() => runStore.writeRun(snapshot)).catch(error => {
      captureServerError(error, "app_flow.run_store");
    });
    runWrites.set(run.runId, pending);
    void pending.finally(() => { if (runWrites.get(run.runId) === pending) runWrites.delete(run.runId); });
  };
  const stopPromptRelay = (runId: string) => {
    const timer = promptRelays.get(runId);
    if (timer) clearInterval(timer);
    promptRelays.delete(runId);
  };
  const startPromptRelay = (run: MutableRun, promptId: string) => {
    stopPromptRelay(run.runId);
    let checking = false;
    const timer = setInterval(() => {
      if (checking || run.state !== "needs-user-action") return;
      checking = true;
      void runStore.takeResolution(run.projectPath, run.runId, promptId).then(async resolution => {
        if (!resolution) return;
        const result = await flow.resolvePrompt(run.projectPath, resolution, promptId);
        if (!result.resolved) return;
        run.state = resolution === "stop" ? "completed" : "running";
        persistRun(run);
        stopPromptRelay(run.runId);
      }).catch(error => captureServerError(error, "app_flow.prompt_relay")).finally(() => { checking = false; });
    }, 100);
    timer.unref?.();
    promptRelays.set(run.runId, timer);
  };
  const agentDeviceRoot = vendoredAgentDeviceRoot();
  const agentDeviceCli = agentDeviceRoot
    ? `${JSON.stringify(process.execPath)} ${JSON.stringify(join(agentDeviceRoot, "bin/agent-device.mjs"))}`
    : undefined;
  const getProjectId = (selectedProjectPath: string): string =>
    createHash("sha256").update(selectedProjectPath).digest("hex").slice(0, 16);
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
        if (event.type === "prompt") {
          run.state = "needs-user-action";
          if (event.prompt?.id) startPromptRelay(run, event.prompt.id);
        }
        else if (event.type === "error") {
          run.state = "failed";
          run.error = event.message;
          stopPromptRelay(run.runId);
        } else if (event.type === "complete") run.state = "completed";
        else if (run.state === "needs-user-action") run.state = "running";
        persistRun(run);
      }
      const runId = run?.runId;
      const key = "nodeId" in event ? `manual:${event.projectId}` : runId ?? `project:${eventProjectId ?? "unknown"}`;
      const seq = bufferEvent(key, runId, event);
      for (const listener of listeners) listener({ ...(runId ? { runId } : {}), seq, event });
    },
    loadAgentDevice: options.loadAgentDevice ?? loadVendoredAgentDevice,
    agentDeviceCli,
    screenshotUri(project, slug) {
      return `appflow-image://mobile-dev/${project}/${Buffer.from(slug).toString("base64url")}`;
    },
  };
  flow = createAppFlowService(ports);
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
      persistRun(run);
      recentEvents.delete(`project:${getProjectId(selectedProjectPath)}`);
      recentEvents.delete(`manual:${getProjectId(selectedProjectPath)}`);
      // A recording drives the same device these do, and now sometimes literally the same one:
      // the recorder adopts the app the user launched rather than booting its own.
      if (manual.isActive(selectedProjectPath)) {
        throw new ExpectedOperationError("invalid_input", "Stop the active App Flow recording first.");
      }
      // A device the recorder is keeping warm holds the iOS runner lease the sweep is about to
      // ask for. See `releaseDevices`.
      await manual.releaseDevices(selectedProjectPath);
      activeDecisions = context.decisions;
      const started = await flow.start(input as never);
      if (!started.ok) {
        run.state = "failed";
        run.error = started.error;
        persistRun(run);
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
        return { ...run, appLaunched: await flow.isAppLaunched(run.projectPath) };
      }
      const selectedProjectPath = projectFor(query);
      const appLaunched = await flow.isAppLaunched(selectedProjectPath);
      const active = [...runs.values()].find(run => run.projectPath === selectedProjectPath &&
        (run.state === "running" || run.state === "needs-user-action" || run.state === "suspended"));
      const saved = await flow.getStatus(selectedProjectPath);
      if (active) {
        return {
          ...active,
          appLaunched,
          exists: saved.exists,
          projectId: saved.projectId,
          ...(saved.manifest === undefined ? {} : { manifest: saved.manifest }),
        };
      }
      const shared = await runStore.readRun(selectedProjectPath);
      if (shared && (shared.state === "running" || shared.state === "needs-user-action" || shared.state === "suspended")) {
        remoteRunProjects.set(shared.runId, selectedProjectPath);
        const { ownerPid: _ownerPid, updatedAt: _updatedAt, ...snapshot } = shared;
        if (shared.state === "suspended" || ownerAlive(shared.ownerPid)) {
          return {
            ...snapshot,
            appLaunched,
            exists: saved.exists,
            projectId: saved.projectId,
            ...(saved.manifest === undefined ? {} : { manifest: saved.manifest }),
          };
        }
        // A Codex-owned sweep can disappear after its turn or process exits. Do not leave the
        // panel replaying its last "running" step forever: reconcile the orphan once and publish a
        // terminal event through the same durable channel used for prompts.
        const error = "App Flow stopped because its Codex worker exited. Start the project again to resume from the saved checkpoint.";
        const event: AppFlowHostEvent = { type: "error", phase: "capture", message: error };
        const failed = { ...snapshot, state: "failed" as const, error, event };
        await runStore.writeRun({ ...failed, ownerPid: shared.ownerPid }).catch(cause => {
          captureServerError(cause, "app_flow.run_store");
        });
        return {
          ...failed,
          appLaunched,
          exists: saved.exists,
          projectId: saved.projectId,
          ...(saved.manifest === undefined ? {} : { manifest: saved.manifest }),
        };
      }
      return {
        projectPath: selectedProjectPath,
        state: saved.exists ? "completed" : "idle",
        appLaunched,
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
    async clear(selectedProjectPath) {
      const liveStates: AppFlowRunState[] = ["running", "needs-user-action", "suspended"];
      const projectRuns = [...runs.values()].filter(run => run.projectPath === selectedProjectPath);
      const local = projectRuns.find(run =>
        run.projectPath === selectedProjectPath && liveStates.includes(run.state));
      if (local) throw new Error("Stop the active App Flow run before clearing its saved data.");

      // A screen sweep may be owned by the Codex MCP process while this panel uses another
      // process. Its shared run record is the only safe cross-process guard against deleting the
      // checkpoint and captures underneath that worker. Suspended runs remain resumable work and
      // are guarded even when their original process has exited.
      const shared = await runStore.readRun(selectedProjectPath);
      const sharedIsLive = shared && liveStates.includes(shared.state)
        && (shared.state === "suspended" || ownerAlive(shared.ownerPid));
      if (sharedIsLive) throw new Error("Stop the active App Flow run before clearing its saved data.");
      if (manual.isActive(selectedProjectPath)) {
        throw new Error("Stop the active App Flow recording before clearing its saved data.");
      }

      // A terminal event persists its final active-run record asynchronously. Let those writes
      // drain before deleting the directory, or a late rename could recreate it after `clear`
      // returned and make the removed flow appear to exist again.
      await Promise.all(projectRuns.map(run => runWrites.get(run.runId)).filter(
        (pending): pending is Promise<void> => pending !== undefined));
      const cleared = await flow.clear(selectedProjectPath);
      for (const [runId, run] of runs) {
        if (run.projectPath === selectedProjectPath) {
          stopPromptRelay(runId);
          runs.delete(runId);
          runWrites.delete(runId);
        }
      }
      for (const [runId, projectPath] of remoteRunProjects) {
        if (projectPath === selectedProjectPath) remoteRunProjects.delete(runId);
      }
      recentEvents.delete(`project:${cleared.projectId}`);
      recentEvents.delete(`manual:${cleared.projectId}`);
      return cleared;
    },
    async pause(selectedRunId) {
      const run = runs.get(selectedRunId);
      if (!run) throw new Error("That App Flow run does not exist.");
      const result = await flow.pause(run.projectPath);
      if ((result as { paused?: boolean }).paused) run.state = "suspended";
      if ((result as { paused?: boolean }).paused) persistRun(run);
      activeDecisions?.suspend("App Flow was paused and can be resumed.");
      return result;
    },
    async cancel(selectedRunId) {
      const run = runs.get(selectedRunId);
      if (!run) throw new Error("That App Flow run does not exist.");
      const result = await flow.cancel(run.projectPath);
      run.state = "cancelled";
      stopPromptRelay(run.runId);
      persistRun(run);
      activeDecisions = undefined;
      return result;
    },
    // Raise a failed launch the same way `start` does, and for the same reason: the panel decides
    // whether a call failed from the tool result's `isError`, which only a throw through `safe()`
    // sets. Returned as a value, every failure after the device boots — the scheme prompt, a Metro
    // cold start, an install race — reached the user as a successful launch of an app that never
    // came up, which is indistinguishable from "it only booted the simulator".
    async exploreUi(selectedProjectPath, exploreOptions, context) {
      if ([...runs.values()].some(run => run.state === "running" || run.state === "needs-user-action")) {
        throw new Error("Another App Flow run is already active.");
      }
      const run: MutableRun = { runId: context.runId, projectPath: selectedProjectPath, state: "running" };
      runs.set(run.runId, run);
      persistRun(run);
      recentEvents.delete(`project:${getProjectId(selectedProjectPath)}`);
      // A recording drives the same device these do, and now sometimes literally the same one:
      // the recorder adopts the app the user launched rather than booting its own.
      if (manual.isActive(selectedProjectPath)) {
        throw new ExpectedOperationError("invalid_input", "Stop the active App Flow recording first.");
      }
      await manual.releaseDevices(selectedProjectPath);
      const started = await flow.exploreUi(selectedProjectPath, exploreOptions);
      if (!started.ok) {
        run.state = "failed";
        run.error = started.error;
        persistRun(run);
        runs.delete(run.runId);
        // Benign states of the surface are tagged so the reporter counts them rather than filing
        // an exception — the same split `launchApp` makes below.
        if (started.expected) throw new ExpectedOperationError("invalid_input", started.error);
        throw new Error(started.error);
      }
      return started;
    },
    async launchApp(selectedProjectPath) {
      // A recording drives the same device these do, and now sometimes literally the same one:
      // the recorder adopts the app the user launched rather than booting its own.
      if (manual.isActive(selectedProjectPath)) {
        throw new ExpectedOperationError("invalid_input", "Stop the active App Flow recording first.");
      }
      await manual.releaseDevices(selectedProjectPath);
      const launched = await flow.launchApp(selectedProjectPath);
      if (launched.ok) return launched;
      // Benign states of the surface (a second click, a project with no routes) are raised so the
      // panel shows them, but tagged so the reporter counts them instead of filing an exception.
      if (launched.expected) throw new ExpectedOperationError("invalid_input", launched.error);
      throw new Error(launched.error);
    },
    async resolvePrompt(selectedRunId, selectedResolution, promptId, selectedProjectPath) {
      const run = runs.get(selectedRunId);
      if (!run) {
        if (!selectedProjectPath || !promptId) throw new Error("That App Flow run does not exist.");
        const shared = await runStore.readRun(selectedProjectPath);
        const sharedPrompt = shared?.event && typeof shared.event === "object" && "prompt" in shared.event
          ? (shared.event as { prompt?: { id?: string } }).prompt : undefined;
        if (!shared || shared.runId !== selectedRunId || shared.state !== "needs-user-action" || sharedPrompt?.id !== promptId || !ownerAlive(shared.ownerPid)) {
          throw new Error("That App Flow prompt is no longer active.");
        }
        await runStore.requestResolution(selectedProjectPath, { runId: selectedRunId, promptId, resolution: selectedResolution });
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
          const updated = await runStore.readRun(selectedProjectPath);
          if (!updated || updated.runId !== selectedRunId || updated.state !== "needs-user-action") return { resolved: true, relayed: true };
        }
        return { resolved: true, relayed: true };
      }
      const result = await flow.resolvePrompt(run.projectPath, selectedResolution, promptId);
      if ((result as { resolved?: boolean }).resolved && selectedResolution !== "stop") run.state = "running";
      if ((result as { resolved?: boolean }).resolved && selectedResolution === "stop") run.state = "completed";
      if ((result as { resolved?: boolean }).resolved) { stopPromptRelay(run.runId); persistRun(run); }
      return result;
    },
    manualStart: (selectedProjectPath, nodeId) => {
      recentEvents.delete(`manual:${getProjectId(selectedProjectPath)}`);
      return manual.start(selectedProjectPath, nodeId);
    },
    manualAct: (selectedProjectPath, selectedAction) => manual.act(selectedProjectPath, selectedAction as never),
    manualStop: selectedProjectPath => manual.stop(selectedProjectPath),
    manualCancel: selectedProjectPath => manual.cancel(selectedProjectPath),
    manualReplay: (selectedProjectPath, nodeId) => manual.replay(selectedProjectPath, nodeId),
    runtimeReplay: (selectedProjectPath, nodeId) => manual.replayRuntime(selectedProjectPath, nodeId),
    async poll(query, since) {
      const key = query.runId
        ? query.runId
        : `manual:${getProjectId(projectFor(query))}`;
      const buffered = recentEvents.get(key) ?? [];
      const pending = buffered.filter(entry => entry.seq > since);
      if (pending.length || !query.runId) return pending;
      const remoteProjectPath = remoteRunProjects.get(query.runId);
      if (!remoteProjectPath) return pending;
      const durable = await runStore.readEvent(remoteProjectPath, query.runId, since);
      return durable ? [durable] : pending;
    },
    async screenshot(selectedProjectId, encodedPath) {
      let decoded = Buffer.from(encodedPath, "base64url").toString("utf8");
      // Cache-busting `?v=` (auth checkpoints, and per-build capture versions) is a renderer
      // concern; on disk the slug is just the file.
      decoded = decoded.split("?")[0] ?? decoded;
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

function ownerAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
