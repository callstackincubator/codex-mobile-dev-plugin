import type { HostBridge } from "./host-bridge.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { captureUiError, countUiEvent, getUiTelemetryAttributes, recordUiTiming } from "./telemetry.ts";
import { testRecorder } from "./test-recorder.ts";
import type { RecorderTreeSource } from "./test-recorder.ts";
import type { ScreenComponent } from "@mobile-dev/shared/screen-annotations.ts";
import { testFileSlug } from "@mobile-dev/shared/test-recording.ts";
import type { RecordedStep } from "@mobile-dev/shared/test-recording.ts";

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
};

/** 400 ms while an agent is recording, so a step lands in the panel as it is recorded. */
const AGENT_POLL_ACTIVE_MS = 400;
/**
 * And a slow tick otherwise, so a recording the agent starts is noticed even when the user is
 * looking at another tool. It is what opens the Testing tab for them.
 */
const AGENT_POLL_IDLE_MS = 2_500;

/** One entry of the project selector. The server owns the list so a pick survives the panel document. */
export interface TestingProjectOption { path: string; name: string }
/** A target as the project's e2e config declares it; a static read may not see every field. */
export interface TestingTargetOption { name: string; platform?: string; bundleId?: string }

export type TestingSnapshot = {
  open: boolean;
  available: boolean;
  projectPath: string;
  projects: TestingProjectOption[];
  targets: TestingTargetOption[];
  /** The target the panel records against; "" until a project with targets is loaded. */
  targetName: string;
  configPath: string;
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
  /** The agent recording the server holds, or null when no agent has ever recorded here. */
  agent: TestingAgentView | null;
  error: string | null;
};

function textError(result: Awaited<ReturnType<HostBridge["callServerTool"]>>, fallback: string): Error {
  return new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || fallback);
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function projectName(projectPath: string): string { return projectPath.split("/").filter(Boolean).at(-1) ?? projectPath; }

/**
 * The Testing panel: pick an e2e project, launch its app on the mirrored device, and (once the
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
  /** The project and target the installed tree source reads; "" when there is no source. */
  private treeSourceKey = "";
  private snapshot: TestingSnapshot = {
    open: false, available: false, projectPath: "", projects: [], targets: [], targetName: "", configPath: "",
    loadingProject: false, pickingProject: false, launching: false, appLaunched: false,
    fileName: "", saving: false, overwritePath: "", savedRevision: -1, savedPath: "", running: false, pendingRun: false,
    agent: null, error: null,
  };

  /** The agent recording's revision the panel has already adopted; -1 before the first poll. */
  private agentRevision = -1;
  private agentTimer?: ReturnType<typeof setTimeout>;
  private agentPolling = false;
  /** The last selection reported to the server, so the context tool is not called on every tick. */
  private reportedContext = "";
  private readonly stopWatchingDevices: () => void;
  /** Set when a session goes active, for the host chrome to show the Testing tab. */
  private onAgentRecording?: () => void;

  constructor(app: HostBridge, deviceApps: DeviceAppsStore) {
    this.app = app;
    this.deviceApps = deviceApps;
    // The device is half of what an agent recording needs and it belongs to the simulator panel,
    // so the selection is reported whenever either half moves.
    this.stopWatchingDevices = deviceApps.subscribe(() => { void this.reportContext(); });
  }

  /**
   * The host chrome's way of being told to show the Testing tab.
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
    const key = this.disposed || !projectPath || !bundleId ? "" : `${projectPath}\u0000${bundleId}`;
    if (key === this.treeSourceKey) return;
    this.treeSourceKey = key;
    testRecorder.useTreeSource(key ? this.treeSource(projectPath, bundleId) : undefined);
  }

  private treeSource(projectPath: string, bundleId: string): RecorderTreeSource {
    return {
      read: async udid => {
        const result = await this.call("mobile_testing_read_tree", { udid, projectPath, bundleId }, 20000);
        const tree = object(result.structuredContent)?.tree;
        return Array.isArray(tree) ? tree as ScreenComponent[] : [];
      },
      // Fire and forget: giving the device back must never hold up stopping a recording, and a
      // release that fails leaves the session for the next `read` to take over.
      release: () => { void this.call("mobile_testing_release_device", {}, 10000).catch(() => undefined); },
    };
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
    // the user is in another tool is what opens the Testing tab for them.
    this.pollAgent();
  }

  /** The target the recorder would use: the chosen one, else the first the config declares. */
  get target(): TestingTargetOption | undefined {
    const { targets, targetName } = this.snapshot;
    return targets.find(entry => entry.name === targetName) ?? targets[0];
  }

  /** Whether a launch is possible: a bundle id to launch and a booted device to launch it on. */
  get canLaunch(): boolean {
    const device = this.deviceApps.getSnapshot().device;
    const booted = device?.state === "Booted" || device?.state === "connected";
    return Boolean(this.snapshot.available && this.target?.bundleId && booted && !this.snapshot.launching);
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
        if (!this.disposed) this.update({ projects });
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
      const latest = this.snapshot.projects[0];
      if (latest && !this.disposed && !this.snapshot.projectPath) await this.selectProject(latest.path);
    })();
    this.restoreRequest = request;
    try { await request; } finally { if (this.restoreRequest === request) this.restoreRequest = undefined; }
  }

  private remembered(project: TestingProjectOption) {
    this.update({ projects: [project, ...this.snapshot.projects.filter(entry => entry.path !== project.path)] });
  }

  /** Selects a project the selector already lists, and makes it the one the panel reopens with. */
  async chooseProject(projectPath: string) {
    const path = projectPath.trim();
    if (!path) return;
    if (!this.snapshot.available) { await this.selectProject(path); return; }
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

  /** Loads one project's e2e config into the panel. */
  async selectProject(projectPath: string) {
    const path = projectPath.trim();
    const revision = ++this.loadRevision;
    this.update({ projectPath: path, targets: [], targetName: "", configPath: "", appLaunched: false,
      overwritePath: "", savedRevision: -1, savedPath: "", error: null });
    if (!path || !this.snapshot.available) return;
    this.update({ loadingProject: true });
    try {
      const response = await this.call("mobile_testing_project_config", { projectPath: path });
      if (revision !== this.loadRevision) return;
      const data = object(response.structuredContent) ?? {};
      const listed = Array.isArray(data.targets) ? data.targets : [];
      const targets = listed.map(entry => object(entry)).filter((entry): entry is Record<string, unknown> => entry !== null)
        .filter(entry => text(entry.name))
        .map(entry => ({
          name: text(entry.name),
          ...(text(entry.platform) ? { platform: text(entry.platform) } : {}),
          ...(text(entry.bundleId) ? { bundleId: text(entry.bundleId) } : {}),
        }));
      // iOS first: it is the only platform the recorder handles, so it is the useful default even
      // in a config that declares a web target ahead of it.
      const preferred = targets.find(entry => entry.platform === "ios") ?? targets[0];
      this.update({ targets, targetName: preferred?.name ?? "", configPath: text(data.configPath) });
    } catch (error) {
      if (revision === this.loadRevision) this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (revision === this.loadRevision) this.update({ loadingProject: false });
    }
  }

  /** Records against another target the config declares. */
  selectTarget(name: string) {
    if (!this.snapshot.targets.some(entry => entry.name === name)) return;
    this.update({ targetName: name, appLaunched: false });
  }

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
        platform: device.platform ?? "ios",
        deviceId: device.udid,
        bundleId,
      }, 120_000);
      this.update({ appLaunched: true });
      countUiEvent("ui.testing.launch");
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
      captureUiError(error, "testing.launch", telemetryContext);
    } finally {
      if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.testing.launch", performance.now() - startedAt);
      this.update({ launching: false });
    }
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
    if (recorder.steps.length === 0) { this.update({ error: "Record a step before saving." }); return; }
    const relativePath = this.relativePath;
    this.update({ saving: true, error: null });
    try {
      const response = await this.call("mobile_testing_write_file", {
        projectPath, relativePath, contents: testRecorder.source, overwrite: confirmOverwrite,
      }, 60_000);
      const data = object(response.structuredContent) ?? {};
      if (data.written === true) {
        const resume = this.snapshot.pendingRun;
        this.update({ savedRevision: recorder.revision, savedPath: text(data.path), overwritePath: "", pendingRun: false });
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
  private async pollRunProgress() {
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
      testRecorder.applyRunProgress(entries);
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
  private async reportContext() {
    if (this.disposed || !this.snapshot.available) return;
    const projectPath = this.snapshot.projectPath;
    const bundleId = this.target?.bundleId ?? "";
    const device = this.deviceApps.getSnapshot().device;
    const booted = device?.state === "Booted" || device?.state === "connected";
    // Only an iOS simulator can be recorded against; anything else is reported as no device.
    const udid = booted && device && (device.platform ?? "ios") === "ios" && device.kind !== "physical" ? device.udid : "";
    const key = `${projectPath}\u0000${udid}\u0000${bundleId}`;
    if (key === this.reportedContext) return;
    this.reportedContext = key;
    try {
      await this.call("mobile_testing_set_context", { projectPath, udid, bundleId }, 10_000);
    } catch {
      // The next change reports again; a selection the server missed only means an agent is told
      // to ask the user, which is the refusal it would have given anyway.
      this.reportedContext = "";
    }
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
        this.snapshot.agent?.active ? AGENT_POLL_ACTIVE_MS : AGENT_POLL_IDLE_MS);
    });
  }

  private async readAgentState() {
    let data: Record<string, unknown>;
    try {
      const response = await this.call("mobile_testing_agent_state", {}, 5_000);
      data = object(response.structuredContent) ?? {};
    } catch {
      return;
    }
    if (this.disposed) return;
    const revision = typeof data.revision === "number" ? data.revision : 0;
    const status = data.status === "recording" || data.status === "finished" || data.status === "aborted" ? data.status : "idle";
    const steps = (Array.isArray(data.steps) ? data.steps : []) as RecordedStep[];
    const agent: TestingAgentView = {
      active: data.active === true, status,
      title: text(data.title), goal: text(data.goal), steps: steps.length, note: text(data.note),
    };
    const first = this.agentRevision < 0;
    const unchanged = !first && revision === this.agentRevision;
    this.agentRevision = revision;
    if (status === "idle") { this.update({ agent: null }); return; }
    const wasActive = this.snapshot.agent?.active === true;
    this.update({ agent });
    if (agent.active) {
      // A session already in flight when the panel opened is adopted too: the agent may have
      // started before the user's host drew this document.
      if (!unchanged || !wasActive) {
        const udid = this.deviceApps.getSnapshot().device?.udid ?? "";
        testRecorder.adoptAgentRecording(udid, steps, agent.title);
      }
      if (!wasActive) this.onAgentRecording?.();
      return;
    }
    // The agent stopped. The steps are left dirty exactly as they are, and from here the flow is
    // an ordinary unsaved recording: the banner clears and the mirror is the user's again.
    if (wasActive) {
      if (steps.length !== testRecorder.getSnapshot().steps.length) {
        testRecorder.adoptAgentRecording(this.deviceApps.getSnapshot().device?.udid ?? "", steps, agent.title);
      }
      testRecorder.endAgentRecording(status === "aborted" ? "aborted" : "finished");
      this.update({ savedRevision: -1, savedPath: "" });
    }
  }

  /** The user's Stop button on the agent banner. The server drops the session; the steps stay. */
  async stopAgent() {
    if (!this.snapshot.agent?.active) return;
    try {
      await this.call("mobile_testing_agent_abort", { reason: "The user stopped the recording from the Testing panel." }, 10_000);
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    // Do not wait for the next tick to hand the mirror back: the user pressed Stop to get it back.
    testRecorder.endAgentRecording("aborted");
    this.update({ agent: { ...this.snapshot.agent, active: false, status: "aborted" } });
    this.pollAgent();
  }

  /** Whether Run has something to run: a project, steps, and no run or save already in flight. */
  get canRun(): boolean {
    // Never while an agent is recording: a run resets the app and takes the one agent-device
    // session the device allows, which is the session the recording is being read through.
    return Boolean(this.snapshot.available && this.snapshot.projectPath && !this.snapshot.agent?.active
      && testRecorder.getSnapshot().steps.length > 0 && !this.snapshot.running && !this.snapshot.saving);
  }

  /**
   * Runs the recorded test against the device, and marks the preview with what the runner reports.
   *
   * **Run saves.** The runner runs a file, so there has to be one; running a copy in a temporary
   * path would run a test whose failures point at lines of a file the user cannot open. It saves
   * through the same path the Save button uses, which means an existing file is still never
   * replaced without being asked about — the overwrite question stops the run and resumes it from
   * the answer.
   *
   * **Run releases the device first.** The recorder holds the one agent-device session the device
   * allows, so a run started while it is held fails with `Device is already in use by session
   * "mobile-dev-recorder"` — a refusal the user cannot connect to anything they did. Recording
   * stops, the session is given back and *waited for*, and only then is the runner spawned. The
   * server tool releases again on its own account, because a release the caller forgot is the
   * same failure.
   */
  async runTest() {
    if (!this.canRun) return;
    if (this.dirty || !this.snapshot.savedPath) {
      await this.saveTest();
      // The file is already there and the user has not answered yet; `saveTest(true)` resumes.
      if (this.snapshot.overwritePath) { this.update({ pendingRun: true }); return; }
      if (this.dirty) return;
    }
    const relativePath = this.relativePath;
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
    testRecorder.beginRun();
    const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
    // The run's own tool call is one request and one response, so progress comes from polling a
    // second tool while it is in flight. See `mobile_testing_run_progress`.
    const poll = setInterval(() => { void this.pollRunProgress(); }, 400);
    try {
      const response = await this.call("mobile_testing_run_test", {
        projectPath: this.snapshot.projectPath, relativePath,
        ...(this.snapshot.configPath ? { configPath: this.snapshot.configPath } : {}),
      }, 15 * 60_000);
      const data = object(response.structuredContent) ?? {};
      const steps = (Array.isArray(data.steps) ? data.steps : []).map(entry => object(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map(entry => ({
          line: typeof entry.line === "number" ? entry.line : 0,
          status: text(entry.status),
          ...(text(entry.error) ? { error: text(entry.error) } : {}),
        }))
        .filter(step => step.line > 0);
      // The runner's own number for the run, which is not the timing below: that one brackets the
      // whole call, spawning the CLI and resolving the project included.
      const durationMs = typeof data.durationMs === "number" && Number.isFinite(data.durationMs) ? data.durationMs : undefined;
      testRecorder.finishRun({
        status: text(data.status) || "failed", steps,
        ...(text(data.output) ? { output: text(data.output) } : {}),
        ...(durationMs === undefined ? {} : { durationMs }),
      });
      countUiEvent(text(data.status) === "passed" ? "ui.testing.run_passed" : "ui.testing.run_failed");
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

  dismissError() { this.update({ error: null }); }

  dispose() {
    this.disposed = true;
    clearTimeout(this.agentTimer);
    this.stopWatchingDevices();
    this.update({ open: false });
    this.listeners.clear();
    // The panel is going; the device it was reading must not go with it. See `RecorderTreeSource`.
    this.syncTreeSource();
  }
}
