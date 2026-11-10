import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { udidSchema } from "@mobile-dev/shared/protocol.ts";
import {
  agentStepLabel, anchorSelector, emitE2eTest, resolveComponentSelector, selectorSource, stepEffect, stepExpression,
  stepLabel, stepNeedsValue, swipeDirection, swipePath,
} from "@mobile-dev/shared/test-recording.ts";

import type {
  AgentStep, AgentStepKind, PinnedStep, PinnedStepKind, RecordedStep, StepTarget, SwipeDirection,
} from "@mobile-dev/shared/test-recording.ts";
import type { ScreenComponent, ScreenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { TestingDevices } from "./testing-device.ts";
import type { TestingDeviceTarget } from "./testing-device.ts";
import { captureServerError, recordTestingAgentRead } from "./telemetry.ts";

/**
 * Recording an e2e test from the user's own coding agent, into the Testing panel the user is
 * looking at.
 *
 * The manual recorder lives entirely in the iframe — `testRecorder` is a singleton there and
 * `RecordedStep[]` exists nowhere else — and an agent talks to this process over MCP, not to that
 * object. The server is the only thing the two share, so an agent's recording lives here and the
 * panel reads it, which is the same shape as run progress and for the same reason: a tool call is
 * one request and one response, so anything live has to be polled.
 *
 * The reasoning stays with the agent. There is no model in this process, one step per tool call,
 * and nothing here decides what is worth recording — see `docs/agent-recording.md`.
 */

/** The ranks a screen read reports, in the order `resolveChain` tries them. */
const RANK_LABEL: Record<string, string> = {
  testId: "testId", role: "role + name", placeholder: "placeholder", text: "text", label: "name",
  nth: "position among matches", point: "coordinate",
};

/**
 * How many elements one screen read answers with.
 *
 * A screen of review rows runs to several hundred nodes and the agent only ever names one of them,
 * so the read is cut rather than left to fill a context window. It is a cut, not a filter: the
 * rows are in the snapshot's own depth-first order, so what is dropped is the end of the tree and
 * the read says how many it dropped.
 */
const MAX_ELEMENTS = 200;

/** What the panel's selection is, as the panel reports it. Nothing here is inferred. */
export type TestingAgentContext = { projectPath: string; udid: string; bundleId: string };

export type TestingAgentStatus = "idle" | "recording" | "finished" | "aborted";

/** What the panel polls for, and the whole of what it draws the agent banner from. */
export type TestingAgentState = {
  active: boolean;
  status: TestingAgentStatus;
  /** Bumped by every change; the panel adopts the steps when it moves. */
  revision: number;
  title: string;
  goal: string;
  steps: RecordedStep[];
  note: string;
  error: string;
};

type Session = {
  target: TestingDeviceTarget;
  title: string;
  goal: string;
  steps: RecordedStep[];
  status: Exclude<TestingAgentStatus, "idle">;
  note: string;
  error: string;
  /**
   * Which read the live refs came from. Every action invalidates the tree, so a `ref` carries the
   * read it was minted by and one from an older read is refused rather than acted on — the
   * manual recorder makes the same assumption, it just has a pointer to re-hover with.
   */
  readId: number;
  refs: Map<string, { ref?: string; component: ScreenComponent }>;
  components: ScreenComponent[];
  screen?: ScreenSize;
  /** The rows of the last read, kept so a read the step path already paid for is not paid twice. */
  rows: ScreenRow[];
  /** How many elements that read left out, for the same reason. */
  truncated: number;
  /** When the last read happened, so a tree the app has since changed on its own is not served. */
  readAt: number;
  /** The last read's element identities; see `hasNavigated`. */
  identities: Set<string>;
};

/** One element of a screen read, as the agent sees it. */
type ScreenRow = {
  ref: string;
  role?: string; name?: string; text?: string; placeholder?: string; value?: string; testId?: string;
  enabled?: boolean; selected?: boolean; offScreen?: boolean;
  bounds: number[];
  selector?: string; rank?: string; unique?: boolean;
};

const PINNED_KINDS = [
  "tap", "doubleTap", "longPress", "fill", "scrollUntilVisible", "assertVisible", "assertNotVisible",
  "assertText", "assertContainsText", "assertValue", "assertEnabled", "assertDisabled",
  "assertSelected", "swipe",
] as const satisfies readonly PinnedStepKind[];
const AGENT_KINDS = ["agentAct", "agentAssert", "agentWaitFor"] as const satisfies readonly AgentStepKind[];

/**
 * How long a read stays usable without touching the device.
 *
 * An acting step reads the tree straight after its action — it has to, to tell the agent whether
 * the screen was replaced — and the agent's own next `agent_screen` would otherwise read the same
 * quiet screen again. This bounds the one thing that can still have changed: the app moving on by
 * itself, an animation finishing or data arriving. The manual recorder caches on the same rule.
 */
const TREE_TTL_MS = 1_500;

/**
 * What an element is, independently of the read it came from.
 *
 * Node ids are minted per read, so two reads of one unchanged screen share none of them. What a
 * test would name an element by — its role, its testID, its name, its text — is stable across
 * reads and is exactly what the agent is looking at.
 */
function identity(component: ScreenComponent): string {
  return [component.role, component.identifier, component.label, component.text, component.placeholder]
    .map(value => (value ?? "").replace(/\s+/g, " ").trim()).join("\u0000");
}

/**
 * Whether a step left the screen it was recorded on.
 *
 * Measured as the overlap between the two reads' element identities, because that is the thing
 * the rule is actually about: a step that *changes* a screen leaves most of it in place — a
 * disclosure adds a few rows, a filter rewrites a list under a heading, a fill re-labels one field
 * — while a step that *navigates* replaces it. Measured against a real app's Explore screens:
 * opening a disclosure kept every element the read had, switching tabs kept about two fifths of
 * them (the tab bar and the chrome around it), and tapping into a pushed screen kept about a
 * tenth. A third sits in the gap, with room on both sides.
 *
 * A tab switch therefore does not fire, which is the answer worth having: it is usually the
 * navigation *to* the screen the recording is for, so a boundary warning there would land exactly
 * as the agent arrives. And it is a hint either way — nothing refuses a step because of it.
 */
function hasNavigated(before: Set<string>, after: Set<string>): boolean {
  if (before.size === 0 || after.size === 0) return false;
  let kept = 0;
  for (const value of before) if (after.has(value)) kept += 1;
  return kept / before.size < 1 / 3;
}

function refused(message: string): never {
  throw new ExpectedOperationError("invalid_input", message);
}

/** Only the fields a command row is gated on; see `PinnedStep.target`. */
function stepTarget(component: ScreenComponent): StepTarget {
  return {
    ...(component.role === undefined ? {} : { role: component.role }),
    ...(component.placeholder === undefined ? {} : { placeholder: component.placeholder }),
    ...(component.label === undefined ? {} : { label: component.label }),
    ...(component.text === undefined ? {} : { text: component.text }),
    ...(component.value === undefined ? {} : { value: component.value }),
  };
}

/**
 * The one agent recording, and the panel selection it records against.
 *
 * One at a time, for the same reason the manual recorder is a singleton: a test is one flow on one
 * device, and two sessions would interleave two screens into one file. A second `begin` is refused
 * rather than allowed to stomp on the first.
 */
export class TestingAgentRecordings {
  private readonly devices: TestingDevices;
  private context?: TestingAgentContext;
  private session?: Session;
  private revision = 0;

  constructor(devices: TestingDevices) { this.devices = devices; }

  /** The panel's current project, device and bundle id. The only thing that knows the selection. */
  setContext(context: TestingAgentContext) { this.context = context; }
  clearContext() { this.context = undefined; }

  state(): TestingAgentState {
    const session = this.session;
    return {
      active: session?.status === "recording",
      status: session?.status ?? "idle",
      revision: this.revision,
      title: session?.title ?? "",
      goal: session?.goal ?? "",
      steps: session?.steps ?? [],
      note: session?.note ?? "",
      error: session?.error ?? "",
    };
  }

  private changed() { this.revision += 1; }

  private recording(): Session {
    const session = this.session;
    if (session?.status !== "recording") {
      refused("No agent recording is in flight. Call mobile_testing_agent_begin first.");
    }
    return session;
  }

  /**
   * Starts a recording against whatever the panel has selected.
   *
   * It never picks for the user. Choosing the project is an explicit act — the panel's picker is
   * an OS folder dialog, which must not open inside an agent's turn — and the device is whichever
   * one the mirror is showing. Missing either, the refusal says which, and the user fixes it in
   * the panel where the choice lives.
   */
  begin(input: { title: string; goal: string }) {
    if (this.session?.status === "recording") {
      refused(`An agent recording is already in flight: "${this.session.title}". Finish it with mobile_testing_agent_finish, or drop it with mobile_testing_agent_abort.`);
    }
    const context = this.context;
    const missing = [
      context?.projectPath ? "" : "an e2e project",
      context?.udid ? "" : "a booted simulator in the mirror",
      context?.bundleId ? "" : "a target with a bundle id in the project's e2e config",
    ].filter(Boolean);
    if (!context || missing.length > 0) {
      refused(`The Testing panel has no ${missing.join(", no ")} selected, so there is nothing to record against. Ask the user to open Mobile Dev's Testing tab and choose one, then begin again.`);
    }
    this.session = {
      target: { udid: context.udid, projectPath: context.projectPath, bundleId: context.bundleId },
      title: input.title.trim() || "a recorded flow",
      goal: input.goal.trim(),
      steps: [], status: "recording", note: "", error: "",
      readId: 0, refs: new Map(), components: [], rows: [], truncated: 0, readAt: 0, identities: new Set(),
    };
    this.changed();
    return {
      ok: true,
      title: this.session.title,
      projectPath: context.projectPath,
      udid: context.udid,
      bundleId: context.bundleId,
      next: "Call mobile_testing_agent_screen to read the screen, then mobile_testing_agent_step with one of its refs. Re-read after every step that acts.",
    };
  }

  /**
   * The runner's element tree as the agent's eyes.
   *
   * One row per element, carrying what it is and — the part that matters — **the selector the
   * recorder would emit for it**, with its rank and whether it is unique. The agent never writes a
   * locator: it names a `ref` and the selector is resolved here, by the same `resolveChain` a tap
   * on the mirror runs, so an agent-recorded step and a hand-recorded one are the same step.
   */
  async screen() {
    const session = this.recording();
    // A read the step path already paid for answers this one, while it is still describing the
    // screen it was taken of. The agent is told to re-read after every acting step and that read
    // has already happened, so the loop costs one snapshot per step rather than two.
    if (session.rows.length === 0 || performance.now() - session.readAt > TREE_TTL_MS) await this.refresh(session);
    return {
      readId: session.readId,
      ...(session.screen ? { screen: session.screen } : {}),
      elements: session.rows,
      ...(session.truncated > 0
        ? { truncated: session.truncated, note: `${session.truncated} further elements were left out of this read. Scroll with a swipe step if what you need is not here.` }
        : {}),
    };
  }

  /** Reads the device and makes that read the session's current tree, refs and rows. */
  private async refresh(session: Session): Promise<void> {
    const startedAt = performance.now();
    let tree: Awaited<ReturnType<TestingDevices["read"]>>;
    try {
      tree = await this.devices.read(session.target);
    } catch (error) {
      // The refs the agent holds described a screen this read failed to replace; none of them can
      // be trusted now, so a step on one is refused rather than acted on.
      session.refs = new Map();
      session.rows = [];
      recordTestingAgentRead("failed", performance.now() - startedAt, 0);
      throw error;
    }
    session.readId += 1;
    session.components = tree.tree;
    session.screen = tree.screen;
    session.refs = new Map();
    session.identities = new Set(tree.tree.map(identity));
    // Off-screen elements stay in the read, flagged. The manual recorder never had to think about
    // them — the user points at what they can see — but an agent asserting the *result* of a
    // filter is often asserting a row below the fold, and `getByText` resolves it whether or not
    // it is on screen. Dropping them hid exactly what the test was being written about.
    session.rows = tree.tree.slice(0, MAX_ELEMENTS).map(component => {
      const ref = `${session.readId}-${component.nodeId ?? ""}`;
      session.refs.set(ref, { component, ...(component.nodeId && tree.refs[component.nodeId] ? { ref: tree.refs[component.nodeId] } : {}) });
      const resolved = resolveComponentSelector(tree.tree, component, tree.screen);
      return {
        ref,
        ...(component.role ? { role: component.role } : {}),
        ...(component.label ? { name: component.label } : {}),
        ...(component.text && component.text !== component.label ? { text: component.text } : {}),
        ...(component.placeholder ? { placeholder: component.placeholder } : {}),
        ...(component.value ? { value: component.value } : {}),
        ...(component.identifier ? { testId: component.identifier } : {}),
        ...(component.disabled ? { enabled: false } : {}),
        ...(component.selected ? { selected: true } : {}),
        // A role query skips it and a tap cannot land on it; text and label queries still resolve
        // it, so it is an element to assert about or to scroll to, not one to act on.
        ...(component.hidden ? { offScreen: true } : {}),
        bounds: [Math.round(component.bounds.x), Math.round(component.bounds.y), Math.round(component.bounds.width), Math.round(component.bounds.height)],
        // Nothing here means nothing on this screen names the element: record it with
        // `instruction` instead of a `ref`, which is the only time an agent step is the right step.
        ...(resolved ? {
          selector: selectorSource(resolved.selector),
          rank: RANK_LABEL[resolved.selector.kind] ?? resolved.selector.kind,
          unique: !resolved.ambiguous,
        } : {}),
      };
    });
    session.truncated = tree.tree.length - session.rows.length;
    session.readAt = performance.now();
    recordTestingAgentRead("success", performance.now() - startedAt, tree.tree.length);
  }

  /**
   * Records one step, and takes it when it is an action.
   *
   * A step recorded but never taken leaves the app on the screen before it, so the next step would
   * be resolved against a screen the test will never reach — the rule the mirror's command menu
   * already follows. An assertion reads and changes nothing, so it records without touching the
   * device.
   */
  async step(input: { ref?: string; kind?: string; value?: string; direction?: string; instruction?: string }) {
    const session = this.recording();
    const kind = (input.kind ?? (input.instruction ? "agentAct" : "tap")) as PinnedStepKind | AgentStepKind;
    const instruction = input.instruction?.trim();
    if ((AGENT_KINDS as readonly string[]).includes(kind)) {
      if (!instruction) refused(`${kind} is a sentence the runner resolves at run time, so it needs an instruction.`);
      return this.recordAgentStep(session, kind as AgentStepKind, instruction);
    }
    if (!(PINNED_KINDS as readonly string[]).includes(kind)) {
      refused(`"${kind}" is not a step the runner has. Use one of: ${PINNED_KINDS.join(", ")}, or an instruction with agentAct/agentAssert/agentWaitFor.`);
    }
    if (instruction && !input.ref) return this.recordAgentStep(session, "agentAct", instruction);
    return this.recordPinnedStep(session, kind as PinnedStepKind, input);
  }

  private recordAgentStep(session: Session, kind: AgentStepKind, instruction: string) {
    // No locator to resolve, so the tree is never read and nothing is sent to the device: taking
    // an agent step would mean running a model against the live app mid-recording, which is a run.
    const step: AgentStep = { kind, instruction, id: crypto.randomUUID(), label: agentStepLabel(kind, instruction) };
    session.steps.push(step);
    this.changed();
    return { ok: true, index: session.steps.length, label: step.label, source: stepExpression(step), acted: false };
  }

  private async recordPinnedStep(session: Session, kind: PinnedStepKind, input: { ref?: string; value?: string; direction?: string }) {
    const value = input.value;
    if (stepNeedsValue(kind) && (value === undefined || value === "")) {
      refused(`${kind} compares or types text, so it needs a value.`);
    }
    const direction = swipeDirection(input.direction);
    // A swipe with no element is a swipe of the viewport, which is how a flow scrolls to something
    // that is not on screen yet. It is the one pinned step that names nothing and still emits.
    if (!input.ref) {
      if (kind !== "swipe") refused(`${kind} acts on an element, so it needs a ref from mobile_testing_agent_screen. Only swipe can be taken without one, and it then swipes the viewport.`);
      const centre = { x: (session.screen?.width ?? 0) / 2, y: (session.screen?.height ?? 0) / 2 };
      const anchor = anchorSelector(session.components, centre, session.screen);
      return this.addStep(session, {
        kind, selector: { kind: "point", point: centre }, direction,
        // A swipe is as actionable as a tap: the viewport is ready from the first frame, so
        // without something on the screen to wait for it fires into whatever is still loading.
        ...(anchor && anchor.kind !== "point" ? { anchor } : {}),
        id: crypto.randomUUID(), label: stepLabel("swipe", { kind: "point", point: centre }, direction),
        // The runner performs `screen.swipe` as agent-device's own `scroll`, so this does too —
        // same call, same direction, no trajectory of our own to fall outside a viewport that the
        // keyboard has shrunk.
      }, { kind: "scroll", direction });
    }
    const entry = session.refs.get(input.ref);
    if (!entry) {
      refused(`${input.ref} is not from the latest screen read. Every action changes the screen, so call mobile_testing_agent_screen again and use a ref from that read.`);
    }
    const resolved = resolveComponentSelector(session.components, entry.component, session.screen);
    if (!resolved) {
      refused(`Nothing on this screen names ${input.ref} — no testID, no role with a name, no text of its own. Record it as a sentence instead: mobile_testing_agent_step with an instruction and no ref.`);
    }
    const step: PinnedStep = {
      id: crypto.randomUUID(),
      kind,
      selector: resolved.selector,
      label: stepLabel(kind, resolved.selector, kind === "swipe" ? direction : value),
      ...(kind === "swipe" ? { direction } : value === undefined ? {} : { value }),
      ...(resolved.ambiguous ? { ambiguous: true as const } : {}),
      // Kept so the panel's step list can offer the same commands long after this screen has gone.
      target: stepTarget(resolved.component ?? entry.component),
    };
    const effect = stepEffect(kind);
    // A swipe is scoped by the element's own box rather than placed on it, so it is the one acting
    // step that does not need a handle. The rest are placed on the element, which is what makes
    // the tap land where the runner's locator action will land.
    if (effect === "swipe") return this.addStep(session, step, { kind: "swipe", ...swipePath(entry.component.bounds, direction) });
    if (effect === "none") return this.addStep(session, step);
    const deviceRef = entry.ref;
    if (!deviceRef) {
      refused(`${input.ref} has no handle the device can act on, so this step cannot be taken. Record it as an assertion, or use a sentence with an instruction.`);
    }
    return this.addStep(session, step, effect === "type"
      ? { kind: "type", ref: deviceRef, text: value ?? "" }
      : { kind: effect === "doubleTap" ? "doubleTap" : "tap", ref: deviceRef });
  }

  private async addStep(session: Session, step: PinnedStep, action?: Parameters<TestingDevices["perform"]>[1]) {
    session.steps.push(step);
    this.changed();
    const result = { ok: true, index: session.steps.length, label: step.label, source: stepExpression(step) };
    if (!action) return { ...result, acted: false };
    const before = session.identities;
    try {
      await this.devices.perform(session.target, action);
    } catch (error) {
      // The step is recorded and the screen is not where the step says it is, which is worse than
      // either on its own: say so rather than letting the next read be about a screen the flow
      // never reached.
      session.error = errorMessage(error);
      this.changed();
      // Every action invalidates the tree, so the refs from the last read go with it.
      session.refs = new Map();
      session.rows = [];
      throw error;
    }
    // Reading here rather than leaving it to the agent's next `agent_screen` is what makes the
    // navigation hint possible at all — the comparison needs both sides — and it costs nothing,
    // because that read is the one `agent_screen` then serves.
    await this.refresh(session);
    const navigated = hasNavigated(before, session.identities);
    return {
      ...result, acted: true,
      // Advisory, never enforcement. Plenty of real flows cross screens on purpose — a checkout, a
      // sign-in — and a recorder that refused them would be worse than one that occasionally
      // records a step too many. So this says what happened and what the recording was for, and
      // leaves the judgement where the reasoning is.
      ...(navigated ? {
        navigated: true,
        goal: session.goal,
        next: `That step replaced the screen. This recording is for: ${session.goal || session.title}. If the screen you have arrived at is outside that, assert that you arrived and call mobile_testing_agent_finish; only keep recording if the flow the user asked for genuinely crosses screens.`,
      } : { next: "The screen has changed. Call mobile_testing_agent_screen before the next step." }),
    };
  }

  /**
   * Ends the recording with the steps left dirty in the panel.
   *
   * Nothing is saved and nothing is run. The user adjusts the flow, names the file and saves it
   * themselves — a run would also reset the app and take the device session, which is the one
   * thing the panel's recorder still needs.
   */
  finish(input: { note?: string }) {
    const session = this.recording();
    session.status = "finished";
    session.note = input.note?.trim() ?? "";
    this.changed();
    return {
      ok: true,
      steps: session.steps.length,
      source: emitE2eTest(session.steps, { title: session.title }),
      next: `${session.steps.length} step${session.steps.length === 1 ? "" : "s"} are waiting in Mobile Dev's Testing panel, unsaved. Tell the user to review them there and press Save; nothing has been written to the project and nothing has been run.`,
    };
  }

  /** Drops the session. Whatever was recorded stays in the panel, which is the user's to keep. */
  abort(input: { reason: string }) {
    const session = this.session;
    if (!session || session.status !== "recording") return { ok: true, steps: session?.steps.length ?? 0, wasRecording: false };
    session.status = "aborted";
    session.note = input.reason.trim();
    this.changed();
    return { ok: true, steps: session.steps.length, wasRecording: true };
  }
}

const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
/** The panel's own plumbing; the model drives the recording through the five tools below. */
const appVisibility = { ui: { visibility: ["app"] as ("app" | "model")[] } };
/**
 * Visible to the model *and* to the panel, which is the whole point of this file: the agent drives
 * the recording and the panel shows it. The eight tools in `testing-tools.ts` stay app-only —
 * writing a file and running a test are the user's acts, not a step in an agent's loop.
 */
const sharedVisibility = { ui: { visibility: ["app", "model"] as ("app" | "model")[] } };

function safe<T>(handler: (input: T) => Promise<CallToolResult> | CallToolResult) {
  return async (input: T): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      captureServerError(error, "testing.agent");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  };
}

function dataResult(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

/** Registers the agent recording tools beside `registerTestingTools`, on the same device session. */
export function registerTestingAgentTools(server: McpServer, devices: TestingDevices, recordings = new TestingAgentRecordings(devices)): TestingAgentRecordings {
  registerAppTool(server, "mobile_testing_agent_begin", {
    title: "Begin recording an e2e test",
    description:
      "Start recording an e2e test into Mobile Dev's Testing panel, against the project, device and app the panel already has selected. Refuses, saying what is missing, when the user has not chosen them. The steps appear in the panel as you record them and are never saved or run by you.",
    inputSchema: {
      title: z.string().min(1).max(200).describe("The test's title, e.g. \"the explore details screen\"."),
      goal: z.string().min(1).max(500).describe("What this flow covers, in one sentence. Shown to the user in the panel's banner."),
    },
    annotations: write,
    _meta: sharedVisibility,
  }, safe(async (input: { title: string; goal: string }) => dataResult(recordings.begin(input))));

  registerAppTool(server, "mobile_testing_agent_screen", {
    title: "Read the screen being recorded",
    description:
      "Read the element tree of the screen the recording is on: one row per element with its role, name, text, placeholder, value, testId, state and bounds, and the selector a step on it would emit, its rank, and whether it is unique. Name a ref from this read in mobile_testing_agent_step; never write a locator yourself. Every acting step changes the screen, so read again after each one.",
    inputSchema: {},
    annotations: read,
    _meta: sharedVisibility,
  }, safe(async () => dataResult(await recordings.screen())));

  registerAppTool(server, "mobile_testing_agent_step", {
    title: "Record one step",
    description:
      "Record one step of the flow and, when it acts, take it on the device so the next step is read from the screen the test will be on. Pass a ref from the last screen read; assertions record without touching the device. Pass an instruction and no ref only for an element the screen read reported no selector for. The result says navigated: true when the step replaced the screen, with the recording's goal as a reminder of its scope.",
    inputSchema: {
      ref: z.string().min(1).max(64).optional().describe("An element ref from the latest mobile_testing_agent_screen."),
      kind: z.enum([...PINNED_KINDS, ...AGENT_KINDS]).optional().describe("The step; defaults to tap, or agentAct with an instruction."),
      value: z.string().max(2048).optional().describe("The text fill types, or the text an assertion compares with."),
      direction: z.enum(["up", "down", "left", "right"]).optional().describe("Which way a swipe goes. A swipe with no ref swipes the viewport."),
      instruction: z.string().max(1000).optional().describe("A sentence for agent.act/agent.assert, for an element nothing can name."),
    },
    annotations: write,
    _meta: sharedVisibility,
  }, safe(async (input: { ref?: string; kind?: string; value?: string; direction?: string; instruction?: string }) =>
    dataResult(await recordings.step(input))));

  registerAppTool(server, "mobile_testing_agent_finish", {
    title: "Finish the recording",
    description:
      "End the recording. The steps are left unsaved in the Testing panel for the user to adjust, save and run; nothing is written to the project and nothing is run.",
    inputSchema: { note: z.string().max(500).optional().describe("One line on what was recorded, for the user.") },
    annotations: write,
    _meta: sharedVisibility,
  }, safe(async (input: { note?: string }) => dataResult(recordings.finish(input))));

  registerAppTool(server, "mobile_testing_agent_abort", {
    title: "Abandon the recording",
    description: "Drop the recording. Whatever was recorded stays in the Testing panel for the user.",
    inputSchema: { reason: z.string().min(1).max(500).describe("Why the recording stopped.") },
    annotations: write,
    _meta: sharedVisibility,
  }, safe(async (input: { reason: string }) => dataResult(recordings.abort(input))));

  registerAppTool(server, "mobile_testing_agent_state", {
    title: "Read the agent recording",
    description: "Read the agent recording's status and steps. The Testing panel polls this and adopts the steps as they arrive.",
    inputSchema: {},
    annotations: read,
    _meta: appVisibility,
  }, safe(() => dataResult({ ...recordings.state() })));

  registerAppTool(server, "mobile_testing_set_context", {
    title: "Report the Testing panel's selection",
    description:
      "Tell the server which project, device and bundle id the Testing panel has selected, so an agent recording has something to record against. The panel calls this whenever the selection changes; nothing is ever inferred from the server's own working directory.",
    inputSchema: {
      projectPath: z.string().max(4096),
      udid: udidSchema.or(z.literal("")),
      bundleId: z.string().max(512),
    },
    annotations: write,
    _meta: appVisibility,
  }, safe((input: TestingAgentContext) => {
    if (input.projectPath && input.udid && input.bundleId) recordings.setContext(input);
    else recordings.clearContext();
    return dataResult({ ok: true });
  }));

  return recordings;
}
