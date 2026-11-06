import { emitE2eTest, resolveSelector, stepLabel } from "@mobile-dev/shared/test-recording.ts";
import type { RecordedStep, RecordedStepKind } from "@mobile-dev/shared/test-recording.ts";
import type { ScreenBounds, ScreenComponent, ScreenPoint, ScreenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { countUiEvent, recordUiTiming } from "./telemetry.ts";

/**
 * Reads the screen the recorder is recording against. The simulator panel owns the device
 * connection, so it supplies this; the recorder never talks to the host itself.
 */
export type RecorderReader = {
  /** The accessibility tree as flat components, in the same coordinate space as `screen`. */
  readComponents: () => Promise<ScreenComponent[]>;
  /** The screen size the mirror maps pointer events into. */
  screen: () => ScreenSize;
};

export type TestRecorderSnapshot = {
  /** The udid being recorded against, or "" when nothing is recording. */
  recordingUdid: string;
  /** The next tap asserts instead of acting, and is not forwarded to the device. */
  assertMode: boolean;
  steps: RecordedStep[];
  title: string;
  /** Bumped by every change to what would be written, so the panel can tell saved from dirty. */
  revision: number;
  /** A step is being resolved: the tap is held until its tree read finishes. */
  resolving: boolean;
  /**
   * What a tap at the pointer would record, for the outline drawn over the mirror: the bounds of
   * the element the selector would name, the step it would add, and the screen those bounds are
   * in so the overlay can scale them to the canvas.
   */
  hover?: { bounds: ScreenBounds; label: string; screen: ScreenSize; ambiguous: boolean };
  error: string;
};

const DEFAULT_TITLE = "a recorded flow";
/**
 * How long a tree read stays usable. Any input invalidates it outright; this only bounds the case
 * where the app changed the screen on its own (an animation finishing, data arriving) without the
 * user touching it.
 */
const TREE_TTL_MS = 1_500;

/**
 * Records taps on the mirror as deterministic test steps.
 *
 * One recording at a time, across the whole panel: a test is a single flow on a single device, and
 * two concurrent recordings would interleave steps from two screens into one file. That is why
 * this is a module singleton rather than a per-stage store.
 */
export class TestRecorder {
  private readonly listeners = new Set<() => void>();
  private reader?: RecorderReader;
  private components: ScreenComponent[] = [];
  private componentsReadAt = 0;
  private pending?: Promise<ScreenComponent[]>;
  /** Only the newest hover may write the outline; earlier reads that land late are dropped. */
  private hoverToken = 0;
  private snapshot: TestRecorderSnapshot = {
    recordingUdid: "", assertMode: false, steps: [], title: DEFAULT_TITLE, revision: 0, resolving: false, error: "",
  };

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private update(fields: Partial<TestRecorderSnapshot>) {
    // Anything that changes the emitted source is a new revision; the controls are not.
    const changed = fields.steps !== undefined || (fields.title !== undefined && fields.title !== this.snapshot.title);
    this.snapshot = { ...this.snapshot, ...fields, ...(changed ? { revision: this.snapshot.revision + 1 } : {}) };
    for (const listener of this.listeners) listener();
  }

  /** The simulator panel hands the recorder its way of reading the device it shows. */
  attach(udid: string, reader: RecorderReader) {
    if (this.snapshot.recordingUdid && this.snapshot.recordingUdid !== udid) return;
    this.reader = reader;
    this.invalidate();
  }

  /** The panel's device went away, so nothing can be recorded from it any more. */
  detach(udid: string) {
    if (this.snapshot.recordingUdid && this.snapshot.recordingUdid !== udid) return;
    this.reader = undefined;
    this.invalidate();
    if (this.snapshot.recordingUdid) this.stop();
  }

  isRecording(udid?: string) {
    return Boolean(udid) && this.snapshot.recordingUdid === udid;
  }

  get source() { return emitE2eTest(this.snapshot.steps, { title: this.snapshot.title }); }

  start(udid: string) {
    if (!udid || !this.reader) return;
    this.invalidate();
    this.update({ recordingUdid: udid, error: "", assertMode: false, hover: undefined });
    countUiEvent("ui.testing.record_start");
  }

  stop() {
    if (!this.snapshot.recordingUdid) return;
    this.update({ recordingUdid: "", assertMode: false, resolving: false, hover: undefined });
    countUiEvent("ui.testing.record_stop");
  }

  /**
   * Previews what a tap at this point would record, so the mirror can outline it — the same
   * resolution the tap itself runs, against the same cached tree, so what is outlined is what is
   * recorded. Call with nothing when the pointer leaves.
   *
   * Hovering reads the tree when it is stale, exactly as a tap does; once warm, every move after
   * that is answered locally.
   */
  async hover(point?: ScreenPoint) {
    if (!this.snapshot.recordingUdid || !point) { if (this.snapshot.hover) this.update({ hover: undefined }); return; }
    const token = ++this.hoverToken;
    let components: ScreenComponent[];
    try { components = await this.currentComponents(); }
    catch { return; }
    // The pointer moved on, or recording stopped, while the tree was being read.
    if (token !== this.hoverToken || !this.snapshot.recordingUdid) return;
    const screen = this.reader?.screen();
    const { selector, ambiguous, component } = resolveSelector(components, point, screen);
    const bounds = component?.bounds;
    if (!bounds || !screen) { if (this.snapshot.hover) this.update({ hover: undefined }); return; }
    const label = stepLabel(this.snapshot.assertMode ? "assertVisible" : "tap", selector);
    const previous = this.snapshot.hover;
    if (previous && previous.label === label && previous.ambiguous === ambiguous
      && previous.bounds.x === bounds.x && previous.bounds.y === bounds.y
      && previous.bounds.width === bounds.width && previous.bounds.height === bounds.height) return;
    this.update({ hover: { bounds, label, screen, ambiguous } });
  }

  // The outline is labelled with the step it would add, so switching mode restates it.
  setAssertMode(assertMode: boolean) { this.update({ assertMode, hover: undefined }); }
  setTitle(title: string) { this.update({ title: title.trim() || DEFAULT_TITLE }); }
  removeStep(id: string) { this.update({ steps: this.snapshot.steps.filter(step => step.id !== id) }); }
  clearSteps() { this.update({ steps: [] }); }
  dismissError() { this.update({ error: "" }); }

  /**
   * Marks the cached tree stale. Every input changes the screen, so the panel calls this after
   * each one rather than letting a tap be named from the screen it already left.
   */
  invalidate() {
    this.hoverToken++;
    if (this.snapshot.hover) this.update({ hover: undefined });
    this.components = [];
    this.componentsReadAt = 0;
    this.pending = undefined;
  }

  private async currentComponents(): Promise<ScreenComponent[]> {
    const fresh = this.componentsReadAt > 0 && performance.now() - this.componentsReadAt < TREE_TTL_MS;
    if (fresh && this.components.length) return this.components;
    if (!this.reader) return [];
    this.pending ??= (async () => {
      const startedAt = performance.now();
      try {
        const components = await this.reader!.readComponents();
        this.components = components;
        this.componentsReadAt = performance.now();
        return components;
      } finally {
        recordUiTiming("ui.testing.tree_read", performance.now() - startedAt);
        this.pending = undefined;
      }
    })();
    return this.pending;
  }

  /**
   * Records one interaction at a point on the screen.
   *
   * The caller awaits this **before** forwarding the touch to the device: after the tap the screen
   * may be gone, and a selector resolved from the next screen names the wrong element. A fresh
   * cache answers without a round trip; a stale one costs one read on loopback.
   *
   * Returns whether the caller should still forward the touch — an assertion must not act on the
   * app, so it returns false.
   */
  async record(point: ScreenPoint, kind: RecordedStepKind = this.snapshot.assertMode ? "assertVisible" : "tap"): Promise<boolean> {
    if (!this.snapshot.recordingUdid) return true;
    this.update({ resolving: true });
    try {
      const components = await this.currentComponents();
      const screen = this.reader?.screen();
      const { selector, ambiguous } = resolveSelector(components, point, screen);
      const step: RecordedStep = {
        id: crypto.randomUUID(),
        kind,
        selector,
        label: stepLabel(kind, selector),
        ...(ambiguous ? { ambiguous } : {}),
      };
      this.update({ steps: [...this.snapshot.steps, step] });
      countUiEvent(kind === "tap" ? "ui.testing.step_tap" : "ui.testing.step_assert");
      if (selector.kind === "point") countUiEvent("ui.testing.step_unresolved");
    } catch (error) {
      // A failed read must not swallow the user's tap, so the step is dropped and the touch still
      // goes through — losing a step is recoverable, a dead mirror is not.
      this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.update({ resolving: false });
    }
    if (kind === "assertVisible") {
      // An assertion reads the screen without changing it, so the cache it just filled stays good.
      this.update({ assertMode: false });
      return false;
    }
    this.invalidate();
    return true;
  }
}

/** The one recorder. See the class comment for why there is only one. */
export const testRecorder = new TestRecorder();
