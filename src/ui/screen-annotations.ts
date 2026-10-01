import { componentAt, componentsAt, screenComponents } from "../shared/screen-annotations.ts";
import type { ScreenAnnotation, ScreenBounds, ScreenComponent, ScreenPoint } from "../shared/screen-annotations.ts";
import { recordUiTiming } from "./telemetry.ts";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { PanelContext } from "./model-context.ts";

type Capture = { screenshot: ScreenAnnotation["screenshot"]; screen: ScreenAnnotation["screen"] };
type Draft = Capture & { id: string; number: number; component: ScreenComponent; point: ScreenPoint; text: string };
export class ScreenAnnotationsStore {
  private state = {
    disabled: true, selecting: false, loading: false, busy: false, canSend: false,
    error: "", status: "", annotations: [] as ScreenAnnotation[],
    draft: undefined as Draft | undefined, hovered: undefined as ScreenComponent | undefined,
    viewport: { x: 0, y: 0, width: 0, height: 0, stageWidth: 0, stageHeight: 0 },
    capture: undefined as Capture | undefined,
    selectionBounds: undefined as ScreenBounds | undefined,
    candidates: [] as ScreenComponent[],
  };
  private listeners = new Set<() => void>();
  private simulator?: SimulatorDevice;
  private context?: PanelContext;
  private unsubscribe?: () => void;
  private components: ScreenComponent[] = [];
  private dragStart?: ScreenPoint;
  private hoverPoint?: ScreenPoint;
  private revision = 0;
  private nextNumber = 1;
  capture?: () => Capture;
  readTree?: (simulator: SimulatorDevice) => Promise<unknown>;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }

  connect(context: PanelContext) {
    this.unsubscribe?.();
    this.context = context;
    this.unsubscribe = context.subscribe(() => this.sync());
    this.sync();
  }
  private sync() {
    const annotations = this.context?.screenAnnotations.filter(item => item.simulator.udid === this.simulator?.udid) ?? [];
    this.nextNumber = Math.max(1, ...annotations.map(item => item.number + 1));
    const removedDraft = this.state.draft && this.state.annotations.some(item => item.id === this.state.draft?.id) && !annotations.some(item => item.id === this.state.draft?.id);
    const status = this.state.status === "Note saved. It will attach when this chat reconnects." && !this.context?.annotationsPending && annotations.length ? "Attached to your next chat message." : this.state.status;
    this.update({ annotations, status, canSend: !!this.context?.canSendMessage, ...(removedDraft ? { draft: undefined } : {}) });
  }
  configure(simulator: SimulatorDevice | undefined, disabled: boolean) {
    if (simulator?.udid !== this.simulator?.udid) {
      this.revision++;
      this.simulator = simulator;
      this.components = [];
      this.dragStart = undefined;
      this.hoverPoint = undefined;
      this.nextNumber = 1;
      this.update({ selecting: false, loading: false, busy: false, draft: undefined, hovered: undefined, capture: undefined, selectionBounds: undefined, candidates: [], error: "", status: "" });
      this.sync();
    }
    if (disabled !== this.state.disabled) {
      if (disabled) { this.revision++; this.cancelSelection(); this.update({ selecting: false, loading: false, busy: false, hovered: undefined }); }
      this.update({ disabled });
    }
  }
  setViewport(viewport: typeof this.state.viewport) {
    if (Object.keys(viewport).some(key => viewport[key as keyof typeof viewport] !== this.state.viewport[key as keyof typeof viewport])) this.update({ viewport });
  }
  async toggle() {
    if (this.state.selecting) { this.exit(); return; }
    if (this.state.disabled || !this.simulator || !this.capture || !this.readTree || this.state.busy) return;
    const revision = ++this.revision;
    let capture: Capture;
    try { capture = this.capture(); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); return; }
    try {
      this.components = [];
      this.hoverPoint = undefined;
      this.cancelSelection();
      this.update({ selecting: true, loading: true, capture, hovered: undefined, draft: undefined, candidates: [], error: "", status: "" });
      const tree = await this.readTree(this.simulator);
      if (revision === this.revision) {
        const startedAt = performance.now();
        this.components = screenComponents(tree);
        recordUiTiming("ui.annotations.tree_processing", performance.now() - startedAt);
      }
    } catch (error) {
      if (revision === this.revision) this.update({ error: `Could not read component names. You can still annotate a screen region. ${error instanceof Error ? error.message : String(error)}` });
    } finally { if (revision === this.revision) { this.update({ loading: false }); this.hover(this.hoverPoint); } }
  }
  exit() {
    if (this.state.busy) return;
    this.revision++;
    this.hoverPoint = undefined;
    this.cancelSelection();
    this.update({ selecting: false, loading: false, draft: undefined, hovered: undefined, candidates: [] });
  }
  hover(point?: ScreenPoint) {
    if (this.dragStart && point) { this.moveSelection(point); return; }
    this.hoverPoint = point;
    if (!this.state.selecting || this.state.draft || this.state.loading) return;
    const hovered = point ? componentAt(this.components, point, this.state.capture?.screen) : undefined;
    if (hovered !== this.state.hovered) this.update({ hovered });
  }
  select(point: ScreenPoint) {
    if (!this.state.selecting || this.state.loading || this.state.busy || this.state.draft || !this.state.capture) return;
    const component = this.component(point);
    if (!component) return;
    this.update({ draft: { ...this.state.capture, id: crypto.randomUUID(), number: this.nextNumber, point, component, text: "" }, candidates: componentsAt(this.components, point, this.state.capture.screen), hovered: undefined, status: "" });
  }
  private component(point: ScreenPoint): ScreenComponent | undefined {
    if (!this.state.capture) return;
    const { screen } = this.state.capture;
    return componentAt(this.components, point, screen) ?? { name: "Screen point", source: "screen", depth: 0, bounds: {
      x: Math.max(0, point.x - 12), y: Math.max(0, point.y - 12),
      width: Math.min(24, screen.width - Math.max(0, point.x - 12)), height: Math.min(24, screen.height - Math.max(0, point.y - 12)),
    } };
  }
  chooseComponent(component: ScreenComponent) {
    if (this.state.draft && !this.state.busy && this.state.candidates.includes(component))
      this.update({ draft: { ...this.state.draft, component } });
  }
  beginSelection(point: ScreenPoint) {
    if (!this.state.selecting || this.state.loading || this.state.busy || this.state.draft) return false;
    this.dragStart = point;
    this.update({ hovered: undefined, selectionBounds: undefined });
    return true;
  }
  moveSelection(point: ScreenPoint) {
    if (!this.dragStart || !this.state.capture) return;
    const start = this.dragStart, screen = this.state.capture.screen;
    const x = Math.max(0, Math.min(start.x, point.x, screen.width));
    const y = Math.max(0, Math.min(start.y, point.y, screen.height));
    const width = Math.min(screen.width, Math.max(start.x, point.x)) - x;
    const height = Math.min(screen.height, Math.max(start.y, point.y)) - y;
    this.update({ selectionBounds: width >= 4 && height >= 4 ? { x, y, width, height } : undefined });
  }
  endSelection(point: ScreenPoint) {
    const start = this.dragStart;
    if (!start) return;
    this.moveSelection(point);
    const bounds = this.state.selectionBounds;
    this.cancelSelection();
    if (!bounds) { this.select(start); return; }
    if (!this.state.capture || !this.state.selecting || this.state.disabled || this.state.busy) return;
    const component: ScreenComponent = { name: "Selected region", source: "screen", role: "manual-region", depth: 0, bounds };
    this.update({ draft: { ...this.state.capture, id: crypto.randomUUID(), number: this.nextNumber, point: start, component, text: "" }, candidates: [], hovered: undefined, status: "" });
  }
  cancelSelection() {
    this.dragStart = undefined;
    if (this.state.selectionBounds) this.update({ selectionBounds: undefined });
  }
  edit(annotation: ScreenAnnotation) {
    if (this.state.busy) return;
    this.update({ draft: { ...annotation }, candidates: [], hovered: undefined, error: "", status: "" });
  }
  setText(text: string) { if (this.state.draft && !this.state.busy) this.update({ draft: { ...this.state.draft, text } }); }
  closeDraft() { if (!this.state.busy) this.update({ draft: undefined }); }
  async save() {
    const draft = this.state.draft;
    if (!draft?.text.trim() || !this.simulator || !this.context || this.state.busy) return;
    const revision = this.revision;
    this.update({ busy: true, error: "" });
    try {
      const attached = await this.context.attachAnnotation({ ...draft, text: draft.text.trim(), simulator: this.simulator });
      if (revision !== this.revision) return;
      this.update({ draft: undefined, status: attached ? (this.context.annotationsPending ? "Note saved. It will attach when this chat reconnects." : "Attached to your next chat message.") : "Annotation removed from chat." });
    } catch (error) { if (revision === this.revision) this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { if (revision === this.revision) this.update({ busy: false }); }
  }
  async remove(id: string) {
    if (!this.context || this.state.busy) return;
    const revision = this.revision;
    this.update({ busy: true, error: "" });
    try { await this.context.removeAnnotation(id); if (revision === this.revision) this.update({ draft: undefined, status: "Annotation removed." }); }
    catch (error) { if (revision === this.revision) this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { if (revision === this.revision) this.update({ busy: false }); }
  }
  async send() {
    if (!this.simulator || !this.context || this.state.busy || !this.state.annotations.length) return;
    const revision = this.revision;
    this.update({ busy: true, error: "" });
    try { await this.context.sendAnnotationsToChat(this.simulator.udid); if (revision === this.revision) this.update({ status: "Annotations sent to chat." }); }
    catch (error) { if (revision === this.revision) this.update({ error: error instanceof Error ? error.message : String(error) }); }
    finally { if (revision === this.revision) this.update({ busy: false }); }
  }
  dispose() { this.revision++; this.cancelSelection(); this.unsubscribe?.(); this.context = undefined; this.capture = undefined; this.readTree = undefined; }
}

const stores = new WeakMap<HTMLElement, ScreenAnnotationsStore>();
export function bindScreenAnnotations(element: HTMLElement, store: ScreenAnnotationsStore) { stores.set(element, store); }
export function getScreenAnnotations(element: HTMLElement) {
  let store = stores.get(element);
  if (!store) { store = new ScreenAnnotationsStore(); stores.set(element, store); }
  return store;
}
