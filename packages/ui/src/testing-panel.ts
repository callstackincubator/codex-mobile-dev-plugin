import type { HostBridge } from "./host-bridge.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { captureUiError, countUiEvent, getUiTelemetryAttributes, recordUiTiming } from "./telemetry.ts";
import { testRecorder } from "./test-recorder.ts";
import { testFileSlug } from "@mobile-dev/shared/test-recording.ts";

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
  private snapshot: TestingSnapshot = {
    open: false, available: false, projectPath: "", projects: [], targets: [], targetName: "", configPath: "",
    loadingProject: false, pickingProject: false, launching: false, appLaunched: false,
    fileName: "", saving: false, overwritePath: "", savedRevision: -1, savedPath: "", error: null,
  };

  constructor(app: HostBridge, deviceApps: DeviceAppsStore) {
    this.app = app;
    this.deviceApps = deviceApps;
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private update(fields: Partial<TestingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...fields };
    for (const listener of this.listeners) listener();
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
    // The panel can be opened before the host answers, which leaves nothing to reopen; try again
    // once the host is there rather than leaving an empty selector for the rest of the session.
    if (available && this.snapshot.open) void this.restoreProject();
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
        this.update({ savedRevision: recorder.revision, savedPath: text(data.path), overwritePath: "" });
        // The flow is written, so the recording is over: leaving it armed turns the next stray tap
        // on the mirror into a step the saved file does not have.
        testRecorder.stop();
        countUiEvent("ui.testing.save");
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

  cancelOverwrite() { this.update({ overwritePath: "" }); }

  dismissError() { this.update({ error: null }); }

  dispose() {
    this.disposed = true;
    this.update({ open: false });
    this.listeners.clear();
  }
}
