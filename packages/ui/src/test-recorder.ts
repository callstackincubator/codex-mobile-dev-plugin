import { anchorSelector, emitE2eTestLines, hitLadder, resolveSelector, stepEffect, stepLabel, stepOffers, treeHealth } from "@mobile-dev/shared/test-recording.ts";
import type { RecordedStep, RecordedStepKind, StepOffer } from "@mobile-dev/shared/test-recording.ts";
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
   * Drives the device for a step the menu just recorded.
   *
   * A step that is recorded but never taken leaves the app on the screen before it, so the next
   * row is resolved against a screen the test will not be on. The recorder does not touch the
   * device itself — the simulator panel owns the stream — so it asks.
   */
  perform?: (action: { kind: "tap"; point: ScreenPoint } | { kind: "type"; text: string }) => void;
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

/** What a run marks one line of the preview with. */
export type RunLineMark = "running" | "passed" | "failed";

/**
 * A run, as the preview shows it.
 *
 * The marks are keyed by 1-based line rather than by step because that is what the runner's report
 * gives: every step it executed carries the line it came from. `state` is the file's own verdict.
 */
export type TestRunView = {
  state: "running" | "passed" | "failed";
  lines: Record<number, RunLineMark>;
  /** The first failure's message, from the report, for the line that failed. */
  error?: string;
  /** The runner said nothing a line could be marked with — its own output is the explanation. */
  output?: string;
  /** A passing run's marks are on their way out; the CSS honours `prefers-reduced-motion`. */
  fading?: boolean;
};

export type TestRecorderSnapshot = {
  /** The udid being recorded against, or "" when nothing is recording. */
  recordingUdid: string;
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
  /**
   * The element menu a right-click opened: what the runner can do with the element the outline is
   * on, each row carrying the code it would add. Walking the outline out with the wheel and then
   * right-clicking acts on the element the outline shows, which is why the menu resolves at the
   * hover level rather than from the innermost hit.
   */
  menu?: {
    label: string;
    ambiguous: boolean;
    /** How many elements the offered selector matches; 1 unless the menu is flagged. */
    matches: number;
    offers: StepOffer[];
    /**
     * The element's own rectangle, and the screen it is in. The menu carries its own anchor rather
     * than borrowing the outline's: a hover is dropped by anything that invalidates the tree, and a
     * menu the user explicitly asked for must not vanish with it.
     */
    bounds: ScreenBounds;
    screen: ScreenSize;
  };
  run?: TestRunView;
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
/** How long a passing run's checkmarks stay before they start to go, and how long going takes. */
const HOLD_MS = 2_500;
const FADE_MS = 600;

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
  /** Where the open element menu resolved from, so a chosen row records the same element. */
  private menuPoint?: ScreenPoint;
  /** A menu is being resolved. Set before the tree read, because the race is during it. */
  private menuOpening = false;
  /**
   * The menu's own concurrency, separate from the hover's.
   *
   * A hover that lands late must not draw over the element the user right-clicked, and — the bug
   * this separation fixes — anything that bumps the *hover* token while the menu is reading must
   * not silently drop the menu. A pointer move, an input that invalidates the tree, a frame: the
   * recorder has several reasons to invalidate a hover and none of them are a reason to cancel a
   * menu the user asked for. Only another `openMenu` or a `closeMenu` cancels this one.
   */
  private menuToken = 0;
  private fadeTimer?: ReturnType<typeof setTimeout>;
  /** The centre of the element the last step named, which is where its action lands. */
  private lastTarget?: ScreenPoint;
  private snapshot: TestRecorderSnapshot = {
    recordingUdid: "", steps: [], title: DEFAULT_TITLE, revision: 0, resolving: false, error: "",
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
    // The panel re-attaches whenever it refreshes its device list, which is every few seconds.
    // Invalidating on each of those threw the cached tree away — and with it, through
    // `clearHover`, the outline and any open element menu, about a second after they appeared.
    // Only a reader that actually changed is a reason to read the screen again.
    if (this.reader === reader) return;
    // A reader being replaced held a session on whatever it was reading; hand that back first.
    if (this.reader) this.reader.release?.();
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

  get source() { return this.emitted.source; }

  /**
   * Begins recording. A recording that was already saved starts a new flow rather than appending
   * to the file just written — the saved steps are still on screen, and a tap landing on the end
   * of a finished test is never what was meant.
   */
  start(udid: string, keepSteps = false) {
    if (!udid || !this.reader) return;
    this.invalidate();
    this.clearHover();
    this.update({ recordingUdid: udid, error: "", menu: undefined, ...(keepSteps ? {} : { steps: [] }) });
    countUiEvent("ui.testing.record_start");
  }

  stop() {
    if (!this.snapshot.recordingUdid) return;
    this.clearHover();
    this.update({ recordingUdid: "", resolving: false, menu: undefined });
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
    // An open menu owns the outline: it is about one element, and following the pointer would move
    // the menu off the element whose steps it is listing. `menuOpening` covers the read the menu is
    // waiting on — a browser sends a pointermove after the right-click, and a hover landing in that
    // window would invalidate the menu's own token and silently drop it.
    if (this.snapshot.menu || this.menuOpening) return;
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
    // An open menu is about the element the outline shows, so walking the outline re-asks what can
    // be done with the element it has walked to.
    if (this.snapshot.menu) this.showMenu(this.components);
    countUiEvent("ui.testing.hover_walk");
  }

  private clearHover() {
    this.hoverPoint = undefined;
    this.menuPoint = undefined;
    this.menuToken++;
    this.hoverInnermost = undefined;
    this.hoverLevel = 0;
    // A menu resolved from a tree that is going is a menu about a screen that has gone.
    if (this.snapshot.hover || this.snapshot.menu) this.update({ hover: undefined, menu: undefined });
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
    const label = stepLabel("tap", selector);
    const hover = { bounds, label, screen, ambiguous, level: this.hoverLevel, levels };
    const previous = this.snapshot.hover;
    if (previous && previous.label === label && previous.ambiguous === ambiguous && previous.level === hover.level
      && previous.levels === levels && previous.bounds.x === bounds.x && previous.bounds.y === bounds.y
      && previous.bounds.width === bounds.width && previous.bounds.height === bounds.height) return;
    this.update({ hover });
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
   * Appends one step for the element the outline is on. Shared by the tap path and the element
   * menu, so a step means the same thing however it was asked for.
   *
   * Returns whether a step was added; a refusal has already said why.
   */
  private addStep(components: ScreenComponent[], point: ScreenPoint, kind: RecordedStepKind, value?: string): boolean {
    const screen = this.reader?.screen();
    // The outline the user is looking at is the step they mean, walked-out level and all.
    const { selector, ambiguous } = resolveSelector(components, point, screen, this.hoverLevel);
    if (selector.kind === "point" && kind !== "tap") {
      // A coordinate is not a thing to be visible, to hold text or to be scrolled to, so the step
      // would emit nothing. Say so instead of adding a step whose whole body is two comments.
      countUiEvent("ui.testing.step_unresolved");
      this.update({ error: "Nothing here can be named, so there is nothing to act on but the coordinate. Scroll the mirror to pick the element around it, or add a testID." });
      return false;
    }
    const step: RecordedStep = {
      id: crypto.randomUUID(),
      kind,
      selector,
      label: stepLabel(kind, selector, value),
      ...(value === undefined ? {} : { value }),
      ...(ambiguous ? { ambiguous } : {}),
      // Only a coordinate tap needs one: every locator action waits for its own element.
      ...(selector.kind === "point" ? { anchor: anchorSelector(components, point) } : {}),
    };
    // Where the runner's own locator action would land, for `chooseOffer` to act on.
    const owner = resolveSelector(components, point, screen, this.hoverLevel).component;
    this.lastTarget = owner
      ? { x: owner.bounds.x + owner.bounds.width / 2, y: owner.bounds.y + owner.bounds.height / 2 }
      : point;
    this.update({ steps: [...this.snapshot.steps, step] });
    countUiEvent(kind === "tap" ? "ui.testing.step_tap" : kind === "assertVisible" || kind === "assertText" ? "ui.testing.step_assert" : "ui.testing.step_action");
    if (selector.kind === "point") countUiEvent("ui.testing.step_unresolved");
    return true;
  }

  /**
   * Opens the element menu over the mirror: what the runner can do with the element the outline is
   * currently on, each row showing the code the step would add.
   *
   * It resolves from the same cached tree and the same walked-out level as the outline, so the
   * menu is about the element the user can see outlined — including one they walked out to with
   * the wheel — rather than whatever happens to be innermost under the pointer.
   */
  async openMenu(point: ScreenPoint) {
    if (!this.snapshot.recordingUdid) return;
    const token = ++this.menuToken;
    let components: ScreenComponent[];
    this.menuOpening = true;
    this.update({ resolving: true });
    try { components = await this.currentComponents(); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); return; }
    finally { this.menuOpening = false; this.update({ resolving: false }); }
    if (token !== this.menuToken || !this.snapshot.recordingUdid) return;
    // The menu owns the outline from here, so a hover still in flight cannot move it.
    this.hoverToken++;
    if (treeHealth(components) === "no-accessibility") { this.update({ error: NO_TREE }); return; }
    // The right-click is also a hover: it is where the user is pointing, and the outline follows it.
    this.hoverPoint = point;
    const innermost = hitLadder(components, point, this.reader?.screen())[0]?.nodeId;
    if (innermost !== this.hoverInnermost) { this.hoverInnermost = innermost; this.hoverLevel = 0; }
    this.showHover(components);
    this.menuPoint = point;
    this.showMenu(components);
    countUiEvent("ui.testing.menu_open");
  }

  /** The menu for the element the outline currently shows, resolved from the cached tree. */
  private showMenu(components: ScreenComponent[]) {
    const point = this.menuPoint;
    const screen = this.reader?.screen();
    if (!point || !screen) return;
    const { selector, ambiguous, component, matches } = resolveSelector(components, point, screen, this.hoverLevel);
    // Nothing resolved is still somewhere: the menu marks the coordinate a tap here would record.
    const bounds = component?.bounds ?? { x: point.x - 12, y: point.y - 12, width: 24, height: 24 };
    this.update({ menu: { label: stepLabel("tap", selector), ambiguous, matches, offers: stepOffers(selector, component), bounds, screen } });
  }

  closeMenu() {
    this.menuOpening = false;
    this.menuToken++;
    if (this.snapshot.menu) this.update({ menu: undefined });
  }

  /**
   * Records the step a menu row stands for. Nothing is sent to the device: the menu is how a user
   * records an assertion, a scroll or a typed value without the tap that would change the screen
   * out from under it.
   */
  async chooseOffer(kind: RecordedStepKind, value?: string) {
    const point = this.menuPoint;
    this.update({ menu: undefined });
    if (!point || !this.snapshot.recordingUdid) return;
    this.update({ resolving: true });
    try {
      const components = await this.currentComponents();
      if (treeHealth(components) === "no-accessibility") { this.update({ error: NO_TREE }); return; }
      const added = this.addStep(components, point, kind, value);
      if (!added) return;
      // The step is taken as well as recorded, so the app is on the screen the next step will be
      // resolved against. `where` is the element's own centre, which is where the runner's locator
      // action lands — not the pixel the user happened to right-click.
      const effect = stepEffect(kind);
      const where = this.lastTarget ?? point;
      if (effect === "tap") this.reader?.perform?.({ kind: "tap", point: where });
      else if (effect === "type") {
        this.reader?.perform?.({ kind: "tap", point: where });
        this.reader?.perform?.({ kind: "type", text: value ?? "" });
      }
      // Anything that touched the app leaves a screen the cached tree no longer describes.
      if (effect !== "none") this.invalidate();
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.update({ resolving: false });
    }
  }

  /** The emitted file and where each step's lines are in it. See `emitE2eTestLines`. */
  get emitted() { return emitE2eTestLines(this.snapshot.steps, { title: this.snapshot.title }); }

  /**
   * A run has started. Every call line goes to `running` together, because that is as much as the
   * command line honestly tells us while the runner works — see `packages/core/src/testing-run.ts`
   * for why there is no per-step stream to follow.
   */
  beginRun() {
    if (this.fadeTimer !== undefined) { clearTimeout(this.fadeTimer); this.fadeTimer = undefined; }
    this.update({ run: { state: "running", lines: {} } });
  }

  /**
   * One batch of the runner's live progress, mapped onto lines.
   *
   * A `step` event has no source position — only the finished report does — but it has the step's
   * index within its test, and the runner reports one step per awaited call in order, so the index
   * is the position in `EmittedTest.calls`. A step that has started is running; one that has ended
   * takes its own status. The report reconciles all of it at the end.
   */
  applyRunProgress(entries: readonly { stepIndex: number; phase: "start" | "end"; status?: string; error?: string }[]) {
    const run = this.snapshot.run;
    if (!run || run.state !== "running") return;
    const calls = this.emitted.calls;
    const lines: Record<number, RunLineMark> = {};
    let error: string | undefined;
    for (const entry of entries) {
      const line = calls[entry.stepIndex];
      if (line === undefined) continue;
      if (entry.phase === "start") { lines[line] = "running"; continue; }
      const mark: RunLineMark = entry.status === "failed" || entry.status === "timedOut" ? "failed" : "passed";
      lines[line] = mark;
      if (mark === "failed" && !error) error = entry.error ?? `${entry.status} at line ${line}`;
    }
    const same = Object.keys(lines).length === Object.keys(run.lines).length
      && Object.entries(lines).every(([line, mark]) => run.lines[Number(line)] === mark);
    if (same && error === run.error) return;
    this.update({ run: { ...run, lines, ...(error ? { error } : {}) } });
  }

  /**
   * The run is over: each line takes the status the report gave it, and a line the runner never
   * reached loses its mark rather than keeping a spinner that will never resolve.
   *
   * A passing run holds its checkmarks briefly and then fades them, so the preview goes back to
   * being the test rather than a scoreboard. A failure stays until the next run.
   */
  finishRun(result: { status: string; steps: { line: number; status: string; error?: string }[]; output?: string }) {
    // A fade left over from the previous run would take this run's marks with it.
    if (this.fadeTimer !== undefined) { clearTimeout(this.fadeTimer); this.fadeTimer = undefined; }
    const lines: Record<number, RunLineMark> = {};
    let error: string | undefined;
    for (const step of result.steps) {
      const mark: RunLineMark = step.status === "passed" ? "passed" : step.status === "failed" || step.status === "timedOut" ? "failed" : "passed";
      // A retried line reports more than once; a failure is the one worth keeping.
      if (lines[step.line] === "failed") continue;
      lines[step.line] = mark;
      if (mark === "failed" && !error) error = step.error ?? `${step.status} at line ${step.line}`;
    }
    const passed = result.status === "passed" && error === undefined;
    this.update({ run: { state: passed ? "passed" : "failed", lines,
      ...(error ? { error } : {}), ...(result.output ? { output: result.output } : {}) } });
    if (!passed) return;
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = undefined;
      if (this.snapshot.run?.state !== "passed") return;
      this.update({ run: { ...this.snapshot.run, fading: true } });
      this.fadeTimer = setTimeout(() => { this.fadeTimer = undefined; this.clearRun(); }, FADE_MS);
    }, HOLD_MS);
  }

  /** The run failed to start at all, or the user cleared it. */
  failRun(error: string) { this.update({ run: { state: "failed", lines: {}, error } }); }
  clearRun() {
    if (this.fadeTimer !== undefined) { clearTimeout(this.fadeTimer); this.fadeTimer = undefined; }
    if (this.snapshot.run) this.update({ run: undefined });
  }
}

/** The one recorder. See the class comment for why there is only one. */
export const testRecorder = new TestRecorder();
