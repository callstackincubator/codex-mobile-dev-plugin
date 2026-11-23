import type { TestingRuntimeProgress } from "@mobile-dev/shared/testing-runtime.ts";
import type { HostBridge } from "./host-bridge.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { captureUiError, countUiEvent, getUiTelemetryAttributes, recordUiTiming } from "./telemetry.ts";
import { testRecorder } from "./test-recorder.ts";
import type { RecorderTreeSource } from "./test-recorder.ts";
import { PANEL_HEARTBEAT_MS, isRecordableDevice, recordablePlatform } from "@mobile-dev/shared/panel-target.ts";
import type { ScreenComponent } from "@mobile-dev/shared/screen-annotations.ts";
import { screenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { testFileSlug } from "@mobile-dev/shared/test-recording.ts";
import { branchStoredStepLocator, storedTestCallLines, storedTestUntilSource } from "@mobile-dev/shared/stored-test-steps.ts";
import type { RecordedStep } from "@mobile-dev/shared/test-recording.ts";
import type { TestDraftSummary } from "@mobile-dev/shared/test-drafts.ts";
import { DEFAULT_MATRIX_LIMIT, clampLimit, isTerminalLane, matrixFinished, parseMatrix, parseMatrixDevices, readMatrixPreferences, writeMatrixPreferences } from "./testing-matrix.ts";
import type { MatrixDeviceOption, MatrixLane, MatrixView } from "./testing-matrix.ts";

/**
 * One test the project already holds, as the server reports it.
 *
 * The panel's list has two halves: what has not been stored yet (the drafts above) and what the
 * project already holds. A saved recording moves from one to the other, which is the whole reason
 * this exists — the draft is deleted on save, so before this the test left the list entirely.
 */
export type StoredTestSummary = { relativePath: string; name: string; updatedAt: string; sizeBytes: number; /** The app a Testing Studio test is pinned to, and any app added for the other platform. */ target?: { platform: "ios" | "android"; bundleId: string; apps?: { ios?: string; android?: string } } };

/**
 * An agent recording, as the server reports it.
 *
 * The recording itself lives in the server — see `packages/core/src/testing-agent.ts` for why it
 * has to — and the panel polls for it, the same way it polls a run's progress and for the same
 * reason: a tool call is one request and one response.
 */
export type TestingAgentView = {
  active: boolean;
  status: "idle" | "recording" | "finished" | "aborted";
  title: string;
  goal: string;
  steps: number;
  note: string;
  /** The unsaved recording a finished session was kept as; "" while it is still recording. */
  draftId: string;
  /** The Testing Studio test a finished session was saved as, relative to Testing Studio; "" when it was kept as a draft. */
  savedPath: string;
};

/**
 * What survives the panel document: the project the user was last in, and the agent's project
 * request this panel already applied. The host rebuilds the document often (and after a crash),
 * and a fresh one must reopen on the same project rather than on the newest folder, or replay an
 * agent's request the user has since moved past. Best effort: storage can be blocked.
 */
const PROJECT_STATE_KEY = "mobile-dev.testing.project";
type StoredProjectState = { project?: string; request?: { id: number; path: string } };
function readProjectState(): StoredProjectState {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(PROJECT_STATE_KEY) ?? "null") as unknown;
    const data = object(stored);
    const request = object(data?.request);
    return {
      ...(typeof data?.project === "string" && data.project ? { project: data.project } : {}),
      ...(typeof request?.id === "number" && typeof request.path === "string" ? { request: { id: request.id, path: request.path } } : {}),
    };
  } catch { return {}; }
}
function writeProjectState(change: StoredProjectState) {
  try { globalThis.localStorage?.setItem(PROJECT_STATE_KEY, JSON.stringify({ ...readProjectState(), ...change })); } catch { /* best effort */ }
}

/** 400 ms while an agent is recording, so a step lands in the panel as it is recorded. */
const AGENT_POLL_ACTIVE_MS = 400;
/**
 * And a slow tick otherwise, so a recording the agent starts is noticed even when the user is
 * looking at another tool. It is what opens the Testing Studio tab for them.
 */
const AGENT_POLL_IDLE_MS = 2_500;

/**
 * How long the panel waits after the last change before keeping the flow.
 *
 * Long enough that dragging a step or typing a title is one write rather than a dozen, short
 * enough that switching tools a moment after a tap still finds the step. A write is a few
 * kilobytes to a file in the plugin's own storage, so the cost of being wrong here is small in
 * one direction and a lost recording in the other.
 */
const DRAFT_AUTOSAVE_MS = 700;

/** One entry of the project selector. The server owns the list so a pick survives the panel document. */
export interface TestingProjectOption { path: string; name: string }
/** A target as the project's e2e config declares it; a static read may not see every field. */
export interface TestingTargetOption { name: string; platform?: string; bundleId?: string }
export type TestingModelPreference = { provider: "vercel" | "openrouter" | "openai-compatible" | "chatgpt" | "copilot" | "opencode-console" | "grok"; model: string; endpoint?: string };
export type TestingProviderOption = { id: string; label: string; subscription?: string; defaultModel?: string };
export type TestingSetupOptions = { targets: { name: string; platform: "ios" | "android"; bundleId: string }[]; provider: TestingModelPreference["provider"] | "none"; model?: string; endpoint?: string; installDependencies: boolean; installSkill: boolean; registerMcp: boolean };
export type TestingSetupOperation = { id: string; kind: "apply" | "login"; status: "running" | "waiting" | "succeeded" | "failed" | "cancelled"; message: string; completed: number; total: number; applied: string[]; auth?: { url: string; instructions: string; userCode?: string }; prompt?: { message: string; placeholder?: string } };
export type TestingSetupDetails = { provider?: string; model?: string; endpoint?: string; dependencies: { e2e?: string; mobile?: string }; skillInstalled: boolean; mcpRegistrations: string[]; loginStatus: Record<string, boolean> };

export type TestingSnapshot = {
  open: boolean;
  available: boolean;
  projectPath: string;
  projects: TestingProjectOption[];
  /** The private workspace Testing Studio records against when no project is open; "" until the server says. */
  studioPath: string;
  targets: TestingTargetOption[];
  /** The target the panel records against; "" until a project with targets is loaded. */
  targetName: string;
  configPath: string;
  runtimeMode: "project" | "bundled";
  setupState: "configured" | "available";
  setupDetails?: TestingSetupDetails;
  targetSource: "project" | "expo-cli" | "static-expo" | "foreground" | "none";
  projectWarning: string;
  modelPreference?: TestingModelPreference;
  providers: TestingProviderOption[];
  modelPickerOpen: boolean;
  setupOpen: boolean;
  needsRuntime?: boolean;
  loadingProject: boolean;
  pickingProject: boolean;
  launching: boolean;
  /**
   * Whether this panel launched the app on the selected device. It is optimistic and panel-local:
   * nothing polls the device for it, so an app launched elsewhere still reads as false here. It
   * only drives the button's label, never anything the recorder depends on.
   */
  appLaunched: boolean;
  /** The file name under `tests/`, without the folder; "" means "derive it from the title". */
  fileName: string;
  saving: boolean;
  /** Set when the target file exists and the user has not yet agreed to replace it. */
  overwritePath: string;
  /** The recorder revision that was written, so the panel can tell saved from dirty. */
  savedRevision: number;
  savedPath: string;
  /** A run is in flight. The recorder holds the per-line marks; this is just the button's state. */
  running: boolean;
  /** Run asked to replace an existing file and is waiting on the answer. */
  pendingRun: boolean;
  /** The matrix run on screen: one lane per device. Null for a run on a single device. */
  matrix: MatrixView | null;
  /** The lane whose steps the preview shows. */
  selectedLane: string;
  /** Devices the matrix checklist can offer, with whether each is booted and has the app. */
  matrixDevices: MatrixDeviceOption[];
  matrixLoading: boolean;
  /** The devices the user ticked for the current test in this panel session. */
  matrixSelected: string[];
  /** How many devices run at once; the rest queue. Saved per project. */
  matrixLimit: number;
  /** The agent recording the server holds, or null when no agent has ever recorded here. */
  agent: TestingAgentView | null;
  /**
   * An agent started the run on screen (`matrix`). Its lanes are live and the panel's editing is
   * locked the way it is while the agent records, until every lane has finished.
   */
  agentRun: boolean;
  /**
   * The recordings that have not been written into a project yet, newest first.
   *
   * A flow lives in the panel document, which the host rebuilds whenever the user looks at
   * another tool or another chat, so without this a recording they had not saved — or one their
   * agent made while they were reading the chat — was gone when they came back. The panel keeps
   * what it is holding as it changes and lists the rest, so one can be reopened or thrown away.
   */
  drafts: TestDraftSummary[];
  /** The draft the flow on screen is being kept as; "" before the first autosave. */
  draftId: string;
  /** A draft is being read back into the panel. */
  loadingDraft: boolean;
  /** The `.e2e.ts` files the chosen project already holds, newest first. */
  tests: StoredTestSummary[];
  /** A project file shown as source, without importing it into the editable recorder. */
  selectedTestPath: string;
  selectedTestSource: string;
  selectedTestOriginalHash: string;
  selectedTestStaged: boolean;
  loadingTest: boolean;
  /** A stored test is being deleted; its path, so only its own row shows the spinner. */
  deletingTest: string;
  error: string | null;
};

function textError(result: Awaited<ReturnType<HostBridge["callServerTool"]>>, fallback: string): Error {
  return new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || fallback);
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
/** How a platform reads in the panel. */
export function platformLabel(platform: "ios" | "android"): string { return platform === "ios" ? "iOS" : "Android"; }

/**
 * Launch app opens an app that is already installed; it never builds one, since a build is the
 * project's own (Expo, EAS, Gradle, Xcode) and takes minutes. A missing app says so, with the way to fix it.
 */
export function launchErrorMessage(message: string, bundleId: string, platform: "ios" | "android"): string {
  if (!/is not installed|Unable to find package|Unknown package/i.test(message)) return message;
  const where = platform === "ios" ? "this simulator" : "this emulator";
  return `${bundleId} is not installed on ${where}. Build and install it (for an Expo app, \`npx expo run:${platform}\`), then launch again.`;
}

function projectName(projectPath: string): string { return projectPath.split("/").filter(Boolean).at(-1) ?? projectPath; }

/** The targets a `mobile_testing_project_config` result lists, keeping only named entries. */
function parseTargets(data: Record<string, unknown>): TestingTargetOption[] {
  const listed = Array.isArray(data.targets) ? data.targets : [];
  return listed.map(entry => object(entry)).filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter(entry => text(entry.name))
    .map(entry => ({
      name: text(entry.name),
      ...(text(entry.platform) ? { platform: text(entry.platform) } : {}),
      ...(text(entry.bundleId) ? { bundleId: text(entry.bundleId) } : {}),
    }));
}

/**
 * The Testing Studio panel: pick an e2e project, launch its app on the mirrored device, and (once the
 * recorder lands) turn taps on the mirror into a deterministic test.
 *
 * This is the walking skeleton — project selection and launch only. Tap interception, selector
 * resolution and codegen are specified in `docs/testing-panel.md` and are not implemented yet.
 */

export class TestingPanel {
  private readonly app: HostBridge;
  private readonly deviceApps: DeviceAppsStore;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private projectRequest?: Promise<void>;
  private restoreRequest?: Promise<void>;
  /** Guards against a slow project load overwriting a newer selection. */
  private loadRevision = 0;
  private testReadRevision = 0;
  private stageWrite?: Promise<void>;
  private pendingModelAction?: { kind: "recording"; options: { untilStepId?: string } } | { kind: "stored"; untilLine?: number };
  private savingModelPreference = false;
  /** The project and target the installed tree source reads; "" when there is no source. */
  private treeSourceKey = "";
  private snapshot: TestingSnapshot = {
    open: false, available: false, projectPath: "", projects: [], studioPath: "", targets: [], targetName: "", configPath: "", runtimeMode: "bundled", setupState: "available", targetSource: "none", projectWarning: "", providers: [], modelPickerOpen: false, setupOpen: false,
    loadingProject: false, pickingProject: false, launching: false, appLaunched: false,
    fileName: "", saving: false, overwritePath: "", savedRevision: -1, savedPath: "", running: false, pendingRun: false,
    matrix: null, selectedLane: "", matrixDevices: [], matrixLoading: false, matrixSelected: [], matrixLimit: DEFAULT_MATRIX_LIMIT,
    agent: null, agentRun: false, drafts: [], draftId: "", loadingDraft: false, tests: [], selectedTestPath: "", selectedTestSource: "", selectedTestOriginalHash: "", selectedTestStaged: false, loadingTest: false, deletingTest: "", error: null,
  };

  /** The agent recording's revision the panel has already adopted; -1 before the first poll. */
  private agentRevision = -1;
  /** The server's stored-tests revision the panel has loaded; -1 before the first poll. */
  private storedTestsRevision = -1;
  private agentTimer?: ReturnType<typeof setTimeout>;
  private agentPolling = false;
  /** The last selection reported to the server, so the context tool is not called on every tick. */
  private reportedContext = "";
  private readonly stopWatchingDevices: () => void;
  private readonly stopWatchingRecorder: () => void;
  private draftTimer?: ReturnType<typeof setTimeout>;
  /** The recorder revision already kept, so an unchanged flow is not rewritten on every tick. */
  private draftRevision = -1;
  /**
   * Which flow `draftId` belongs to.
   *
   * Without it, pressing Record on a finished recording kept the old draft id and wrote the new
   * flow straight over the old one's file: the list showed one recording where the user had made
   * two. `revision` cannot tell those apart — it moves for an edit and for a new flow alike — so
   * the recorder mints a `flowId` and the draft is pinned to it. A flow that is not the one the
   * draft was taken from is kept as a new draft, whatever the panel was holding a moment ago.
   */
  private draftFlowId = "";
  private draftWrite?: Promise<void>;
  /** Set while `dispose` makes its last keep, so the guards do not refuse the flush. */
  private flushing = false;
  /** Set when a session goes active, for the host chrome to show the Testing Studio tab. */
  private onAgentRecording?: () => void;

  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private readonly onPageHide = () => { void this.clearReportedContext(); };
  private beat() { if (this.snapshot.open) void this.reportContext(true); }
  /** Coming back from throttling: report now rather than wait for the next (late) timer tick. */
  private readonly onWake = () => { this.beat(); };

  constructor(app: HostBridge, deviceApps: DeviceAppsStore, options: { heartbeatMs?: number } = {}) {
    this.app = app;
    this.deviceApps = deviceApps;
    // The server only believes a panel that keeps reporting: a closed tab or window sends nothing.
    // An unfocused host window reports the page hidden and throttles its timers; that is not the tab
    // closing, so the beat does not check visibility. `snapshot.open` is the panel's own tab state.
    this.heartbeatTimer = setInterval(() => { this.beat(); }, options.heartbeatMs ?? PANEL_HEARTBEAT_MS);
    // An interval must not keep a host process alive on its own.
    (this.heartbeatTimer as { unref?: () => void }).unref?.();
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onPageHide);
      window.addEventListener("focus", this.onWake);
    }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onWake);
    // The device is half of what an agent recording needs and it belongs to the simulator panel,
    // so the selection is reported whenever either half moves.
    this.stopWatchingDevices = deviceApps.subscribe(() => {
      void this.reportContext();
      const { foregroundApp } = deviceApps.getSnapshot();
      const front = foregroundApp?.bundleId;
      if (this.snapshot.projectPath && this.snapshot.runtimeMode === "bundled") {
        // Only the targets: reloading the whole project here would close the test the user has open.
        if (front && this.snapshot.targets.every(entry => entry.bundleId !== front)) void this.refreshStudioTargets();
        // An app the device list cannot name (Apple's own, or the home screen) is still the app in
        // front: keeping the last app's target would have Record open that one instead.
        else if (!front && foregroundApp?.pid && this.noProject && this.studioForegroundKey !== `pid:${foregroundApp.pid}`) void this.refreshStudioTargets();
      }
    });
    // Every change to what would be written bumps the recorder's revision, which is exactly the
    // thing worth keeping, so one subscription covers recording, editing, dragging and the title.
    this.stopWatchingRecorder = testRecorder.subscribe(() => { this.scheduleDraft(); });
  }

  /**
   * The host chrome's way of being told to show the Testing Studio tab.
   *
   * Which tool is on screen is the host's own state — the workspace component holds it — so the
   * panel asks rather than reaches. Opening the tab is the point of an agent recording: the user
   * asked their agent for a test and the steps have to be somewhere they can see them.
   */
  onAgentRecordingStarted(listener: () => void) {
    this.onAgentRecording = listener;
    return () => { if (this.onAgentRecording === listener) this.onAgentRecording = undefined; };
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private update(fields: Partial<TestingSnapshot>) {
    // A device choice belongs to one test in one panel session. Only concurrency follows the project.
    if (fields.projectPath !== undefined && fields.projectPath !== this.snapshot.projectPath) {
      const saved = readMatrixPreferences(fields.projectPath);
      fields = { ...fields, matrixSelected: [], matrixLimit: saved.limit, matrix: null, selectedLane: "" };
    }
    this.snapshot = { ...this.snapshot, ...fields };
    for (const listener of this.listeners) listener();
    this.syncTreeSource();
    void this.reportContext();
  }

  /**
   * Keeps the recorder's tree source in step with the project and target.
   *
   * The source is what reads the e2e runner's own element tree, and reading it needs both: the
   * project, whose `@e2e-dev/mobile` decides what every element's role is, and the target's bundle
   * id, to attach to the app the user is already tapping. Without both there is nothing to read,
   * and the recorder is told so rather than being left pointed at a stale project.
   */
  private syncTreeSource() {
    const projectPath = this.snapshot.projectPath;
    const bundleId = this.target?.bundleId ?? "";
    const key = this.disposed || this.snapshot.needsRuntime || !projectPath || !bundleId ? "" : `${projectPath}\u0000${bundleId}`;
    if (key === this.treeSourceKey) return;
    this.treeSourceKey = key;
    testRecorder.useTreeSource(key ? this.treeSource(projectPath, bundleId) : undefined);
  }

  private treeSource(projectPath: string, bundleId: string): RecorderTreeSource {
    return {
      read: async (deviceId, platform) => {
        const result = await this.call("mobile_testing_read_tree", { deviceId, platform, projectPath, bundleId }, 20000);
        const content = object(result.structuredContent);
        const tree = content?.tree;
        // The screen the runner measured against. Android's is device pixels and the mirror's is
        // the stream's own size, so the mirror cannot place these rectangles without it.
        const screen = screenSize(content?.screen);
        return { tree: Array.isArray(tree) ? tree as ScreenComponent[] : [], ...(screen ? { screen } : {}) };
      },
      // Fire and forget: giving the device back must never hold up stopping a recording, and a
      // release that fails leaves the session for the next `read` to take over.
      release: () => { void this.call("mobile_testing_release_device", {}, 10000).catch(() => undefined); },
    };
  }

  /** A host may advertise a preselection through configuration; host names never select behavior. */
  private hostModelDefault(): TestingModelPreference | undefined {
    const capabilities = this.app.getHostCapabilities() as unknown as Record<string, unknown> | undefined;
    const configuration = object(capabilities?.configuration) ?? object(object(capabilities?.experimental)?.mobileDev);
    const testing = object(configuration?.testing);
    const candidate = object(testing?.defaultModel);
    const provider = text(candidate?.provider) as TestingModelPreference["provider"];
    const model = text(candidate?.model);
    if (!provider || !model || !["vercel", "openrouter", "openai-compatible", "chatgpt", "copilot", "opencode-console", "grok"].includes(provider)) return;
    return { provider, model, ...(text(candidate?.endpoint) ? { endpoint: text(candidate?.endpoint) } : {}) };
  }

  private async call(name: string, arguments_: Record<string, unknown>, timeout = 30000) {
    const result = await this.app.callServerTool({ name, arguments: arguments_ }, { timeout });
    if (result.isError) throw textError(result, `${name} failed.`);
    return result;
  }

  show() { if (!this.disposed) { this.update({ open: true }); void this.restoreProject(); } }
  hide() { this.update({ open: false }); }
  setAvailable(available: boolean) {
    this.update({ available });
    if (!available) return;
    // Reopened on the last project whether or not the tab is showing: an agent recording needs a
    // project the user has already chosen, and asking them to open the tab first only to have it
    // reopen on the folder they picked last time is a step that answers nothing. The *choice* is
    // still theirs — nothing is ever inferred from the server's working directory.
    void this.restoreProject();
    // And the poll runs from here rather than from `show`, so a recording the agent starts while
    // the user is in another tool is what opens the Testing Studio tab for them.
    this.pollAgent();
    void this.refreshDrafts();
    void this.refreshTests();
  }

  /** The target the recorder would use: the chosen one, else the first the config declares. */
  get target(): TestingTargetOption | undefined {
    const { targets, targetName } = this.snapshot;
    return targets.find(entry => entry.name === targetName) ?? targets[0];
  }

  /**
   * Why the selected target cannot be recorded against the mirrored device, or "". A flow recorded
   * on one platform and run on another is a test nobody can reproduce, so it is refused here
   * rather than discovered when the run fails.
   */
  get targetMismatch(): string {
    const device = this.deviceApps.getSnapshot().device;
    const target = this.target;
    if (!device || !target?.platform) return "";
    const mirrored = recordablePlatform(device);
    if (target.platform === mirrored) return "";
    // Testing Studio's target follows the app in front, which is unknown for a moment after the mirror changes:
    // `selectDevice` clears it and `refreshStudioTargets` re-reads the target once it is found. Until
    // then the target is still the other mirror's, and warning about it only flashes. Say nothing until
    // the new device has answered and its target is in.
    if (this.noProject) {
      const { ready, foregroundApp } = this.deviceApps.getSnapshot();
      if (!ready || this.refreshingTargets) return "";
      if (foregroundApp?.bundleId && this.snapshot.targets.every(entry => entry.bundleId !== foregroundApp.bundleId)) return "";
    }
    const shown = mirrored === "ios" ? "an iOS simulator" : "an Android emulator";
    const other = target.platform === "ios" ? "an iOS simulator" : "an Android emulator";
    // Testing Studio's targets are the app in front, so its only target names are internal: say what to do on the device instead.
    if (this.noProject) return `The mirror shows ${shown}, but the app was picked up on ${platformLabel(target.platform)}. Open the app on this device to record here, or switch the mirror to ${other}.`;
    return `The "${target.name}" target runs on ${platformLabel(target.platform)}, but the mirror shows ${shown}. Choose ${mirrored === "ios" ? "an iOS" : "an Android"} target, or switch the mirror to ${other}.`;
  }

  /** Whether a launch is possible: a bundle id to launch and a booted device to launch it on. */
  get canLaunch(): boolean {
    const device = this.deviceApps.getSnapshot().device;
    const booted = device?.state === "Booted" || device?.state === "connected";
    return Boolean(this.snapshot.available && this.target?.bundleId && booted && !this.targetMismatch && !this.snapshot.launching);
  }

  /** Reads the server's project list, so a pick survives the panel document. */
  async refreshProjects() {
    this.projectRequest ??= (async () => {
      const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
      try {
        const response = await this.call("mobile_testing_projects", {});
        const listed = object(response.structuredContent)?.projects;
        const projects = (Array.isArray(listed) ? listed : []).map(entry => object(entry))
          .filter((entry): entry is Record<string, unknown> => entry !== null)
          .filter(entry => text(entry.path))
          .map(entry => ({ path: text(entry.path), name: text(entry.name) || projectName(text(entry.path)) }));
        if (!this.disposed) this.update({ projects, studioPath: text(object(response.structuredContent)?.studioPath) || this.snapshot.studioPath });
      } catch {
        // The panel still works from the project it was last opened with, or the empty state.
      } finally {
        if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.projects", performance.now() - startedAt);
        this.projectRequest = undefined;
      }
    })();
    return this.projectRequest;
  }

  /** Reopens the panel on the project it was last used with. Retryable: the host may not be up yet. */
  private async restoreProject() {
    if (!this.snapshot.available || this.snapshot.projectPath || this.restoreRequest) return this.restoreRequest;
    const request = (async () => {
      await this.refreshProjects();
      // An agent that opened the panel for its chat has already said which project it wants.
      if (await this.applyServerProjectRequest()) return;
      // No project is a state of its own: with nothing recorded against yet, Testing Studio opens on its
      // private workspace so recording never waits for a folder to be chosen.
      // The one the user was last in, whether that was Testing Studio or a folder; else the newest folder.
      const last = readProjectState().project;
      const known = last && (last === this.snapshot.studioPath || this.snapshot.projects.some(entry => entry.path === last)) ? last : "";
      const latest = known || this.snapshot.projects[0]?.path || this.snapshot.studioPath;
      if (latest && !this.disposed && !this.snapshot.projectPath) await this.selectProject(latest);
    })();
    this.restoreRequest = request;
    try { await request; } finally { if (this.restoreRequest === request) this.restoreRequest = undefined; }
  }

  private appliedProjectRequest = readProjectState().request;
  private projectRequestApply?: Promise<void>;

  /**
   * The project an agent chose when it opened the panel for its chat: No project, or a folder
   * (added to the list if missing, without the folder dialog). Applied once per request, so a
   * project the user picks afterwards is never taken back. Returns whether a request was found.
   */
  private async applyProjectRequest(data: Record<string, unknown>): Promise<boolean> {
    const request = object(data.projectRequest);
    const id = request?.id, path = text(request?.path);
    if (typeof id !== "number" || !path) return false;
    // A request an earlier document of this panel already applied is spent, not a new instruction.
    const applied = this.appliedProjectRequest;
    if (applied && applied.id === id && applied.path === path && !this.projectRequestApply) return false;
    if (!applied || applied.id !== id || applied.path !== path) {
      this.appliedProjectRequest = { id, path };
      writeProjectState({ request: { id, path } });
      this.projectRequestApply = (async () => {
        await this.refreshProjects();
        if (this.disposed || path === this.snapshot.projectPath) return;
        await this.chooseProject(path);
      })();
    }
    await this.projectRequestApply;
    return true;
  }

  private async applyServerProjectRequest(): Promise<boolean> {
    try {
      const response = await this.call("mobile_testing_agent_state", {}, 5_000);
      return await this.applyProjectRequest(object(response.structuredContent) ?? {});
    } catch { return false; }
  }

  private remembered(project: TestingProjectOption) {
    this.update({ projects: [project, ...this.snapshot.projects.filter(entry => entry.path !== project.path)] });
  }

  /** Whether Testing Studio is on its private workspace rather than a project the user opened. */
  get noProject(): boolean { return Boolean(this.snapshot.studioPath) && this.snapshot.projectPath === this.snapshot.studioPath; }

  /** Leaves the open project and records in Testing Studio's own workspace. */
  async useNoProject() {
    await this.refreshProjects();
    if (this.snapshot.studioPath) await this.selectProject(this.snapshot.studioPath);
  }

  /** Selects a project the selector already lists, and makes it the one the panel reopens with. */
  async chooseProject(projectPath: string) {
    const path = projectPath.trim();
    if (!path) return;
    if (!this.snapshot.available || path === this.snapshot.studioPath) { await this.selectProject(path); return; }
    try {
      const response = await this.call("mobile_testing_choose_project", { projectPath: path });
      const project = object(object(response.structuredContent)?.project);
      const chosen = text(project?.path);
      if (!chosen) return;
      this.remembered({ path: chosen, name: text(project?.name) || projectName(chosen) });
      await this.selectProject(chosen);
    } catch (error) {
      // The server refuses folders with no e2e config, so the current project stays put.
      this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Opens the system folder picker. Cancelling keeps the current project. */
  async pickProject() {
    if (this.snapshot.pickingProject) return;
    this.update({ pickingProject: true, error: null });
    try {
      // The wait is a person choosing a folder, so the server's dialog metric measures it.
      const response = await this.call("mobile_testing_choose_project", {}, 300_000);
      const project = object(object(response.structuredContent)?.project);
      const path = text(project?.path);
      if (!path) return;
      this.remembered({ path, name: text(project?.name) || projectName(path) });
      await this.selectProject(path);
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.update({ pickingProject: false });
    }
  }

  /**
   * Testing Studio derives its only target from the app in front, so when another app comes to the front
   * the target is re-read, in place: unlike `selectProject` it keeps drafts, tests and selection.
   */
  private async refreshStudioTargets() {
    const { projectPath } = this.snapshot;
    const { device, foregroundApp } = this.deviceApps.getSnapshot();
    const foregroundBundleId = foregroundApp?.bundleId ?? undefined;
    const pid = foregroundBundleId ? undefined : foregroundApp?.pid ?? undefined;
    const key = foregroundBundleId ?? (pid ? `pid:${pid}` : "");
    if (!projectPath || !device || !isRecordableDevice(device) || !key || this.refreshingTargets === key) return;
    this.refreshingTargets = key;
    this.studioForegroundKey = key;
    const revision = this.loadRevision;
    try {
      const platform = recordablePlatform(device);
      const response = await this.call("mobile_testing_project_config", { projectPath, foregroundPlatform: platform,
        ...(foregroundBundleId ? { foregroundBundleId } : { foregroundDeviceId: device.udid, foregroundPid: pid }) });
      if (revision !== this.loadRevision || this.snapshot.runtimeMode !== "bundled") return;
      const data = object(response.structuredContent) ?? {};
      const targets = parseTargets(data);
      const preferred = targets.find(entry => entry.platform === platform) ?? targets[0];
      const source = text(data.targetSource);
      this.update({ targets, targetName: preferred?.name ?? "", ...(["expo-cli", "static-expo", "foreground", "none"].includes(source) ? { targetSource: source as TestingSnapshot["targetSource"] } : {}) });
    } catch { /* the next foreground change retries */ } finally {
      if (this.refreshingTargets === key) this.refreshingTargets = "";
    }
  }
  private refreshingTargets = "";
  /** The foreground the Testing Studio targets were last read for, so an unnamed app is read once, not on every device update. */
  private studioForegroundKey = "";

  /** Loads one project's e2e config into the panel. */
  async selectProject(projectPath: string) {
    const path = projectPath.trim();
    const revision = ++this.loadRevision;
    if (path) writeProjectState({ project: path });
    this.clearTestPreview();
    // The flow on screen belongs to the project it was recorded against, so the panel lets go of
    // its draft rather than rewriting that draft under a different project's path.
    clearTimeout(this.draftTimer);
    this.draftRevision = testRecorder.getSnapshot().revision;
    this.draftFlowId = "";
    this.pendingModelAction = undefined;
    this.update({ projectPath: path, needsRuntime: false, targets: [], targetName: "", configPath: "", runtimeMode: "bundled", setupState: "available", setupDetails: undefined, targetSource: "none", projectWarning: "", appLaunched: false,
      overwritePath: "", savedRevision: -1, savedPath: "", draftId: "", drafts: [], tests: [], error: null });
    void this.refreshDrafts();
    void this.refreshTests();
    if (!path || !this.snapshot.available) return;
    this.update({ loadingProject: true });
    try {
      const device = this.deviceApps.getSnapshot().device;
      const foregroundBundleId = this.deviceApps.getSnapshot().foregroundApp?.bundleId ?? undefined;
      const foregroundPlatform = device && isRecordableDevice(device) ? recordablePlatform(device) : undefined;
      const response = await this.call("mobile_testing_project_config", { projectPath: path, ...(foregroundPlatform && foregroundBundleId ? { foregroundPlatform, foregroundBundleId } : {}) });
      if (revision !== this.loadRevision) return;
      const data = object(response.structuredContent) ?? {};
      const targets = parseTargets(data);
      // The target on the mirrored device's platform, so a project with both records against the
      // right one without being asked; else the first, which `targetMismatch` then reports on.
      const preferred = (device ? targets.find(entry => entry.platform === recordablePlatform(device)) : undefined) ?? targets[0];
      const preference = object(data.modelPreference);
      const modelPreference = preference && text(preference.provider) && text(preference.model) ? { provider: text(preference.provider) as TestingModelPreference["provider"], model: text(preference.model), ...(text(preference.endpoint) ? { endpoint: text(preference.endpoint) } : {}) } : this.hostModelDefault();
      const setup = object(data.setup);
      const dependencyData = object(setup?.dependencies) ?? {};
      const loginData = object(setup?.loginStatus) ?? {};
      const setupDetails: TestingSetupDetails | undefined = setup ? {
        ...(text(setup.provider) ? { provider: text(setup.provider) } : {}), ...(text(setup.model) ? { model: text(setup.model) } : {}), ...(text(setup.endpoint) ? { endpoint: text(setup.endpoint) } : {}),
        dependencies: { ...(text(dependencyData.e2e) ? { e2e: text(dependencyData.e2e) } : {}), ...(text(dependencyData.mobile) ? { mobile: text(dependencyData.mobile) } : {}) },
        skillInstalled: setup.skillInstalled === true,
        mcpRegistrations: Array.isArray(setup.mcpRegistrations) ? setup.mcpRegistrations.map(text).filter(Boolean) : [],
        loginStatus: Object.fromEntries(Object.entries(loginData).map(([key, value]) => [key, value === true])),
      } : undefined;
      const providers = (Array.isArray(data.providers) ? data.providers : []).map(entry => object(entry)).filter((entry): entry is Record<string, unknown> => entry !== null).map(entry => ({ id: text(entry.id), label: text(entry.label), ...(text(entry.subscription) ? { subscription: text(entry.subscription) } : {}), ...(text(entry.defaultModel) ? { defaultModel: text(entry.defaultModel) } : {}) })).filter(entry => entry.id && entry.label);
      this.update({ targets, targetName: preferred?.name ?? "", needsRuntime: data.needsRuntime === true, configPath: text(data.configPath), runtimeMode: data.runtimeMode === "project" ? "project" : "bundled", setupState: data.setupState === "configured" ? "configured" : "available", setupDetails, targetSource: ["project", "expo-cli", "static-expo", "foreground"].includes(text(data.targetSource)) ? text(data.targetSource) as TestingSnapshot["targetSource"] : "none", projectWarning: text(data.warning), modelPreference, providers });
    } catch (error) {
      if (revision === this.loadRevision) this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (revision === this.loadRevision) this.update({ loadingProject: false });
    }
  }

  async runtimeProgress(projectPath: string, start?: { retry: boolean }) {
    const revision = this.loadRevision;
    const tool = start ? "mobile_testing_prepare_runtime" : "mobile_testing_runtime_progress";
    const response = await this.call(tool, start ?? {});
    const data = response.structuredContent as { progress: TestingRuntimeProgress; loginStatus?: Record<string, boolean> };
    if (data.progress.phase === "ready" && !this.disposed && revision === this.loadRevision && projectPath === this.snapshot.projectPath) {
      const setupDetails = this.snapshot.setupDetails;
      this.update({ needsRuntime: false, ...(setupDetails && data.loginStatus ? { setupDetails: { ...setupDetails, loginStatus: data.loginStatus } } : {}) });
    }
    return data.progress;
  }

  /** Records against another target the config declares. */
  selectTarget(name: string) {
    if (!this.snapshot.targets.some(entry => entry.name === name)) return;
    this.update({ targetName: name, appLaunched: false });
  }

  openSetup() { this.update({ setupOpen: true }); }
  closeSetup() { this.update({ setupOpen: false }); }
  openModelPicker() { this.update({ modelPickerOpen: true }); }
  closeModelPicker() { this.pendingModelAction = undefined; this.update({ modelPickerOpen: false }); }

  async saveModelPreference(preference?: TestingModelPreference) {
    if (this.savingModelPreference) return;
    this.savingModelPreference = true;
    const pending = this.pendingModelAction;
    this.pendingModelAction = undefined;
    try {
      await this.call("mobile_testing_model_preference", { ...(preference ? { preference } : {}) });
      this.update({ modelPreference: preference, modelPickerOpen: false });
      countUiEvent("ui.testing.model_preference");
      if (preference && pending) {
        if (pending.kind === "stored") void this.runStoredTest(pending.untilLine);
        else void this.runTest(pending.options);
      }
    } catch (error) {
      if (!this.pendingModelAction) this.pendingModelAction = pending;
      throw error;
    } finally {
      this.savingModelPreference = false;
    }
  }

  /** Opens an OAuth URL only for a sign-in flow the user explicitly started. */
  async openLoginUrl(url: string) {
    const destination = new URL(url);
    if (destination.protocol !== "https:" && destination.protocol !== "http:") throw new Error("Only web sign-in links can be opened.");
    await this.app.openLink({ url: destination.href });
  }

  async planSetup(options: TestingSetupOptions) {
    const response = await this.call("mobile_testing_setup_plan", { projectPath: this.snapshot.projectPath, options }, 60_000);
    return object(object(response.structuredContent)?.plan);
  }
  async applySetup(planId: string) {
    const response = await this.call("mobile_testing_setup_apply", { planId }, 30_000);
    return object(object(response.structuredContent)?.operation) as TestingSetupOperation | null;
  }
  async setupProgress(operationId: string) {
    const response = await this.call("mobile_testing_setup_progress", { operationId }, 10_000);
    return object(object(response.structuredContent)?.operation) as TestingSetupOperation | null;
  }
  async cancelSetup(operationId: string) { await this.call("mobile_testing_setup_cancel", { operationId }); }
  async startLogin(provider: string) {
    const response = await this.call("mobile_testing_setup_login", { provider }, 30_000);
    return object(object(response.structuredContent)?.operation) as TestingSetupOperation | null;
  }
  async answerLogin(operationId: string, value: string) { await this.call("mobile_testing_setup_answer", { operationId, value }); }

  /**
   * Launches the selected target's app on the mirrored device, so recording starts from the app
   * the generated test will open. It does not build: an app that is not installed fails here, and
   * the message says so.
   */
  async launchApp() {
    const device = this.deviceApps.getSnapshot().device;
    const bundleId = this.target?.bundleId;
    if (!device || !bundleId || this.snapshot.launching) return;
    this.update({ launching: true, error: null });
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    try {
      await this.call("mobile_launch_app", {
        platform: recordablePlatform(device),
        deviceId: device.udid,
        bundleId,
      }, 120_000);
      this.update({ appLaunched: true });
      countUiEvent("ui.testing.launch");
    } catch (error) {
      this.update({ error: launchErrorMessage(error instanceof Error ? error.message : String(error), bundleId, recordablePlatform(device)) });
      captureUiError(error, "testing.launch", telemetryContext);
    } finally {
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.launch", performance.now() - startedAt);
      this.update({ launching: false });
    }
  }

  /**
   * The unsaved recordings of the chosen project, newest first.
   *
   * Listed for the project rather than for everything: a draft is reopened into a panel pointed
   * at one project, and a flow recorded against another app's selectors would come back naming
   * elements that project has never had.
   */
  async refreshDrafts() {
    if (!this.snapshot.available) return;
    try {
      const response = await this.call("mobile_testing_drafts",
        this.snapshot.projectPath ? { projectPath: this.snapshot.projectPath } : {}, 10_000);
      const listed = object(response.structuredContent)?.drafts;
      const drafts = (Array.isArray(listed) ? listed : []) as TestDraftSummary[];
      if (!this.disposed) this.update({ drafts });
    } catch {
      // The list is a convenience; the flow on screen is unaffected by a read that missed.
    }
  }

  /**
   * The tests the chosen project already holds.
   *
   * Read from the folder rather than remembered: a test written by hand, by an agent or in another
   * checkout belongs in the list beside the recorded ones, and a recording that was saved has to
   * appear here the moment its draft goes.
   */
  /**
   * Pins the panel has just sent, keyed by project and test, so a test shows its app at once and a
   * listing read before the server wrote `targets.json` does not drop it.
   */
  private readonly pendingPins = new Map<string, NonNullable<StoredTestSummary["target"]>>();

  private notePinned(relativePath: string, target: NonNullable<StoredTestSummary["target"]>) {
    const projectPath = this.snapshot.projectPath;
    if (!projectPath) return;
    this.pendingPins.set(`${projectPath}\0${relativePath}`, target);
    if (this.snapshot.tests.some(test => test.relativePath === relativePath))
      this.update({ tests: this.snapshot.tests.map(test => test.relativePath === relativePath ? { ...test, target } : test) });
  }

  async refreshTests() {
    if (!this.snapshot.available || !this.snapshot.projectPath) {
      this.clearTestPreview();
      if (this.snapshot.tests.length > 0) this.update({ tests: [] });
      return;
    }
    const projectPath = this.snapshot.projectPath;
    try {
      const response = await this.call("mobile_testing_tests", { projectPath }, 15_000);
      const listed = object(response.structuredContent)?.tests;
      const tests = ((Array.isArray(listed) ? listed : []) as StoredTestSummary[]).map(test => {
        const key = `${projectPath}\0${test.relativePath}`;
        if (test.target) { this.pendingPins.delete(key); return test; }
        const pending = this.pendingPins.get(key);
        return pending ? { ...test, target: pending } : test;
      });
      // A slow read must not land on a project the user has since left.
      if (!this.disposed && this.snapshot.projectPath === projectPath) {
        if (this.snapshot.selectedTestPath && !tests.some(test => test.relativePath === this.snapshot.selectedTestPath)) this.clearTestPreview();
        this.update({ tests });
      }
    } catch {
      // The list is a readout; a read that missed leaves the recording on screen untouched.
    }
  }

  private clearTestPreview() {
    ++this.testReadRevision;
    if (this.snapshot.selectedTestPath) testRecorder.clearRun();
    if (this.snapshot.selectedTestPath || this.snapshot.loadingTest) this.update({ selectedTestPath: "", selectedTestSource: "", selectedTestOriginalHash: "", selectedTestStaged: false, loadingTest: false });
  }

  /** Shows the file exactly as stored. The recorder's current flow remains intact. */
  async openTest(relativePath: string) {
    const projectPath = this.snapshot.projectPath;
    if (!relativePath || !projectPath || this.agentBusy) return;
    const revision = ++this.testReadRevision;
    clearTimeout(this.draftTimer);
    await this.keepDraft();
    await this.stageWrite?.catch(() => undefined);
    if (this.disposed || this.snapshot.projectPath !== projectPath || revision !== this.testReadRevision) return;
    testRecorder.stop();
    testRecorder.clearRun();
    this.update({ selectedTestPath: relativePath, selectedTestSource: "", loadingTest: true, matrixSelected: [], error: null });
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    try {
      const response = await this.call("mobile_testing_read_file", { projectPath, relativePath }, 15_000);
      if (revision === this.testReadRevision && this.snapshot.projectPath === projectPath) {
        const data = object(response.structuredContent);
        this.update({ selectedTestSource: text(data?.source), selectedTestOriginalHash: text(data?.originalHash), selectedTestStaged: data?.staged === true });
      }
      countUiEvent("ui.testing.test_preview");
    } catch (error) {
      if (revision === this.testReadRevision) {
        this.update({ error: error instanceof Error ? error.message : String(error) });
        captureUiError(error, "testing.test_preview", telemetryContext);
      }
    } finally {
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.test_preview", performance.now() - startedAt);
      if (revision === this.testReadRevision) this.update({ loadingTest: false });
    }
  }

  /** Edits the temporary working copy; the project file is only replaced by Save. */
  editStoredTest(source: string) {
    const { projectPath, selectedTestPath: relativePath, selectedTestOriginalHash: originalHash } = this.snapshot;
    if (!projectPath || !relativePath || !originalHash || this.snapshot.running || this.snapshot.saving || source === this.snapshot.selectedTestSource) return;
    this.update({ selectedTestSource: source, selectedTestStaged: true, error: null });
    testRecorder.clearRun();
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    const write = (this.stageWrite ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await this.call("mobile_testing_stage_file", { projectPath, relativePath, originalHash, source }, 15_000);
      countUiEvent("ui.testing.test_edit");
    });
    this.stageWrite = write;
    void write.catch(error => {
      if (this.snapshot.projectPath === projectPath && this.snapshot.selectedTestPath === relativePath) this.update({ error: error instanceof Error ? error.message : String(error) });
      captureUiError(error, "testing.test_stage", telemetryContext);
    }).finally(() => {
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.test_stage", performance.now() - startedAt);
    });
  }

  /**
   * The line a re-record would change: the selected Testing Studio test's first failed line, when the last
   * run failed on the other platform than the one it was recorded on and the mirror shows that one.
   * Zero when there is nothing to offer.
   */
  get reRecordLine(): number { return this.reRecord?.line ?? 0; }

  /**
   * The failed line that can take a locator for the platform it failed on, and whether the mirror
   * shows that platform: the element is picked on the mirror, so a failure on an Android lane
   * while an iOS device is mirrored can be named but not re-recorded yet.
   */
  get reRecord(): { line: number; platform: "ios" | "android"; ready: boolean } | undefined {
    const stored = this.storedTarget;
    const platform = this.runPlatform ?? this.mirroredPlatform;
    const run = testRecorder.getSnapshot().run;
    if (!stored || !platform || platform === stored.platform || !this.storedAppOn(platform) || run?.state !== "failed" || this.snapshot.running || this.snapshot.saving) return;
    const failed = Object.entries(run.lines).filter(([, mark]) => mark === "failed").map(([line]) => Number(line)).sort((a, b) => a - b)[0] ?? 0;
    // Only a line whose locator can be swapped: a multi-line call or an agent step stays the user's to edit.
    if (!failed || branchStoredStepLocator(this.snapshot.selectedTestSource, failed, platform, "screen.getByText(\"\")") === this.snapshot.selectedTestSource) return;
    return { line: failed, platform, ready: this.mirroredPlatform === platform };
  }

  /**
   * Re-records one failed line's locator on the mirrored platform: the user right-clicks the
   * element on the mirror, and the line keeps its locator for the recorded platform and takes the
   * picked one on this platform behind a `platform` branch. The test is then saved.
   */
  /**
   * The device workspace's way of making one platform's mirror the active one. It answers false
   * when that platform has no device showing, which only the user can change.
   */
  private focusMirror: ((platform: "ios" | "android") => boolean) | undefined;
  setMirrorFocus(focus: ((platform: "ios" | "android") => boolean) | undefined) { this.focusMirror = focus; }

  private mirrorDevice: ((platform: "ios" | "android", deviceId: string) => boolean) | undefined;
  setMirrorDevice(show: ((platform: "ios" | "android", deviceId: string) => boolean) | undefined) { this.mirrorDevice = show; }

  /**
   * A click on a result row: shows that lane's steps, and mirrors its device when the device is
   * booted. Lanes run on their own device sessions, never through the mirror, so switching it
   * during a run (the panel's or the agent's) does not touch the run.
   */
  openLane(runId: string) {
    this.selectLane(runId);
    const lane = this.snapshot.matrix?.lanes.find(entry => entry.runId === runId);
    if (!lane) return;
    // A single-mirror layout first switches to the lane's platform, since a hidden mirror cannot
    // show a device. Only on the click itself, so a platform the user switches back to stays.
    this.onLaneSelected?.(lane.platform);
    const deviceId = lane.resolvedDeviceId ?? lane.deviceId;
    if (this.deviceApps.getSnapshot().device?.udid === deviceId) return;
    if (this.mirrorDevice?.(lane.platform, deviceId)) countUiEvent("ui.testing.lane_mirror");
  }

  private onLaneSelected?: (platform: "ios" | "android") => void;
  /** The host chrome's way of hearing which platform a clicked lane ran on, to show that mirror. */
  onLanePicked(listener: (platform: "ios" | "android") => void) {
    this.onLaneSelected = listener;
    return () => { if (this.onLaneSelected === listener) this.onLaneSelected = undefined; };
  }

  async reRecordStoredLine(line: number) {
    const platform = this.reRecord?.platform;
    if (!platform || line <= 0) return;
    this.update({ error: null });
    // The element is picked on the mirror, so the failing platform's mirror has to be the active one.
    if (this.mirroredPlatform !== platform) this.focusMirror?.(platform);
    if (this.mirroredPlatform !== platform) {
      this.update({ error: `Show a booted ${platform === "ios" ? "iOS simulator" : "Android emulator"} in the mirror to re-record line ${line}.` });
      return;
    }
    const mirrored = this.mirroredPlatform;
    const app = mirrored ? this.storedAppOn(mirrored) : undefined;
    const device = this.deviceApps.getSnapshot().device;
    if (!mirrored || mirrored !== platform || !app || !device) return;
    // The element tree is read from the app in front, so it has to be this platform's app.
    if (this.deviceApps.getSnapshot().foregroundApp?.bundleId !== app.bundleId) {
      try { await this.call("mobile_launch_app", { platform: app.platform, deviceId: device.udid, bundleId: app.bundleId }, 120_000); }
      catch (error) { this.update({ error: `Could not open ${app.bundleId}: ${error instanceof Error ? error.message : String(error)}` }); return; }
    }
    const relativePath = this.snapshot.selectedTestPath;
    const armed = testRecorder.pickElement(device.udid, mirrored, locator => {
      const source = this.snapshot.selectedTestSource;
      if (this.snapshot.selectedTestPath !== relativePath) return;
      const next = branchStoredStepLocator(source, line, mirrored, locator);
      if (next === source) { this.update({ error: `Line ${line} could not be changed. Edit it in Preview.` }); return; }
      countUiEvent("ui.testing.rerecord_line");
      this.editStoredTest(next);
      void this.saveStoredTest();
    });
    if (!armed) this.update({ error: "The mirror is busy recording. Stop the recording, then try again." });
  }

  /** Leaves a re-record without changing the test. */
  cancelReRecord() { if (testRecorder.getSnapshot().picking) testRecorder.stop(); }

  async saveStoredTest() {
    const { projectPath, selectedTestPath: relativePath } = this.snapshot;
    if (!projectPath || !relativePath || !this.snapshot.selectedTestStaged || this.snapshot.saving) return;
    this.update({ saving: true, error: null });
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    try {
      await this.stageWrite;
      const response = await this.call("mobile_testing_save_staged_file", { projectPath, relativePath }, 60_000);
      if (this.snapshot.projectPath === projectPath && this.snapshot.selectedTestPath === relativePath)
        this.update({ selectedTestStaged: false, selectedTestOriginalHash: text(object(response.structuredContent)?.originalHash) });
      countUiEvent("ui.testing.test_save");
      await this.refreshTests();
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
      captureUiError(error, "testing.test_save", telemetryContext);
    } finally {
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.test_save", performance.now() - startedAt);
      this.update({ saving: false });
    }
  }

  async undoStoredTest() {
    const { projectPath, selectedTestPath: relativePath } = this.snapshot;
    if (!projectPath || !relativePath || !this.snapshot.selectedTestStaged || this.snapshot.saving) return;
    this.update({ saving: true, error: null });
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    try {
      await this.stageWrite?.catch(() => undefined);
      const response = await this.call("mobile_testing_discard_staged_file", { projectPath, relativePath }, 15_000);
      if (this.snapshot.projectPath === projectPath && this.snapshot.selectedTestPath === relativePath) {
        const data = object(response.structuredContent);
        this.update({ selectedTestSource: text(data?.source), selectedTestOriginalHash: text(data?.originalHash), selectedTestStaged: false });
        testRecorder.clearRun();
      }
      countUiEvent("ui.testing.test_undo");
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
      captureUiError(error, "testing.test_undo", telemetryContext);
    } finally {
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.test_undo", performance.now() - startedAt);
      this.update({ saving: false });
    }
  }

  /**
   * Deletes one test out of the project. The panel asks first — see the row's confirmation — and
   * the host asks again, because this removes a file from the user's repository.
   */
  async deleteTest(relativePath: string) {
    const projectPath = this.snapshot.projectPath;
    if (!relativePath || !projectPath || !this.snapshot.available || this.snapshot.deletingTest) return;
    this.update({ deletingTest: relativePath, error: null });
    try {
      await this.call("mobile_testing_delete_file", { projectPath, relativePath }, 15_000);
      countUiEvent("ui.testing.test_delete");
      // The file the panel last wrote is the one that just went, so the "Saved to …" line under
      // the editor would be pointing at nothing.
      if (this.snapshot.savedPath.endsWith(relativePath)) this.update({ savedPath: "", savedRevision: -1 });
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.update({ deletingTest: "" });
    }
    await this.refreshTests();
  }

  /** Asks for a keep after the edits settle. Called on every recorder change. */
  private scheduleDraft() {
    if (this.disposed) return;
    // A new flow is not the kept one, and saying so here rather than at the next write keeps the
    // picker honest: the row it ticks and the name on its button are about the flow on screen.
    if (this.snapshot.draftId && testRecorder.getSnapshot().flowId !== this.draftFlowId) {
      this.update({ draftId: "" });
    }
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => { void this.keepDraft(); }, DRAFT_AUTOSAVE_MS);
  }

  /**
   * Keeps the flow on screen as an unsaved recording.
   *
   * Not while an agent is recording: the server holds that flow and writes its own draft when the
   * session ends, so keeping it here too would leave two copies of one recording in the list. Not
   * once it has been written into the project either — the draft is deleted at that point, and
   * the panel has nothing left to protect.
   */
  private async keepDraft(): Promise<void> {
    const { available, projectPath, agent } = this.snapshot;
    const recorder = testRecorder.getSnapshot();
    if ((this.disposed && !this.flushing) || !available || !projectPath || agent?.active) return;
    if ((recorder.steps.length === 0 && !recorder.sourceOverride) || recorder.revision === this.draftRevision) return;
    if (recorder.revision === this.snapshot.savedRevision) return;
    const revision = recorder.revision;
    // The draft only belongs to the flow it was taken from. Record, Clear and an agent session
    // all begin a different recording, and writing this one over that one's file is how two
    // recordings became one.
    const sameFlow = recorder.flowId === this.draftFlowId;
    const replacing = sameFlow ? this.snapshot.draftId : "";
    const flowId = recorder.flowId;
    // Serialized: two writes in flight would race over which one the list ends on, and the later
    // call carries the newer steps anyway.
    const write = (this.draftWrite ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (this.disposed && !this.flushing) return;
      // Not measured while the panel is being torn down: the dispose-time keep is bookkeeping on
      // the way out, not a wait the user sat through, and a measurement recorded from a document
      // that is going away has no surface left to attribute it to.
      const measured = !this.flushing;
      const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
      try {
        const response = await this.call("mobile_testing_draft_save", {
          ...(replacing ? { id: replacing } : {}),
          projectPath, title: recorder.title, fileName: this.snapshot.fileName,
          origin: recorder.agentDeviceId ? "agent" : "user",
          steps: recorder.steps,
          ...(recorder.sourceOverride === undefined ? {} : { source: recorder.sourceOverride }),
        }, 15_000);
        const id = text(object(response.structuredContent)?.id);
        this.draftRevision = revision;
        this.draftFlowId = flowId;
        if (this.disposed) return;
        if (id) this.update({ draftId: id });
        await this.refreshDrafts();
      } catch (error) {
        // Silent: an autosave that failed must not put a banner over a recording that is working.
        // The next change tries again, and the steps are still on screen either way.
        if (measured) captureUiError(error, "testing.draft_save", telemetryContext);
      } finally {
        if (measured && getUiTelemetryAttributes() === telemetryContext) {
          recordUiTiming("ui.testing.draft_save", performance.now() - startedAt);
        }
      }
    });
    this.draftWrite = write;
    await write;
  }

  /**
   * Puts one kept recording back in the panel.
   *
   * The flow on screen is kept first, so swapping between two drafts never loses the one being
   * left. Nothing starts recording: the user opened a flow to look at it.
   */
  async openDraft(id: string) {
    if (!id || this.snapshot.loadingDraft || this.agentBusy) return;
    this.clearTestPreview();
    if (id === this.snapshot.draftId) return;
    clearTimeout(this.draftTimer);
    await this.keepDraft();
    if (this.disposed) return;
    this.update({ loadingDraft: true, error: null });
    try {
      const response = await this.call("mobile_testing_draft_read", { id }, 15_000);
      const draft = object(object(response.structuredContent)?.draft);
      const steps = Array.isArray(draft?.steps) ? draft.steps as RecordedStep[] : [];
      if (!draft || (steps.length === 0 && !text(draft.source))) {
        this.update({ error: "That recording is no longer there." });
        await this.refreshDrafts();
        return;
      }
      testRecorder.restore(steps, text(draft.title) || undefined, typeof draft.source === "string" ? draft.source : undefined);
      // The restored flow is already kept, so the change `restore` just made is not written back,
      // and the draft is pinned to the flow it came back as.
      this.draftRevision = testRecorder.getSnapshot().revision;
      this.draftFlowId = testRecorder.getSnapshot().flowId;
      this.update({ draftId: text(draft.id), fileName: text(draft.fileName), savedRevision: -1, savedPath: "", overwritePath: "", matrixSelected: [] });
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.update({ loadingDraft: false });
    }
  }

  /**
   * Throws one kept recording away. Deleting the one on screen clears the panel too: leaving the
   * steps up after the user deleted them would only have the next edit write them back.
   */
  async deleteDraft(id: string) {
    if (!id || !this.snapshot.available) return;
    const current = id === this.snapshot.draftId;
    if (current && this.agentBusy) return;
    clearTimeout(this.draftTimer);
    try {
      await this.call("mobile_testing_draft_delete", { id }, 15_000);
      countUiEvent("ui.testing.draft_delete");
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (current) this.forgetDraft(true);
    await this.refreshDrafts();
  }

  /**
   * Lets go of the draft the panel is holding, optionally clearing the steps with it. Used when a
   * flow is written into the project and when its draft is deleted.
   */
  private forgetDraft(clearSteps: boolean) {
    clearTimeout(this.draftTimer);
    this.draftRevision = -1;
    this.draftFlowId = "";
    if (clearSteps) {
      testRecorder.stop();
      testRecorder.clearSteps();
      this.draftRevision = testRecorder.getSnapshot().revision;
    }
    this.update({ draftId: "", fileName: clearSteps ? "" : this.snapshot.fileName });
  }

  /** Starts a new flow, keeping whatever is on screen as its own draft first. */
  async newRecording() {
    if (this.agentBusy) return;
    this.clearTestPreview();
    clearTimeout(this.draftTimer);
    await this.keepDraft();
    if (this.disposed) return;
    testRecorder.stop();
    testRecorder.clearSteps();
    testRecorder.setTitle("");
    this.draftRevision = testRecorder.getSnapshot().revision;
    this.draftFlowId = "";
    this.update({ draftId: "", fileName: "", savedRevision: -1, savedPath: "", overwritePath: "", matrixSelected: [] });
  }

  setFileName(fileName: string) { this.update({ fileName: fileName.trim(), overwritePath: "" }); }

  /** The path the Save button writes to, relative to the project. */
  get relativePath(): string {
    const base = (this.snapshot.fileName || testFileSlug(testRecorder.getSnapshot().title)).replace(/\.e2e\.ts$/, "");
    return `tests/${base}.e2e.ts`;
  }

  /** Whether the recording has changes that are not in the file yet. */
  get dirty(): boolean {
    const recorder = testRecorder.getSnapshot();
    return recorder.steps.length > 0 && recorder.revision !== this.snapshot.savedRevision;
  }

  /**
   * Writes the recorded test into the project. The file is only ever written here — nothing is
   * saved as you tap — so one save is one host permission prompt.
   *
   * An existing file is not replaced on the first attempt: the server reports it back and the
   * panel asks. `confirmOverwrite` is the user's answer to that question.
   */
  async saveTest(confirmOverwrite = false) {
    const projectPath = this.snapshot.projectPath;
    const recorder = testRecorder.getSnapshot();
    if (!projectPath || !this.snapshot.available || this.snapshot.saving) return;
    if (recorder.steps.length === 0 && !recorder.sourceOverride) { this.update({ error: "Record a step before saving." }); return; }
    const relativePath = this.relativePath;
    this.update({ saving: true, error: null });
    try {
      const response = await this.call("mobile_testing_write_file", {
        projectPath, relativePath, contents: testRecorder.source, overwrite: confirmOverwrite,
        ...this.pinArguments(),
      }, 60_000);
      const data = object(response.structuredContent) ?? {};
      if (data.written === true) {
        const resume = this.snapshot.pendingRun;
        const keptAs = this.snapshot.draftId;
        this.update({ savedRevision: recorder.revision, savedPath: text(data.path), overwritePath: "", pendingRun: false });
        // The flow is in the project now, which is what the draft was standing in for. The steps
        // stay on screen; only the copy in the plugin's own storage goes.
        if (keptAs) {
          this.forgetDraft(false);
          void this.call("mobile_testing_draft_delete", { id: keptAs }, 10_000)
            .then(() => this.refreshDrafts())
            .catch(() => undefined);
        }
        // And it is one of the project's tests now, so it appears in the stored half of the list
        // rather than leaving the list with its draft.
        const pin = this.pinArguments();
        if ("bundleId" in pin) this.notePinned(relativePath, pin);
        void this.refreshTests();
        // The flow is written, so the recording is over: leaving it armed turns the next stray tap
        // on the mirror into a step the saved file does not have.
        testRecorder.stop();
        countUiEvent("ui.testing.save");
        // Replacing the file was the answer Run was waiting for, so one click finishes what it began.
        if (resume) { this.update({ saving: false }); void this.runTest(); }
        return;
      }
      // The file is already there and the user has not said to replace it.
      this.update({ overwritePath: text(data.path) || relativePath });
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.update({ saving: false });
    }
  }

  cancelOverwrite() { this.update({ overwritePath: "", pendingRun: false }); }

  /**
   * One poll of the run's live progress. Failures are silent: the run is still going, the report
   * will say what happened, and a progress read that missed is not worth an error banner.
   */
  private async pollRunProgress(callLines?: readonly number[]) {
    try {
      const response = await this.call("mobile_testing_run_progress", {}, 5_000);
      const data = object(response.structuredContent) ?? {};
      const entries = (Array.isArray(data.progress) ? data.progress : []).map(item => object(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .filter(item => typeof item.stepIndex === "number" && (item.phase === "start" || item.phase === "end"))
        .map(item => ({
          stepIndex: item.stepIndex as number,
          phase: item.phase as "start" | "end",
          ...(text(item.status) ? { status: text(item.status) } : {}),
          ...(text(item.error) ? { error: text(item.error) } : {}),
        }));
      testRecorder.applyRunProgress(entries, callLines);
    } catch {
      // See above.
    }
  }

  /**
   * Tells the server what the panel has selected, so an agent recording has something to record
   * against.
   *
   * This is the only thing that knows the selection: the project is the user's explicit pick, the
   * device is whichever one the mirror shows, and the bundle id comes from the project's own e2e
   * config. `mobile_testing_agent_begin` reads it and refuses when any of the three is missing,
   * which is what keeps an OS folder dialog from opening inside an agent's turn.
   */
  private async reportContext(force = false) {
    if (this.disposed || !this.snapshot.available) return;
    const projectPath = this.snapshot.projectPath;
    const bundleId = this.target?.bundleId ?? "";
    const device = this.deviceApps.getSnapshot().device;
    // Only a booted iOS simulator or Android emulator can be recorded against; anything else is
    // reported as no device.
    const recordable = device !== undefined && isRecordableDevice(device);
    const deviceId = recordable ? device.udid : "";
    const platform = recordable ? recordablePlatform(device) : undefined;
    const key = `${projectPath}\u0000${platform ?? ""}\u0000${deviceId}\u0000${bundleId}`;
    if (key === this.reportedContext && !force) return;
    this.reportedContext = key;
    try {
      await this.call("mobile_testing_set_context", { projectPath, deviceId, ...(platform ? { platform } : {}), bundleId }, 10_000);
    } catch {
      // The next change reports again; a selection the server missed only means an agent is told
      // to ask the user, which is the refusal it would have given anyway.
      this.reportedContext = "";
    }
  }

  /** Best effort on the way out: an empty project tells the server the tab is gone, without waiting out its expiry. */
  private async clearReportedContext() {
    this.reportedContext = "";
    try { await this.call("mobile_testing_set_context", { projectPath: "", deviceId: "", bundleId: "" }, 3_000); } catch { /* the server's expiry covers it */ }
  }

  /**
   * One poll of the agent recording the server holds, which then schedules the next.
   *
   * Fast while a session is active so a step appears in the panel as it is recorded, slow
   * otherwise so a session started from another tool is still noticed. Failures are silent and do
   * not stop the loop: a missed tick is one the next one covers.
   */
  private pollAgent() {
    if (this.disposed || this.agentPolling) return;
    this.agentPolling = true;
    void this.readAgentState().finally(() => {
      this.agentPolling = false;
      if (this.disposed || !this.snapshot.available) return;
      clearTimeout(this.agentTimer);
      this.agentTimer = setTimeout(() => this.pollAgent(),
        this.agentBusy ? AGENT_POLL_ACTIVE_MS : AGENT_POLL_IDLE_MS);
    });
  }

  /**
   * A run the agent started: the server holds it in the same registry the panel's own runs use, so
   * the latest one is on screen as live lanes while any of them is unfinished. The panel never
   * adopts a finished one it did not see running, and never one while it is running its own.
   */
  private async readAgentRun() {
    if (this.snapshot.running || this.disposed || !this.snapshot.projectPath) return;
    let matrix: MatrixView | null;
    let running: boolean;
    try {
      const response = await this.call("mobile_testing_run_progress", {}, 5_000);
      matrix = parseMatrix(response.structuredContent);
      running = object(response.structuredContent)?.running === true;
    } catch { return; }
    if (this.disposed || this.snapshot.running || !matrix) return;
    const adopted = this.snapshot.agentRun;
    if (!adopted) {
      if (!running || matrix.matrixId === this.snapshot.matrix?.matrixId) return;
      // The lanes show against the test they run, so that test is opened first.
      if (matrix.testPath && matrix.testPath !== this.snapshot.selectedTestPath) {
        if (!this.snapshot.tests.some(test => test.relativePath === matrix!.testPath)) await this.refreshTests();
        if (this.snapshot.tests.some(test => test.relativePath === matrix!.testPath)) await this.openTest(matrix.testPath);
      }
      if (this.disposed || this.snapshot.running) return;
      this.matrixCallLines = storedTestCallLines(this.snapshot.selectedTestSource);
      this.matrixUntilLine = undefined;
      this.laneSignature = "";
      testRecorder.beginRun();
      this.update({ agentRun: true, matrix, selectedLane: matrix.lanes[0]?.runId ?? "", error: null });
      this.onAgentRecording?.();
      this.showLane();
      return;
    }
    // Only the run the panel adopted: a newer one replaces it from the top.
    if (matrix.matrixId !== this.snapshot.matrix?.matrixId) { this.update({ agentRun: false }); testRecorder.invalidate(); return; }
    this.update({ matrix, selectedLane: matrix.lanes.some(lane => lane.runId === this.snapshot.selectedLane) ? this.snapshot.selectedLane : (matrix.lanes[0]?.runId ?? "") });
    this.showLane();
    if (!running) {
      this.update({ agentRun: false });
      testRecorder.invalidate();
      // The agent may have saved, branched or pinned a test while the run was going.
      void this.refreshTests();
    }
  }

  /**
   * A test or its pinned app was written by someone else (the agent's branch_line, set_target,
   * wait_for_app pin, a save). Reload the list, which carries the pins, and the open test's source,
   * unless the user has unsaved edits to it.
   */
  private followStoredTests(revision: number) {
    const previous = this.storedTestsRevision;
    this.storedTestsRevision = revision;
    if (previous < 0 || revision === previous) return;
    const { selectedTestPath, selectedTestStaged, loadingTest } = this.snapshot;
    void this.refreshTests().then(() => {
      if (selectedTestPath && !selectedTestStaged && !loadingTest && this.snapshot.selectedTestPath === selectedTestPath && !this.snapshot.selectedTestStaged) void this.reloadSelectedTest();
    });
  }

  /** Re-reads the open test's stored source in place, keeping the preview on screen meanwhile. */
  private async reloadSelectedTest() {
    const { projectPath, selectedTestPath: relativePath } = this.snapshot;
    if (!projectPath || !relativePath) return;
    const revision = ++this.testReadRevision;
    try {
      const response = await this.call("mobile_testing_read_file", { projectPath, relativePath }, 15_000);
      if (this.disposed || revision !== this.testReadRevision || this.snapshot.selectedTestPath !== relativePath || this.snapshot.selectedTestStaged) return;
      const data = object(response.structuredContent);
      this.update({ selectedTestSource: text(data?.source), selectedTestOriginalHash: text(data?.originalHash), selectedTestStaged: data?.staged === true });
      countUiEvent("ui.testing.test_preview_reload");
    } catch { /* the next change reloads it */ }
  }

  private async readAgentState() {
    await this.readAgentRun();
    let data: Record<string, unknown>;
    try {
      const response = await this.call("mobile_testing_agent_state", {}, 5_000);
      data = object(response.structuredContent) ?? {};
    } catch {
      return;
    }
    if (this.disposed) return;
    await this.applyProjectRequest(data);
    if (this.disposed) return;
    const revision = typeof data.revision === "number" ? data.revision : 0;
    const status = data.status === "recording" || data.status === "finished" || data.status === "aborted" ? data.status : "idle";
    const steps = (Array.isArray(data.steps) ? data.steps : []) as RecordedStep[];
    const agent: TestingAgentView = {
      active: data.active === true, status,
      title: text(data.title), goal: text(data.goal), steps: steps.length, note: text(data.note),
      draftId: text(data.draftId), savedPath: text(data.savedPath),
    };
    this.followStoredTests(typeof data.storedTestsRevision === "number" ? data.storedTestsRevision : 0);
    const savedPath = agent.savedPath;
    const first = this.agentRevision < 0;
    const unchanged = !first && revision === this.agentRevision;
    this.agentRevision = revision;
    if (status === "idle") { this.update({ agent: null }); return; }
    const wasActive = this.snapshot.agent?.active === true;
    this.update({ agent });
    if (agent.active) {
      this.clearTestPreview();
      // A session already in flight when the panel opened is adopted too: the agent may have
      // started before the user's host drew this document.
      if (!unchanged || !wasActive) {
        const device = this.deviceApps.getSnapshot().device;
        if (device) testRecorder.adoptAgentRecording(device.udid, recordablePlatform(device), steps, agent.title);
      }
      if (!wasActive) this.onAgentRecording?.();
      return;
    }
    // The agent stopped. The steps are left dirty exactly as they are, and from here the flow is
    // an ordinary unsaved recording: the banner clears and the mirror is the user's again.
    if (wasActive) {
      if (steps.length !== testRecorder.getSnapshot().steps.length) {
        const device = this.deviceApps.getSnapshot().device;
        if (device) testRecorder.adoptAgentRecording(device.udid, recordablePlatform(device), steps, agent.title);
      }
      testRecorder.endAgentRecording(status === "aborted" ? "aborted" : "finished");
      // The server kept the finished flow, so the panel adopts that draft rather than autosaving
      // a second copy of the same steps a moment later.
      this.draftRevision = testRecorder.getSnapshot().revision;
      if (savedPath) {
        // Testing Studio: finishing wrote the test, so there is no draft to adopt. The steps are in the
        // stored list now, and the recorder's copy is marked saved so autosave does not keep it again.
        this.draftFlowId = "";
        this.update({ savedRevision: testRecorder.getSnapshot().revision, savedPath: `Testing Studio/${savedPath}` });
        testRecorder.stop();
        void this.refreshTests();
        void this.refreshDrafts();
      } else {
        this.draftFlowId = agent.draftId ? testRecorder.getSnapshot().flowId : "";
        this.update({ savedRevision: -1, savedPath: "", ...(agent.draftId ? { draftId: agent.draftId } : {}) });
        void this.refreshDrafts();
      }
    }
  }

  /** The user's Stop button on the agent banner. The server drops the session; the steps stay. */
  async stopAgent() {
    if (this.snapshot.agent?.active !== true) return;
    try {
      await this.call("mobile_testing_agent_abort", { reason: "The user stopped the recording from the Testing Studio panel." }, 10_000);
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    // Do not wait for the next tick to hand the mirror back: the user pressed Stop to get it back.
    testRecorder.endAgentRecording("aborted");
    this.update({ agent: { ...this.snapshot.agent, active: false, status: "aborted" } });
    this.pollAgent();
  }

  /** An agent is recording or running tests: the mirror, the editor and the run controls are its own. */
  get agentBusy(): boolean { return this.snapshot.agent?.active === true || this.snapshot.agentRun; }

  /** Whether Run has something to run: a project, steps, and no run or save already in flight. */
  get canRun(): boolean {
    // Never while an agent is recording: a run resets the app and takes the one agent-device
    // session the device allows, which is the session the recording is being read through.
    return Boolean(this.snapshot.available && this.snapshot.projectPath && !this.snapshot.selectedTestPath && !this.agentBusy
      && (testRecorder.getSnapshot().steps.length > 0 || Boolean(testRecorder.getSnapshot().sourceOverride)) && !this.snapshot.running && !this.snapshot.saving);
  }

  get canRunStored(): boolean {
    return Boolean(this.snapshot.available && this.snapshot.projectPath && this.snapshot.selectedTestPath
      && !this.snapshot.loadingTest && !this.agentBusy && !this.snapshot.running && !this.snapshot.saving
      && !this.storedRunHint);
  }

  /** The app a selected Testing Studio test is pinned to; undefined for project tests and unpinned tests. */
  get storedTarget(): NonNullable<StoredTestSummary["target"]> | undefined {
    if (this.snapshot.runtimeMode !== "bundled") return undefined;
    return this.snapshot.tests.find(test => test.relativePath === this.snapshot.selectedTestPath)?.target;
  }

  /** Every app id the selected Testing Studio test has, per platform: the recorded one and any added one. */
  get storedApps(): { ios?: string; android?: string } {
    const stored = this.storedTarget;
    return stored ? { ...stored.apps, [stored.platform]: stored.bundleId } : {};
  }

  /** The selected Testing Studio test's app on one platform, if it has one there. */
  storedAppOn(platform: "ios" | "android"): { platform: "ios" | "android"; bundleId: string } | undefined {
    const bundleId = this.storedApps[platform];
    return bundleId ? { platform, bundleId } : undefined;
  }

  /** The platform of the mirrored device, when it is one Testing Studio can record and run on. */
  get mirroredPlatform(): "ios" | "android" | undefined {
    const { device } = this.deviceApps.getSnapshot();
    return device && isRecordableDevice(device) ? recordablePlatform(device) : undefined;
  }

  /** The app in front on the mirrored device, as a Testing Studio target. */
  get foregroundTarget(): NonNullable<StoredTestSummary["target"]> | undefined {
    const { device, foregroundApp } = this.deviceApps.getSnapshot();
    if (!device || !isRecordableDevice(device)) return undefined;
    const platform = recordablePlatform(device);
    if (foregroundApp?.bundleId) return { platform, bundleId: foregroundApp.bundleId };
    // An Apple app in front reaches the panel as a pid alone; the server named it when it read the targets.
    const read = this.noProject && foregroundApp?.pid && this.studioForegroundKey === `pid:${foregroundApp.pid}` && this.snapshot.targetSource === "foreground" ? this.target : undefined;
    return read?.bundleId && read.platform === platform ? { platform, bundleId: read.bundleId } : undefined;
  }

  /** Why Run is unavailable for a selected Testing Studio test, or "": it needs a pinned app or one in front. */
  get storedRunHint(): string {
    if (this.snapshot.runtimeMode !== "bundled" || !this.snapshot.selectedTestPath) return "";
    const pinned = this.storedTarget;
    if (!pinned) return this.foregroundTarget ? "" : "This test has no app yet. Open the app in the mirror to run it; Testing Studio will pin it.";
    const mirrored = this.mirroredPlatform;
    if (mirrored && !this.storedAppOn(mirrored)) {
      const recorded = platformLabel(pinned.platform), other = platformLabel(mirrored);
      const back = pinned.platform === "ios" ? "an iOS simulator" : "an Android emulator";
      // With this platform's app in front, the note carries the Add button; without it, the app has to be opened first.
      return this.foregroundTarget
        ? `This test was recorded on ${recorded} and has no ${other} app yet. Add ${this.foregroundTarget.bundleId}, the app in front, to run it here too.`
        : `This test was recorded on ${recorded} and has no ${other} app yet. Open the app on this ${other} device to add it, or mirror ${back}.`;
    }
    // `deviceApps.apps` lists running apps, not installed ones, so it cannot say the pinned app is
    // missing; Run opens it and reports a launch failure if it really is not on the device.
    return "";
  }

  /** Whether the run hint can offer to add the app in front as this test's app on the mirrored platform. */
  get canAddForegroundApp(): boolean {
    const pinned = this.storedTarget, front = this.foregroundTarget;
    return this.snapshot.runtimeMode === "bundled" && Boolean(pinned && front) && front!.platform !== pinned!.platform && !this.storedAppOn(front!.platform) && !this.snapshot.running;
  }

  /** The platform and bundle id sent with a save, so a Testing Studio test is pinned to the app it was recorded against. */
  private pinArguments() {
    // Testing Studio's `targets` can lag the mirror, so the app actually in front wins.
    const target = this.snapshot.runtimeMode === "bundled" ? this.foregroundTarget ?? this.target : this.target;
    return this.snapshot.runtimeMode === "bundled" && (target?.platform === "ios" || target?.platform === "android") && target.bundleId
      ? { platform: target.platform, bundleId: target.bundleId } : {};
  }

  /**
   * Pins the selected Testing Studio test to the app in front. On the recorded platform it replaces that
   * app; on the other platform it adds the app there, so the test runs on both.
   */
  async repinStoredTest() {
    const { projectPath, selectedTestPath: relativePath } = this.snapshot;
    const target = this.foregroundTarget;
    if (!projectPath || !relativePath || !target || this.snapshot.running) return;
    const stored = this.storedTarget;
    const mode = stored && stored.platform !== target.platform ? "add" : "replace";
    try {
      await this.call("mobile_testing_set_target", { projectPath, relativePath, ...target, mode }, 10_000);
      await this.refreshTests();
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private bundledRunArguments(pinned?: { platform: "ios" | "android"; bundleId: string }) {
    if (this.snapshot.runtimeMode !== "bundled") return {};
    const target = pinned ?? this.target;
    return {
      ...(target?.platform === "ios" || target?.platform === "android" ? { platform: target.platform } : {}),
      ...(target?.bundleId ? { bundleId: target.bundleId } : {}),
      ...(this.snapshot.modelPreference ? { model: this.snapshot.modelPreference } : {}),
    };
  }

  /** Deterministic tests stay model-free; an agent step opens the chooser before any run starts. */
  private hasBundledModel(source: string, action: NonNullable<TestingPanel["pendingModelAction"]>): boolean {
    if (this.snapshot.runtimeMode !== "bundled" || !/\bagent\s*\.\s*(act|assert|waitFor|extract)\s*\(/.test(source)) return true;
    if (this.snapshot.modelPreference) return true;
    if (!this.pendingModelAction) this.pendingModelAction = action;
    this.update({ modelPickerOpen: true });
    return false;
  }

  private finishRun(data: Record<string, unknown>, calls: readonly number[]) {
    const steps = (Array.isArray(data.steps) ? data.steps : []).flatMap(item => {
      const step = object(item);
      if (!step) return [];
      const line = typeof step.line === "number" ? step.line : typeof step.stepIndex === "number" ? calls[step.stepIndex] : undefined;
      if (line === undefined || line <= 0) return [];
      return [{ line, status: text(step.status), ...(text(step.error) ? { error: text(step.error) } : {}) }];
    });
    const status = text(data.status) || "failed";
    testRecorder.finishRun({ status, steps,
      ...(text(data.error) ? { error: text(data.error) } : {}),
      ...(text(data.output) ? { output: text(data.output) } : {}),
      ...(typeof data.durationMs === "number" && Number.isFinite(data.durationMs) ? { durationMs: data.durationMs } : {}) });
    countUiEvent(status === "passed" ? "ui.testing.run_passed" : "ui.testing.run_failed");
  }

  /** Runs a temporary sibling copy so Play and Run never save the working copy implicitly. */
  async runStoredTest(untilLine?: number) {
    if (!this.canRunStored) return;
    const { projectPath, selectedTestPath: relativePath, selectedTestSource: source } = this.snapshot;
    const untilSource = untilLine === undefined ? source : storedTestUntilSource(source, untilLine);
    if (untilSource === undefined) return;
    if (!this.hasBundledModel(untilSource, { kind: "stored", ...(untilLine === undefined ? {} : { untilLine }) })) return;
    // A Testing Studio test runs against the app it is pinned to, never whichever app is in front. A test
    // with no app yet takes the one in front and keeps it, so later runs are pinned.
    // A test with an app on both platforms runs the one for the mirrored device's platform.
    const stored = this.storedTarget;
    const mirrored = this.mirroredPlatform;
    const pinned = stored && mirrored ? this.storedAppOn(mirrored) : stored;
    const runTarget = pinned ?? (stored ? undefined : this.foregroundTarget);
    if (this.snapshot.runtimeMode === "bundled" && !runTarget) return;
    if (this.runsOnMatrix) { await this.runMatrix({ relativePath, source: untilSource, ...(untilLine === undefined ? {} : { untilLine }), callLines: storedTestCallLines(source) }); return; }
    this.update({ running: true, error: null });
    if (pinned && this.deviceApps.getSnapshot().foregroundApp?.bundleId !== pinned.bundleId) {
      try {
        const device = this.deviceApps.getSnapshot().device;
        if (device) await this.call("mobile_launch_app", { platform: pinned.platform, deviceId: device.udid, bundleId: pinned.bundleId }, 120_000);
      } catch (error) {
        this.update({ running: false, error: `Could not open ${pinned.bundleId}: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
    }
    testRecorder.clearRun();
    this.runPlatform = runTarget?.platform ?? mirrored;
    testRecorder.beginRun(untilLine);
    if (untilLine !== undefined) countUiEvent("ui.testing.run_until");
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    // A saved project test has no recorder steps to supply `emitted.calls`, so map the runner's
    // step indexes against the awaited calls in the source currently shown in the preview.
    const callLines = storedTestCallLines(source);
    const poll = setInterval(() => { void this.pollRunProgress(callLines); }, 400);
    try {
      await this.stageWrite;
      await this.call("mobile_testing_release_device", {}, 30_000).catch(() => undefined);
      // The server pins before the run starts, so the badge shows it now rather than when the run ends.
      if (!stored && runTarget && this.snapshot.runtimeMode === "bundled") this.notePinned(relativePath, runTarget);
      const response = await this.call("mobile_testing_run_test", {
        projectPath, relativePath, untilSource,
        ...(this.snapshot.configPath ? { configPath: this.snapshot.configPath } : {}),
        ...(this.snapshot.targetName ? { target: this.snapshot.targetName } : {}),
        ...this.bundledRunArguments(runTarget),
        ...(!stored && runTarget ? { pin: true } : {}),
      }, 15 * 60_000);
      this.finishRun(object(response.structuredContent) ?? {}, callLines);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      testRecorder.failRun(message);
      this.update({ error: message });
      captureUiError(error, "testing.run", telemetryContext);
    } finally {
      clearInterval(poll);
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.run", performance.now() - startedAt);
      this.update({ running: false });
      testRecorder.invalidate();
      if (!stored && runTarget) void this.refreshTests();
    }
  }

  /**
   * Runs the recorded test against the device, and marks the preview with what the runner reports.
   *
   * **Run does not save.** The runner receives the exact emitted preview and stages it in an
   * isolated temporary workspace. Save remains an independent action and a run cannot create or
   * replace a project test.
   *
   * **Run releases the device first.** The recorder holds the one agent-device session the device
   * allows, so a run started while it is held fails with `Device is already in use by session
   * "mobile-dev-recorder"` — a refusal the user cannot connect to anything they did. Recording
   * stops, the session is given back and *waited for*, and only then is the runner spawned. The
   * server tool releases again on its own account, because a release the caller forgot is the
   * same failure.
   *
   * **Play until here does not save.** `untilStepId` runs the flow only as far as that step, from a
   * truncated copy the server writes beside the test and deletes when the run ends — so the saved
   * file is never cut down to the part that was tried, and a half-run never raises the overwrite
   * question about a file the user has not asked to replace. Every line the copy keeps is at the
   * line number it has in the full file, so the marks land on the preview unchanged; see
   * `emittedThrough` and `untilSource`.
   */
  async runTest(options: { untilStepId?: string } = {}) {
    if (!this.canRun) return;
    const until = options.untilStepId ? testRecorder.emittedThrough(options.untilStepId) : undefined;
    // The step went while the pointer was on its play button; there is nothing to run up to.
    if (options.untilStepId && !until) return;
    const previewSource = until?.source ?? testRecorder.source;
    if (!this.hasBundledModel(previewSource, { kind: "recording", options })) return;
    const relativePath = this.relativePath;
    if (this.runsOnMatrix) { await this.runMatrix({ relativePath, source: previewSource, ...(until ? { untilLine: until.untilLine } : {}) }); return; }
    this.update({ running: true, error: null, pendingRun: false });
    testRecorder.clearRun();
    // A recording left armed would read the tree mid-run and take the session straight back.
    testRecorder.stop();
    try {
      await this.call("mobile_testing_release_device", {}, 30_000);
    } catch {
      // A release that fails is still worth running through: the tool releases again before it
      // spawns, and the runner's own "device is already in use" is a clearer report than ours.
    }
    testRecorder.beginRun(until?.untilLine);
    if (until) countUiEvent("ui.testing.run_until");
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    // The run's own tool call is one request and one response, so progress comes from polling a
    // second tool while it is in flight. See `mobile_testing_run_progress`.
    const callLines = testRecorder.getSnapshot().sourceOverride !== undefined
      ? storedTestCallLines(testRecorder.source) : testRecorder.emitted.calls;
    const poll = setInterval(() => { void this.pollRunProgress(callLines); }, 400);
    try {
      const response = await this.call("mobile_testing_run_test", {
        projectPath: this.snapshot.projectPath, relativePath,
        ...(this.snapshot.configPath ? { configPath: this.snapshot.configPath } : {}),
        ...(this.snapshot.targetName ? { target: this.snapshot.targetName } : {}),
        untilSource: previewSource,
        ...this.bundledRunArguments(),
      }, 15 * 60_000);
      this.finishRun(object(response.structuredContent) ?? {}, callLines);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      testRecorder.failRun(message);
      this.update({ error: message });
      captureUiError(error, "testing.run", telemetryContext);
    } finally {
      clearInterval(poll);
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.run", performance.now() - startedAt);
      this.update({ running: false });
      // The run drove the app, so whatever the recorder cached describes a screen that has gone.
      testRecorder.invalidate();
    }
  }

  // ---- Test matrix: the same test on several devices at once -------------------------------------------------

  /**
   * Both runtimes can run on several devices: the bundled runner pins each lane's device in its own
   * config, and a project's lanes run its own config's target with the device rewritten in a copy.
   */
  get matrixEnabled(): boolean { return this.snapshot.available; }

  /** The ticked devices that still exist. Zero when the matrix is unavailable. */
  get matrixSelection(): MatrixDeviceOption[] {
    if (!this.matrixEnabled) return [];
    const only = this.matrixPlatform;
    const known = new Map(this.snapshot.matrixDevices.filter(device => !only || device.platform === only).map(device => [device.deviceId, device]));
    return this.snapshot.matrixSelected.flatMap(id => known.get(id) ?? []);
  }

  /**
   * The one platform a pinned Testing Studio test can run on: it was recorded against one app on one
   * platform and has no app added for the other. Undefined when any platform may run.
   */
  get matrixPlatform(): "ios" | "android" | undefined {
    const stored = this.snapshot.runtimeMode === "bundled" ? this.storedTarget : undefined;
    return stored && !stored.apps?.[stored.platform === "ios" ? "android" : "ios"] ? stored.platform : undefined;
  }

  /** How many devices Run would use. */
  get matrixRunCount(): number { return this.matrixSelection.length; }

  /**
   * Whether Run goes to the ticked devices rather than the mirror. Any tick does, except one tick on
   * the mirrored device itself, which runs the plain way there (its preview and failure marks).
   * One ticked device that is not the mirror must run there, never on the mirror.
   */
  get runsOnMatrix(): boolean {
    const selection = this.matrixSelection;
    if (selection.length !== 1) return selection.length > 1;
    return selection[0]!.deviceId !== this.deviceApps.getSnapshot().device?.udid;
  }

  private matrixTargetOrder(): TestingTargetOption[] {
    const selected = this.target;
    return selected ? [selected, ...this.snapshot.targets.filter(entry => entry !== selected)] : this.snapshot.targets;
  }

  /** Project mode: the config target each platform's lanes run, so the server uses the selected one. */
  private matrixProjectTargets(): { ios?: string; android?: string } {
    const targets: { ios?: string; android?: string } = {};
    for (const entry of this.matrixTargetOrder()) {
      const platform = entry.platform;
      if ((platform === "ios" || platform === "android") && entry.bundleId && !targets[platform]) targets[platform] = entry.name;
    }
    return targets;
  }

  /** The app a run would drive, per platform: the open test's own app first, then the project's targets. */
  matrixApps(): { ios?: string; android?: string } {
    // A pinned Testing Studio test runs only the apps it has; the project's targets are not its apps.
    if (this.snapshot.runtimeMode === "bundled" && this.storedTarget) return this.storedApps;
    const apps: { ios?: string; android?: string } = {};
    // The selected target first, so its app wins its platform; the server picks the same target.
    for (const entry of this.matrixTargetOrder()) {
      const platform = entry.platform;
      if ((platform === "ios" || platform === "android") && entry.bundleId && !apps[platform]) apps[platform] = entry.bundleId;
    }
    // A project's lanes run its config's targets, never the app in front on the mirror.
    if (this.snapshot.runtimeMode !== "bundled") return apps;
    const own: StoredTestSummary["target"] = this.snapshot.selectedTestPath ? (this.storedTarget ?? this.foregroundTarget)
      : this.target?.platform && this.target.bundleId && (this.target.platform === "ios" || this.target.platform === "android") ? { platform: this.target.platform, bundleId: this.target.bundleId } : this.foregroundTarget;
    if (own) apps[own.platform] = own.bundleId;
    return apps;
  }

  /** Whether a lane of the run on screen still holds this device. */
  matrixBusy(deviceId: string): boolean {
    return this.snapshot.matrix?.lanes.some(lane => !isTerminalLane(lane.state) && (lane.deviceId === deviceId || lane.resolvedDeviceId === deviceId)) ?? false;
  }

  setMatrixSelection(ids: string[]) {
    this.update({ matrixSelected: ids });
  }

  setMatrixLimit(limit: number) {
    const next = clampLimit(limit);
    this.update({ matrixLimit: next });
    writeMatrixPreferences(this.snapshot.projectPath, { limit: next });
  }

  /** Lists the simulators and emulators, and for each booted one whether the app is on it. */
  async loadMatrixDevices() {
    if (!this.snapshot.available || this.snapshot.matrixLoading) return;
    this.update({ matrixLoading: true });
    try {
      const read = (name: string) => this.call(name, {}, 20_000).then(result => result.structuredContent, () => undefined);
      const [simulators, emulators] = await Promise.all([read("mobile_list_simulators"), read("mobile_list_android_devices")]);
      const devices = [...parseMatrixDevices("ios", simulators), ...parseMatrixDevices("android", emulators)];
      const apps = this.matrixApps();
      const checked = await Promise.all(devices.map(async device => {
        const appId = apps[device.platform];
        if (!device.booted || !appId) return device;
        try {
          const result = await this.call("mobile_list_apps", { platform: device.platform, deviceId: device.deviceId }, 20_000);
          const list = object(result.structuredContent)?.apps;
          return { ...device, installed: Array.isArray(list) && list.some(entry => object(entry)?.bundleId === appId) };
        } catch { return device; }
      }));
      if (!this.disposed) this.update({ matrixDevices: checked });
    } finally {
      if (!this.disposed) this.update({ matrixLoading: false });
    }
  }

  private matrixCallLines?: readonly number[];
  private matrixUntilLine?: number;
  private laneSignature = "";
  /** The platform the run on the preview ran on: a matrix lane's, not the mirror's. */
  private runPlatform: "ios" | "android" | undefined;

  selectLane(runId: string) {
    this.update({ selectedLane: runId });
    this.showLane();
  }

  dismissMatrix() {
    if (this.snapshot.running || this.snapshot.agentRun) return;
    this.update({ matrix: null, selectedLane: "" });
    testRecorder.clearRun();
  }

  /** Cancels one device's lane, or every lane that has not finished. */
  async cancelMatrix(deviceId?: string) {
    const matrix = this.snapshot.matrix;
    if (!matrix) return;
    try { await this.call("mobile_testing_cancel", { matrixId: matrix.matrixId, ...(deviceId ? { deviceId } : {}) }, 10_000); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
    await this.readMatrix(matrix.matrixId);
  }

  /** Puts the chosen lane's steps on the preview, the way a single run would have. */
  private showLane() {
    const matrix = this.snapshot.matrix;
    const lane = matrix?.lanes.find(entry => entry.runId === this.snapshot.selectedLane) ?? matrix?.lanes[0];
    if (!lane) return;
    const signature = `${lane.runId}|${lane.state}|${lane.progress.length}|${lane.result?.steps.length ?? -1}`;
    if (signature === this.laneSignature) return;
    this.laneSignature = signature;
    this.runPlatform = lane.platform;
    testRecorder.beginRun(this.matrixUntilLine);
    testRecorder.applyRunProgress(lane.progress, this.matrixCallLines);
    if (lane.result) testRecorder.finishRun({ status: lane.result.status, steps: lane.result.steps, ...(lane.result.error ? { error: lane.result.error } : {}),
      ...(lane.result.output ? { output: lane.result.output } : {}), ...(lane.result.durationMs === undefined ? {} : { durationMs: lane.result.durationMs }) });
    else if (lane.state === "error" || lane.state === "cancelled") testRecorder.failRun(lane.error ?? (lane.state === "cancelled" ? "This device's run was cancelled." : "The run failed to start."));
  }

  private async readMatrix(matrixId: string): Promise<MatrixView | null> {
    const response = await this.call("mobile_testing_run_progress", { matrixId }, 5_000);
    const matrix = parseMatrix(response.structuredContent);
    if (!matrix || this.disposed) return matrix;
    this.update({ matrix, selectedLane: matrix.lanes.some(lane => lane.runId === this.snapshot.selectedLane) ? this.snapshot.selectedLane : (matrix.lanes[0]?.runId ?? "") });
    this.showLane();
    return matrix;
  }

  /**
   * Runs the same test on every ticked device: one independent lane each, started by the server,
   * which boots a device that is off and installs the app where it is missing. The panel polls the
   * lanes and shows the selected one's steps on the preview.
   */
  private async runMatrix(input: { relativePath: string; source: string; untilLine?: number; callLines?: readonly number[] }) {
    const selection = this.matrixSelection;
    const apps = this.matrixApps();
    const missing = selection.find(device => !apps[device.platform]);
    if (missing) { this.update({ error: `There is no ${missing.platform === "ios" ? "iOS bundle id" : "Android package"} for this test, so ${missing.name} cannot run it.` }); return; }
    this.matrixCallLines = input.callLines;
    this.matrixUntilLine = input.untilLine;
    this.laneSignature = "";
    this.update({ running: true, error: null, matrix: null, selectedLane: "", pendingRun: false });
    testRecorder.clearRun();
    // Only a recorder on one of these devices has to let go; the server releases its own session the same way.
    if (selection.some(device => device.deviceId === testRecorder.getSnapshot().recordingDeviceId)) testRecorder.stop();
    testRecorder.beginRun(input.untilLine);
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    countUiEvent("ui.testing.matrix_run");
    try {
      await this.stageWrite;
      const response = await this.call("mobile_testing_run_matrix", {
        projectPath: this.snapshot.projectPath, relativePath: input.relativePath, untilSource: input.source,
        devices: selection.map(device => ({ deviceId: device.deviceId, platform: device.platform, name: device.name })),
        apps, limit: this.snapshot.matrixLimit,
        ...(this.snapshot.runtimeMode === "project" ? { targets: this.matrixProjectTargets() } : {}),
        ...(this.snapshot.modelPreference ? { model: this.snapshot.modelPreference } : {}),
      }, 60_000);
      const started = parseMatrix(response.structuredContent);
      if (!started) throw new Error("The run did not start.");
      this.update({ matrix: started, selectedLane: started.lanes[0]?.runId ?? "" });
      this.showLane();
      let failures = 0;
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 400));
        if (this.disposed) return;
        try {
          const matrix = await this.readMatrix(started.matrixId);
          failures = 0;
          if (matrixFinished(matrix)) break;
        } catch (error) { if (++failures >= 5) throw error; }
      }
      const passed = this.snapshot.matrix?.lanes.every(lane => lane.state === "passed");
      countUiEvent(passed ? "ui.testing.matrix_passed" : "ui.testing.matrix_failed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      testRecorder.failRun(message);
      this.update({ error: message });
      captureUiError(error, "testing.run_matrix", telemetryContext);
    } finally {
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.matrix_run", performance.now() - startedAt);
      this.update({ running: false });
      testRecorder.invalidate();
    }
  }

  dismissError() { this.update({ error: null }); }

  dispose() {
    // One last keep before the document goes: the host rebuilds this panel whenever the user
    // looks at another tool, which is the very moment a recording used to disappear, and the
    // debounce may still be holding the newest step.
    this.flushing = true;
    void this.keepDraft().finally(() => { this.flushing = false; });
    // Before `disposed` is set, so the call still goes out.
    void this.clearReportedContext();
    this.disposed = true;
    clearInterval(this.heartbeatTimer);
    if (typeof window !== "undefined") { window.removeEventListener("pagehide", this.onPageHide); window.removeEventListener("focus", this.onWake); }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onWake);
    clearTimeout(this.agentTimer);
    clearTimeout(this.draftTimer);
    this.stopWatchingDevices();
    this.stopWatchingRecorder();
    this.update({ open: false });
    this.listeners.clear();
    // The panel is going; the device it was reading must not go with it. See `RecorderTreeSource`.
    this.syncTreeSource();
  }
}
