import { agentStepLabel, allStepOffers, anchorSelector, emitE2eTest, emitE2eTestLines, hitLadder, isAgentStep, resolveSelector, stepEffect, stepIsAssertion, stepLabel, stepNeedsValue, stepOffers, swipeDirection, swipePath, treeHealth } from "@mobile-dev/shared/test-recording.ts";
import type { AgentParams, AgentStep, AgentStepKind, PinnedStep, PinnedStepKind, RecordedStep, StepOffer, StepTarget, SwipeDirection, VisionMode } from "@mobile-dev/shared/test-recording.ts";
import type { ScreenBounds, ScreenComponent, ScreenPoint, ScreenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { countUiEvent, recordUiTiming, setUiGauge } from "./telemetry.ts";

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
  perform?: (action:
    | { kind: "tap"; point: ScreenPoint }
    | { kind: "type"; text: string }
    // Start and end in screen space, as every other point here is; the panel's own stream carries
    // a swipe, so the gesture a recorded step emits is one the mirror can also take.
    | { kind: "swipe"; from: ScreenPoint; to: ScreenPoint }) => void;
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

/**
 * The `app.open()` the emitter writes above the steps, as Play until here names it.
 *
 * It is not one of the recorded steps — it is the header's own call — so it has no step id to go
 * by, and this stands in for one. It is not a UUID, which is what `crypto.randomUUID` gives every
 * recorded step, so it can never be mistaken for one of them.
 */
export const OPEN_STEP = "app:open";

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
  /**
   * How long the run took, from the report. Not the panel's own `ui.testing.run` timing, which
   * brackets the whole call including spawning the CLI; see `reportDuration`.
   */
  durationMs?: number;
  /**
   * The passing ticks are on their way out; the CSS honours `prefers-reduced-motion`. Only they
   * fade — a failing mark is the one thing a failed run leaves behind to look at.
   */
  fading?: boolean;
  /**
   * The run was a Play until here: it ran the flow only as far as this line, so the lines below it
   * were never reached. A verdict about part of a test must not read as a verdict about the test.
   */
  untilLine?: number;
  /**
   * The steps changed after the run, so the line marks have been dropped: they were claims about
   * lines that have since moved. The verdict and the duration stay — they are facts about a run
   * that happened, and they do not stop being true because the next flow is being written.
   */
  stale?: true;
};

export type TestRecorderSnapshot = {
  /** The udid being recorded against, or "" when nothing is recording. */
  recordingUdid: string;
  /**
   * The udid an *agent* is recording against, or "" when the user owns the flow.
   *
   * The steps, the preview, the emitter and Save are the same ones either way — this is
   * deliberately not a second state machine — so the only thing this answers is who is driving.
   * The mirror's input is locked while it is set, because the agent and the user must not both be
   * acting on one screen, and the panel draws its banner from it.
   */
  agentUdid: string;
  steps: RecordedStep[];
  title: string;
  /** Bumped by every change to what would be written, so the panel can tell saved from dirty. */
  revision: number;
  /**
   * Which flow the step list *is*, as opposed to how many times it has changed.
   *
   * A new one is minted whenever the list stops being the same recording — Record on a flow the
   * user did not choose to resume, Clear, a kept recording reopened, an agent session beginning.
   * `revision` cannot answer this: it moves for an edit and for a brand new flow alike, and the
   * panel has to tell those apart or it keeps writing one recording over another's file. See
   * `TestingPanel.keepDraft`.
   */
  flowId: string;
  /** A step is being resolved: the tap is held until its tree read finishes. */
  resolving: boolean;
  /**
   * Recording has been asked for but the screen cannot be named yet.
   *
   * Pressing Record arms the recorder immediately, but nothing on the mirror can be selected until
   * the runner's element tree has been read — attaching to the app and projecting the tree takes a
   * second or two — and until this existed the panel said "Record" and then ignored the first few
   * seconds of pointing, with nothing on screen to say why. `start` now warms the tree itself and
   * holds this until that read lands, which is the moment selection actually works.
   */
  preparing: boolean;
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
   * on, each row carrying the action and emitted code it represents. Walking the outline out with the wheel and then
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
     * Every step the runner can express for the same element, for the menu's "all commands" list.
     * The short list above is what most steps are; this is the rest of the runner's surface, so a
     * step it has — an element that should be *gone*, a field's value, a disabled button — does
     * not need the user to leave the panel and write the line themselves.
     */
    commands: StepOffer[];
    /**
     * What the element carries, for the Agentic rows to write their first draft out of. The
     * instruction is free text the user edits and the runner resolves itself, so this only ever
     * saves them typing; see `agentActSuggestion`.
     */
    target?: StepTarget;
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

/**
 * How long a passing tick stays before it starts to go, and how long going takes.
 *
 * The ticks go and the verdict stays. Once a run has passed, a column of green beside every line
 * says nothing the chip above the preview does not, and it buries the code the user came back to
 * read; the chip and the duration are the part worth keeping on screen. A failing mark is the
 * exception in both directions: it is the one thing that says *where*, so it never fades.
 */
const HOLD_MS = 2_500;
const FADE_MS = 600;

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
/** A fresh flow identity. Not a step id and never emitted: it only ever leaves the panel's memory. */
function newFlowId(): string {
  return crypto.randomUUID();
}

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
  /** The centre of the element the last step named, which is where its action lands. */
  private lastTarget?: ScreenPoint;
  /** That element's rectangle, which is the box a scoped swipe is drawn inside. */
  private lastBounds?: ScreenBounds;
  private snapshot: TestRecorderSnapshot = {
    recordingUdid: "", agentUdid: "", steps: [], title: DEFAULT_TITLE, revision: 0, flowId: newFlowId(), resolving: false, preparing: false, error: "",
  };

  private fadeTimer?: ReturnType<typeof setTimeout>;

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
    // A run's marks are tied to lines of the file as it was emitted, so the first edit to the
    // steps — recorded, deleted, dragged, duplicated, re-pointed — moves the lines out from under
    // them. They go; the verdict and the duration stay, because those are about a run that did
    // happen and the user is often reading them while writing the next step. Clearing the whole
    // run here would also make `start()`'s own clear indistinguishable from an edit.
    const run = fields.run === undefined && fields.steps !== undefined && this.snapshot.run
      && this.snapshot.run.state !== "running" && Object.keys(this.snapshot.run.lines).length > 0
      ? { run: { ...this.snapshot.run, lines: {}, stale: true as const } }
      : {};
    this.snapshot = { ...this.snapshot, ...fields, ...run, ...(changed ? { revision: this.snapshot.revision + 1 } : {}) };
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

  /**
   * Whether an agent is recording, so the mirror's own input is locked.
   *
   * Two drivers on one screen is solved by locking, not by hoping: a tap the user lands between
   * the agent's read and its step resolves the step against a screen that has already moved.
   */
  isAgentRecording(udid?: string) {
    return this.snapshot.agentUdid !== "" && (udid === undefined || this.snapshot.agentUdid === udid);
  }

  /**
   * Takes the steps of an agent recording the server holds, as they arrive.
   *
   * `recordingUdid` is set for the agent's device, so the step list, the preview, editing,
   * duplication and Save all work exactly as they do for a recording the user tapped out: an
   * agent-recorded flow is an ordinary unsaved recording that happened to be written by something
   * else. The steps replace rather than append — the server holds the whole flow, and reconciling
   * two lists would be a second source of truth.
   */
  adoptAgentRecording(udid: string, steps: readonly RecordedStep[], title?: string) {
    if (!udid) return;
    const startedAt = performance.now();
    const added = Math.max(0, steps.length - this.snapshot.steps.length);
    const began = this.snapshot.agentUdid !== udid;
    if (began) {
      this.clearHover();
      this.clearRun();
      countUiEvent("ui.testing.agent_session_start");
    }
    const sameSteps = steps.length === this.snapshot.steps.length
      && steps.every((step, index) => step.id === this.snapshot.steps[index]?.id);
    if (!began && sameSteps && (title === undefined || title === this.snapshot.title)) return;
    this.update({
      agentUdid: udid, recordingUdid: udid, error: "", menu: undefined,
      steps: [...steps],
      ...(began ? { flowId: newFlowId() } : {}),
      ...(title ? { title } : {}),
    });
    // Counted as steps, never as what they say: an element's name and the goal sentence are the
    // user's own content and are not sent. See docs/telemetry.md.
    for (let index = 0; index < added; index += 1) countUiEvent("ui.testing.agent_step_adopted");
    recordUiTiming("ui.testing.agent_adopt", performance.now() - startedAt);
  }

  /**
   * The agent is done. The steps stay, dirty, and the flow is an ordinary unsaved recording from
   * here — so this stops the recorder exactly as the Stop button does, device release included.
   * Leaving it armed would turn the user's next tap on the mirror into a step the agent never
   * recorded, and leaving the session open is the leak `TestingDevices.release` exists to stop.
   */
  endAgentRecording(reason: "finished" | "aborted") {
    if (!this.snapshot.agentUdid) return;
    this.update({ agentUdid: "" });
    this.stop();
    if (reason === "aborted") countUiEvent("ui.testing.agent_session_abort");
  }

  get source() { return this.emitted.source; }

  /**
   * Begins recording. A recording that was already saved starts a new flow rather than appending
   * to the file just written — the saved steps are still on screen, and a tap landing on the end
   * of a finished test is never what was meant.
   */
  start(udid: string, keepSteps = false) {
    if (!udid || !this.reader || this.snapshot.agentUdid) return;
    const had = this.snapshot.steps.length > 0;
    this.invalidate();
    this.clearHover();
    // A run's marks are a verdict on the file as it was. Resuming adds steps that verdict never
    // covered and starting again replaces the file entirely, so either way the overlay would be
    // marking lines of something else — and a passing run's marks are mid-fade besides.
    this.clearRun();
    // A flow that is not being resumed is a different recording, however much of the old one is
    // still on screen a moment before. Anything holding on to the last flow — the panel's kept
    // draft above all — has to be told, or the next thing written lands on the wrong one.
    this.update({ recordingUdid: udid, error: "", menu: undefined, preparing: true, ...(keepSteps ? {} : { steps: [], flowId: newFlowId() }) });
    countUiEvent("ui.testing.record_start");
    // The first tree read is what makes an element selectable, and it is the slow part: the
    // session attaches to the app and the tree is projected before anything can be named. Warming
    // it here rather than on the first hover means the wait happens once, while the overlay is
    // saying so, instead of silently under the user's first few clicks.
    void this.prepare(udid);
    // Which way the user answered, counted only where there was a question to answer. It says
    // whether the choice is carrying its weight; nothing about the flow itself is sent.
    if (had) countUiEvent(keepSteps ? "ui.testing.record_resume" : "ui.testing.record_new");
  }

  /**
   * Reads the screen once so the first hover or right-click is answered locally.
   *
   * Measured as its own timing: how long Record is unusable for is a number the panel is judged on,
   * and it is not the same as `ui.testing.tree_read`, which also covers the warm reads during a
   * recording. A read that fails leaves `preparing` false — the overlay must never outlive the
   * thing it is explaining — and the next hover retries as it always did.
   */
  private async prepare(udid: string): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.currentComponents();
    } catch {
      // Silent: a failed warm read is not an error the user asked for. The first hover says so.
    } finally {
      recordUiTiming("ui.testing.record_prepare", performance.now() - startedAt);
      // Only the recording this prepared for: Stop, or a second Record, owns the flag after that.
      if (this.snapshot.preparing && this.snapshot.recordingUdid === udid) this.update({ preparing: false });
    }
  }

  stop() {
    if (!this.snapshot.recordingUdid) return;
    this.clearHover();
    this.update({ recordingUdid: "", agentUdid: "", resolving: false, preparing: false, menu: undefined });
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

  /**
   * Puts a kept recording back in the panel, without arming the recorder.
   *
   * The flow comes back as steps rather than as the file it would emit, so it is still editable:
   * the generated source is an output and nothing reads it back. Nothing starts recording — the
   * user reopened a flow to look at it, and a tap on the mirror a moment later must not append to
   * it — and any run marks go, because they were a verdict on whatever was in the list before.
   */
  restore(steps: readonly RecordedStep[], title?: string) {
    if (this.snapshot.agentUdid) return;
    this.clearHover();
    this.clearRun();
    this.update({
      recordingUdid: "", resolving: false, preparing: false, error: "", menu: undefined,
      steps: [...steps], flowId: newFlowId(), ...(title ? { title } : {}),
    });
    countUiEvent("ui.testing.draft_restore");
  }

  setTitle(title: string) { this.update({ title: title.trim() || DEFAULT_TITLE }); }
  removeStep(id: string) { this.update({ steps: this.snapshot.steps.filter(step => step.id !== id) }); }
  clearSteps() { this.update({ steps: [], flowId: newFlowId() }); }

  /**
   * Appends a copy of one step at the end of the list.
   *
   * At the end rather than beside the original: a recorded flow is read top to bottom, and the
   * step being copied is almost always one the user wants to repeat *after* what follows it —
   * tapping the same disclosure again to collapse it, asserting the same row twice. Dragging it
   * into place is the other half of this, and it is cheaper than deciding for them.
   */
  duplicateStep(id: string) {
    const step = this.snapshot.steps.find(entry => entry.id === id);
    if (!step) return;
    this.update({ steps: [...this.snapshot.steps, { ...step, id: crypto.randomUUID() }] });
    countUiEvent("ui.testing.step_duplicate");
  }

  /**
   * Swaps what a step does while keeping the element it named.
   *
   * The selector is the expensive half of a step — it was resolved against a screen that has since
   * moved on — so changing the command must not cost the user that screen. Nothing is sent to the
   * device: the flow has already run past this point, and re-taking a step out of order would
   * leave the app somewhere the rest of the list does not describe.
   */
  changeStepCommand(id: string, kind: PinnedStepKind, value?: string) {
    const steps: RecordedStep[] = this.snapshot.steps.map(step => {
      // An agent step has no selector to keep, which is the whole reason this is offered: the
      // mirror's Agentic branch records one, and nothing converts between the two shapes.
      if (step.id !== id || isAgentStep(step)) return step;
      // A kind that carries no text drops the old one rather than keeping a value nothing emits.
      const next = stepNeedsValue(kind) ? value ?? step.value ?? "" : undefined;
      // Both of the optional halves go, so a step never keeps the other command's leftovers: no
      // text on a kind that emits none, no direction on a kind that is not a swipe.
      const { value: _dropped, direction: _wasSwipe, ...rest } = step;
      return {
        ...rest,
        kind,
        label: stepLabel(kind, step.selector, next),
        ...(kind === "swipe" ? { direction: swipeDirection(value) } : next === undefined ? {} : { value: next }),
      };
    });
    if (steps.every((step, index) => step === this.snapshot.steps[index])) return;
    this.update({ steps });
    countUiEvent(stepIsAssertion(kind) ? "ui.testing.step_recommand_assert" : "ui.testing.step_recommand_action");
  }

  /**
   * Moves a step to another position in the list, which is the order the file is emitted in.
   *
   * Everything derived from position — the numbering, the preview, the lines a run marks — is
   * recomputed from `steps`, so the move is the whole change.
   */
  moveStep(id: string, toIndex: number) {
    const from = this.snapshot.steps.findIndex(step => step.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(this.snapshot.steps.length - 1, toIndex));
    if (to === from) return;
    const steps = [...this.snapshot.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved!);
    this.update({ steps });
    countUiEvent("ui.testing.step_reorder");
  }
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
  private addStep(components: ScreenComponent[], point: ScreenPoint, kind: PinnedStepKind, value?: string): boolean {
    const screen = this.reader?.screen();
    // The outline the user is looking at is the step they mean, walked-out level and all.
    const { selector, ambiguous, component: named } = resolveSelector(components, point, screen, this.hoverLevel);
    const target = named && { ...(named.role === undefined ? {} : { role: named.role }), ...(named.placeholder === undefined ? {} : { placeholder: named.placeholder }), ...(named.label === undefined ? {} : { label: named.label }), ...(named.text === undefined ? {} : { text: named.text }), ...(named.value === undefined ? {} : { value: named.value }) };
    // A coordinate has no element, so most commands would emit nothing — but a tap lands on it and
    // `screen.swipe` is about the viewport rather than about anything in it, so both go through.
    if (selector.kind === "point" && kind !== "tap" && kind !== "swipe") {
      // A coordinate is not a thing to be visible, to hold text or to be scrolled to, so the step
      // would emit nothing. Say so instead of adding a step whose whole body is two comments.
      countUiEvent("ui.testing.step_unresolved");
      this.update({ error: "Nothing here can be named, so there is nothing to act on but the coordinate. Scroll the mirror to pick the element around it, or add a testID." });
      return false;
    }
    const step: PinnedStep = {
      id: crypto.randomUUID(),
      kind,
      selector,
      label: stepLabel(kind, selector, value),
      ...(kind === "swipe" ? { direction: swipeDirection(value) } : value === undefined ? {} : { value }),
      ...(ambiguous ? { ambiguous } : {}),
      // Only a coordinate tap needs one: every locator action waits for its own element.
      ...(selector.kind === "point" ? { anchor: anchorSelector(components, point, screen) } : {}),
      // Kept so the step list can offer the same commands later; see `RecordedStep.target`.
      ...(target ? { target } : {}),
    };
    // Where the runner's own locator action would land, for `chooseOffer` to act on.
    const owner = resolveSelector(components, point, screen, this.hoverLevel).component;
    // A locator swipe is scoped to the element, a viewport swipe to the screen; `undefined` here
    // is what makes `chooseOffer` fall back to the whole screen.
    this.lastBounds = selector.kind === "point" ? undefined : owner?.bounds;
    this.lastTarget = owner
      ? { x: owner.bounds.x + owner.bounds.width / 2, y: owner.bounds.y + owner.bounds.height / 2 }
      : point;
    this.update({ steps: [...this.snapshot.steps, step] });
    countUiEvent(kind === "tap" ? "ui.testing.step_tap" : stepIsAssertion(kind) ? "ui.testing.step_assert" : "ui.testing.step_action");
    if (selector.kind === "point") countUiEvent("ui.testing.step_unresolved");
    return true;
  }

  /**
   * Opens the element menu over the mirror: what the runner can do with the element the outline is
   * currently on, each row carrying the action and emitted code the step would add.
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
    this.update({ menu: {
      label: stepLabel("tap", selector), ambiguous, matches,
      offers: stepOffers(selector, component),
      commands: allStepOffers(selector, component),
      ...(component ? { target: component } : {}),
      bounds, screen,
    } });
  }

  closeMenu() {
    this.menuOpening = false;
    this.menuToken++;
    if (this.snapshot.menu) this.update({ menu: undefined });
  }

  /**
   * Records an `agent.act` or `agent.assert` step from the sentence the user wrote.
   *
   * It does not go through `addStep`, and that is the point: there is no selector to resolve, so
   * the tree is never read and the coordinate refusal never applies — an element nothing can name
   * is exactly where describing it is the only way to write the step. The element the user
   * right-clicked only ever prefilled the sentence; it is not carried onto the step and never
   * reaches the file, because the runner resolves the instruction against the screen it finds.
   *
   * Nothing is sent to the device either. Taking an agent step here would mean running a model
   * against the live app mid-recording, which is a run, not a recording.
   */
  recordAgentStep(chosen:
    | { kind: "agentAct"; instruction: string; params?: AgentParams }
    | { kind: "agentAssert" | "agentWaitFor"; instruction: string; vision?: VisionMode }) {
    const instruction = chosen.instruction.trim();
    this.update({ menu: undefined });
    if (!instruction || !this.snapshot.recordingUdid) return;
    const kind: AgentStepKind = chosen.kind;
    // The optional halves — `params` on an act, `vision` on an assert — are carried exactly as the
    // form left them, and the form leaves a default off rather than writing it out: no params from
    // rows the user never filled in, no `vision: false` where `false` is what the runner does.
    const step: AgentStep = { ...chosen, instruction, id: crypto.randomUUID(), label: agentStepLabel(kind, instruction) };
    this.update({ steps: [...this.snapshot.steps, step] });
    countUiEvent(kind === "agentAct" ? "ui.testing.step_agent_act"
      : kind === "agentWaitFor" ? "ui.testing.step_agent_wait" : "ui.testing.step_agent_assert");
    // Counted apart from the step itself: whether params are reached for at all is the question,
    // and the count is of the rows, never of a key or a value.
    if (chosen.kind === "agentAct" && chosen.params) setUiGauge("ui.testing.agent_params", Object.keys(chosen.params).length);
  }

  /**
   * Records the step a menu row stands for. Nothing is sent to the device: the menu is how a user
   * records an assertion, a scroll or a typed value without the tap that would change the screen
   * out from under it.
   */
  async chooseOffer(kind: PinnedStepKind, value?: string) {
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
      // The panel's input path has one tap in it, so a double tap is sent as two. It is the screen
      // that has to keep up with the recorded flow, and an app that treats the pair as two taps is
      // one the emitted `doubleTap` would behave differently on — the step is right either way.
      else if (effect === "doubleTap") {
        this.reader?.perform?.({ kind: "tap", point: where });
        this.reader?.perform?.({ kind: "tap", point: where });
      }
      else if (effect === "swipe") {
        const span = this.lastBounds;
        this.reader?.perform?.({ kind: "swipe", ...swipePath(span ?? { x: 0, y: 0, ...(this.reader?.screen() ?? { width: 0, height: 0 }) }, swipeDirection(value)) });
      }
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
   * The same test cut off after one step: what Play until here runs.
   *
   * It is a re-emit of the first *n* steps rather than a slice of the source text, so the file it
   * produces is a whole test — the header, the steps up to and including this one, and the closing
   * brace. Every line it keeps stays at the line number it has in the full file: the header is a
   * fixed seven lines whether or not an agent step is left in it, and the only thing removed is
   * the tail. That is what lets the runner's report mark the preview's own lines.
   *
   * `untilLine` is the last line of the step that was asked for, which is where the run stops.
   *
   * `OPEN_STEP` is the flow with no steps at all: the app opened and nothing done to it. It is a
   * real thing to ask for — the app launching is where a flow most often breaks — and it is the
   * one line of the header the runner reports, so it marks like any other.
   */
  emittedThrough(stepId: string): { source: string; untilLine: number } | undefined {
    const steps = this.snapshot.steps;
    if (stepId === OPEN_STEP) {
      const emitted = emitE2eTestLines([], { title: this.snapshot.title });
      const line = emitted.calls[0];
      return line === undefined ? undefined : { source: emitted.source, untilLine: line };
    }
    const index = steps.findIndex(step => step.id === stepId);
    if (index < 0) return;
    const span = this.emitted.spans[index];
    if (!span) return;
    return { source: emitE2eTest(steps.slice(0, index + 1), { title: this.snapshot.title }), untilLine: span.to };
  }

  /**
   * A run has started. Every call line goes to `running` together, because that is as much as the
   * command line honestly tells us while the runner works — see `packages/core/src/testing-run.ts`
   * for why there is no per-step stream to follow.
   */
  beginRun(untilLine?: number) {
    // A fade left over from the previous run would take this run's marks with it.
    this.stopFade();
    this.update({ run: { state: "running", lines: {}, ...(untilLine === undefined ? {} : { untilLine }) } });
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
   * The verdict and the duration then stay above the preview until the next run begins, the steps
   * are edited, or it is cleared — pass or fail, with no timeout. The marks in the preview are the
   * half that still goes: the passing ticks fade shortly after the run, because a column of green
   * repeats what the chip already says and buries the code underneath it, while the mark on a line
   * that failed stays for good, since it is the only thing on screen that says where. See
   * `fadePassedMarks`.
   */
  finishRun(result: { status: string; steps: { line: number; status: string; error?: string }[]; output?: string; durationMs?: number }) {
    this.stopFade();
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
    // How far the run was asked to go is a fact about the run, so it outlives the run's own report:
    // "Passed" on a flow that stopped three steps in has to keep saying so.
    const untilLine = this.snapshot.run?.untilLine;
    this.update({ run: { state: passed ? "passed" : "failed", lines,
      ...(untilLine === undefined ? {} : { untilLine }),
      ...(error ? { error } : {}), ...(result.output ? { output: result.output } : {}),
      // Shown for a failure as well: how long a run took before it gave up is as much a part of
      // reading it as how long a passing one took.
      ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }) } });
    this.fadePassedMarks();
  }

  /** The run failed to start at all, or the user cleared it. */
  failRun(error: string) {
    const untilLine = this.snapshot.run?.untilLine;
    this.update({ run: { state: "failed", lines: {}, error, ...(untilLine === undefined ? {} : { untilLine }) } });
  }
  clearRun() {
    this.stopFade();
    if (this.snapshot.run) this.update({ run: undefined });
  }

  private stopFade() {
    if (this.fadeTimer !== undefined) { clearTimeout(this.fadeTimer); this.fadeTimer = undefined; }
  }

  /**
   * Lets the passing ticks go, a while after the run, and leaves everything else alone.
   *
   * The run itself is untouched: the verdict and the duration stay above the preview until the
   * next run, an edit or an explicit clear. Only the `passed` entries leave `lines`, so a mixed
   * run keeps the mark on the line that failed while the ticks around it clear.
   */
  private fadePassedMarks() {
    this.stopFade();
    if (!Object.values(this.snapshot.run?.lines ?? {}).includes("passed")) return;
    // A run whose marks are still worth fading: nothing has replaced it, and nothing has already
    // dropped them — an edit to the steps takes them all at once and sets `stale`.
    const fadable = () => {
      const run = this.snapshot.run;
      return run && run.state !== "running" && !run.stale
        && Object.values(run.lines).includes("passed") ? run : undefined;
    };
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = undefined;
      const run = fadable();
      if (!run) return;
      this.update({ run: { ...run, fading: true } });
      this.fadeTimer = setTimeout(() => {
        this.fadeTimer = undefined;
        const current = this.snapshot.run;
        if (!current) return;
        const { fading: _gone, ...rest } = current;
        this.update({ run: { ...rest,
          lines: Object.fromEntries(Object.entries(current.lines).filter(([, mark]) => mark !== "passed")) } });
      }, FADE_MS);
    }, HOLD_MS);
  }
}

/**
 * How long a run took, the way the `e2e` CLI writes it.
 *
 * Seconds to two decimals once there is a second to show, and whole milliseconds below that: a run
 * that took 840ms reads as a number, where `0.84s` reads as a rounding of something longer.
 */
export function formatRunDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "";
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(2)}s`;
}

/** The one recorder. See the class comment for why there is only one. */
export const testRecorder = new TestRecorder();
