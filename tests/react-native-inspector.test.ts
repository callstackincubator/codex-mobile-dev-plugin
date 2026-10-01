import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { inspectReactNative, readSnapshot, type InspectorNode } from "../src/server/react-native-inspector.ts";
import { collectReactNativeTree } from "../src/server/react-native-snapshot.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Baguette } from "../src/server/baguette.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput, UDID } from "./fixtures.ts";
import { screenComponents, componentAt, componentsAt } from "../src/shared/screen-annotations.ts";

const card = { source: "react-native", role: "Pressable", label: "Row", frame: { x: 10, y: 100, width: 350, height: 70 }, children: [
  { source: "react-native", role: "Text", label: "Title", frame: { x: 30, y: 120, width: 150, height: 20 }, children: [] },
] };

async function backend(t: TestContext) {
  let origin = "", calls = 0, targets: unknown[] = [], response: unknown = { available: true, tree: [card], windowWidth: 400, truncated: false };
  let hold = false;
  const http = createServer((_request, reply) => { reply.setHeader("Content-Type", "application/json"); reply.end(JSON.stringify(targets)); });
  const ws = new WebSocketServer({ server: http, verifyClient: info => info.origin === origin });
  const bindings = new Set<string>();
  ws.on("connection", socket => {
    let binding = "";
    socket.on("message", data => {
      const message = JSON.parse(data.toString());
      if (message.method === "Runtime.addBinding") {
        binding = message.params.name;
        bindings.add(binding);
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      } else if (message.method === "Runtime.removeBinding") {
        bindings.delete(message.params.name);
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      } else if (message.id === 4) {
        assert.match(message.params.expression, /^delete globalThis/);
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      } else {
        calls++;
        assert.equal(message.method, "Runtime.evaluate");
        assert.equal(message.params.silent, true);
        assert.equal(message.params.awaitPromise, undefined);
        assert.match(message.params.expression, /getBoundingClientRect/);
        assert.doesNotMatch(message.params.expression, /setNativeProps|overrideProps/);
        socket.send(JSON.stringify({ id: message.id, result: {} }));
        if (!hold) socket.send(JSON.stringify({ method: "Runtime.bindingCalled", params: { name: binding, payload: JSON.stringify(response) } }));
      }
    });
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const target = { id: "app", appId: "com.example.playground", deviceName: "iPhone 17", webSocketDebuggerUrl: origin.replace("http:", "ws:") + "/inspector", reactNative: { capabilities: { supportsMultipleDebuggers: true } } };
  targets = [target];
  t.after(async () => { for (const socket of ws.clients) socket.terminate(); await new Promise<void>(resolve => ws.close(() => http.close(() => resolve()))); });
  return { origin, target, setTargets: (value: unknown[]) => { targets = value; }, setResponse: (value: unknown) => { response = value; }, hold: () => { hold = true; }, calls: () => calls, bindings, ws };
}

const request = { deviceName: "iPhone 17", appName: "playground", platform: "ios" as const, screenWidth: 400 };

test("MCP-side inspection uses the required origin and preserves selectable rows and parents", async t => {
  const server = await backend(t);
  const result = await inspectReactNative({ ...request, url: server.origin });
  assert.equal(result.available, true);
  if (!result.available) return;
  const components = screenComponents(result.tree);
  assert.equal(componentAt(components, { x: 300, y: 130 })?.name, "Row");
  assert.deepEqual(componentsAt(components, { x: 40, y: 125 }).map(node => node.name), ["Title", "Row"]);
  assert.equal(components[0].source, "react-native");
  assert.equal(server.calls(), 1);
  assert.equal(server.bindings.size, 0, "Temporary debugger bindings are removed before returning.");
});

test("automatic inspection refuses ambiguous apps, wrong devices and exclusive debugger targets", async t => {
  const server = await backend(t);
  server.setTargets([server.target, { ...server.target, id: "second" }]);
  assert.equal((await inspectReactNative({ ...request, url: server.origin })).available, false);
  server.setTargets([{ ...server.target, deviceName: "Different phone" }]);
  assert.equal((await inspectReactNative({ ...request, url: server.origin })).available, false);
  server.setTargets([{ ...server.target, appId: "com.example.other" }]);
  assert.equal((await inspectReactNative({ ...request, url: server.origin })).available, false);
  server.setTargets([{ ...server.target, reactNative: { capabilities: { supportsMultipleDebuggers: false } } }]);
  assert.equal((await inspectReactNative({ ...request, url: server.origin })).available, false);
  assert.equal(server.calls(), 0);
});

test("Android runtime bounds convert from DIPs to screen pixels", async t => {
  const server = await backend(t);
  const result = await inspectReactNative({ ...request, url: server.origin, platform: "android", appId: server.target.appId, screenWidth: 1200 });
  assert.equal(result.available, true);
  if (result.available) assert.deepEqual(result.tree[0].frame, { x: 30, y: 300, width: 1050, height: 210 });
});

test("inspection cancels its socket and rejects invalid native bounds", async t => {
  const server = await backend(t);
  server.setResponse({ available: true, tree: [{ ...card, frame: { ...card.frame, width: -1 } }], windowWidth: 400 });
  await assert.rejects(inspectReactNative({ ...request, url: server.origin }));
  server.hold();
  const controller = new AbortController();
  const reading = readSnapshot(server.target.webSocketDebuggerUrl, controller.signal);
  controller.abort();
  await assert.rejects(reading, /cancelled/);
});

test("runtime adapter reads native bounds, keeps logical parents and excludes unrelated props", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__");
  const host = { tag: 5, type: "RCTView", memoizedProps: { testID: "card", secret: "PRIVATE_APP_PROP" }, stateNode: { canonical: { publicInstance: { getBoundingClientRect: () => card.frame } } } };
  const fiber = { type: { displayName: "CardRow" }, child: host };
  Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { configurable: true, value: { renderers: new Map([[1, { rendererPackageName: "react-native-renderer" }]]), getFiberRoots: () => new Set([{ current: fiber }]) } });
  try {
    const result = collectReactNativeTree() as { available: boolean; tree: InspectorNode[] };
    assert.equal(result.available, true);
    assert.equal(result.tree[0].label, "CardRow");
    assert.deepEqual(result.tree[0].frame, card.frame);
    assert.equal(result.tree[0].children[0].identifier, "card");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_APP_PROP/);
  } finally { if (previous) Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", previous); else delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__; }
});


test("the panel receives runtime and native elements through an MCP tool, with native fallback", async t => {
  const inspector = await backend(t);
  const native = await fakeBaguette();
  const plugin = await createTestPlugin("<canvas></canvas>", new Baguette(native.url), fakeSimulatorInput());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "inspection-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await native.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const args = { platform: "ios", deviceId: UDID, deviceName: "iPhone 17", screenWidth: 400, metroUrl: inspector.origin, targetId: "app" };
  const result = await client.callTool({ name: "mobile_inspect_ui", arguments: args });
  assert.notEqual(result.isError, true);
  const components = screenComponents(result.structuredContent?.tree);
  assert.equal(componentAt(components, { x: 300, y: 130 })?.source, "react-native");
  assert.equal(componentAt(components, { x: 50, y: 40 })?.name, "Continue");
  inspector.setTargets([]);
  const fallback = await client.callTool({ name: "mobile_inspect_ui", arguments: args });
  assert.notEqual(fallback.isError, true);
  assert.equal(componentAt(screenComponents(fallback.structuredContent?.tree), { x: 50, y: 40 })?.name, "Continue");
  assert.equal(inspector.calls(), 1);
});

test("deep runtime trees cross MCP as shallow records with their parent links intact", async t => {
  const inspector = await backend(t);
  let tree: Record<string, unknown> = card;
  for (let i = 0; i < 90; i++) tree = { source: "react-native", role: `Wrapper${i}`, frame: { x: 0, y: 0, width: 400, height: 800 }, children: [tree] };
  inspector.setResponse({ available: true, tree: [tree], windowWidth: 400, truncated: false });
  const native = await fakeBaguette();
  const plugin = await createTestPlugin("<canvas></canvas>", new Baguette(native.url), fakeSimulatorInput());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "inspection-depth-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await native.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "mobile_inspect_ui", arguments: { platform: "ios", deviceId: UDID, deviceName: "iPhone 17", screenWidth: 400, metroUrl: inspector.origin, targetId: "app" } });
  assert.notEqual(result.isError, true);
  const pending: [unknown, number][] = [[result, 0]];
  let depth = 0;
  while (pending.length) {
    const [value, level] = pending.pop()!;
    if (!value || typeof value !== "object") continue;
    depth = Math.max(depth, level + 1);
    for (const child of Object.values(value)) pending.push([child, level + 1]);
  }
  assert.ok(depth <= 8, `MCP JSON must stay below host decoder limits; received depth ${depth}.`);
  const components = screenComponents(result.structuredContent?.tree);
  assert.equal(components.filter(node => node.source === "react-native").length, 92);
  assert.equal(componentAt(components, { x: 300, y: 130 }, { width: 400, height: 800 })?.name, "Row");
  assert.deepEqual(componentsAt(components, { x: 40, y: 125 }, { width: 400, height: 800 }).map(node => node.name), ["Title", "Row"]);
  assert.equal(componentAt(components, { x: 50, y: 40 }, { width: 400, height: 800 })?.name, "Continue");
});


test("native screen fallback returns asynchronous bounds through the temporary binding", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__");
  const host = { tag: 5, type: "RCTView", stateNode: { canonical: { publicInstance: {
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    measureInWindow: (callback: (...values: number[]) => void) => queueMicrotask(() => callback(10, 100, 350, 70)),
  } } } };
  Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { configurable: true, value: { renderers: new Map([[1, { rendererPackageName: "react-native-renderer" }]]), getFiberRoots: () => new Set([{ current: host }]) } });
  try {
    const result = await new Promise<{ available: boolean; tree: InspectorNode[] }>(resolve => collectReactNativeTree(value => resolve(value as { available: boolean; tree: InspectorNode[] })));
    assert.equal(result.available, true);
    assert.deepEqual(result.tree[0].frame, card.frame);
  } finally { if (previous) Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", previous); else delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__; }
});

test("deep navigation wrappers retain runtime card rows and real enclosing elements", () => {
  let tree: Record<string, unknown> = { source: "react-native", role: "Pressable", label: "Card", frame: card.frame, children: [] };
  for (let i = 0; i < 90; i++) tree = { source: "react-native", role: `Wrapper${i}`, frame: { x: 0, y: 0, width: 400, height: 800 }, children: [tree] };
  const components = screenComponents(tree);
  assert.equal(componentAt(components, { x: 200, y: 105 }, { width: 400, height: 800 })?.name, "Card");
});
