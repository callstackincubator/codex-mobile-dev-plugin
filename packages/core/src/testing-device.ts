import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { ScreenComponent, ScreenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { APP_FLOW_DIRECTORY, loadVendoredAgentDevice } from "./app-flow-host.ts";
import { bundledE2eRoot } from "./e2e-runtime.ts";
import { captureServerError } from "./telemetry.ts";
import { isHardwareUdid, settlePhysicalIos } from "./physical-ios-settle.ts";

/**
 * The element tree the Testing Studio panel's recorder names selectors from: the one the `e2e` runner
 * will query when it runs the recorded test.
 *
 * The recorder used to read the macOS accessibility API through Baguette and translate its role
 * vocabulary into the runner's with a hand-maintained table. Two trees over the same pixels never
 * agree for long — iOS reports a tab bar item as a radio button, synthesises `AXLink` from the
 * link *trait* that any view can carry, and offers a search field's placeholder as its name — and
 * every divergence surfaced as a recorded test that simply did not resolve. So the recorder reads
 * the runner's tree instead: the same `agent-device` snapshot, projected by the project's own
 * `@e2e-dev/mobile` build. Role vocabulary and name sources then agree by construction, because
 * there is only one of each.
 *
 * Baguette or the native iOS mirror still owns the video. The recorder and mirror hold the
 * same selected device at once: a snapshot taken while the mirror streams leaves the stream running and
 * returns in about a tenth of a second.
 */

/** One `SemanticNode` as `@e2e-dev/mobile` projects it; only the fields a selector is built from. */
interface SemanticNode {
  role?: string;
  name?: string;
  text?: string;
  value?: string;
  testId?: string;
  attributes?: Record<string, string | undefined>;
  states?: Record<string, boolean | undefined>;
  rect?: { x: number; y: number; width: number; height: number };
}
/**
 * `ref` is agent-device's own handle for the node, which is what an action is placed on: the
 * projection keeps it beside the semantic node, so a selector the panel resolved and a tap the
 * server performs are about the same element without a second lookup. It is absent for a node
 * agent-device did not give one.
 */
interface ProjectedNode { id: string; kind: string; ref?: string; node: SemanticNode; parent?: ProjectedNode }
interface ProjectedSnapshot { index: readonly ProjectedNode[]; viewport?: ScreenSize }
interface EngineProjection {
  projectSnapshot(raw: readonly unknown[], options: { mintId: () => string }): ProjectedSnapshot;
}

/** What one device's recording session needs to attach to the app the user is already tapping. */
export interface TestingDeviceTarget {
  /** An iOS simulator or hardware UDID, or an Android emulator's adb serial. */
  deviceId: string;
  platform: "ios" | "android";
  /** The e2e project whose `@e2e-dev/mobile` projects the snapshot; its build, not ours. */
  projectPath: string;
  /** The project root in project mode, or Mobile Dev's pinned artifact in bundled mode. */
  runtimeRoot?: string;
  /** The app to attach to, from the project's config. Never launched fresh — see `attach`. */
  bundleId: string;
}

export interface TestingDeviceTree {
  tree: ScreenComponent[];
  screen?: ScreenSize;
  /**
   * Each element's agent-device ref, by the `nodeId` the panel knows it as.
   *
   * The panel never needs this — it records selectors and drives the mirror — but an agent
   * recording acts through agent-device itself, and a `ref` is what its tap, fill and scroll take.
   * Keeping the pair here is what stops the server resolving the element a second time, and a
   * second resolution is a second answer.
   */
  refs: Record<string, string>;
}

/**
 * One thing an agent recording does to the device, after the step has been recorded.
 *
 * The kinds are `stepEffect`'s, not `PinnedStepKind`'s: an assertion changes nothing, so it never
 * reaches here, and `scrollUntilVisible` is only ever offered for an element that is on screen
 * already. The same reduction the mirror's menu makes, made once in `test-recording.ts`.
 */
export type TestingDeviceAction =
  | { kind: "tap"; ref: string }
  | { kind: "doubleTap"; ref: string }
  | { kind: "type"; ref: string; text: string }
  // An element-scoped swipe, drawn inside the element's own box.
  | { kind: "swipe"; from: { x: number; y: number }; to: { x: number; y: number } }
  /**
   * A swipe of the viewport, which the runner performs as `interactions.scroll` — so this does
   * too. Deriving a trajectory from the snapshot's viewport instead is what agent-device refuses
   * with "Gesture trajectory does not fit inside the viewport" whenever something shrinks the
   * window the gesture runtime measures, the on-screen keyboard above all.
   */
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right" };

/**
 * agent-device allows exactly one session per device, so a leaked session makes the user's next
 * `e2e run` fail with a refusal they cannot connect to anything they did. One name, released on
 * every path out of recording.
 */
const SESSION = "mobile-dev-recorder";

/**
 * Pins every daemon this app starts to one state directory, so they are same-state-dir peers that
 * can take the iOS runner lease from one another rather than strangers that cannot. App-flow pins
 * the same directory for the same reason; whichever runs first wins and the other agrees.
 */
function pinStateDir(): void {
  if (process.env.AGENT_DEVICE_STATE_DIR?.trim()) return;
  process.env.AGENT_DEVICE_STATE_DIR = join(APP_FLOW_DIRECTORY, "agent-device");
}

/**
 * The project's own node projection: the `ROLE_MAP`, the React Native role descriptions, and the
 * name/placeholder sources the runner will use on this very snapshot. Loaded from the project
 * rather than vendored here, because a copy is a second vocabulary again — the thing this whole
 * path exists to remove.
 */
async function loadProjection(projectPath: string): Promise<EngineProjection> {
  const entry = join(projectPath, "node_modules/@e2e-dev/mobile/dist/nodes.js");
  if (!existsSync(entry)) {
    throw new ExpectedOperationError("invalid_input",
      "This project has no @e2e-dev/mobile installed, so the recorder cannot read the tree its tests will run against. Install the project's dependencies, then record again.");
  }
  // Deep path rather than a package specifier: the package does not export this module, and a
  // copy of its mapping here would be the divergence this path exists to remove.
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  const module = await dynamicImport(pathToFileURL(entry).href) as Partial<EngineProjection> | null;
  if (typeof module?.projectSnapshot !== "function") {
    throw new ExpectedOperationError("invalid_input", "This project's @e2e-dev/mobile does not expose the node projection the recorder reads.");
  }
  return module as EngineProjection;
}

/**
 * The project's projection when it loads, else the bundled runtime's. A project on an e2e version
 * Testing Studio was not built against still runs its tests with its own CLI; only the recorder's tree
 * reading drops back to the pinned copy, so recording keeps working instead of refusing.
 */
async function loadProjectionWithFallback(runtimeRoot: string): Promise<EngineProjection> {
  try {
    return await loadProjection(runtimeRoot);
  } catch (error) {
    let bundled: string;
    try { bundled = await bundledE2eRoot(); } catch { throw error; }
    if (bundled === runtimeRoot) throw error;
    return await loadProjection(bundled).catch(() => { throw error; });
  }
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * One projected node as the panel's flat component list. The names are the panel's; the values
 * are the runner's, passed through untouched — `role` above all, which is why no table survives
 * in `test-recording.ts`.
 */
function toComponent(entry: ProjectedNode, depth: number): ScreenComponent | undefined {
  const rect = entry.node.rect;
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return;
  const name = textOf(entry.node.name);
  const text = textOf(entry.node.text);
  const testId = textOf(entry.node.testId);
  const placeholder = textOf(entry.node.attributes?.["placeholder"]);
  return {
    name: name ?? text ?? testId ?? placeholder ?? entry.kind,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    depth,
    source: "accessibility",
    nodeId: entry.id,
    ...(entry.parent ? { parentId: entry.parent.id } : {}),
    ...(entry.node.role ? { role: entry.node.role } : {}),
    ...(testId ? { identifier: testId } : {}),
    // `label` is the runner's `name`: what `getByRole(role, name)` and `getByLabel` match.
    ...(name ? { label: name } : {}),
    ...(text ? { text } : {}),
    ...(textOf(entry.node.value) ? { value: textOf(entry.node.value) } : {}),
    ...(placeholder ? { placeholder } : {}),
    // The runner skips a hidden node for a role query; `hidden` is set only by `visibleToUser: false`.
    ...(entry.node.states?.["hidden"] === true ? { hidden: true } : {}),
    // What `toBeDisabled` and `toBeSelected` read, so an agent reading the screen can tell a
    // selected tab from the rest without a second call.
    ...(entry.node.states?.["disabled"] === true ? { disabled: true } : {}),
    ...(entry.node.states?.["selected"] === true ? { selected: true } : {}),
  };
}

function depthOf(entry: ProjectedNode): number {
  let depth = 0;
  for (let parent = entry.parent; parent; parent = parent.parent) depth += 1;
  return depth;
}

/**
 * An id for a component that follows the element, not its position in one read.
 *
 * The projection mints `n1…nK` per read, so the same field has a different id after the screen
 * re-reads, and a fill that arrives after a queued read would land on whichever element now holds
 * that number. Derived from what identifies the element (role, names, box), the id is the same
 * across reads while the element is, and simply absent when it is not. The typed `value` is left
 * out so a field keeps its id while it is being filled. Identical siblings are told apart by order.
 */
function stableId(component: ScreenComponent, seen: Map<string, number>): string {
  const { x, y, width, height } = component.bounds;
  const key = [component.role, component.label, component.text, component.identifier, component.placeholder, Math.round(x), Math.round(y), Math.round(width), Math.round(height)].join("\u0000");
  const occurrence = seen.get(key) ?? 0;
  seen.set(key, occurrence + 1);
  return `s${createHash("sha1").update(key).digest("hex").slice(0, 10)}${occurrence ? `-${occurrence}` : ""}`;
}

export function projectedComponents(projection: EngineProjection, nodes: readonly unknown[]): TestingDeviceTree {
  let minted = 0;
  const snapshot = projection.projectSnapshot(nodes, { mintId: () => `n${++minted}` });
  const tree: ScreenComponent[] = [];
  const refs: Record<string, string> = {};
  const ids = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const entry of snapshot.index) {
    const component = toComponent(entry, depthOf(entry));
    if (!component) continue;
    const id = stableId(component, seen);
    ids.set(entry.id, id);
    component.nodeId = id;
    // A parent without a box is not in the tree; the child then has no parent link, as before.
    if (component.parentId !== undefined) {
      const parent = ids.get(component.parentId);
      if (parent) component.parentId = parent; else delete component.parentId;
    }
    tree.push(component);
    // agent-device's own refs are `@e20`; the projection strips the `@` for its own use, and
    // `interactions.click({ ref })` parses a bare `e20` as a selector and refuses it. So the
    // sigil is put back here, at the one boundary that hands a ref to agent-device.
    if (entry.ref) refs[id] = entry.ref.startsWith("@") ? entry.ref : `@${entry.ref}`;
  }
  return { tree, refs, ...(snapshot.viewport ? { screen: snapshot.viewport } : {}) };
}

type AgentDeviceClient = {
  apps: { open(options: Record<string, unknown>): Promise<unknown> };
  capture: { snapshot(options: Record<string, unknown>): Promise<{ nodes?: unknown }> };
  sessions: { close(options?: Record<string, unknown>): Promise<unknown> };
  interactions: {
    click(options: Record<string, unknown>): Promise<unknown>;
    fill(options: Record<string, unknown>): Promise<unknown>;
    swipe(options: Record<string, unknown>): Promise<unknown>;
    scroll(options: Record<string, unknown>): Promise<unknown>;
  };
};

/** The error agent-device raises when the session exists but nothing is attached to an app. */
function needsAttach(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /active app session|SESSION_NOT_FOUND|no active session/i.test(message);
}

/**
 * Reads the runner's tree for the device the panel is mirroring, and owns the session that read
 * needs. One session, one device, released explicitly — see `release`.
 */
export class TestingDevices {
  private client?: Promise<AgentDeviceClient>;
  private readonly projections = new Map<string, Promise<EngineProjection>>();
  /** The device an attached session is on, so a second read reuses it instead of reopening. */
  private attached?: string;
  private lastRefs: Record<string, string> = {};
  /** Serialises reads: agent-device answers one command per session at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly load: typeof loadVendoredAgentDevice;

  /** Lets a physical iPhone finish tearing the recorder's runner down once its session is closed. */
  private readonly settle: (deviceId: string) => Promise<void>;
  /** The device the attached session holds, kept so its release knows whether to settle. */
  private attachedDevice?: { deviceId: string; platform: "ios" | "android" };

  constructor(load = loadVendoredAgentDevice, settle: (deviceId: string) => Promise<void> = settlePhysicalIos) { this.load = load; this.settle = settle; }

  private async connect(): Promise<AgentDeviceClient> {
    pinStateDir();
    this.client ??= this.load().then(module => module.createAgentDeviceClient({}) as AgentDeviceClient);
    return this.client;
  }

  private projection(runtimeRoot: string): Promise<EngineProjection> {
    let pending = this.projections.get(runtimeRoot);
    if (!pending) {
      pending = loadProjectionWithFallback(runtimeRoot);
      // A failed load must not be cached: the user installs the dependency and records again.
      pending.catch(() => this.projections.delete(runtimeRoot));
      this.projections.set(runtimeRoot, pending);
    }
    return pending;
  }

  /**
   * Attaches to the app the user is already in.
   *
   * `relaunch: false` is the whole point: the recorder exists so the user keeps tapping the screen
   * they are on, and a relaunch would throw away the state they navigated to. `--foreground` is
   * never used — it refuses outright when more than one app is running on the simulator, which is
   * every simulator anyone has been working on.
   */
  private async attach(client: AgentDeviceClient, target: TestingDeviceTarget): Promise<void> {
    if (this.attached !== undefined && this.attached !== this.key(target)) await this.releaseOnce();
    await client.apps.open({
      ...this.selector(target), session: SESSION,
      app: target.bundleId, relaunch: false, noRecord: true, timeoutMs: 120_000,
    });
    this.attached = this.key(target);
    this.attachedDevice = { deviceId: target.deviceId, platform: target.platform };
  }

  /** The runner's own snapshot call, with the runner's own options: a different tree is a different test. */
  private snapshot(client: AgentDeviceClient, target: TestingDeviceTarget): Promise<{ nodes?: unknown }> {
    return client.capture.snapshot({ ...this.selector(target), session: SESSION, interactiveOnly: false });
  }

  /** The device selector agent-device takes: an adb serial on Android, a UDID on iOS. */
  private selector(target: TestingDeviceTarget) {
    return target.platform === "android"
      ? { platform: "android" as const, serial: target.deviceId }
      : { platform: "ios" as const, udid: target.deviceId };
  }

  /** Every input that decides which app/session is attached and how its tree is projected. */
  private key(target: TestingDeviceTarget): string {
    return `${target.platform}\u0000${target.deviceId}\u0000${target.projectPath}\u0000${target.runtimeRoot ?? target.projectPath}\u0000${target.bundleId}`;
  }

  async read(target: TestingDeviceTarget): Promise<TestingDeviceTree> {
    const run = this.queue.then(() => this.readOnce(target), () => this.readOnce(target));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readOnce(target: TestingDeviceTarget): Promise<TestingDeviceTree> {
    const [client, projection] = await Promise.all([this.connect(), this.projection(target.runtimeRoot ?? target.projectPath)]);
    if (this.attached !== this.key(target)) await this.attach(client, target);
    let snapshot: { nodes?: unknown };
    try {
      snapshot = await this.snapshot(client, target);
    } catch (error) {
      // The session can go while the panel is idle — the app was closed, the runner was swept. One
      // reattach, then the failure is real and the panel says so.
      if (!needsAttach(error)) throw error;
      this.attached = undefined;
      await this.attach(client, target);
      snapshot = await this.snapshot(client, target);
    }
    if (!Array.isArray(snapshot.nodes)) throw new Error("The device snapshot returned no nodes.");
    const projected = projectedComponents(projection, snapshot.nodes);
    this.lastRefs = projected.refs;
    return projected;
  }

  /**
   * Enters the recorded text into the field the panel named.
   *
   * The panel's fill is fire-and-forget behind its own refresh, so a read can be queued ahead of
   * it and the refs from the read the panel acted on are gone. The field is therefore found again
   * on a fresh snapshot, by its stable id, and the fill waits its turn in the queue like any read.
   * A field that moved or went away is refused, never filled on a neighbour.
   */
  async fillNode(target: TestingDeviceTarget, nodeId: string, text: string): Promise<void> {
    const fill = async () => {
      await this.readOnce(target);
      const ref = this.lastRefs[nodeId];
      if (!ref) throw new ExpectedOperationError("invalid_input", "The selected text field is no longer on the current screen. Read the screen and record the step again.");
      await this.performOnce(target, { kind: "type", ref, text });
    };
    const run = this.queue.then(fill, fill);
    this.queue = run.catch(() => undefined);
    await run;
  }

  /**
   * Takes the step an agent recording just recorded, on the same session the read used.
   *
   * Not the panel's own input path: the server cannot reach the mirror's stream, and this is the
   * better half of the trade anyway — agent-device places the action on the element's own ref, so
   * the tap lands where the runner's locator action will land rather than on a coordinate someone
   * computed from a rectangle. The mirror shows every change regardless, because the video stream
   * and the snapshot hold the same device at once.
   *
   * Every action asks agent-device to **settle** afterwards. The step the agent records next is
   * resolved against the screen this one produced, and a screen mid-transition answers with refs
   * that are already stale — agent-device refuses the next action outright with "had no confirmed
   * resting position when the transition window ran out". The wait belongs here, where the
   * transition is, rather than as a sleep the caller guesses at.
   */
  async perform(target: TestingDeviceTarget, action: TestingDeviceAction): Promise<void> {
    const run = this.queue.then(() => this.performOnce(target, action), () => this.performOnce(target, action));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async performOnce(target: TestingDeviceTarget, action: TestingDeviceAction): Promise<void> {
    const client = await this.connect();
    if (this.attached !== this.key(target)) await this.attach(client, target);
    const base = { ...this.selector(target), session: SESSION, settle: true };
    switch (action.kind) {
      case "tap": await client.interactions.click({ ...base, ref: action.ref }); return;
      // agent-device takes the double tap as one gesture, so unlike the mirror — whose input path
      // has a single tap in it and sends two — this is the gesture the emitted `doubleTap` names.
      case "doubleTap": await client.interactions.click({ ...base, ref: action.ref, doubleTap: true }); return;
      // The runner's `fill` replaces a field's contents, and so does agent-device's, so an agent
      // recording leaves the screen showing exactly what the step will produce — the one place it
      // is more faithful than the mirror, which can only append.
      case "type": await client.interactions.fill({ ...base, ref: action.ref, text: action.text }); return;
      // `SwipeOptions` has no settle: a swipe is a gesture over the viewport rather than an
      // action on an element, so there is no element whose resting position the next step needs.
      case "swipe": await client.interactions.swipe({ ...this.selector(target), session: SESSION, from: action.from, to: action.to }); return;
      case "scroll": await client.interactions.scroll({ ...base, direction: action.direction }); return;
    }
  }

  /**
   * Gives the device back.
   *
   * agent-device refuses a second session on a device that already has one, so a session left open
   * here makes the user's next `npx e2e run` fail with `Device is already in use` — a worse,
   * stranger failure than any this path fixes. Recording stops, the panel closes, the device
   * changes: each of those releases.
   */
  async release(): Promise<void> {
    const run = this.queue.then(() => this.releaseOnce(), () => this.releaseOnce());
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Releases the recorder only when it holds one of these devices. A matrix run touches only its own
   * devices, so a recorder on some other device keeps its session.
   */
  async releaseOn(deviceIds: readonly string[]): Promise<void> {
    const close = async () => {
      const held = this.attached?.split("\u0000")[1];
      if (held !== undefined && deviceIds.includes(held)) await this.releaseOnce();
    };
    const run = this.queue.then(close, close);
    this.queue = run.catch(() => undefined);
    await run;
  }

  private async releaseOnce(): Promise<void> {
    if (this.attached === undefined || this.client === undefined) return;
    this.attached = undefined;
    this.lastRefs = {};
    const held = this.attachedDevice;
    this.attachedDevice = undefined;
    try {
      await (await this.client).sessions.close({ session: SESSION });
    } catch (error) {
      // A session that is already gone is the state we wanted; anything else is worth knowing
      // about but must not fail the user's stop.
      captureServerError(error, "testing.release");
    }
    // Closing returns before the phone has torn the runner (and the app it drove) down; see `settlePhysicalIos`.
    if (held?.platform === "ios" && isHardwareUdid(held.deviceId)) await this.settle(held.deviceId).catch(() => undefined);
  }
}
