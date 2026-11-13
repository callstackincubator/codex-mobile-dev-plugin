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
      id: mintId(), kind: String(node.kind ?? ""), ref: node.ref as string | undefined,
      node: node.node as Record<string, unknown>, parent: undefined,
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
      interactions: {
        scroll: async (options: Record<string, unknown>) => { calls.push({ call: "scroll", ...options }); },
        click: async (options: Record<string, unknown>) => { calls.push({ call: "click", ...options }); },
        fill: async (options: Record<string, unknown>) => { calls.push({ call: "fill", ...options }); },
        swipe: async (options: Record<string, unknown>) => { calls.push({ call: "swipe", ...options }); },
      },
    }),
  });
}

const target = { deviceId: "11111111-2222-3333-4444-555555555555", platform: "ios" as const, projectPath: "/project", bundleId: "com.example.app" };

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
  assert.equal(open.udid, target.deviceId);
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
      interactions: { click: async () => undefined, fill: async () => undefined, swipe: async () => undefined, scroll: async () => undefined },
    }),
  }) as never);
  const server = { registerTool: () => undefined, registerResource: () => undefined } as never;
  const projects = { list: async () => [], choose: async () => undefined, record: async () => undefined } as never;
  const shutdown = registerTestingTools(server, projects, devices);
  // Nothing is attached, so there is nothing to give back and nothing is called.
  await shutdown();
  assert.deepEqual(closed, []);
  (devices as unknown as { attached?: string; client?: unknown }).attached = "ios:udid";
  (devices as unknown as { client?: unknown }).client = (await (devices as unknown as { connect(): Promise<unknown> }).connect());
  await shutdown();
  assert.deepEqual(closed, [{ session: "mobile-dev-recorder" }]);
});

test("each element keeps the agent-device ref an action is placed on", () => {
  // The panel never needs these — it records selectors and drives the mirror — but an agent
  // recording acts through agent-device, whose tap and fill take a ref. Keeping the pair beside
  // the projection is what stops the server resolving the same element a second time.
  const { tree, refs } = projectedComponents(projection as never, [
    { kind: "button", ref: "e1", node: { role: "tab", name: "Explore", rect } },
    { kind: "other", ref: "e2", node: { role: "other", name: "Nowhere" } },
  ]);
  // The `@` the projection stripped is put back: `click({ ref: "e1" })` parses a bare ref as a
  // selector and refuses it with `Invalid selector term "e1", expected key=value`.
  assert.deepEqual(refs, { [tree[0].nodeId!]: "@e1" }, "an element with no box is not in the tree, so it has no ref either");
});

test("disabled and selected survive the projection, for the matchers that read them", () => {
  const { tree } = projectedComponents(projection as never, [
    { kind: "button", node: { role: "tab", name: "Explore", states: { selected: true }, rect } },
    { kind: "button", node: { role: "button", name: "Save", states: { disabled: true }, rect } },
  ]);
  assert.equal(tree[0].selected, true);
  assert.equal(tree[0].disabled, undefined);
  assert.equal(tree[1].disabled, true);
});

test("an agent recording's step is placed on the element's own ref, on the recorder's session", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await devices.read(target);
  await devices.perform(target, { kind: "tap", ref: "e1" });
  await devices.perform(target, { kind: "doubleTap", ref: "e1" });
  await devices.perform(target, { kind: "type", ref: "e2", text: "Roaming Rosa" });
  await devices.perform(target, { kind: "swipe", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });

  const clicks = calls.filter(entry => entry.call === "click");
  assert.deepEqual(clicks.map(entry => entry.ref), ["e1", "e1"]);
  // One session, the recorder's: an agent recording is another holder of it, never a second one.
  assert.ok(clicks.every(entry => entry.session === "mobile-dev-recorder" && entry.udid === target.deviceId));
  assert.equal(clicks[0].doubleTap, undefined);
  // The next step is resolved against the screen this one produced, so the wait for that screen
  // to stop moving belongs here; without it agent-device refuses the next action outright.
  assert.equal(clicks[0].settle, true);
  assert.equal(calls.find(entry => entry.call === "fill")!.settle, true);
  assert.equal(calls.find(entry => entry.call === "swipe")!.settle, undefined, "a swipe has no element to come to rest");
  assert.equal(clicks[1].doubleTap, true, "agent-device takes the double tap as the one gesture the step emits");
  const fill = calls.find(entry => entry.call === "fill")!;
  assert.equal(fill.text, "Roaming Rosa");
  assert.deepEqual(calls.find(entry => entry.call === "swipe")!.from, { x: 1, y: 2 });
  // Nothing re-attached: the step runs on the session the read already opened.
  assert.equal(calls.filter(entry => entry.call === "open").length, 1);
});

test("a step on a device nothing is attached to attaches first", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  await devices.perform(target, { kind: "tap", ref: "e1" });
  assert.equal(calls.filter(entry => entry.call === "open").length, 1);
  assert.equal(calls.find(entry => entry.call === "open")!.relaunch, false);
});

test("an Android emulator is addressed by serial, never udid, on every call", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));
  const android = { ...target, deviceId: "emulator-5554", platform: "android" as const };

  await devices.read(android);
  await devices.perform(android, { kind: "tap", ref: "e1" });
  await devices.perform(android, { kind: "type", ref: "e2", text: "hi" });
  await devices.perform(android, { kind: "scroll", direction: "down" });
  await devices.perform(android, { kind: "swipe", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });

  const names = ["open", "snapshot", "click", "fill", "scroll", "swipe"];
  for (const call of names) {
    const entry = calls.find(item => item.call === call)!;
    assert.ok(entry, call);
    assert.equal(entry.platform, "android", call);
    assert.equal(entry.serial, "emulator-5554", call);
    assert.equal(entry.udid, undefined, call);
  }
  assert.equal(calls.find(item => item.call === "open")!.relaunch, false);
});

test("the same id on another platform is not a cached attach", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await devices.read(target);
  await devices.read({ ...target, platform: "android" });

  assert.equal(calls.filter(entry => entry.call === "open").length, 2);
});

test("changing project or bundle on one device is not a cached attach", async () => {
  const calls: Record<string, unknown>[] = [];
  const devices = new TestingDevices(fakeAgentDevice(calls, () => ({ nodes: [] })) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/other-project", Promise.resolve(projection));

  await devices.read(target);
  await devices.read({ ...target, bundleId: "com.example.other" });
  await devices.read({ ...target, projectPath: "/other-project" });

  assert.equal(calls.filter(entry => entry.call === "open").length, 3);
});

test("release finishes before a later read can attach a new session", async () => {
  const calls: Record<string, unknown>[] = [];
  let finishClose!: () => void;
  const close = new Promise<void>(resolve => { finishClose = resolve; });
  const devices = new TestingDevices(async () => ({
    createAgentDeviceClient: () => ({
      apps: { open: async (options: Record<string, unknown>) => { calls.push({ call: "open", ...options }); } },
      capture: { snapshot: async () => ({ nodes: [] }) },
      sessions: { close: async () => { calls.push({ call: "close" }); await close; } },
      interactions: { click: async () => {}, fill: async () => {}, swipe: async () => {}, scroll: async () => {} },
    }),
  }) as never);
  (devices as unknown as { projections: Map<string, unknown> }).projections.set("/project", Promise.resolve(projection));

  await devices.read(target);
  const releasing = devices.release();
  const reading = devices.read({ ...target, bundleId: "com.example.next" });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.filter(entry => entry.call === "open").length, 1, "the new attach waits for close");
  finishClose();
  await Promise.all([releasing, reading]);
  assert.deepEqual(calls.map(entry => entry.call), ["open", "close", "open"]);
});
