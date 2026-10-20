import type { App } from "@modelcontextprotocol/ext-apps";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppFlowBuildMode, AppFlowProgressEvent, AppFlowPrompt, AppFlowPromptResolution, AppFlowResult, DeepLinkJudgeMode, ExplorationMode, ManualRecordingEvent, StartAppFlowInput } from "../shared/app-flow.ts";
import { AppFlowRecordingStore } from "./app-flow-recording.ts";
import { captureUiError, countUiEvent, getUiTelemetryAttributes, recordUiTiming } from "./telemetry.ts";

export type AppFlowRunState = "idle" | "running" | "needs-user-action" | "suspended" | "completed" | "failed" | "cancelled";
export interface AppFlowSweepSummary { completed: number; total: number; message: string; captured?: number; captureLimit?: number; }
/** One entry of the project selector. The server owns the list so a pick survives the panel document. */
export interface AppFlowProjectOption { path: string; name: string; }
type Snapshot = {
  open: boolean; available: boolean; projectPath: string; projects: AppFlowProjectOption[]; runId: string | null; projectId: string;
  state: AppFlowRunState; result: AppFlowResult | null; progress: AppFlowProgressEvent | null;
  sweepSummary: AppFlowSweepSummary | null; prompt: AppFlowPrompt | null; error: string | null;
  launching: boolean; agentStartPending: boolean; pickingProject: boolean;
  /**
   * Whether this project's app is up on the App Flow device. The server owns this: every
   * `mobile_appflow_status` read answers with its own `appLaunched`, so an app launched externally
   * or in a previous panel session is still reported accurately, exactly as the engine sees it. A
   * successful `launchApp` sets it optimistically so it is true immediately instead of waiting for
   * the next status read, and `selectProject` resets it
   * before adopting the new project's status, since another project's launch says nothing here.
   */
  appLaunched: boolean;
};

type StartOptions = Omit<StartAppFlowInput, "projectPath">;

function textError(result: Awaited<ReturnType<App["callServerTool"]>>, fallback: string): Error {
  return new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || fallback);
}
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? value as Record<string, unknown> : null; }
function projectName(projectPath: string): string { return projectPath.split("/").filter(Boolean).at(-1) ?? projectPath; }

const POLL_INTERVAL_MS = 1_000;
/** How often a live sweep may re-read the graph document. The server publishes it on a similar
 *  cadence; refreshing faster would serialize an unchanged document over the bridge. */
const LIVE_RESULT_REFRESH_MS = 5_000;
/**
 * The run event channel carries two incompatible seq spaces: in-process events are numbered by a
 * counter that starts at 1, while the durable cross-process replay stamps `Date.parse(updatedAt)`
 * — epoch milliseconds. A single cursor over both is poisoned by the first durable event (it jumps
 * to ~1.7e12 and discards every in-process event for that run forever), so each space keeps its own
 * cursor and this floor is what tells them apart. No plausible in-process counter reaches it, and no
 * timestamp falls below it.
 */
const DURABLE_SEQ_FLOOR = 1e12;

export class AppFlowPanel {
  private readonly app: App;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private progressStartedAt?: number;
  private agentStartTimer?: ReturnType<typeof setTimeout>;
  private loadRevision = 0;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private readonly pollIntervalMs: number;
  private readonly liveResultRefreshMs: number;
  private polledRunId?: string | null;
  private polledRecordingNode: string | null = null;
  private runSeq = 0;
  private durableSeq = 0;
  private manualSeq = 0;
  /**
   * Monotonic token for "the panel asked for a new sweep". A status response that was already in
   * flight when the request happened describes the run being replaced, so it is dropped rather
   * than adopted.
   */
  private startEpoch = 0;
  /** The runId the pending sweep replaces. Status keeps answering with it (a paused run is still
   *  "active", an orphaned Codex-owned run is reconciled to "failed" with its id attached), and
   *  adopting it pins the panel to a dead run whose successor's events are then all dropped. */
  private abandonedRunId: string | null = null;
  private lastLiveResultRefreshAt = Number.NEGATIVE_INFINITY;
  private urls = new Map<string, string>();
  readonly recording: AppFlowRecordingStore;
  private projectRequest?: Promise<void>;
  private restoreRequest?: Promise<void>;
  private snapshot: Snapshot = { open: false, available: false, projectPath: "", projects: [], runId: null, projectId: "",
    state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null, launching: false, agentStartPending: false, pickingProject: false,
    appLaunched: false };

  constructor(app: App, pollIntervalMs = POLL_INTERVAL_MS, liveResultRefreshMs = LIVE_RESULT_REFRESH_MS) {
    this.app = app;
    this.pollIntervalMs = pollIntervalMs;
    this.liveResultRefreshMs = liveResultRefreshMs;
    this.recording = new AppFlowRecordingStore(app);
    // A recording that starts from a graph node (or ends) changes what needs polling without any
    // sweep state change, so follow the recording store directly. A fresh recording also restarts
    // the manual cursor: the server clears its buffer when a recording starts, and a server
    // restart would otherwise leave a high cursor skipping every new event.
    this.recording.subscribe(() => {
      const snapshot = this.recording.getSnapshot();
      if (snapshot.nodeId !== this.polledRecordingNode) {
        this.polledRecordingNode = snapshot.nodeId;
        if (snapshot.status === "starting") this.manualSeq = 0;
      }
      this.schedulePoll();
    });
    app.setNotificationHandler(LoggingMessageNotificationSchema, notification => this.acceptNotification(notification.params.data));
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  get canSendAgentStart() { return Boolean(this.app.getHostCapabilities()?.message?.text); }
  private update(fields: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...fields };
    // A fresh runId means a fresh server-side buffer key, and after a server restart the seq
    // counter restarts too, so the sweep cursor must restart with it.
    if (this.snapshot.runId !== this.polledRunId) {
      this.polledRunId = this.snapshot.runId;
      // Clearing the id must restart the cursors too: the next run starts a fresh server-side
      // buffer whose counter also starts at 1, so a cursor left at the finished run's height
      // swallowed the new run's opening events.
      this.runSeq = 0; this.durableSeq = 0;
      if (this.snapshot.runId) this.abandonedRunId = null;
    }
    for (const listener of this.listeners) listener();
    this.schedulePoll();
  }
  private async call(name: string, arguments_: Record<string, unknown>, timeout = 30000) {
    const result = await this.app.callServerTool({ name, arguments: arguments_ }, { timeout });
    if (result.isError) throw textError(result, `${name} failed.`);
    return result;
  }
  /** Merges a chosen folder into the selector's list; the server keeps the durable copy. */
  private remembered(project: AppFlowProjectOption) {
    this.update({ projects: [project, ...this.snapshot.projects.filter(entry => entry.path !== project.path)] });
  }

  show() { if (!this.disposed) { this.update({ open: true }); void this.restoreProject(); } }
  hide() { this.update({ open: false }); }
  setAvailable(available: boolean) {
    this.update({ available });
    // The panel can be opened before the host answers, which leaves nothing to reopen; try again
    // once the host is there rather than showing an empty selector for the rest of the session.
    if (available && this.snapshot.open) void this.restoreProject();
  }

  /** Reads the server's project list, so a pick survives the panel document and shows up in every surface. */
  async refreshProjects() {
    this.projectRequest ??= (async () => {
      const startedAt = performance.now(), telemetryContext = getUiTelemetryAttributes();
      try {
        const response = await this.call("mobile_appflow_projects", {});
        const listed = object(object(response.structuredContent)?.projects);
        const projects = (Array.isArray(listed) ? listed : []).map(entry => object(entry)).filter((entry): entry is Record<string, unknown> => entry !== null)
          .filter(entry => typeof entry.path === "string" && entry.path)
          .map(entry => {
            const path = entry.path as string;
            return { path, name: typeof entry.name === "string" && entry.name ? entry.name : projectName(path) };
          });
        if (!this.disposed) this.update({ projects });
      } catch {
        // Setup still works from the project this panel was last opened with, or the empty state.
      } finally {
        // A hidden tab or a read that finished under another surface measures nothing.
        if (getUiTelemetryAttributes() === telemetryContext) recordUiTiming("ui.app_flow.projects", performance.now() - startedAt);
        this.projectRequest = undefined;
      }
    })();
    return this.projectRequest;
  }

  /**
   * Opens App Flow again on the project it was last used with, so its map is there to read. A call
   * with nothing to reopen stays retryable, because the panel can be shown before the host answers.
   */
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

  /** Selects a project the selector already lists, and makes it the one App Flow reopens with. */
  async chooseProject(projectPath: string) {
    const path = projectPath.trim();
    if (!path) return;
    if (!this.snapshot.available) { await this.selectProject(path); return; }
    try {
      const response = await this.call("mobile_appflow_choose_project", { projectPath: path });
      const project = object(object(response.structuredContent)?.project);
      if (typeof project?.path !== "string") return;
      this.remembered({ path: project.path, name: typeof project.name === "string" && project.name ? project.name : projectName(project.path) });
      await this.selectProject(project.path);
    } catch (error) {
      // The server refuses folders App Flow could not open, so the current project stays put.
      this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Opens the system folder picker and selects what it returns. Cancelling keeps the current project. */
  async pickProject() {
    if (this.snapshot.pickingProject) return;
    this.update({ pickingProject: true, error: null });
    // The wait is a person choosing a folder, so it is measured by the server's dialog metric
    // rather than as UI work.
    try {
      const response = await this.call("mobile_appflow_choose_project", {}, 300_000);
      const project = object(object(response.structuredContent)?.project);
      const path = typeof project?.path === "string" ? project.path : "";
      if (!path) return;
      this.remembered({ path, name: typeof project?.name === "string" && project.name ? project.name : projectName(path) });
      await this.selectProject(path);
    } catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { this.update({ pickingProject: false }); }
  }

  async selectProject(projectPath: string) {
    const path = projectPath.trim();
    const revision = ++this.loadRevision;
    clearTimeout(this.agentStartTimer); this.agentStartTimer = undefined; this.progressStartedAt = undefined;
    this.lastLiveResultRefreshAt = Number.NEGATIVE_INFINITY;
    // Another project's run is not the one being replaced, and its status is not stale for this one.
    this.startEpoch++; this.abandonedRunId = null;
    this.update({ projectPath: path, runId: null, projectId: "", state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null, agentStartPending: false,
      appLaunched: false });
    if (!path || !this.snapshot.available) return;
    try {
      const status = await this.call("mobile_appflow_status", { projectPath });
      if (revision !== this.loadRevision) return;
      const data = object(status.structuredContent) ?? {};
      const runId = typeof data.runId === "string" ? data.runId : null;
      const state = typeof data.state === "string" ? data.state as AppFlowRunState : "idle";
      this.update({ ...(typeof data.appLaunched === "boolean" ? { appLaunched: data.appLaunched } : {}),
        runId, state, projectId: typeof data.projectId === "string" ? data.projectId : "", error: typeof data.error === "string" ? data.error : null });
      // Status retains the active run's latest event. Apply it as a recovery channel so reopening
      // the panel (or missing both a host notification and the bounded event poll) cannot leave a
      // human-action state without the prompt controls needed to resolve it.
      const event = object(data.event);
      if (event && (event.type !== "prompt" || state === "needs-user-action")) this.ingest({ ...(runId ? { runId } : {}), event });
      // The status state is authoritative when its latest event predates a pause/cancel transition.
      this.update({ state, ...(state === "needs-user-action" ? {} : { prompt: null }) });
      if (data.exists === true) await this.refreshResult({ projectPath: path, ...(runId ? { runId } : {}) });
    } catch (error) {
      if (revision === this.loadRevision) this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async refreshResult(target?: { runId?: string; projectPath?: string }) {
    const revision = this.loadRevision;
    const projectPath = target?.projectPath ?? this.snapshot.projectPath;
    // Graphs are durable and project-scoped. Looking them up by project also works when the run is
    // owned by the Codex MCP process rather than the panel's MCP process.
    const arguments_ = { projectPath };
    const response = await this.call("mobile_appflow_result", arguments_);
    // A refresh that outlived its project (or the panel) must not paint another project's map.
    if (this.disposed || revision !== this.loadRevision || this.snapshot.projectPath !== projectPath) return;
    const data = object(response.structuredContent);
    const result = data?.result && typeof data.result === "object" ? data.result as AppFlowResult : null;
    if (result) this.update({ result, ...(typeof data?.projectId === "string" ? { projectId: data.projectId } : {}) });
  }

  /**
   * Re-reads the graph while a sweep is live so captured screens appear as they finish.
   *
   * The server publishes `app-flow.json` mid-sweep on its own interval, so this is paced to match
   * rather than run once per poll tick: an unchanged document serialized over the bridge measures
   * nothing and costs the host a parse. A failed read is simply retried on the next tick, and the
   * terminal refresh stays authoritative.
   */
  private maybeRefreshLiveResult() {
    const now = performance.now();
    if (now - this.lastLiveResultRefreshAt < this.liveResultRefreshMs) return;
    this.lastLiveResultRefreshAt = now;
    void this.refreshResult().catch(() => { /* the terminal refresh, or the next tick, covers it */ });
  }

  /**
   * One bounded count per user-started run that has "Capture UI states" switched on. It replaces
   * the count the removed UI Explore button made, and like it carries no project path, state name
   * or capture content: the event name is the whole payload beyond the shared surface attributes.
   */
  private countUiStateOption(options: StartOptions) { if (options.captureUiStates === true) countUiEvent("ui.app_flow.capture_ui_states_start"); }

  async start(options: StartOptions) {
    const projectPath = this.snapshot.projectPath.trim();
    if (!projectPath) return;
    this.countUiStateOption(options);
    await this.beginRun("mobile_appflow_start", { projectPath, ...options }, "app_flow.start");
  }

  /**
   * Starts a run through a server tool that answers with a runId, and adopts it.
   *
   * Retire the previous run the same way `requestAgentStart` does. Keeping its id here meant the
   * new run's events were dropped by the ingest guard (while still advancing the seq cursor past
   * them) until the id finally changed, so the panel only recovered if the server's bounded
   * buffer had not rolled in the meantime.
   */
  private async beginRun(name: string, arguments_: Record<string, unknown>, operation: string) {
    this.progressStartedAt = performance.now();
    this.startEpoch++; this.abandonedRunId = this.snapshot.runId ?? this.abandonedRunId;
    this.update({ runId: null, state: "running", error: null, progress: null, sweepSummary: null, prompt: null });
    const startedAt = performance.now();
    try {
      const response = await this.call(name, arguments_);
      const data = object(response.structuredContent) ?? {};
      const runId = typeof data.runId === "string" ? data.runId : null;
      if (!runId) throw new Error("App Flow did not return a run ID.");
      this.update({ runId, state: "running" });
    } catch (error) {
      this.progressStartedAt = undefined;
      captureUiError(error, operation);
      this.update({ state: "failed", error: error instanceof Error ? error.message : String(error) });
    }
    finally { recordUiTiming("ui.app_flow.start", performance.now() - startedAt); }
  }

  async requestAgentStart(options: StartOptions) {
    if (!this.canSendAgentStart) { this.update({ error: "This host cannot send a follow-up message, so a screen sweep must be started from chat." }); return; }
    const projectPath = this.snapshot.projectPath.trim();
    if (!projectPath) return;
    this.progressStartedAt = performance.now();
    // Clear the previous run the same way `start` does. Without this, a second sweep on the same
    // project (a fresh start or a Resume — the label is cosmetic, both land here) kept the finished
    // run's id, and that stale id is self-sustaining: `ingest` drops every envelope whose runId
    // differs from it, the status-by-project discovery in `pollEvents` only runs while the panel
    // has no runId, and `mobile_appflow_status` answers with no runId once a run is done, so
    // nothing could ever overwrite it. The panel sat on the old summary and a frozen clock until
    // the user switched projects. The progress/summary/prompt reset is what unfreezes the display;
    // the runId reset is what lets the new run's events in at all.
    //
    // `state` is deliberately left alone — unlike `start`, nothing has been started here yet. The
    // prompt only asks the agent to call `mobile_appflow_start`, so claiming "running" would show
    // a live run that may never begin (and the agent may decline). `agentStartPending` is what
    // drives the pending affordance and keeps `pollNeeded` polling, and the first real event — or
    // the status discovery it unblocks — sets the honest state a moment later.
    //
    // Clearing the id is necessary but not sufficient: `pollEvents` fires about a second later,
    // usually before Codex has called `mobile_appflow_start`, and the project-scoped status it uses
    // for discovery still answers with the PREVIOUS run — a paused run is still returned by the
    // active-run finder, and an orphaned Codex-owned run is returned reconciled to "failed", both
    // carrying their runId. Adopting it pinned the panel back onto the dead run, which is why the
    // display only unfroze when the user switched projects. The epoch and the abandoned id below
    // are what make the adoption site reject those answers.
    this.startEpoch++; this.abandonedRunId = this.snapshot.runId ?? this.abandonedRunId;
    this.update({ runId: null, progress: null, sweepSummary: null, prompt: null });
    this.countUiStateOption(options);
    const input = { projectPath, ...options, mode: "screen-ui-and-structure" satisfies AppFlowBuildMode };
    const prompt = `Start an App Flow screen sweep with mobile_appflow_start using these exact arguments, then service its mobile_appflow_next_decision and mobile_appflow_submit_decision loop until the run completes, fails, is cancelled, is suspended, or needs user action. Do not resolve a human auth/review prompt yourself.\n\n${JSON.stringify(input)}`;
    this.update({ agentStartPending: true, error: null });
    try {
      const response = await this.app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] }, { timeout: 5000, maxTotalTimeout: 5000 });
      if (response.isError) throw new Error("Codex could not start the App Flow sweep.");
      clearTimeout(this.agentStartTimer);
      this.agentStartTimer = setTimeout(() => { this.agentStartTimer = undefined; this.update({ agentStartPending: false }); }, 30000);
    } catch (error) { this.progressStartedAt = undefined; this.update({ agentStartPending: false, error: error instanceof Error ? error.message : String(error) }); }
  }

  async launchApp() {
    const projectPath = this.snapshot.projectPath.trim(); if (!projectPath) return;
    this.update({ launching: true, error: null });
    // Booting the simulator, building if needed, and waiting for the app to come up is a
    // multi-minute operation; the routine 30s tool timeout would report failure while the server
    // keeps working (and the panel restores launching=false when the run's events arrive).
    try { await this.call("mobile_appflow_launch_app", { projectPath }, 300_000); this.update({ appLaunched: true }); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { this.update({ launching: false }); }
  }
  async pause() { await this.mutateRun("mobile_appflow_pause"); }
  async cancel() { await this.mutateRun("mobile_appflow_cancel"); }
  async clear() {
    const projectPath = this.snapshot.projectPath.trim();
    if (!projectPath) return;
    try {
      await this.call("mobile_appflow_clear", { projectPath });
      // Invalidate a graph/status read that started before the clear, otherwise its late response
      // can repaint the just-deleted map. The selected project itself intentionally stays put.
      this.loadRevision++;
      this.startEpoch++;
      this.abandonedRunId = this.snapshot.runId ?? this.abandonedRunId;
      clearTimeout(this.agentStartTimer); this.agentStartTimer = undefined;
      this.progressStartedAt = undefined;
      this.lastLiveResultRefreshAt = Number.NEGATIVE_INFINITY;
      this.urls.clear();
      this.update({ runId: null, projectId: "", state: "idle", result: null, progress: null,
        sweepSummary: null, prompt: null, error: null, agentStartPending: false });
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  private async mutateRun(name: string) {
    const runId = this.snapshot.runId; if (!runId) return;
    try { await this.call(name, { runId }); await this.refreshStatus(); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
  }
  async resolvePrompt(resolution: AppFlowPromptResolution) {
    const { runId, prompt, projectPath } = this.snapshot; if (!runId) return;
    this.update({ prompt: null });
    try {
      await this.call("mobile_appflow_resolve_prompt", { runId, resolution, projectPath, ...(prompt?.id ? { promptId: prompt.id } : {}) });
      await this.refreshStatus();
      // A Codex turn deliberately ends when a human prompt appears. Continuing only the engine
      // leaves its next model decision without a caller, so wake a new turn for this same run.
      if (resolution !== "stop" && this.snapshot.state === "running" && this.canSendAgentStart) {
        const resume = `Resume the existing App Flow run ${runId}. Service its mobile_appflow_next_decision and mobile_appflow_submit_decision loop until it completes, fails, is cancelled, is suspended, or needs user action. Do not start a new run and do not resolve a human auth/review prompt yourself.`;
        const response = await this.app.sendMessage({ role: "user", content: [{ type: "text", text: resume }] }, { timeout: 5000, maxTotalTimeout: 5000 });
        if (response.isError) throw new Error("Codex could not resume the App Flow decision loop.");
      }
    }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
  }
  async replay(nodeId: string) {
    const projectPath = this.snapshot.projectPath;
    // A cold device walks the path in minutes; the panel just waits for the outcome.
    await this.call("mobile_appflow_manual_replay", { projectPath, nodeId }, 300_000);
  }
  async refreshStatus() {
    // The active sweep may be owned by the MCP process serving Codex's tool calls, so always use
    // the project-scoped durable lookup instead of assuming this panel owns the runId.
    const target = { projectPath: this.snapshot.projectPath };
    const response = await this.call("mobile_appflow_status", target);
    const data = object(response.structuredContent) ?? {};
    const state = typeof data.state === "string" ? data.state as AppFlowRunState : this.snapshot.state;
    const statusRunId = typeof data.runId === "string" ? data.runId : undefined;
    const event = object(data.event);
    if (event && (event.type !== "prompt" || state === "needs-user-action")) this.ingest({ ...(statusRunId ? { runId: statusRunId } : {}), event });
    this.update({ state, ...(statusRunId ? { runId: statusRunId } : {}),
      ...(typeof data.appLaunched === "boolean" ? { appLaunched: data.appLaunched } : {}),
      ...(typeof data.error === "string" ? { error: data.error } : {}),
      ...(state === "needs-user-action" ? {} : { prompt: null }) });
    if (["completed", "failed", "cancelled", "suspended"].includes(state)) await this.refreshResult();
  }

  /**
   * The event channel a sweep or recording depends on. Hosts may drop server logging
   * notifications, so the panel also polls the server's bounded event buffer while work is live.
   * The shared seq cursor keeps this and the notification path from double-applying an event.
   */
  private schedulePoll() {
    if (this.disposed || this.pollTimer !== undefined) return;
    if (!this.pollNeeded()) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollEvents().finally(() => this.schedulePoll());
    }, this.pollIntervalMs);
  }

  private pollNeeded() {
    // A hidden view does not need live events: the server keeps buffering them (capped), and the
    // cursor replays what the panel missed when it is shown again.
    if (!this.snapshot.open) return false;
    const { state, runId, projectPath, agentStartPending } = this.snapshot;
    if (runId && (state === "running" || state === "needs-user-action")) return true;
    if (agentStartPending && projectPath !== "") return true;
    const recording = this.recording.getSnapshot();
    const recordingLive = recording.nodeId !== null && recording.status !== null
      && recording.status !== "stopped" && recording.status !== "error";
    return recordingLive && projectPath !== "";
  }

  private async pollEvents() {
    if (this.disposed) return;
    let { runId, state } = this.snapshot;
    const projectPath = this.snapshot.projectPath;
    // A Codex-started sweep has no runId here: the follow-up message only reaches the server a
    // moment later, so status-by-project is what discovers it. The same call is not a reliable
    // "is anything running" question, though — it also answers with the run this start replaces,
    // and it does so with a runId attached whenever that run is suspended/paused or was an
    // orphaned Codex-owned run reconciled to "failed". Adopting one of those pins the panel to a
    // dead run and the ingest guard then drops every event the real new run produces.
    //
    // So a runId the panel is not already following is adopted only when the run it names is
    // actually live, and never when it is the run this start is replacing. Updates about the run
    // already being followed stay unconditional, so a pause or a late terminal state still lands.
    // After adoption the event buffer takes over and its `complete`/`error` events carry the
    // terminal state.
    const epoch = this.startEpoch;
    if (((!runId && this.snapshot.agentStartPending) || state === "running" || state === "needs-user-action") && projectPath !== "") {
      try {
        const response = await this.call("mobile_appflow_status", { projectPath });
        const data = object(response.structuredContent) ?? {};
        // A status read that was in flight when a new sweep was requested describes the old run.
        if (!this.disposed && epoch === this.startEpoch && typeof data.runId === "string" && typeof data.state === "string") {
          const statusRunId = data.runId, statusState = data.state as AppFlowRunState;
          const live = statusState === "running" || statusState === "needs-user-action";
          if (statusRunId === this.snapshot.runId || (live && statusRunId !== this.abandonedRunId)) {
            this.update({ runId: statusRunId, state: statusState });
            const event = object(data.event);
            if (event && (event.type !== "prompt" || statusState === "needs-user-action")) this.ingest({ runId: statusRunId, event });
            ({ runId, state } = this.snapshot);
          }
        }
      } catch {
        // Retried on the next tick.
      }
    }
    if (runId && (state === "running" || state === "needs-user-action")) {
      await this.readEvents({ runId }, this.runSeq);
      this.maybeRefreshLiveResult();
    }
    const recording = this.recording.getSnapshot();
    const recordingLive = recording.nodeId !== null && recording.status !== null
      && recording.status !== "stopped" && recording.status !== "error";
    if (recordingLive) {
      await this.readEvents({ projectPath }, this.manualSeq);
    }
  }

  private async readEvents(target: { runId?: string; projectPath?: string }, since: number) {
    try {
      const response = await this.call("mobile_appflow_events", { ...target, since });
      const content = object(response.structuredContent);
      const events = Array.isArray(content?.result) ? content.result : Array.isArray(content?.events) ? content.events : [];
      // `ingest` owns the shared seq cursor, so an event notified first is skipped here.
      for (const entry of events) {
        const envelope = object(entry);
        if (envelope) this.ingest(envelope);
      }
    } catch {
      // A dropped poll is retried on the next tick; a finished run stops needing polls at all.
    }
  }

  private acceptNotification(data: unknown) {
    const envelope = object(data);
    if (envelope?.source !== "app-flow") return;
    this.ingest(envelope);
  }

  /**
   * Applies one App Flow event, whether it arrived as a logging notification or a poll result.
   * Both channels carry the server's monotonic seq, so the matching per-stream cursor lets a
   * duplicate from the other channel be dropped before it can double-append a recording step.
   */
  private ingest(envelope: Record<string, unknown>) {
    const event = object(envelope.event);
    if (!event || typeof event.type !== "string") return;
    const manual = typeof event.nodeId === "string";
    const envelopeRunId = typeof envelope.runId === "string" ? envelope.runId : undefined;
    // Decide whether this event belongs to the run being followed BEFORE the cursor moves, so an
    // event that is about to be dropped cannot carry the cursor past events that do belong. While
    // no run is followed (between a start request and the new run's first event) anything from the
    // run that start replaces is refused, otherwise a late straggler re-adopts the dead run.
    if (!manual && envelopeRunId !== undefined
      && (this.snapshot.runId ? envelopeRunId !== this.snapshot.runId : envelopeRunId === this.abandonedRunId)) return;
    const seq = typeof envelope.seq === "number" ? envelope.seq : undefined;
    if (seq !== undefined) {
      if (manual) { if (seq <= this.manualSeq) return; this.manualSeq = seq; }
      // Durable cross-process replay numbers its event by timestamp, so it shares no ordering with
      // the in-process counter the poll cursor is sent as. Folding it into `runSeq` pushed the
      // cursor past every in-process seq this run could ever produce, and the server's own
      // `seq > since` filter then withheld them too — a second, permanent way to freeze.
      else if (seq >= DURABLE_SEQ_FLOOR) { if (seq <= this.durableSeq) return; this.durableSeq = seq; }
      else { if (seq <= this.runSeq) return; this.runSeq = seq; }
    }
    if (manual) {
      this.recording.accept(event as unknown as ManualRecordingEvent);
      if (event.type === "complete") void this.refreshResult({ projectPath: this.snapshot.projectPath }).catch(error => this.update({ error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    const progress = event as unknown as AppFlowProgressEvent;
    clearTimeout(this.agentStartTimer); this.agentStartTimer = undefined;
    const summary = progress.completed !== undefined && progress.total !== undefined
      ? { completed: progress.completed, total: progress.total, message: progress.message,
          ...(progress.captured !== undefined ? { captured: progress.captured } : {}),
          ...(progress.captureLimit !== undefined ? { captureLimit: progress.captureLimit } : {}) }
      : this.snapshot.sweepSummary;
    if (this.progressStartedAt !== undefined) { recordUiTiming("ui.app_flow.start_to_progress", performance.now() - this.progressStartedAt); this.progressStartedAt = undefined; }
    const fields: Partial<Snapshot> = { progress, sweepSummary: summary, prompt: progress.type === "prompt" ? progress.prompt ?? null : null, agentStartPending: false,
      ...(typeof envelope.runId === "string" ? { runId: envelope.runId } : {}), ...(typeof progress.projectId === "string" ? { projectId: progress.projectId } : {}) };
    if (progress.type === "error") { fields.state = "failed"; fields.error = progress.message; }
    else if (progress.type === "prompt") fields.state = "needs-user-action";
    else if (progress.type === "complete") fields.state = "completed";
    else fields.state = "running";
    this.update(fields);
    if (progress.type === "complete" || progress.type === "error") countUiEvent(`ui.app_flow.terminal.${progress.type}`);
    if (progress.type === "complete" || progress.type === "structure-ready") void this.refreshResult().catch(error => this.update({ error: error instanceof Error ? error.message : String(error) }));
  }

  async screenshot(projectId: string, path: string): Promise<string> {
    if (/^(?:data:|blob:|https?:)/.test(path)) return path;
    const key = `${projectId}\0${path}`;
    const cached = this.urls.get(key); if (cached) return cached;
    let screenshotId = path;
    if (path.startsWith("appflow-image://")) {
      try { screenshotId = new URL(path).pathname.split("/").filter(Boolean).at(-1) ?? ""; }
      catch { screenshotId = ""; }
    }
    if (!screenshotId) throw new Error("App Flow returned an invalid screenshot reference.");
    const result = await this.call("mobile_appflow_screenshot", { projectId, path: screenshotId });
    const image = result.content.find(item => item.type === "image");
    if (!image || image.type !== "image") throw new Error("App Flow did not return a screenshot.");
    // The host sandbox enforces the CSP declared with the UI resource, whose img-src allows `data:`
    // but not `blob:`, so inline the base64 the tool already returned instead of an object URL.
    const url = `data:${image.mimeType};base64,${image.data}`;
    this.urls.set(key, url); return url;
  }

  async dispose() {
    this.disposed = true; this.loadRevision++; clearTimeout(this.agentStartTimer); this.agentStartTimer = undefined;
    clearTimeout(this.pollTimer); this.pollTimer = undefined;
    this.listeners.clear(); this.recording.dispose();
    this.app.removeNotificationHandler("notifications/message");
    this.urls.clear();
  }
}

export type { AppFlowBuildMode, DeepLinkJudgeMode, ExplorationMode };
