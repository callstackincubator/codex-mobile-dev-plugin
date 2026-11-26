import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTraceSiftTools } from "../src/tracesift-tools.ts";
import { TraceSiftError } from "../src/tracesift-client.ts";
import type { TraceSiftClient } from "../src/tracesift-client.ts";

/** Crosses the boundary the card's frame will: the SDK validates the envelope on both sides. */
function deepTree(depth: number) {
  let node: Record<string, unknown> = { id: `n${depth}`, name: "leaf", frameClass: "app", totalMs: 1, selfMs: 1, invocations: 1, children: [] };
  for (let level = depth - 1; level >= 0; level--) node = { id: `n${level}`, name: `frame-${level}`, frameClass: "app", totalMs: 100, selfMs: 0, invocations: 1, children: [node] };
  return node;
}

async function connect(client: Partial<TraceSiftClient>) {
  // A throwaway server, not the plugin fixture: the telemetry test owns its real MCP child
  // process, which one process per file cannot share.
  const server = new McpServer({ name: "tracesift-tools-test", version: "1" });
  registerTraceSiftTools(server, client as TraceSiftClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "tracesift-tools-test-client", version: "1" });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { mcp, close: async () => { await mcp.close(); await server.close(); } };
}

test("the TraceSift status tool starts or reuses a ready service", async t => {
  let checks = 0;
  const { mcp, close } = await connect({ async readyService() { checks++; } });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_status", arguments: {} });
  assert.equal(checks, 1);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { apiVersion: 1, status: "ready" });
});

test("the TraceSift status tool returns setup guidance as structured data", async t => {
  const { mcp, close } = await connect({
    async readyService() { throw new TraceSiftError("Run `tracesift init`.", "setup", "needs_init"); },
  });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_status", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    apiVersion: 1, status: "setup_required", reason: "needs_init", message: "Run `tracesift init`.",
  });
});

test("a profiling build starts promptly and reports its eventual launch", async t => {
  let complete!: (result: { log: string }) => void;
  const pending = new Promise<{ log: string }>(resolve => { complete = resolve; });
  const { mcp, close } = await connect({ async profileBuild() { return pending; } });
  t.after(close);
  const started = await mcp.callTool({ name: "mobile_tracesift_profile_build", arguments: { projectPath: "/tmp", platform: "android" } });
  assert.equal(started.isError, undefined);
  const runId = (started.structuredContent as { runId: string }).runId;
  assert.equal((await mcp.callTool({ name: "mobile_tracesift_profile_build_status", arguments: { runId } })).structuredContent?.status, "running");
  complete({ log: "installed and launched" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual((await mcp.callTool({ name: "mobile_tracesift_profile_build_status", arguments: { runId } })).structuredContent,
    { runId, status: "completed", log: "installed and launched" });
});

test("profiler installation forwards a local package path", async t => {
  const calls: unknown[] = [];
  const { mcp, close } = await connect({ async installProfiler(...args: unknown[]) { calls.push(args); } });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_install_profiler", arguments: { projectPath: "/app", packagePath: "/local/tracesift-profiler" } });
  assert.equal(result.isError, undefined);
  assert.equal((calls[0] as unknown[])[0], "/app");
  assert.equal((calls[0] as unknown[])[2], "/local/tracesift-profiler");
});

test("an iOS profiling build reports insufficient disk before starting", async t => {
  const { statfs } = await import("node:fs/promises");
  const disk = await statfs("/tmp");
  if (disk.bavail * disk.bsize >= 8 * 1024 ** 3) return t.skip("At least 8 GB is free on the test disk.");
  let started = false;
  const { mcp, close } = await connect({ async profileBuild() { started = true; return { log: "" }; } });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_profile_build", arguments: { projectPath: "/tmp", platform: "ios" } });
  assert.equal(result.isError, true);
  assert.match((result.content as { text: string }[])[0]!.text, /at least 8 GB free/);
  assert.equal(started, false);
});

test("the TraceSift setup tools run only their fixed client operations", async t => {
  const calls: string[] = [];
  const { mcp, close } = await connect({
    async installCli() { calls.push("install"); },
    async initialize() { calls.push("init"); },
  });
  t.after(close);
  const installed = await mcp.callTool({ name: "mobile_install_tracesift_cli", arguments: {} });
  const initialized = await mcp.callTool({ name: "mobile_initialize_tracesift", arguments: {} });
  assert.deepEqual(calls, ["install", "init"]);
  assert.deepEqual(installed.structuredContent, {
    apiVersion: 1, action: "install", completed: true, message: "TraceSift CLI installed. Checking setup…",
  });
  assert.deepEqual(initialized.structuredContent, {
    apiVersion: 1, action: "init", completed: true, message: "TraceSift initialized. Checking readiness…",
  });
});

test("the Explore payload tool carries a full task tree as one JSON text item", async t => {
  const requested: unknown[] = [];
  const { mcp, close } = await connect({
    async exploreTask(analysisId: string, taskIndex: number) {
      requested.push({ analysisId, taskIndex });
      return { analysisId, profileTitle: "Profile", totalMs: 200, card: { id: "task-0", tree: deepTree(400), timeline: { boxes: [] } } };
    },
  });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_explore_payload", arguments: { analysisId: "analysis-1", taskIndex: 4 } });
  assert.deepEqual(requested, [{ analysisId: "analysis-1", taskIndex: 4 }]);
  assert.equal(result.isError, undefined);
  // Below the compression threshold, so it crosses as plain JSON.
  assert.deepEqual(result.structuredContent, { apiVersion: 1, kind: "task", encoding: "json", payloadBytes: (result.content as Array<{ text: string }>)[0]!.text.length });
  const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { card: { tree: { id: string } } };
  assert.equal(payload.card.tree.id, "n0");
  let depth = 0;
  for (let node: { children?: unknown[] } = payload.card.tree; node.children?.length; node = node.children[0] as { children?: unknown[] }) depth++;
  assert.equal(depth, 400);
});

test("the Explore payload tool survives a several-megabyte card", async t => {
  // A real long task's tree plus timeline is megabytes.
  const wide = Array.from({ length: 3_000 }, (_, index) => ({
    id: `b${index}`, name: `component-${index}`, frameClass: "app", totalMs: 5, selfMs: 1, invocations: 2,
    children: Array.from({ length: 12 }, (_, child) => ({ id: `b${index}-${child}`, name: `leaf-${index}-${child}`, frameClass: "lib", totalMs: 1, selfMs: 1, invocations: 1, children: [] })),
  }));
  const { mcp, close } = await connect({
    async exploreTask(analysisId: string) {
      return { analysisId, profileTitle: "Profile", totalMs: 4_000,
        card: { id: "task-0", tree: { id: "root", name: "root", frameClass: "app", totalMs: 4_000, selfMs: 0, invocations: 1, children: wide },
          timeline: { boxes: Array.from({ length: 20_000 }, (_, index) => ({ startMs: index, durationMs: 1, kind: "app" })) } } };
    },
  });
  t.after(close);
  const startedAt = performance.now();
  const result = await mcp.callTool({ name: "mobile_tracesift_explore_payload", arguments: { analysisId: "analysis-1", taskIndex: 0 } });
  const elapsed = performance.now() - startedAt;
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  const envelope = result.structuredContent as { encoding: string; payloadBytes: number };
  assert.ok(envelope.payloadBytes > 2_000_000, `expected a multi-megabyte payload, got ${envelope.payloadBytes} bytes`);
  // Past the threshold the bridge carries compressed bytes, so the host's decoder has nothing to recurse into.
  assert.equal(envelope.encoding, "gzip+base64");
  assert.ok(text.length < envelope.payloadBytes / 2, `expected compression, got ${text.length} text bytes`);
  const inflated = await new Response(new Blob([Uint8Array.from(atob(text), c => c.charCodeAt(0))]).stream()
    .pipeThrough(new DecompressionStream("gzip"))).text();
  assert.equal(inflated.length, envelope.payloadBytes);
  assert.ok(elapsed < 10_000, `the round trip took ${elapsed}ms`);
});

test("the Explore payload tool serves one React timeline for the whole analysis", async t => {
  const requested: unknown[] = [];
  const { mcp, close } = await connect({
    async exploreReact(analysisId: string) {
      requested.push(analysisId);
      return { analysisId, profileTitle: "React", explore: { commits: [{ index: 0 }] }, cards: [] };
    },
  });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_explore_payload", arguments: { analysisId: "analysis-9" } });
  assert.deepEqual(requested, ["analysis-9"]);
  assert.equal((result.structuredContent as { kind: string }).kind, "react");
  assert.deepEqual(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).explore, { commits: [{ index: 0 }] });
});

test("the Explore payload tool reports an expired analysis as its message", async t => {
  const { mcp, close } = await connect({
    async exploreTask() { throw new Error("This analysis is no longer available to Explore. Run it again."); },
  });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_explore_payload", arguments: { analysisId: "gone", taskIndex: 0 } });
  assert.equal(result.isError, true);
  assert.match((result.content as Array<{ text: string }>)[0]!.text, /no longer available to Explore/);
});

test("the Explore payload tool is app-only and keeps the browser tool beside it", async t => {
  const { mcp, close } = await connect({});
  t.after(close);
  const { tools } = await mcp.listTools();
  const payload = tools.find(tool => tool.name === "mobile_tracesift_explore_payload");
  assert.ok(payload);
  assert.deepEqual((payload._meta as { ui: { visibility: string[] } }).ui.visibility, ["app"]);
  assert.ok(tools.some(tool => tool.name === "mobile_open_tracesift_explore"));
});

test("the Explore payload tool carries a real recording's call depth", async t => {
  // A node and its `children` array are two object levels each; real React Native recordings reach this depth.
  const { mcp, close } = await connect({
    async exploreTask(analysisId: string) {
      return { analysisId, profileTitle: "Profile", totalMs: 200, card: { id: "task-0", tree: deepTree(1000), timeline: { boxes: [] } } };
    },
  });
  t.after(close);
  const result = await mcp.callTool({ name: "mobile_tracesift_explore_payload", arguments: { analysisId: "analysis-1", taskIndex: 0 } });
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as { kind: string }).kind, "task");
});

test("the Explore payload tool refuses a tree too deep to serialize", async () => {
  // `JSON.stringify` recurses, so this must be caught before serialization.
  const { mcp, close } = await connect({
    async exploreTask(analysisId: string) {
      return { analysisId, profileTitle: "Profile", totalMs: 200, card: { id: "task-0", tree: deepTree(5000), timeline: { boxes: [] } } };
    },
  });
  const result = await mcp.callTool({ name: "mobile_tracesift_explore_payload", arguments: { analysisId: "analysis-1", taskIndex: 0 } });
  assert.equal(result.isError, true);
  assert.match((result.content as { text: string }[])[0]!.text, /larger than the panel can open/);
  await close();
});


test("published TraceSift annotations distinguish saved references, service startup, and file-only restores", async t => {
  const { mcp, close } = await connect({});
  t.after(close);
  const { tools } = await mcp.listTools();
  const expected = {
    mobile_tracesift_status: [false, false],
    mobile_install_tracesift_cli: [false, true],
    mobile_initialize_tracesift: [false, true],
    mobile_analyze_profile: [false, true],
    mobile_pick_profile_file: [false, false],
    mobile_tracesift_capture_state: [true, false],
    mobile_tracesift_launch_browser: [false, false],
    mobile_tracesift_start_recording: [false, false],
    mobile_tracesift_stop_recording: [false, true],
    mobile_tracesift_recorded_profiles: [true, false],
    mobile_tracesift_delete_recorded_profile: [false, true],
    mobile_tracesift_close_browser: [false, true],
    mobile_tracesift_list_react_native_targets: [true, false],
    mobile_tracesift_record_react_native: [false, false],
    mobile_tracesift_profiler_setup: [true, false],
    mobile_tracesift_install_profiler: [false, true],
    mobile_tracesift_profile_devices: [true, false],
    mobile_tracesift_profile_build: [false, true],
    mobile_tracesift_profile_build_status: [true, false],
    mobile_get_tracesift_project: [true, false],
    mobile_pick_tracesift_project: [false, true],
    mobile_remember_tracesift_analysis: [false, true],
    mobile_restore_tracesift_analysis: [true, false],
    mobile_restore_tracesift_analysis_by_input: [true, false],
    mobile_open_tracesift_explore: [false, false],
    mobile_tracesift_explore_payload: [false, false],
    mobile_get_tracesift_handoff: [false, false],
  };
  assert.equal(tools.length, Object.keys(expected).length);
  for (const [name, [readOnlyHint, destructiveHint]] of Object.entries(expected)) {
    const tool = tools.find(tool => tool.name === name);
    assert.ok(tool, `Missing ${name}`);
    assert.deepEqual(tool.annotations, {
      readOnlyHint, destructiveHint,
      openWorldHint: ["mobile_install_tracesift_cli", "mobile_initialize_tracesift", "mobile_tracesift_install_profiler", "mobile_tracesift_profile_build"].includes(name),
    }, name);
  }
  const status = tools.find(tool => tool.name === "mobile_tracesift_status");
  assert.deepEqual((status?._meta as { ui: { visibility: string[] } }).ui.visibility, ["app", "model"]);
  for (const name of ["mobile_install_tracesift_cli", "mobile_initialize_tracesift"]) {
    const tool = tools.find(entry => entry.name === name);
    assert.deepEqual((tool?._meta as { ui: { visibility: string[] } }).ui.visibility, ["app"]);
  }
});

/**
 * Who may drive a recording is the whole design, so it is asserted rather than
 * left to a comment. Chrome stays panel-only because a model that launched a
 * browser nobody is sitting at would record an empty page. React Native is
 * model-callable because nothing is launched: the app is already running, and
 * the agent can list, start and stop without control leaving the harness.
 */
test("React Native recording is model-callable where launching a browser is not", async t => {
  const { mcp, close } = await connect({});
  t.after(close);
  const { tools } = await mcp.listTools();
  const visibility = (name: string) => {
    const tool = tools.find(tool => tool.name === name);
    assert.ok(tool, `Missing ${name}`);
    return (tool._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility;
  };
  for (const name of ["mobile_tracesift_list_react_native_targets", "mobile_tracesift_record_react_native",
    "mobile_tracesift_stop_recording", "mobile_tracesift_capture_state", "mobile_tracesift_profiler_setup",
    "mobile_tracesift_install_profiler", "mobile_tracesift_profile_devices", "mobile_tracesift_profile_build",
    "mobile_tracesift_profile_build_status"]) {
    assert.deepEqual(visibility(name), ["app", "model"], name);
  }
  for (const name of ["mobile_tracesift_launch_browser", "mobile_tracesift_start_recording", "mobile_tracesift_close_browser"]) {
    assert.deepEqual(visibility(name), ["app"], name);
  }
});

test("listing React Native targets names the default app, and recording one passes the target through", async t => {
  const calls: unknown[] = [];
  const { mcp, close } = await connect({
    async reactNativeTargets(metro?: string) {
      calls.push({ targets: metro });
      return { apiVersion: 1 as const, platform: "rn" as const, metro: metro ?? "http://127.0.0.1:8081",
        targets: [{ id: "device-1", title: "AwesomeApp", deviceName: "iPhone 17 Pro", supportsMultipleDebuggers: true, recommended: true }] };
    },
    async startReactNativeRecording(options: { metro?: string; targetId?: string; projectPath?: string }) { calls.push({ start: options }); },
  });
  t.after(close);

  const listed = await mcp.callTool({ name: "mobile_tracesift_list_react_native_targets", arguments: {} });
  assert.equal(listed.isError, undefined);
  assert.match((listed.content as { text: string }[])[0]!.text, /AwesomeApp \(default\) \[device-1\]/);

  const started = await mcp.callTool({ name: "mobile_tracesift_record_react_native", arguments: { targetId: "device-1", projectPath: "/app" } });
  assert.equal(started.isError, undefined);
  assert.deepEqual(started.structuredContent, { recording: true });
  assert.deepEqual(calls, [{ targets: undefined }, { start: { metro: undefined, targetId: "device-1", projectPath: "/app" } }]);
});

test("neither route answering says so rather than returning an empty list without comment", async t => {
  const { mcp, close } = await connect({
    async reactNativeTargets() {
      return { apiVersion: 1 as const, platform: "rn" as const, metro: "http://127.0.0.1:8081", targets: [] };
    },
  });
  t.after(close);
  const listed = await mcp.callTool({ name: "mobile_tracesift_list_react_native_targets", arguments: {} });
  const text = (listed.content as { text: string }[])[0]!.text;
  // Both routes are named, so the agent does not conclude that starting Metro
  // is the only thing that could make an app appear.
  assert.match(text, /No React Native app is reachable/);
  assert.match(text, /none connected to Metro/);
  assert.match(text, /no release build dialled in/);
});

test("a recording the app refuses reports the CLI's own sentence to the agent", async t => {
  const { mcp, close } = await connect({
    async startReactNativeRecording() {
      throw new TraceSiftError("A debugger is attached to that app. Close React Native DevTools, then run this again.", "request");
    },
  });
  t.after(close);
  const started = await mcp.callTool({ name: "mobile_tracesift_record_react_native", arguments: {} });
  assert.equal(started.isError, true);
  assert.match((started.content as { text: string }[])[0]!.text, /Close React Native DevTools/);
});
