import { componentAt, screenComponents } from "../shared/screen-annotations.ts";
import type { ScreenAnnotation, ScreenComponent, ScreenPoint } from "../shared/screen-annotations.ts";
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
  };
  private listeners = new Set<() => void>();
  private simulator?: SimulatorDevice;
  private context?: PanelContext;
  private unsubscribe?: () => void;
  private components: ScreenComponent[] = [];
  private regions: ScreenComponent[] = [];
  private hoverPoint?: ScreenPoint;
  private revision = 0;
  private nextNumber = 1;
  capture?: () => Capture;
  readTree?: (simulator: SimulatorDevice) => Promise<unknown>;
  readRegions?: (screen: Capture["screen"]) => ScreenComponent[];
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
      this.regions = [];
      this.hoverPoint = undefined;
      this.nextNumber = 1;
      this.update({ selecting: false, loading: false, busy: false, draft: undefined, hovered: undefined, capture: undefined, error: "", status: "" });
      this.sync();
    }
    if (disabled !== this.state.disabled) {
      if (disabled) { this.revision++; this.update({ selecting: false, loading: false, busy: false, hovered: undefined }); }
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
      try { this.regions = this.readRegions?.(capture.screen) ?? []; } catch { this.regions = []; }
      this.update({ selecting: true, loading: true, capture, hovered: undefined, draft: undefined, error: "", status: "" });
      const tree = await this.readTree(this.simulator);
      if (revision === this.revision) this.components = screenComponents(tree);
    } catch (error) {
      if (revision === this.revision) this.update({ error: `Could not read component names. You can still annotate a screen region. ${error instanceof Error ? error.message : String(error)}` });
    } finally { if (revision === this.revision) { this.update({ loading: false }); this.hover(this.hoverPoint); } }
  }
  exit() {
    if (this.state.busy) return;
    this.revision++;
    this.hoverPoint = undefined;
    this.update({ selecting: false, loading: false, draft: undefined, hovered: undefined });
  }
  hover(point?: ScreenPoint) {
    this.hoverPoint = point;
    if (!this.state.selecting || this.state.draft || this.state.loading) return;
    const hovered = point ? this.component(point) : undefined;
    if (hovered !== this.state.hovered) this.update({ hovered });
  }
  select(point: ScreenPoint) {
    if (!this.state.selecting || this.state.loading || this.state.busy || this.state.draft || !this.state.capture) return;
    const component = this.component(point);
    if (!component) return;
    this.update({ draft: { ...this.state.capture, id: crypto.randomUUID(), number: this.nextNumber, point, component, text: "" }, hovered: undefined, status: "" });
  }
  private component(point: ScreenPoint): ScreenComponent | undefined {
    if (!this.state.capture) return;
    const { screen } = this.state.capture;
    return componentAt(this.components, point, screen) ?? componentAt(this.regions, point, screen) ?? { name: "Screen region", source: "screen", depth: 0, bounds: {
      x: Math.max(0, point.x - 12), y: Math.max(0, point.y - 12),
      width: Math.min(24, screen.width - Math.max(0, point.x - 12)), height: Math.min(24, screen.height - Math.max(0, point.y - 12)),
    } };
  }
  edit(annotation: ScreenAnnotation) {
    if (this.state.busy) return;
    this.update({ draft: { ...annotation }, hovered: undefined, error: "", status: "" });
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
  dispose() { this.revision++; this.unsubscribe?.(); this.context = undefined; this.capture = undefined; this.readTree = undefined; this.readRegions = undefined; }
}

const stores = new WeakMap<HTMLElement, ScreenAnnotationsStore>();
export function bindScreenAnnotations(element: HTMLElement, store: ScreenAnnotationsStore) { stores.set(element, store); }
export function getScreenAnnotations(element: HTMLElement) {
  let store = stores.get(element);
  if (!store) { store = new ScreenAnnotationsStore(); stores.set(element, store); }
  return store;
}
