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
import { ServeEmu } from "../src/server/serve-emu.ts";
import { fakeInspectionSdk } from "./android-inspection-fixtures.ts";

const card = { source: "react-native", role: "Pressable", label: "Row", frame: { x: 10, y: 100, width: 350, height: 70 }, children: [
  { source: "react-native", role: "Text", label: "Title", frame: { x: 30, y: 120, width: 150, height: 20 }, children: [] },
] };

async function backend(t: TestContext) {
  let origin = "", calls = 0, targets: unknown[] = [], response: unknown = { available: true, tree: [card], windowWidth: 400, truncated: false };
  let sourceCalls = 0, sourceFailure = false;
  let hold = false;
  const http = createServer((request, reply) => {
    reply.setHeader("Content-Type", "application/json");
    if (request.url === "/symbolicate") {
      sourceCalls++;
      let body = "";
      request.on("data", bytes => { body += bytes; });
      request.on("end", () => {
        if (sourceFailure) { reply.statusCode = 404; reply.end("{}"); return; }
        const frames = JSON.parse(body).stack;
        reply.end(JSON.stringify({ stack: frames.map((frame: { methodName: string }, index: number) => ({ ...frame,
          file: index % 3 === 0 ? "/project/node_modules/react/jsx-runtime.js" : "/project/src/HomeScreen.tsx",
          lineNumber: 49, column: 10, methodName: index % 3 === 0 ? "jsx" : "HomeScreen.renderItem", collapse: index % 3 === 0,
        })) }));
      });
    } else reply.end(JSON.stringify(targets));
  });
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
  return { origin, target, setTargets: (value: unknown[]) => { targets = value; }, setResponse: (value: unknown) => { response = value; }, sourceFailure: () => { sourceFailure = true; }, sourceCalls: () => sourceCalls, hold: () => { hold = true; }, calls: () => calls, bindings, ws };
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

test("a display name that differs from the bundle ID matches the foreground app on the same device", async t => {
  const server = await backend(t);
  const expo = { ...server.target, id: "expo", appId: "host.exp.Exponent" };
  const otherDevice = { ...expo, id: "android", deviceName: "Pixel 9" };
  server.setTargets([expo, otherDevice]);
  let lookups = 0;
  const resolveForegroundAppId = async () => { lookups++; return "host.exp.Exponent"; };
  assert.equal((await inspectReactNative({ ...request, appName: "Expo Go", url: server.origin })).available, false);
  assert.equal((await inspectReactNative({ ...request, appName: "Expo Go", resolveForegroundAppId, url: server.origin })).available, true);
  assert.equal(lookups, 1);

  // A backgrounded React Native app never stands in for a different foreground app.
  const native = async () => "com.example.native";
  assert.equal((await inspectReactNative({ ...request, appName: "Expo Go", resolveForegroundAppId: native, url: server.origin })).available, false);
  const failing = async () => { throw new Error("foreground unavailable"); };
  assert.equal((await inspectReactNative({ ...request, appName: "Expo Go", resolveForegroundAppId: failing, url: server.origin })).available, false);

  // Name matches skip the lookup.
  server.setTargets([server.target]);
  assert.equal((await inspectReactNative({ ...request, resolveForegroundAppId, url: server.origin })).available, true);
  assert.equal(lookups, 1);
});

test("Android runtime bounds convert from DIPs to screen pixels", async t => {
  const server = await backend(t);
  const result = await inspectReactNative({ ...request, url: server.origin, platform: "android", appId: server.target.appId, screenWidth: 1200 });
  assert.equal(result.available, true);
  if (result.available) assert.deepEqual(result.tree[0].frame, { x: 30, y: 300, width: 1050, height: 210 });
});

test("flat debugger snapshots preserve deep parent links through Android scaling", async t => {
  const server = await backend(t);
  server.setResponse({ available: true, windowWidth: 400, truncated: false, tree: [
    { source: "react-native", role: "Pressable", label: "Row", frame: card.frame, nodeId: "rn-row", depth: 280 },
    { source: "react-native", role: "Text", label: "Subtitle", frame: card.children[0].frame, nodeId: "rn-subtitle", parentId: "rn-row", depth: 285 },
  ] });
  const result = await inspectReactNative({ ...request, url: server.origin, platform: "android", screenWidth: 1200 });
  assert.equal(result.available, true);
  if (!result.available) return;
  const components = screenComponents(result.tree);
  assert.deepEqual(componentsAt(components, { x: 120, y: 375 }).map(node => node.name), ["Subtitle", "Row"]);
  assert.equal(components[1].depth, 285);
  assert.equal(components[1].parentId, "rn-row");
});

test("MCP inspection resolves shared creation stacks to app JSX without leaking bundle URLs", async t => {
  const server = await backend(t);
  const base = { ...card, children: [], react: { component: "Text", owners: ["HomeScreen", "Text"] }, creationStackIds: [0] };
  server.setResponse({ available: true, windowWidth: 400, tree: [base, { ...base, label: "Second row" }], sourceUrls: [`${server.origin}/index.bundle?platform=ios`], sourceStacks: [[
    { url: 0, line: 150, column: 10, methodName: "jsx" }, { url: 0, line: 300, column: 12, methodName: "renderItem" },
  ]] });
  const result = await inspectReactNative({ ...request, url: server.origin });
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(server.sourceCalls(), 1, "Resolve all elements in one request.");
  const components = screenComponents(result.tree);
  assert.deepEqual(components[0].react?.source, { file: "/project/src/HomeScreen.tsx", line: 49, column: 11, functionName: "HomeScreen.renderItem" });
  assert.deepEqual(components[1].react?.source, components[0].react?.source);
  assert.deepEqual(components[0].react?.owners, ["HomeScreen", "Text"]);
  assert.equal(components[0].react?.sourceKind, "element");
  assert.doesNotMatch(JSON.stringify(result), /index\.bundle|creationStackIds|ownerStackIds|sourceStacks/);
  server.sourceFailure();
  const fallback = await inspectReactNative({ ...request, url: server.origin });
  assert.equal(fallback.available, true);
  if (fallback.available) assert.equal(fallback.tree[0].react?.source, undefined);
});

test("source resolution never forwards stack URLs from another server", async t => {
  const server = await backend(t);
  server.setResponse({ available: true, windowWidth: 400, tree: [{ ...card, react: { component: "Text", owners: ["HomeScreen"] }, creationStackIds: [0] }], sourceUrls: ["http://example.com/index.bundle"], sourceStacks: [[{ url: 0, line: 100, column: 10, methodName: "renderItem" }]] });
  const result = await inspectReactNative({ ...request, url: server.origin });
  assert.equal(result.available, true);
  assert.equal(server.sourceCalls(), 0);
});

test("source lookup labels an owner fallback and strips its transport-only stack IDs", async t => {
  const server = await backend(t);
  server.setResponse({ available: true, windowWidth: 400, tree: [{ ...card, children: [], react: { component: "Text", owners: ["Card"], key: "subtitle" }, creationStackIds: [0], ownerStackIds: [1] }],
    sourceUrls: [`${server.origin}/index.bundle?platform=ios`], sourceStacks: [
      [{ url: 0, line: 150, column: 10, methodName: "jsx" }],
      [{ url: 0, line: 300, column: 12, methodName: "Card" }],
    ],
  });
  const result = await inspectReactNative({ ...request, url: server.origin });
  assert.equal(result.available, true);
  if (!result.available) return;
  const selected = screenComponents(result.tree)[0];
  assert.equal(selected.react?.sourceKind, "owner");
  assert.equal(selected.react?.key, "subtitle");
  assert.equal(selected.react?.source?.file, "/project/src/HomeScreen.tsx");
  assert.doesNotMatch(JSON.stringify(result), /creationStackIds|ownerStackIds|sourceStacks|index\.bundle/);
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
    assert.equal(result.tree[1].identifier, "card");
    assert.equal(result.tree[1].parentId, result.tree[0].nodeId);
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

test("Android MCP inspection aligns native and React bounds with downscaled video and discovers SDK-only adb", async t => {
  await fakeInspectionSdk(t);
  const inspector = await backend(t);
  inspector.setTargets([{ ...inspector.target, deviceName: "sdk_gphone64_arm64" }]);
  const native = await fakeBaguette();
  class Android extends ServeEmu {
    async accessibility() {
      return { screen: { width: 1080, height: 2400 }, tree: { nodes: [
        { text: "Continue", packageName: "com.example.playground", resourceId: "app:id/continue", className: "android.widget.Button", bounds: { left: 270, top: 1200, right: 810, bottom: 1350 } },
      ] } };
    }
  }
  const plugin = await createTestPlugin("<canvas></canvas>", new Baguette(native.url), fakeSimulatorInput(), undefined, new Android());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "android-inspection-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await native.close(); });
  await plugin.server.connect(serverTransport); await client.connect(clientTransport);
  const args = { platform: "android", deviceId: "emulator-5554", deviceName: "Pixel_8_API_36", screenWidth: 576, metroUrl: inspector.origin };
  for (const runtimeAvailable of [true, false]) {
    if (!runtimeAvailable) inspector.setTargets([]);
    const result = await client.callTool({ name: "mobile_inspect_ui", arguments: args });
    assert.notEqual(result.isError, true);
    assert.equal((result.structuredContent?.runtime as { available: boolean }).available, runtimeAvailable);
    const components = screenComponents(result.structuredContent?.tree);
    const hit = componentAt(components, { x: 288, y: 680 }, { width: 576, height: 1280 });
    assert.equal(hit?.name, "Continue");
    assert.deepEqual(hit?.bounds, { x: 144, y: 640, width: 288, height: 80 });
    assert.equal(hit?.identifier, "app:id/continue");
    if (runtimeAvailable) assert.equal(componentAt(components, { x: 432, y: 187 })?.source, "react-native");
  }
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

function collectFibers(fiber: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__");
  Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { configurable: true, value: { renderers: new Map([[1, { rendererPackageName: "react-native-renderer" }]]), getFiberRoots: () => new Set([{ current: fiber }]) } });
  try { return collectReactNativeTree() as { available: boolean; tree: InspectorNode[]; truncated: boolean }; }
  finally { if (previous) Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", previous); else delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__; }
}

function nativeFiber(type: string, frame: typeof card.frame, props = {}) {
  return { tag: 5, type, memoizedProps: props, stateNode: { canonical: { publicInstance: { isConnected: true, getBoundingClientRect: () => frame } } } };
}

test("deep catalog screens retain all ten rows and separate title and subtitle bounds", () => {
  const rows = Array.from({ length: 10 }, (_, index) => {
    const y = 140 + index * 64;
    const title = nativeFiber("RCTText", { x: 32, y: y + 8, width: 327, height: 20 }, { children: `Title ${index}` });
    const subtitle = nativeFiber("RCTText", { x: 32, y: y + 32, width: 327, height: 17 }, { children: `Subtitle ${index}` });
    return { ...nativeFiber("Pressable", { x: 16, y, width: 370, height: 60 }), child: { ...title, sibling: subtitle }, sibling: undefined as unknown };
  });
  rows.forEach((row, index) => { row.sibling = rows[index + 1]; });
  let fiber: unknown = rows[0];
  for (let index = 0; index < 280; index++) fiber = { tag: 10, type: { displayName: "Context" }, child: fiber };
  const result = collectFibers({ ...nativeFiber("RCTView", { x: 0, y: 0, width: 400, height: 900 }), child: fiber });
  assert.equal(result.available, true);
  assert.equal(result.truncated, false);
  const components = screenComponents(JSON.parse(JSON.stringify(result.tree)));
  assert.equal(components.filter(node => node.role === "Pressable").length, 10);
  for (let index = 0; index < 10; index++) {
    const y = 140 + index * 64;
    assert.equal(componentAt(components, { x: 100, y: y + 15 }, { width: 400, height: 900 })?.name, `Title ${index}`);
    assert.equal(componentAt(components, { x: 100, y: y + 38 }, { width: 400, height: 900 })?.name, `Subtitle ${index}`);
    assert.deepEqual(componentsAt(components, { x: 100, y: y + 38 }, { width: 400, height: 900 }).map(node => node.role), ["RCTText", "Pressable"]);
  }
  assert.ok(!JSON.stringify(result).includes('"children"'), "The debugger transport must also remain flat.");
});

test("retained native-stack screens do not cover visible text, and decorative text stays selectable", () => {
  const title = nativeFiber("RCTText", card.frame, { children: "Visible title" });
  const decorative = nativeFiber("RCTText", { x: 370, y: 100, width: 10, height: 20 }, { children: "›", "aria-hidden": true });
  const active = { type: "Screen", memoizedProps: { activityState: 2, "aria-hidden": false }, child: { ...title, sibling: decorative } };
  const retained = { type: "Screen", memoizedProps: { activityState: 2, "aria-hidden": true }, child: nativeFiber("RCTText", { ...card.frame, width: 50, height: 20 }, { children: "Old home title" }), sibling: active };
  const components = screenComponents(collectFibers(retained).tree);
  assert.equal(componentAt(components, { x: 20, y: 105 })?.name, "Visible title");
  assert.equal(components.some(node => node.name === "Old home title"), false);
  assert.equal(componentAt(components, { x: 375, y: 105 })?.name, "›");
});

test("the collector keeps React owners and deduplicates creation stacks, including numeric text", () => {
  const creation = { stack: "Error: react-stack-top-frame\n    at jsx (http://localhost:8081/index.bundle:150:11)\n    at Counter (http://localhost:8081/index.bundle:300:13)" };
  const screen = { type: { name: "CounterScreen" }, _debugStack: creation, _debugOwner: undefined as unknown };
  screen._debugOwner = screen;
  const owner = { type: { render: { name: "Text" } }, _debugOwner: screen, _debugStack: creation };
  const target = { ...nativeFiber("RCTText", card.frame, { children: 0 }), _debugOwner: owner, _debugStack: creation };
  const result = collectFibers({ ...target, sibling: { ...target, memoizedProps: { children: 1 } } }) as ReturnType<typeof collectFibers> & { sourceUrls: string[]; sourceStacks: unknown[] };
  assert.equal(result.tree[0].label, "0");
  assert.deepEqual(result.tree[0].react, { component: "Text", owners: ["CounterScreen", "Text"] });
  assert.deepEqual(result.tree[0].creationStackIds, [0]);
  assert.equal(result.sourceStacks.length, 1);
  assert.equal(result.sourceUrls.length, 1);
});

test("the iterative collector reports its work limit instead of silently cutting off deep fibers", () => {
  let fiber: unknown = nativeFiber("RCTText", card.frame);
  for (let index = 0; index < 11000; index++) fiber = { tag: 10, child: fiber };
  const result = collectFibers({ ...nativeFiber("RCTView", { x: 0, y: 0, width: 400, height: 900 }), child: fiber });
  assert.equal(result.truncated, true);
});

test("the collector separates selected creation stacks from owner stacks and keeps the selected React key", () => {
  const owner = { type: { name: "Card" }, _debugStack: { stack: "Error\n    at Screen (http://localhost:8081/index.bundle:300:13)" } };
  const target = { ...nativeFiber("RCTText", card.frame, { children: "Subtitle" }), key: "subtitle", _debugOwner: owner };
  const result = collectFibers(target);
  assert.deepEqual(result.tree[0].creationStackIds, []);
  assert.deepEqual(result.tree[0].ownerStackIds, [0]);
  assert.equal(result.tree[0].react?.key, "subtitle");
  const ownStack = { stack: "Error\n    at Card (http://localhost:8081/index.bundle:400:13)" };
  const exact = collectFibers({ ...target, _debugStack: ownStack });
  assert.deepEqual(exact.tree[0].creationStackIds, [0]);
  assert.deepEqual(exact.tree[0].ownerStackIds, [1]);
});
