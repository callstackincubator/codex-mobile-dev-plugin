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
interface ProjectedNode { id: string; kind: string; node: SemanticNode; parent?: ProjectedNode }
interface ProjectedSnapshot { index: readonly ProjectedNode[]; viewport?: ScreenSize }
interface EngineProjection {
  projectSnapshot(raw: readonly unknown[], options: { mintId: () => string }): ProjectedSnapshot;
}

/** What one device's recording session needs to attach to the app the user is already tapping. */
export interface TestingDeviceTarget {
  udid: string;
  /** The e2e project whose `@e2e-dev/mobile` projects the snapshot; its build, not ours. */
  projectPath: string;
  /** The app to attach to, from the project's config. Never launched fresh — see `attach`. */
  bundleId: string;
}

export interface TestingDeviceTree {
  tree: ScreenComponent[];
  screen?: ScreenSize;
}

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
  for (const entry of snapshot.index) {
    const component = toComponent(entry, depthOf(entry));
    if (component) tree.push(component);
  }
  return { tree, ...(snapshot.viewport ? { screen: snapshot.viewport } : {}) };
}

type AgentDeviceClient = {
  apps: { open(options: Record<string, unknown>): Promise<unknown> };
  capture: { snapshot(options: Record<string, unknown>): Promise<{ nodes?: unknown }> };
  sessions: { close(options?: Record<string, unknown>): Promise<unknown> };
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
      platform: "ios", udid: target.udid, session: SESSION,
      app: target.bundleId, relaunch: false, noRecord: true, timeoutMs: 120_000,
    });
    this.attached = target.udid;
  }

  /** The runner's own snapshot call, with the runner's own options: a different tree is a different test. */
  private snapshot(client: AgentDeviceClient, udid: string): Promise<{ nodes?: unknown }> {
    return client.capture.snapshot({ platform: "ios", udid, session: SESSION, interactiveOnly: false });
  }

  async read(target: TestingDeviceTarget): Promise<TestingDeviceTree> {
    const run = this.queue.then(() => this.readOnce(target), () => this.readOnce(target));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readOnce(target: TestingDeviceTarget): Promise<TestingDeviceTree> {
    const [client, projection] = await Promise.all([this.connect(), this.projection(target.projectPath)]);
    if (this.attached !== target.udid) await this.attach(client, target);
    let snapshot: { nodes?: unknown };
    try {
      snapshot = await this.snapshot(client, target.udid);
    } catch (error) {
      // The session can go while the panel is idle — the app was closed, the runner was swept. One
      // reattach, then the failure is real and the panel says so.
      if (!needsAttach(error)) throw error;
      this.attached = undefined;
      await this.attach(client, target);
      snapshot = await this.snapshot(client, target.udid);
    }
    if (!Array.isArray(snapshot.nodes)) throw new Error("The device snapshot returned no nodes.");
    return projectedComponents(projection, snapshot.nodes);
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
