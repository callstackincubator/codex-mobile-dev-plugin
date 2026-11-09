import test from "node:test";
import assert from "node:assert/strict";
import { TestingDevices, projectedComponents } from "../src/testing-device.ts";
import { registerTestingTools } from "../src/testing-tools.ts";

/**
 * Stands in for `@e2e-dev/mobile`'s `projectSnapshot`. The real projection is the project's own
 * build and is exercised against a device in the recorded-flow check; what matters here is that
 * whatever it says about an element reaches the panel unchanged.
 */
const projection = {
  projectSnapshot(raw: readonly unknown[], { mintId }: { mintId: () => string }) {
    const index = (raw as Record<string, unknown>[]).map(node => ({
      id: mintId(), kind: String(node.kind ?? ""), node: node.node as Record<string, unknown>, parent: undefined,
    }));
    for (const [position, entry] of index.entries()) {
      const parent = (raw as Record<string, unknown>[])[position].parent;
      if (typeof parent === "number") (entry as { parent?: unknown }).parent = index[parent];
    }
    return { index, viewport: { width: 402, height: 874 } } as never;
  },
};

const rect = { x: 24, y: 476, width: 354, height: 35 };

test("the runner's own fields reach the panel untouched", () => {
  const { tree, screen } = projectedComponents(projection as never, [
    { kind: "tab-bar", node: { role: "tablist", name: "Tab Bar", text: "Tab Bar", rect } },
    { kind: "button", parent: 0, node: { role: "tab", name: "Explore", text: "Explore", rect } },
  ]);
  assert.deepEqual(screen, { width: 402, height: 874 });
  // `role` above all: the engine said `tab` for a button inside a tab bar, and nothing renames it.
  assert.equal(tree[1].role, "tab");
  assert.equal(tree[1].label, "Explore", "the runner's `name` is what getByRole and getByLabel match");
  assert.equal(tree[1].text, "Explore");
  assert.equal(tree[1].parentId, tree[0].nodeId, "the parent link the innermost-only rule needs");
  assert.equal(tree[1].depth, 1);
});

test("a placeholder and a hidden state survive the projection", () => {
  const { tree } = projectedComponents(projection as never, [
    { kind: "text-field", node: { role: "textbox", attributes: { placeholder: "Search transactions" }, value: "Search transactions", rect } },
    { kind: "static-text", node: { role: "text", name: "Gone", states: { hidden: true }, rect } },
  ]);
  assert.equal(tree[0].placeholder, "Search transactions");
  assert.equal(tree[0].label, undefined, "a field named only by its placeholder has no accessible name");
  // The name shown in the panel still has to say something, so it falls back to the placeholder.
  assert.equal(tree[0].name, "Search transactions");
  assert.equal(tree[1].hidden, true);
});

test("an element with no box is not something a tap could land on", () => {
  const { tree } = projectedComponents(projection as never, [
    { kind: "other", node: { role: "other", name: "Nowhere" } },
    { kind: "other", node: { role: "other", name: "Empty", rect: { x: 0, y: 0, width: 0, height: 10 } } },
    { kind: "text", node: { role: "text", name: "Here", rect } },
  ]);
  assert.deepEqual(tree.map(item => item.label), ["Here"]);
});

/** A client that records the calls made on it, so the attach options can be asserted. */
function fakeAgentDevice(calls: Record<string, unknown>[], snapshot: () => { nodes?: unknown }) {
  return async () => ({
    createAgentDeviceClient: () => ({
      apps: { open: async (options: Record<string, unknown>) => { calls.push({ call: "open", ...options }); } },
      capture: { snapshot: async (options: Record<string, unknown>) => { calls.push({ call: "snapshot", ...options }); return snapshot(); } },
      sessions: { close: async (options: Record<string, unknown>) => { calls.push({ call: "close", ...options }); } },
    }),
  });
}

const target = { udid: "11111111-2222-3333-4444-555555555555", projectPath: "/project", bundleId: "com.example.app" };

test("the recorder attaches to the running app and never relaunches it", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  // The projection is the project's; stub it so the test is about the session, not about roles.
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await devices.read(target);

  const open = calls.find(entry => entry.call === "open")!;
  // Relaunching would throw away the screen the user navigated to, which is the whole point.
  assert.equal(open.relaunch, false);
  assert.equal(open.app, "com.example.app");
  assert.equal(open.udid, target.udid);
  // `--foreground` refuses outright when more than one app is running, which is every real simulator.
  assert.equal(open.foreground, undefined);
  // The runner's own snapshot options: a different tree would resolve differently.
  assert.equal(calls.find(entry => entry.call === "snapshot")!.interactiveOnly, false);
});

test("a second read reuses the session rather than attaching again", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await devices.read(target);
  await devices.read(target);

  assert.equal(calls.filter(entry => entry.call === "open").length, 1);
  assert.equal(calls.filter(entry => entry.call === "snapshot").length, 2);
});

test("a session that went away is reattached once", async () => {
  const calls: Record<string, unknown>[] = [];
  let first = true;
  const devices = new TestingDevices(fakeAgentDevice(calls, () => {
    if (first) { first = false; throw new Error("iOS snapshot requires an active app session on the target device."); }
    return { nodes: [] };
  }) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await devices.read(target);

  assert.equal(calls.filter(entry => entry.call === "open").length, 2, "the app was closed under the panel; attach again");
});

test("releasing closes the session, so the next e2e run is not refused the device", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await devices.read(target);
  await devices.release();

  assert.equal(calls.filter(entry => entry.call === "close").length, 1);
  // Nothing is held any more, so releasing again is not a second close.
  await devices.release();
  assert.equal(calls.filter(entry => entry.call === "close").length, 1);

  // And the next read attaches from scratch.
  await devices.read(target);
  assert.equal(calls.filter(entry => entry.call === "open").length, 2);
});

test("a failed read still leaves the device releasable", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => { throw new Error("the runner fell over"); }) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await assert.rejects(devices.read(target), /fell over/);
  await devices.release();
  assert.equal(calls.filter(entry => entry.call === "close").length, 1);
});

test("a project without the mobile engine says so instead of guessing at roles", async () => {
  const devices = new TestingDevices(fakeAgentDevice([], () => ({ nodes: [] })) as never);
  await assert.rejects(
    devices.read({ ...target, projectPath: "/does/not/exist" }),
    /@e2e-dev\/mobile/,
  );
});

test("shutting the plugin down gives the recorder's device back", async () => {
  // A server that goes away without releasing leaves the claim behind, and the agent-device daemon
  // that holds it outlives the server. The user's own `e2e run` then refuses to boot the device
  // with "has an ownership claim that could not be verified", which points at nothing they did.
  const closed: unknown[] = [];
  const devices = new TestingDevices(async () => ({
    createAgentDeviceClient: () => ({
      apps: { open: async () => undefined },
      capture: { snapshot: async () => ({ nodes: [] }) },
      sessions: { close: async (options?: unknown) => { closed.push(options); } },
    }),
  }) as never);
  const server = { registerTool: () => undefined, registerResource: () => undefined } as never;
  const projects = { list: async () => [], choose: async () => undefined, record: async () => undefined } as never;
  const shutdown = registerTestingTools(server, projects, devices);
  // Nothing is attached, so there is nothing to give back and nothing is called.
  await shutdown();
  assert.deepEqual(closed, []);
  (devices as unknown as { attached?: string; client?: unknown }).attached = "udid";
  (devices as unknown as { client?: unknown }).client = (await (devices as unknown as { connect(): Promise<unknown> }).connect());
  await shutdown();
  assert.deepEqual(closed, [{ session: "mobile-dev-recorder" }]);
});
