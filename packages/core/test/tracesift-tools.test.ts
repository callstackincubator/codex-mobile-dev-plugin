import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTraceSiftTools } from "../src/tracesift-tools.ts";
import type { TraceSiftClient } from "../src/tracesift-client.ts";

/** Crosses the boundary the card's frame will: the SDK validates the envelope on both sides. */
function deepTree(depth: number) {
  let node: Record<string, unknown> = { id: `n${depth}`, name: "leaf", frameClass: "app", totalMs: 1, selfMs: 1, invocations: 1, children: [] };
  for (let level = depth - 1; level >= 0; level--) node = { id: `n${level}`, name: `frame-${level}`, frameClass: "app", totalMs: 100, selfMs: 0, invocations: 1, children: [node] };
  return node;
}

async function connect(client: Partial<TraceSiftClient>) {
  // Not the plugin fixture: that owns a real MCP child process one process per file cannot share.
  const server = new McpServer({ name: "tracesift-tools-test", version: "1" });
  registerTraceSiftTools(server, client as TraceSiftClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "tracesift-tools-test-client", version: "1" });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { mcp, close: async () => { await mcp.close(); await server.close(); } };
}

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
    mobile_analyze_profile: [false, true],
    mobile_pick_profile_file: [false, false],
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
    assert.deepEqual(tool.annotations, { readOnlyHint, destructiveHint, openWorldHint: false }, name);
  }
});
