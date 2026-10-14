import type { App } from "@modelcontextprotocol/ext-apps";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppFlowBuildMode, AppFlowProgressEvent, AppFlowPrompt, AppFlowPromptResolution, AppFlowResult, DeepLinkJudgeMode, ExplorationMode, ManualRecordingEvent, RenderTransportMode, StartAppFlowInput } from "../shared/app-flow.ts";
import { AppFlowRecordingStore } from "./app-flow-recording.ts";
import { countUiEvent, recordUiTiming } from "./telemetry.ts";

export type AppFlowRunState = "idle" | "running" | "needs-user-action" | "suspended" | "completed" | "failed" | "cancelled";
export interface AppFlowSweepSummary { completed: number; total: number; message: string; }
type Snapshot = {
  open: boolean; available: boolean; projectPath: string; recents: string[]; runId: string | null; projectId: string;
  state: AppFlowRunState; result: AppFlowResult | null; progress: AppFlowProgressEvent | null;
  sweepSummary: AppFlowSweepSummary | null; prompt: AppFlowPrompt | null; error: string | null;
  launching: boolean; agentStartPending: boolean;
};

type StartOptions = Omit<StartAppFlowInput, "projectPath">;
const RECENTS_KEY = "app-flow-project-recents";
const MAX_RECENTS = 8;

function textError(result: Awaited<ReturnType<App["callServerTool"]>>, fallback: string): Error {
  return new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || fallback);
}
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? value as Record<string, unknown> : null; }
function savedRecents(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"); return Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, MAX_RECENTS) : []; }
  catch { return []; }
}

export class AppFlowPanel {
  private readonly app: App;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private progressStartedAt?: number;
  private agentStartTimer?: ReturnType<typeof setTimeout>;
  private loadRevision = 0;
  private urls = new Map<string, string>();
  readonly recording: AppFlowRecordingStore;
  private snapshot: Snapshot = { open: false, available: false, projectPath: "", recents: savedRecents(), runId: null, projectId: "",
    state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null, launching: false, agentStartPending: false };

  constructor(app: App) {
    this.app = app;
    this.recording = new AppFlowRecordingStore(app);
    app.setNotificationHandler(LoggingMessageNotificationSchema, notification => this.acceptNotification(notification.params.data));
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  get canSendAgentStart() { return Boolean(this.app.getHostCapabilities()?.message?.text); }
  private update(fields: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...fields }; for (const listener of this.listeners) listener(); }
  private async call(name: string, arguments_: Record<string, unknown>, timeout = 30000) {
    const result = await this.app.callServerTool({ name, arguments: arguments_ }, { timeout });
    if (result.isError) throw textError(result, `${name} failed.`);
    return result;
  }
  private remember(projectPath: string) {
    const recents = [projectPath, ...this.snapshot.recents.filter(path => path !== projectPath)].slice(0, MAX_RECENTS);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch { /* storage is best effort */ }
    this.update({ recents });
  }

  show() { if (!this.disposed) this.update({ open: true }); }
  hide() { this.update({ open: false }); }
  setAvailable(available: boolean) { this.update({ available }); }

  async selectProject(projectPath: string) {
    const path = projectPath.trim();
    const revision = ++this.loadRevision;
    clearTimeout(this.agentStartTimer); this.agentStartTimer = undefined; this.progressStartedAt = undefined;
    this.update({ projectPath: path, runId: null, projectId: "", state: "idle", result: null, progress: null, sweepSummary: null, prompt: null, error: null, agentStartPending: false });
    if (!path || !this.snapshot.available) return;
    this.remember(path);
    try {
      const status = await this.call("mobile_appflow_status", { projectPath });
      if (revision !== this.loadRevision) return;
      const data = object(status.structuredContent) ?? {};
      const runId = typeof data.runId === "string" ? data.runId : null;
      const state = typeof data.state === "string" ? data.state as AppFlowRunState : "idle";
      this.update({ runId, state, projectId: typeof data.projectId === "string" ? data.projectId : "", error: typeof data.error === "string" ? data.error : null });
      if (data.exists === true) await this.refreshResult({ projectPath: path, ...(runId ? { runId } : {}) });
    } catch (error) {
      if (revision === this.loadRevision) this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async refreshResult(target?: { runId?: string; projectPath?: string }) {
    const arguments_ = target?.runId ? { runId: target.runId } : { projectPath: target?.projectPath ?? this.snapshot.projectPath };
    const response = await this.call("mobile_appflow_result", arguments_);
    const data = object(response.structuredContent);
    const result = data?.result && typeof data.result === "object" ? data.result as AppFlowResult : null;
    if (result) this.update({ result, ...(typeof data?.projectId === "string" ? { projectId: data.projectId } : {}) });
  }

  async start(options: StartOptions) {
    const projectPath = this.snapshot.projectPath.trim();
    if (!projectPath) return;
    this.remember(projectPath);
    this.progressStartedAt = performance.now();
    this.update({ state: "running", error: null, progress: null, sweepSummary: null, prompt: null });
    const startedAt = performance.now();
    try {
      const response = await this.call("mobile_appflow_start", { projectPath, ...options });
      const data = object(response.structuredContent) ?? {};
      const runId = typeof data.runId === "string" ? data.runId : null;
      if (!runId) throw new Error("App Flow did not return a run ID.");
      this.update({ runId, state: "running" });
    } catch (error) { this.progressStartedAt = undefined; this.update({ state: "failed", error: error instanceof Error ? error.message : String(error) }); }
    finally { recordUiTiming("ui.app_flow.start", performance.now() - startedAt); }
  }

  async requestAgentStart(options: StartOptions) {
    if (!this.canSendAgentStart) { this.update({ error: "This host cannot send a follow-up message, so a screen sweep must be started from chat." }); return; }
    const projectPath = this.snapshot.projectPath.trim();
    if (!projectPath) return;
    this.remember(projectPath);
    this.progressStartedAt = performance.now();
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
    try { await this.call("mobile_appflow_launch_app", { projectPath }); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { this.update({ launching: false }); }
  }
  async pause() { await this.mutateRun("mobile_appflow_pause"); }
  async cancel() { await this.mutateRun("mobile_appflow_cancel"); }
  private async mutateRun(name: string) {
    const runId = this.snapshot.runId; if (!runId) return;
    try { await this.call(name, { runId }); await this.refreshStatus(); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
  }
  async resolvePrompt(resolution: AppFlowPromptResolution) {
    const { runId, prompt } = this.snapshot; if (!runId) return;
    this.update({ prompt: null });
    try { await this.call("mobile_appflow_resolve_prompt", { runId, resolution, ...(prompt?.id ? { promptId: prompt.id } : {}) }); await this.refreshStatus(); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
  }
  async replay(nodeId: string) {
    const projectPath = this.snapshot.projectPath;
    await this.call("mobile_appflow_manual_replay", { projectPath, nodeId }, 120000);
  }
  async refreshStatus() {
    const target = this.snapshot.runId ? { runId: this.snapshot.runId } : { projectPath: this.snapshot.projectPath };
    const response = await this.call("mobile_appflow_status", target);
    const data = object(response.structuredContent) ?? {};
    const state = typeof data.state === "string" ? data.state as AppFlowRunState : this.snapshot.state;
    const event = object(data.event) as AppFlowProgressEvent | null;
    this.update({ state, ...(typeof data.runId === "string" ? { runId: data.runId } : {}),
      ...(typeof data.error === "string" ? { error: data.error } : {}), ...(event ? { progress: event } : {}) });
    if (["completed", "failed", "cancelled", "suspended"].includes(state)) await this.refreshResult();
  }

  private acceptNotification(data: unknown) {
    const envelope = object(data);
    if (envelope?.source !== "app-flow") return;
    const event = object(envelope.event);
    if (!event || typeof event.type !== "string") return;
    if (typeof event.nodeId === "string") {
      this.recording.accept(event as unknown as ManualRecordingEvent);
      if (event.type === "complete") void this.refreshResult({ projectPath: this.snapshot.projectPath }).catch(error => this.update({ error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (this.snapshot.runId && typeof envelope.runId === "string" && envelope.runId !== this.snapshot.runId) return;
    const progress = event as unknown as AppFlowProgressEvent;
    clearTimeout(this.agentStartTimer); this.agentStartTimer = undefined;
    const summary = progress.completed !== undefined && progress.total !== undefined
      ? { completed: progress.completed, total: progress.total, message: progress.message } : this.snapshot.sweepSummary;
    if (this.progressStartedAt !== undefined) { recordUiTiming("ui.app_flow.start_to_progress", performance.now() - this.progressStartedAt); this.progressStartedAt = undefined; }
    const fields: Partial<Snapshot> = { progress, sweepSummary: summary, prompt: progress.type === "prompt" ? progress.prompt ?? null : null,
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
    const binary = atob(image.data); const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
    this.urls.set(key, url); return url;
  }

  async dispose() {
    this.disposed = true; this.loadRevision++; clearTimeout(this.agentStartTimer); this.agentStartTimer = undefined; this.listeners.clear(); this.recording.dispose();
    this.app.removeNotificationHandler("notifications/message");
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

export type { AppFlowBuildMode, DeepLinkJudgeMode, ExplorationMode, RenderTransportMode };
