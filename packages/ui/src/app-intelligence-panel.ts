import type { HostBridge } from "./host-bridge.ts";
import type { AppIntelSnapshot, AppIntelStatus } from "@mobile-dev/shared/app-intelligence.ts";
import { captureUiError, countUiEvent, measureUiOperation, recordUiTiming, setUiGauge } from "./telemetry.ts";

export type AppIntelligenceState = {
  open: boolean; available: boolean; projectPath: string; snapshot: AppIntelSnapshot | null;
  run: AppIntelStatus["run"]; busy: "loading" | "picking" | "generating" | "cancelling" | "clearing" | null;
  error: string; selectedScreen: string | null;
  /** Projects the panel remembers, most recent first, so switching needs no folder picker. */
  recents: string[];
  /**
   * Boundary groups flipped away from their default fold (only the first hop opens by itself),
   * and those opened past their row cap. Both are keyed "<hop>:<boundary>".
   */
  toggled: string[]; expanded: string[];
  /**
   * The boundary whose connectors are drawn at full strength: "<hop>:<boundary>" from a header,
   * or "*:<boundary>" from a filter chip, which lights that boundary at every hop. null dims all.
   */
  litBoundary: string | null;
  /** Boundaries the Flow may draw. null means every boundary, which is what a fresh graph shows. */
  boundaries: string[] | null;
};

function resultError(result: Awaited<ReturnType<HostBridge["callServerTool"]>>) {
  return result.content?.filter(item => item.type === "text").map(item => item.text).join("\n") || "App Intelligence request failed.";
}

export class AppIntelligencePanel {
  private listeners = new Set<() => void>();
  private state: AppIntelligenceState = { open: false, available: false, projectPath: "", snapshot: null, run: null, busy: null, error: "", selectedScreen: null, recents: [], toggled: [], expanded: [], litBoundary: null, boundaries: null };
  private loadRevision = 0;
  private app: HostBridge;
  constructor(app: HostBridge) { this.app = app; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  private update(patch: Partial<AppIntelligenceState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  // A panel that already has a cached graph reloads quietly: flipping to busy:"loading" on every
  // reopen disabled the controls and reset nothing useful, since the cached graph is still valid.
  setAvailable(available: boolean) { this.update({ available }); if (available && this.state.open) void this.load(undefined, { silent: Boolean(this.state.snapshot) }); }
  show() { this.update({ open: true }); if (this.state.available) void this.load(undefined, { silent: Boolean(this.state.snapshot) }); }
  hide() { this.update({ open: false }); }
  dispose() { this.loadRevision++; this.listeners.clear(); }
  // A new root means new hops, so the folds from the old one would land on unrelated boundaries.
  selectScreen(selectedScreen: string | null) { this.update({ selectedScreen, toggled: [], expanded: [], litBoundary: null }); }
  /** `open` is what the click is asking for; the state stores only the flip from the default. */
  toggleGroup(key: string, open: boolean) {
    countUiEvent(open ? "ui.app_intel.group_expand" : "ui.app_intel.group_collapse");
    const flipped = this.state.toggled.includes(key);
    this.update({ toggled: flipped ? this.state.toggled.filter(entry => entry !== key) : [...this.state.toggled, key] });
  }
  /** Clicking the lit boundary again puts every connector back to the same dim weight. */
  litBoundaryTo(key: string | null) {
    const next = key === this.state.litBoundary ? null : key;
    if (next) countUiEvent("ui.app_intel.boundary_highlight");
    this.update({ litBoundary: next });
  }

  /** Opens one boundary past its row cap. Folding it away later also forgets that it was opened. */
  showAllIn(key: string) {
    if (this.state.expanded.includes(key)) return;
    countUiEvent("ui.app_intel.group_show_all");
    this.update({ expanded: [...this.state.expanded, key] });
  }
  setBoundaries(boundaries: string[] | null) { countUiEvent("ui.app_intel.boundary_filter"); this.update({ boundaries }); }
  toggleBoundary(boundary: string, available: readonly string[]) {
    const current = this.state.boundaries ?? available;
    const next = current.includes(boundary) ? current.filter(entry => entry !== boundary) : [...current, boundary];
    this.setBoundaries(next.length === available.length && available.every(entry => next.includes(entry)) ? null : next);
  }

  async load(projectPath?: string, { silent = false }: { silent?: boolean } = {}) {
    if (!this.state.available || this.state.busy === "generating") return;
    const revision = ++this.loadRevision;
    this.update(silent ? { error: "" } : { busy: "loading", error: "" });
    try {
      const result = await measureUiOperation("ui.app_intel.load", "ui.app_intel.load_failed", () => this.app.callServerTool({ name: "mobile_app_intel_snapshot", arguments: projectPath ? { projectPath } : {} }));
      if (revision !== this.loadRevision) return;
      // Even a failed read carries the remembered projects, so the picker still has them to offer.
      if (result.isError) { this.update({ recents: (result.structuredContent as { recents?: string[] } | undefined)?.recents ?? this.state.recents }); throw new Error(resultError(result)); }
      const value = result.structuredContent as { projectPath: string; snapshot: AppIntelSnapshot | null; recents?: string[] };
      setUiGauge("ui.app_intel.files", Object.keys(value.snapshot?.files ?? {}).length);
      setUiGauge("ui.app_intel.screens", Object.keys(value.snapshot?.screens ?? {}).length);
      const screen = value.snapshot && this.state.selectedScreen && value.snapshot.screens[this.state.selectedScreen] ? this.state.selectedScreen : null;
      this.update({ projectPath: value.projectPath, snapshot: value.snapshot, recents: value.recents ?? this.state.recents, busy: null, selectedScreen: screen });
    } catch (error) {
      if (revision !== this.loadRevision) return;
      const message = error instanceof Error ? error.message : String(error);
      this.update({ busy: null, error: /No project selected/.test(message) ? "" : message, projectPath: /No project selected/.test(message) ? "" : this.state.projectPath });
    }
  }

  async pickProject() {
    if (!this.state.available) return;
    this.loadRevision++;
    this.update({ busy: "picking", error: "" });
    try {
      const result = await measureUiOperation("ui.app_intel.pick", "ui.app_intel.pick_failed", () => this.app.callServerTool({ name: "mobile_pick_app_intel_project", arguments: {} }));
      if (result.isError) throw new Error(resultError(result));
      const value = result.structuredContent as { picked: boolean; projectPath?: string };
      if (!value.picked) { countUiEvent("ui.app_intel.pick_cancelled"); this.update({ busy: null }); return; }
      this.update({ projectPath: value.projectPath ?? "", busy: null, snapshot: null, selectedScreen: null, toggled: [], expanded: [], litBoundary: null, boundaries: null });
      await this.load(value.projectPath);
    } catch (error) { this.update({ busy: null, error: error instanceof Error ? error.message : String(error) }); captureUiError(error, "app_intel.pick"); }
  }

  /** Switches to a remembered project without reopening the host folder picker. */
  async selectProject(projectPath: string) {
    if (!this.state.available || projectPath === this.state.projectPath) return;
    this.loadRevision++;
    this.update({ busy: "picking", error: "", snapshot: null, selectedScreen: null, toggled: [], expanded: [], litBoundary: null, boundaries: null });
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
    this.loadRevision++;
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

  /** Throws the saved graph away and leaves the project selected, ready to generate again. */
  async clear() {
    if (!this.state.available || !this.state.projectPath || this.state.busy !== null) return;
    this.loadRevision++;
    this.update({ busy: "clearing", error: "" });
    try {
      const result = await this.app.callServerTool({ name: "mobile_clear_app_intel", arguments: { projectPath: this.state.projectPath } });
      if (result.isError) throw new Error(resultError(result));
      countUiEvent("ui.app_intel.clear");
      this.update({ busy: null, snapshot: null, selectedScreen: null, toggled: [], expanded: [], litBoundary: null, boundaries: null });
    } catch (error) { this.update({ busy: null, error: error instanceof Error ? error.message : String(error) }); captureUiError(error, "app_intel.clear"); }
  }

  async cancel() {
    if (this.state.busy !== "generating") return;
    this.update({ busy: "cancelling" });
    try { await this.app.callServerTool({ name: "mobile_cancel_app_intel", arguments: { projectPath: this.state.projectPath } }); }
    finally { this.update({ busy: null, run: null }); }
  }
}

