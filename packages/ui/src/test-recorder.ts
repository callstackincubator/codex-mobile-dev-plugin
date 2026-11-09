import { anchorSelector, emitE2eTest, hitLadder, resolveSelector, stepLabel, treeHealth } from "@mobile-dev/shared/test-recording.ts";
import type { RecordedStep, RecordedStepKind } from "@mobile-dev/shared/test-recording.ts";
import type { ScreenBounds, ScreenComponent, ScreenPoint, ScreenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { countUiEvent, recordUiTiming } from "./telemetry.ts";

/**
 * Reads the screen the recorder is recording against. The simulator panel owns the device
 * connection, so it supplies this; the recorder never talks to the host itself.
 */
export type RecorderReader = {
  /** The runner's element tree as flat components, in the same coordinate space as `screen`. */
  readComponents: () => Promise<ScreenComponent[]>;
  /** The screen size the mirror maps pointer events into. */
  screen: () => ScreenSize;
  /**
   * Gives the device back to whoever wants it next.
   *
   * Reading the runner's tree holds a session on the device, and the runner allows exactly one, so
   * a session left open here makes the user's next `e2e run` fail with "device is already in use"
   * — a refusal they cannot connect to anything they did. The recorder calls this on every path
   * out of recording: stop, detach, and a device that changes under it.
   */
  release?: () => void;
};

/**
 * Reads the runner's element tree for one device, and owns the session that read needs.
 *
 * The Testing panel installs this, because it is the panel that knows which e2e project and which
 * target the recording is for; the simulator panel knows the device and the screen. The recorder
 * is the one object both already share, so it is where the two halves meet.
 */
export type RecorderTreeSource = {
  read: (udid: string) => Promise<ScreenComponent[]>;
  release: () => void;
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
  hover?: {
    bounds: ScreenBounds; label: string; screen: ScreenSize; ambiguous: boolean;
    /** How far out the user has walked, and how far out they still can. */
    level: number; levels: number;
  };
  error: string;
};

const DEFAULT_TITLE = "a recorded flow";
/**
 * The runner reported no elements at all, so there is nothing a recorded step could name. It is
 * the app, not the read path: the snapshot is rooted at the application and never carries the
 * simulator's own chrome.
 */
const NO_TREE = "The app is not reporting any elements, so a recorded step would name nothing the test runner can find. Bring the app to the foreground, then record again.";
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
  /** Where the pointer is, how far out of it the user has walked, and what it was last over. */
  private hoverPoint?: ScreenPoint;
  private hoverLevel = 0;
  private hoverInnermost?: string;
  private snapshot: TestRecorderSnapshot = {
    recordingUdid: "", assertMode: false, steps: [], title: DEFAULT_TITLE, revision: 0, resolving: false, error: "",
  };

  private treeSource?: RecorderTreeSource;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  /** The Testing panel supplies the tree source; see `RecorderTreeSource`. */
  useTreeSource(source?: RecorderTreeSource) {
    if (this.treeSource === source) return;
    this.treeSource?.release();
    this.treeSource = source;
    this.invalidate();
  }

  /** What a panel's `readComponents` forwards to. Without a source there is nothing to record from. */
  readTree(udid: string): Promise<ScreenComponent[]> {
    return this.treeSource ? this.treeSource.read(udid) : Promise.resolve([]);
  }

  releaseTree() { this.treeSource?.release(); }

  private update(fields: Partial<TestRecorderSnapshot>) {
    // Anything that changes the emitted source is a new revision; the controls are not.
    const changed = fields.steps !== undefined || (fields.title !== undefined && fields.title !== this.snapshot.title);
    this.snapshot = { ...this.snapshot, ...fields, ...(changed ? { revision: this.snapshot.revision + 1 } : {}) };
    for (const listener of this.listeners) listener();
  }

  /** The simulator panel hands the recorder its way of reading the device it shows. */
  attach(udid: string, reader: RecorderReader) {
    if (this.snapshot.recordingUdid && this.snapshot.recordingUdid !== udid) return;
    // A reader being replaced held a session on whatever it was reading; hand that back first.
    if (this.reader && this.reader !== reader) this.reader.release?.();
    this.reader = reader;
    this.invalidate();
  }

  /** The panel's device went away, so nothing can be recorded from it any more. */
  detach(udid: string) {
    if (this.snapshot.recordingUdid && this.snapshot.recordingUdid !== udid) return;
    const reader = this.reader;
    this.reader = undefined;
    this.invalidate();
    // `stop` releases through the reader, which is why the reader outlives this assignment until
    // after it; with nothing recording there is still a session to give back.
    if (this.snapshot.recordingUdid) { this.reader = reader; this.stop(); this.reader = undefined; }
    else reader?.release?.();
  }

  isRecording(udid?: string) {
    return Boolean(udid) && this.snapshot.recordingUdid === udid;
  }

  get source() { return emitE2eTest(this.snapshot.steps, { title: this.snapshot.title }); }

  /**
   * Begins recording. A recording that was already saved starts a new flow rather than appending
   * to the file just written — the saved steps are still on screen, and a tap landing on the end
   * of a finished test is never what was meant.
   */
  start(udid: string, keepSteps = false) {
    if (!udid || !this.reader) return;
    this.invalidate();
    this.clearHover();
    this.update({ recordingUdid: udid, error: "", assertMode: false, ...(keepSteps ? {} : { steps: [] }) });
    countUiEvent("ui.testing.record_start");
  }

  stop() {
    if (!this.snapshot.recordingUdid) return;
    this.clearHover();
    this.update({ recordingUdid: "", assertMode: false, resolving: false });
    // The steps stay; the device does not. See `RecorderReader.release`.
    this.reader?.release?.();
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
    if (!this.snapshot.recordingUdid || !point) { this.clearHover(); return; }
    const token = ++this.hoverToken;
    let components: ScreenComponent[];
    try { components = await this.currentComponents(); }
    catch { return; }
    // The pointer moved on, or recording stopped, while the tree was being read.
    if (token !== this.hoverToken || !this.snapshot.recordingUdid) return;
    this.hoverPoint = point;
    // Walking out is anchored to one element: pointing at a different one starts again from it.
    const innermost = hitLadder(components, point, this.reader?.screen())[0]?.nodeId;
    if (innermost !== this.hoverInnermost) { this.hoverInnermost = innermost; this.hoverLevel = 0; }
    this.showHover(components);
  }

  /**
   * Walks the outline out to the enclosing element and back in, for when the element under the
   * pointer is not the one the test should name — a label inside the row, the row inside the card.
   * It re-resolves from the cached tree, so it costs nothing and stays in step with the tap.
   */
  walkHover(outwards: boolean) {
    if (!this.snapshot.recordingUdid || !this.hoverPoint) return;
    const next = this.hoverLevel + (outwards ? 1 : -1);
    const levels = this.snapshot.hover?.levels ?? 1;
    if (next < 0 || next > levels - 1) return;
    this.hoverLevel = next;
    this.showHover(this.components);
    countUiEvent("ui.testing.hover_walk");
  }

  private clearHover() {
    this.hoverPoint = undefined;
    this.hoverInnermost = undefined;
    this.hoverLevel = 0;
    if (this.snapshot.hover) this.update({ hover: undefined });
  }

  private showHover(components: ScreenComponent[]) {
    const point = this.hoverPoint;
    const screen = this.reader?.screen();
    if (!point || !screen) return;
    if (treeHealth(components) === "no-accessibility") {
      if (this.snapshot.error !== NO_TREE) this.update({ error: NO_TREE });
      if (this.snapshot.hover) this.update({ hover: undefined });
      return;
    }
    const { selector, ambiguous, component, levels } = resolveSelector(components, point, screen, this.hoverLevel);
    // Nothing under the pointer is still worth drawing: silence reads as a broken recorder, and
    // the mark is the honest answer — this is the coordinate a tap here would record.
    const bounds = component?.bounds ?? { x: point.x - 12, y: point.y - 12, width: 24, height: 24 };
    const label = stepLabel(this.snapshot.assertMode ? "assertVisible" : "tap", selector);
    const hover = { bounds, label, screen, ambiguous, level: this.hoverLevel, levels };
    const previous = this.snapshot.hover;
    if (previous && previous.label === label && previous.ambiguous === ambiguous && previous.level === hover.level
      && previous.levels === levels && previous.bounds.x === bounds.x && previous.bounds.y === bounds.y
      && previous.bounds.width === bounds.width && previous.bounds.height === bounds.height) return;
    this.update({ hover });
  }

  // The outline is labelled with the step it would add, so switching mode restates it.
  setAssertMode(assertMode: boolean) {
    this.update({ assertMode });
    if (this.hoverPoint) this.showHover(this.components);
  }
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
    this.clearHover();
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
      if (treeHealth(components) === "no-accessibility") {
        // A refused step is recoverable; a test that cannot run is not.
        countUiEvent("ui.testing.tree_empty");
        this.update({ error: NO_TREE });
        return false;
      }
      // The outline the user is looking at is the step they mean, walked-out level and all.
      const { selector, ambiguous } = resolveSelector(components, point, screen, this.hoverLevel);
      if (selector.kind === "point" && kind === "assertVisible") {
        // A coordinate is not a thing to be visible, so the step would emit nothing. Say so instead
        // of adding a step whose whole body is two comments.
        countUiEvent("ui.testing.step_unresolved");
        this.update({ error: "Nothing here can be named, so there is nothing to assert. Scroll the mirror to pick the element around it, or add a testID." });
        return false;
      }
      const step: RecordedStep = {
        id: crypto.randomUUID(),
        kind,
        selector,
        label: stepLabel(kind, selector),
        ...(ambiguous ? { ambiguous } : {}),
        // Only a coordinate tap needs one: every locator action waits for its own element.
        ...(selector.kind === "point" ? { anchor: anchorSelector(components, point) } : {}),
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
