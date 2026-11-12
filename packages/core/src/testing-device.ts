import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { ScreenComponent, ScreenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { APP_FLOW_DIRECTORY, loadVendoredAgentDevice } from "./app-flow-host.ts";
import { captureServerError } from "./telemetry.ts";

/**
 * The element tree the Testing panel's recorder names selectors from: the one the `e2e` runner
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
 * Baguette still owns the mirror. Only the recorder's *read* path moves, and the two hold the
 * same simulator at once: a snapshot taken while the mirror streams leaves the stream running and
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
  /** An iOS simulator UDID or an Android emulator's adb serial. */
  deviceId: string;
  platform: "ios" | "android";
  /** The e2e project whose `@e2e-dev/mobile` projects the snapshot; its build, not ours. */
  projectPath: string;
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
  return await dynamicImport(pathToFileURL(entry).href) as EngineProjection;
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

export function projectedComponents(projection: EngineProjection, nodes: readonly unknown[]): TestingDeviceTree {
  let minted = 0;
  const snapshot = projection.projectSnapshot(nodes, { mintId: () => `n${++minted}` });
  const tree: ScreenComponent[] = [];
  const refs: Record<string, string> = {};
  for (const entry of snapshot.index) {
    const component = toComponent(entry, depthOf(entry));
    if (!component) continue;
    tree.push(component);
    // agent-device's own refs are `@e20`; the projection strips the `@` for its own use, and
    // `interactions.click({ ref })` parses a bare `e20` as a selector and refuses it. So the
    // sigil is put back here, at the one boundary that hands a ref to agent-device.
    if (entry.ref) refs[entry.id] = entry.ref.startsWith("@") ? entry.ref : `@${entry.ref}`;
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
  /** Serialises reads: agent-device answers one command per session at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly load: typeof loadVendoredAgentDevice;

  constructor(load = loadVendoredAgentDevice) { this.load = load; }

  private async connect(): Promise<AgentDeviceClient> {
    pinStateDir();
    this.client ??= this.load().then(module => module.createAgentDeviceClient({}) as AgentDeviceClient);
    return this.client;
  }

  private projection(projectPath: string): Promise<EngineProjection> {
    let pending = this.projections.get(projectPath);
    if (!pending) {
      pending = loadProjection(projectPath);
      // A failed load must not be cached: the user installs the dependency and records again.
      pending.catch(() => this.projections.delete(projectPath));
      this.projections.set(projectPath, pending);
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
    await client.apps.open({
      ...this.selector(target), session: SESSION,
      app: target.bundleId, relaunch: false, noRecord: true, timeoutMs: 120_000,
    });
    this.attached = this.key(target);
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

  /** Platform-qualified, so the same string on another platform is never taken for a cached attach. */
  private key(target: TestingDeviceTarget): string { return `${target.platform}:${target.deviceId}`; }

  async read(target: TestingDeviceTarget): Promise<TestingDeviceTree> {
    const run = this.queue.then(() => this.readOnce(target), () => this.readOnce(target));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readOnce(target: TestingDeviceTarget): Promise<TestingDeviceTree> {
    const [client, projection] = await Promise.all([this.connect(), this.projection(target.projectPath)]);
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
    return projectedComponents(projection, snapshot.nodes);
  }

  /**
   * Takes the step an agent recording just recorded, on the same session the read used.
   *
   * Not the panel's own input path: the server cannot reach the mirror's stream, and this is the
   * better half of the trade anyway — agent-device places the action on the element's own ref, so
   * the tap lands where the runner's locator action will land rather than on a coordinate someone
   * computed from a rectangle. The mirror shows every change regardless, because the video stream
   * and the snapshot hold the same simulator at once.
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
    if (this.attached === undefined || this.client === undefined) return;
    this.attached = undefined;
    try {
      await (await this.client).sessions.close({ session: SESSION });
    } catch (error) {
      // A session that is already gone is the state we wanted; anything else is worth knowing
      // about but must not fail the user's stop.
      captureServerError(error, "testing.release");
    }
  }
}
