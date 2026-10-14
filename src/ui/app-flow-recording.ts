import type { App } from "@modelcontextprotocol/ext-apps";
import type { ManualRecordingAction, ManualRecordingEvent, ManualRecordingStatus, ManualSnapshotNode, ManualSnapshotRect } from "../shared/app-flow.ts";

type Snapshot = {
  nodeId: string | null;
  status: ManualRecordingStatus | null;
  statusMessage: string | null;
  snapshot: ManualSnapshotNode[];
  bounds: ManualSnapshotRect | null;
  steps: Array<{ command: string; portable: boolean }>;
  error: string | null;
  outcome: { pathToReach: string[]; replayVerified: boolean; fallbackReason?: string } | null;
};

const INITIAL: Snapshot = { nodeId: null, status: null, statusMessage: null, snapshot: [], bounds: null, steps: [], error: null, outcome: null };

export class AppFlowRecordingStore {
  private readonly app: App;
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private value: Snapshot = INITIAL;

  constructor(app: App) { this.app = app; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.value;
  private update(fields: Partial<Snapshot>) { this.value = { ...this.value, ...fields }; for (const listener of this.listeners) listener(); }
  private reset(nodeId: string | null) { this.revision = 0; this.update({ ...INITIAL, nodeId }); }
  private async call(name: string, arguments_: Record<string, unknown>, timeout = 30000) {
    const result = await this.app.callServerTool({ name, arguments: arguments_ }, { timeout });
    if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || `${name} failed.`);
    return result;
  }

  accept(event: ManualRecordingEvent) {
    const current = this.value.nodeId;
    if (current && event.nodeId !== current) return;
    switch (event.type) {
      case "status": this.update({ status: event.status, statusMessage: event.message ?? null }); break;
      case "snapshot":
        if (event.revision < this.revision) return;
        this.revision = event.revision;
        this.update({ snapshot: event.nodes, bounds: event.bounds });
        break;
      case "step": this.update({ steps: [...this.value.steps, { command: event.command, portable: event.portable }] }); break;
      case "complete": this.update({ status: "stopped", statusMessage: null, outcome: { pathToReach: event.pathToReach,
        replayVerified: event.replayVerified, ...(event.fallbackReason ? { fallbackReason: event.fallbackReason } : {}) } }); break;
      case "error": this.update({ status: "error", error: event.message }); break;
    }
  }

  async start(projectPath: string, nodeId: string) {
    this.reset(nodeId); this.update({ status: "starting" });
    try { await this.call("mobile_appflow_manual_start", { projectPath, nodeId }); }
    catch (error) { this.update({ status: "error", error: error instanceof Error ? error.message : String(error) }); }
  }
  async act(projectPath: string, action: ManualRecordingAction) {
    // One interaction settles the app, waits for the route, and re-snapshots; that can outlast a
    // routine tool timeout while the session is still healthy.
    try { await this.call("mobile_appflow_manual_act", { projectPath, action }, 60000); this.update({ error: null }); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
  }
  async stop(projectPath: string) {
    this.update({ status: "saving" });
    // Saving replays the whole recording to verify it, then tears the device down: minutes, not
    // seconds. The result arrives as events either way; the call just carries the failure.
    try { await this.call("mobile_appflow_manual_stop", { projectPath }, 300_000); }
    catch (error) { this.update({ status: "error", error: error instanceof Error ? error.message : String(error) }); }
  }
  async cancel(projectPath: string) {
    try { await this.call("mobile_appflow_manual_cancel", { projectPath }); }
    finally { this.reset(null); }
  }
  dismiss() { this.reset(null); }
  dispose() { this.listeners.clear(); this.reset(null); }
}
