import type { HostBridge } from "./host-bridge.ts";
import type { AppIntelSnapshot, AppIntelStatus } from "@mobile-dev/shared/app-intelligence.ts";
import { captureUiError, countUiEvent, measureUiOperation, recordUiTiming, setUiGauge } from "./telemetry.ts";

export type AppIntelligenceState = {
  open: boolean; available: boolean; projectPath: string; snapshot: AppIntelSnapshot | null;
  run: AppIntelStatus["run"]; busy: "loading" | "picking" | "generating" | "cancelling" | null;
  error: string; selectedScreen: string | null;
  /** Projects the panel remembers, most recent first, so switching needs no folder picker. */
  recents: string[];
  view: "atlas" | "flow"; atlasPath: string; showPackages: boolean; flowRoot: string | null;
  /** Boundaries the Flow may draw. null means every boundary, which is what a fresh graph shows. */
  boundaries: string[] | null;
};

function resultError(result: Awaited<ReturnType<HostBridge["callServerTool"]>>) {
  return result.content?.filter(item => item.type === "text").map(item => item.text).join("\n") || "App Intelligence request failed.";
}

export class AppIntelligencePanel {
  private listeners = new Set<() => void>();
  private state: AppIntelligenceState = { open: false, available: false, projectPath: "", snapshot: null, run: null, busy: null, error: "", selectedScreen: null, recents: [], view: "atlas", atlasPath: "", showPackages: false, flowRoot: null, boundaries: null };
  private app: HostBridge;
  constructor(app: HostBridge) { this.app = app; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  private update(patch: Partial<AppIntelligenceState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  setAvailable(available: boolean) { this.update({ available }); if (available && this.state.open) void this.load(); }
  show() { this.update({ open: true }); if (this.state.available) void this.load(); }
  hide() { this.update({ open: false }); }
  dispose() { this.listeners.clear(); }
  selectScreen(selectedScreen: string | null) { this.update({ selectedScreen, flowRoot: null, view: "flow" }); }
  setView(view: AppIntelligenceState["view"]) { if (view !== this.state.view) { countUiEvent("ui.app_intel.view_switch"); this.update({ view }); } }
  zoomTo(atlasPath: string) { if (atlasPath !== this.state.atlasPath) { countUiEvent("ui.app_intel.zoom"); this.update({ atlasPath }); } }
  setPackages(showPackages: boolean) { this.update({ showPackages }); }
  setFlowRoot(flowRoot: string | null) { this.update({ flowRoot }); }
  setBoundaries(boundaries: string[] | null) { countUiEvent("ui.app_intel.boundary_filter"); this.update({ boundaries }); }
  toggleBoundary(boundary: string, available: readonly string[]) {
    const current = this.state.boundaries ?? available;
    const next = current.includes(boundary) ? current.filter(entry => entry !== boundary) : [...current, boundary];
    this.setBoundaries(next.length === available.length && available.every(entry => next.includes(entry)) ? null : next);
  }

  async load(projectPath?: string) {
    if (!this.state.available || this.state.busy === "generating") return;
    this.update({ busy: "loading", error: "" });
    try {
      const result = await measureUiOperation("ui.app_intel.load", "ui.app_intel.load_failed", () => this.app.callServerTool({ name: "mobile_app_intel_snapshot", arguments: projectPath ? { projectPath } : {} }));
      // Even a failed read carries the remembered projects, so the picker still has them to offer.
      if (result.isError) { this.update({ recents: (result.structuredContent as { recents?: string[] } | undefined)?.recents ?? this.state.recents }); throw new Error(resultError(result)); }
      const value = result.structuredContent as { projectPath: string; snapshot: AppIntelSnapshot | null; recents?: string[] };
      setUiGauge("ui.app_intel.files", Object.keys(value.snapshot?.files ?? {}).length);
      setUiGauge("ui.app_intel.screens", Object.keys(value.snapshot?.screens ?? {}).length);
      const screen = value.snapshot && this.state.selectedScreen && value.snapshot.screens[this.state.selectedScreen] ? this.state.selectedScreen : null;
      const flowRoot = value.snapshot && this.state.flowRoot && value.snapshot.files[this.state.flowRoot] ? this.state.flowRoot : null;
      const atlasPath = value.snapshot && this.state.atlasPath && Object.keys(value.snapshot.files).some(path => path === this.state.atlasPath || path.startsWith(this.state.atlasPath + "/")) ? this.state.atlasPath : "";
      this.update({ projectPath: value.projectPath, snapshot: value.snapshot, recents: value.recents ?? this.state.recents, busy: null, selectedScreen: screen, flowRoot, atlasPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update({ busy: null, error: /No project selected/.test(message) ? "" : message, projectPath: /No project selected/.test(message) ? "" : this.state.projectPath });
    }
  }

  async pickProject() {
    if (!this.state.available) return;
    this.update({ busy: "picking", error: "" });
    try {
      const result = await measureUiOperation("ui.app_intel.pick", "ui.app_intel.pick_failed", () => this.app.callServerTool({ name: "mobile_pick_app_intel_project", arguments: {} }));
      if (result.isError) throw new Error(resultError(result));
      const value = result.structuredContent as { picked: boolean; projectPath?: string };
      if (!value.picked) { countUiEvent("ui.app_intel.pick_cancelled"); this.update({ busy: null }); return; }
      this.update({ projectPath: value.projectPath ?? "", busy: null, snapshot: null, selectedScreen: null, flowRoot: null, atlasPath: "", view: "atlas", boundaries: null });
      await this.load(value.projectPath);
    } catch (error) { this.update({ busy: null, error: error instanceof Error ? error.message : String(error) }); captureUiError(error, "app_intel.pick"); }
  }

  /** Switches to a remembered project without reopening the host folder picker. */
  async selectProject(projectPath: string) {
    if (!this.state.available || projectPath === this.state.projectPath) return;
    this.update({ busy: "picking", error: "", snapshot: null, selectedScreen: null, flowRoot: null, atlasPath: "", view: "atlas", boundaries: null });
    try {
      const result = await this.app.callServerTool({ name: "mobile_select_app_intel_project", arguments: { projectPath } });
      if (result.isError) throw new Error(resultError(result));
      const value = result.structuredContent as { projectPath: string; snapshot: AppIntelSnapshot | null; recents?: string[] };
      countUiEvent("ui.app_intel.project_switch");
      this.update({ projectPath: value.projectPath, snapshot: value.snapshot, recents: value.recents ?? this.state.recents, busy: null });
    } catch (error) { this.update({ busy: null, error: error instanceof Error ? error.message : String(error) }); captureUiError(error, "app_intel.select"); }
  }

  async generate() {
    if (!this.state.available || !this.state.projectPath) return;
    this.update({ busy: "generating", error: "", run: { runId: "ui", phase: "analyzing", message: "Discovering screens and dependencies" } });
    const startedAt = performance.now();
    try {
      const result = await this.app.callServerTool({ name: "mobile_generate_app_intel", arguments: { projectPath: this.state.projectPath } });
      if (result.isError) throw new Error(resultError(result));
      countUiEvent("ui.app_intel.generate_success");
      this.update({ busy: null, run: null });
      await this.load(this.state.projectPath);
    } catch (error) {
      countUiEvent("ui.app_intel.generate_failed");
      captureUiError(error, "app_intel.generate");
      this.update({ error: error instanceof Error ? error.message : String(error), busy: null, run: null });
    } finally {
      recordUiTiming("ui.app_intel.generate", performance.now() - startedAt);
    }
  }

  async cancel() {
    if (this.state.busy !== "generating") return;
    this.update({ busy: "cancelling" });
    try { await this.app.callServerTool({ name: "mobile_cancel_app_intel", arguments: { projectPath: this.state.projectPath } }); }
    finally { this.update({ busy: null, run: null }); }
  }
}

