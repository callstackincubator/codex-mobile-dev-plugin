/**
 * The explore-UI pass, as far as it can be exercised without a simulator: the tool's contract, the
 * catalog handed to the device, the limit, the attribution rule, and above all that the app is
 * rolled back whatever happens. The device-only half — that a real sheet actually opens, that the
 * frame is the sheet rather than its transition, that Metro symbolicates a real stack — is noted in
 * the hand-off report rather than faked here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AppFlowProjectChoices } from "../src/server/app-flow-projects.ts";
import { AppFlowHost, type AppFlowHostServices } from "../src/server/app-flow-host.ts";
import { registerAppFlowTools } from "../src/server/app-flow-tools.ts";
import {
  attributeToNode,
  exploreUiStates,
  uiStateSlug,
  type ExploreUiPorts,
  type ExploreUiRuntimePort,
} from "../src/app-flow/explore-ui.ts";
import type { AppFlowNode, AppFlowPresentationAction, AppFlowPresentations } from "../src/shared/app-flow.ts";

function action(id: string, name: string, overrides: Partial<AppFlowPresentationAction> = {}): AppFlowPresentationAction {
  return {
    id, name, file: "src/Screen.tsx", line: 12, owner: "Screen", component: "Button", prop: "onPress",
    effect: { kind: "state", site: `site-${id}`, path: [], value: true },
    ...overrides,
  };
}

function catalog(actions: AppFlowPresentationAction[]): AppFlowPresentations {
  return { states: actions.map(entry => ({
    id: `site-${entry.id}`, file: entry.file, line: entry.line, column: 4, endLine: entry.line, owner: "Screen", paths: [],
  })), actions };
}

function node(id: string, slug = id.toLowerCase()): AppFlowNode {
  return {
    id, urlPath: null, reach: "navigation-only", title: id, file: "src/Screen.tsx", slug, group: "Root",
    groups: ["Root"], navigator: null, params: [], presentation: null, guard: null,
    capture: { status: "ok", needsNavigation: false, note: null, screenshot: "screens/home.png", pressables: [] },
  };
}

/** A runtime that opens everything, recording the exact command order it was driven through. */
function runtime(overrides: Partial<ExploreUiRuntimePort> = {}, log: string[] = []): ExploreUiRuntimePort {
  return {
    async setup() { log.push("setup"); return { ok: true, bindings: 2, matched: 2, unbound: [] }; },
    async configure(matches) { log.push(`configure:${matches.length}`); return { configured: matches.length }; },
    async list() { log.push("list"); return { available: [], unavailable: 0 }; },
    async open(id) { log.push(`open:${id}`); return { ok: true, kind: "state", checkpoint: 1 }; },
    async rollback(level) { log.push(`rollback:${level}`); return { ok: true, checkpoint: 0 }; },
    ...overrides,
  };
}

function ports(runtimePort: ExploreUiRuntimePort, overrides: Partial<ExploreUiPorts> = {}): ExploreUiPorts {
  return {
    runtime: runtimePort,
    async bind() { return []; },
    async focusedRoute() { return "Home"; },
    async settle() {},
    async screenshot(slug) { return `screens/${slug}.png`; },
    emit() {},
    ...overrides,
  };
}

test("the explore-ui tool takes a project path and a positive integer limit, and nothing else", async t => {
  const server = new McpServer({ name: "app-flow-explore-ui-test", version: "1" });
  const started: Array<{ projectPath: string; options: { limit?: number } }> = [];
  const services = {
    async exploreUi(projectPath: string, options: { limit?: number }) { started.push({ projectPath, options }); return { ok: true }; },
  } as unknown as AppFlowHostServices;
  const close = registerAppFlowTools(server, new AppFlowHost(services), new AppFlowProjectChoices("/nonexistent"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "app-flow-explore-ui-client", version: "1" });
  t.after(async () => { await client.close(); await close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tool = (await client.listTools()).tools.find(candidate => candidate.name === "mobile_appflow_explore_ui");
  assert.ok(tool, "mobile_appflow_explore_ui is registered");
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), ["limit", "projectPath"]);
  assert.deepEqual(tool.inputSchema.required, ["projectPath"]);

  const ok = await client.callTool({ name: "mobile_appflow_explore_ui", arguments: { projectPath: "/projects/demo", limit: 3 } });
  assert.equal(ok.isError, undefined);
  assert.equal((ok.structuredContent as { state: string }).state, "running");
  assert.deepEqual(started, [{ projectPath: "/projects/demo", options: { limit: 3 } }]);

  // A run without a limit must not invent one.
  await client.callTool({ name: "mobile_appflow_explore_ui", arguments: { projectPath: "/projects/demo" } });
  assert.deepEqual(started[1]?.options, {});

  for (const limit of [0, -1, 2.5, "three", 1001]) {
    const rejected = await client.callTool({ name: "mobile_appflow_explore_ui", arguments: { projectPath: "/projects/demo", limit } });
    assert.equal(rejected.isError, true, `limit ${String(limit)} is refused`);
  }
  assert.equal(started.length, 2, "no refused call reached the host");
});

test("the catalog handed to the device carries the previews and view states the scan compiled", async t => {
  const log: string[] = [];
  let payload: Pick<AppFlowPresentations, "states" | "actions"> | null = null;
  const preview = action("preview-1", "PreviewSheet", { preview: true });
  const base = action("open-1", "SettingsSheet", { views: ["view-1"] });
  const scanned: AppFlowPresentations = {
    ...catalog([base]),
    previews: [preview],
    previewStates: [{ id: "site-preview-1", file: "src/Screen.tsx", line: 30, column: 2, endLine: 30, owner: "Screen", paths: [] }],
    viewStates: [{ id: "site-view-1", file: "src/Screen.tsx", line: 40, column: 2, endLine: 40, owner: "Screen", paths: [] }],
  };
  const runtimePort = runtime({
    async setup(given) { payload = given; log.push("setup"); return { ok: true, bindings: 1, matched: 1 }; },
    async list() { return { available: [{ id: "open-1", kind: "state" }, { id: "preview-1", kind: "mount" }], unavailable: 2 }; },
  }, log);
  const outcome = await exploreUiStates({ catalog: scanned, nodes: [node("Home")] }, ports(runtimePort));

  assert.deepEqual(payload!.actions.map(entry => entry.id), ["open-1", "preview-1"]);
  assert.deepEqual(payload!.states.map(entry => entry.id), ["site-open-1", "site-preview-1", "site-view-1"]);
  assert.equal(outcome.nodeId, "Home");
  assert.deepEqual(outcome.uiStates.map(state => [state.id, state.name, state.screenshot, state.file, state.line]), [
    ["open-1", "SettingsSheet", "screens/home_state_open_1.png", "src/Screen.tsx", 12],
    ["preview-1", "PreviewSheet", "screens/home_state_preview_1.png", "src/Screen.tsx", 12],
  ]);
  // The views join is kept; A's node id, kind, path, required and navigation edge are not.
  assert.deepEqual(outcome.uiStates[0]!.sourceViews, ["view-1"]);
  assert.equal("kind" in outcome.uiStates[0]!, false);
  // Entries the device could not bind are reported, not dropped.
  assert.equal(outcome.discoveryFailures.at(-1)?.reason.includes("2 discovered UI state(s)"), true);
});

test("the limit counts variants actually captured, and leaves the rest untouched", async () => {
  const log: string[] = [];
  const runtimePort = runtime({
    async list() { return { available: [1, 2, 3, 4].map(index => ({ id: `open-${index}`, kind: "state" as const })), unavailable: 0 }; },
  }, log);
  const outcome = await exploreUiStates(
    { catalog: catalog([1, 2, 3, 4].map(index => action(`open-${index}`, `Sheet${index}`))), nodes: [node("Home")], limit: 2 },
    ports(runtimePort),
  );
  assert.equal(outcome.uiStates.filter(state => state.screenshot).length, 2);
  assert.deepEqual(log.filter(entry => entry.startsWith("open:")), ["open:open-1", "open:open-2"]);
});

test("a variant that fails to open is recorded with its reason and does not spend the limit", async () => {
  const runtimePort = runtime({
    async list() { return { available: [{ id: "open-1", kind: "state" }, { id: "open-2", kind: "control" }], unavailable: 0 }; },
    async open(id) {
      return id === "open-1"
        ? { ok: false, error: "More than one live instance owns this opening state.", checkpoint: 0 }
        : { ok: true, kind: "control", checkpoint: 1 };
    },
  });
  const outcome = await exploreUiStates(
    { catalog: catalog([action("open-1", "Sheet1"), action("open-2", "Sheet2")]), nodes: [node("Home")], limit: 1 },
    ports(runtimePort),
  );
  assert.deepEqual(outcome.discoveryFailures.map(failure => failure.id), ["open-1"]);
  assert.equal(outcome.uiStates[0]!.screenshot, null);
  assert.equal(outcome.uiStates[0]!.error, "More than one live instance owns this opening state.");
  assert.equal(outcome.uiStates[1]!.screenshot, "screens/home_state_open_2.png");
  assert.equal(outcome.uiStates[1]!.openedBy, "control");
});

test("rollback runs after a screenshot failure, after a cancel, and after a thrown port", async () => {
  // A screenshot that throws must still close the presentation it was taking.
  const afterFailure: string[] = [];
  const failing = runtime({
    async list() { return { available: [{ id: "open-1", kind: "state" }], unavailable: 0 }; },
  }, afterFailure);
  const failed = await exploreUiStates(
    { catalog: catalog([action("open-1", "Sheet1")]), nodes: [node("Home")] },
    ports(failing, { async screenshot() { throw new Error("the runner was busy"); } }),
  );
  assert.deepEqual(afterFailure.filter(entry => entry.startsWith("rollback")), ["rollback:0", "rollback:0"]);
  assert.equal(failed.uiStates[0]!.error, "the runner was busy");
  assert.equal(failed.rolledBack, true);

  // A cancel between variants stops the loop and still unwinds.
  const controller = new AbortController();
  const afterCancel: string[] = [];
  const cancelling = runtime({
    async list() { return { available: [{ id: "open-1", kind: "state" }, { id: "open-2", kind: "state" }], unavailable: 0 }; },
    async open(id) { controller.abort(); afterCancel.push(`open:${id}`); return { ok: true, kind: "state", checkpoint: 1 }; },
  }, afterCancel);
  const cancelled = await exploreUiStates(
    { catalog: catalog([action("open-1", "Sheet1"), action("open-2", "Sheet2")]), nodes: [node("Home")] },
    ports(cancelling, { signal: controller.signal }),
  );
  assert.deepEqual(afterCancel.filter(entry => entry.startsWith("open:")), ["open:open-1"]);
  assert.equal(cancelled.cancelled, true);
  assert.equal(afterCancel.at(-1), "rollback:0");

  // A throw out of the pass itself still unwinds before it propagates.
  const afterThrow: string[] = [];
  const throwing = runtime({
    async list() { throw new Error("the runtime stopped replying"); },
  }, afterThrow);
  await assert.rejects(
    exploreUiStates({ catalog: catalog([action("open-1", "Sheet1")]), nodes: [node("Home")] }, ports(throwing)),
    /stopped replying/,
  );
  assert.equal(afterThrow.at(-1), "rollback:0");
});

test("an unwind the device refuses is reported rather than silently accepted", async () => {
  const runtimePort = runtime({
    async list() { return { available: [{ id: "open-1", kind: "state" }], unavailable: 0 }; },
    async rollback() { return { ok: false, error: "The presentation control refused to close.", checkpoint: 1 }; },
  });
  const outcome = await exploreUiStates(
    { catalog: catalog([action("open-1", "Sheet1")]), nodes: [node("Home")] },
    ports(runtimePort),
  );
  assert.equal(outcome.rolledBack, false);
});

test("variants attribute to the focused route, and an unknown route stops the pass", async () => {
  // Route identity is the navigator's own name, matched to a node id or its last segment.
  assert.equal(attributeToNode([node("HomeTab/Home", "home")], "Home")?.id, "HomeTab/Home");
  assert.equal(attributeToNode([node("HomeTab/Home"), node("Other/Home")], "Home"), null, "ambiguity attributes to nothing");
  assert.equal(attributeToNode([node("Home")], null), null);

  const runtimePort = runtime({ async list() { return { available: [], unavailable: 0 }; } });
  await assert.rejects(
    exploreUiStates({ catalog: catalog([action("open-1", "Sheet1")]), nodes: [node("Home")] }, ports(runtimePort, {
      async focusedRoute() { return "Settings"; },
    })),
    /not one of this project’s captured screens/,
  );
});

test("two variants that pick the same name on one screen get distinct screenshot files", () => {
  const used = new Set<string>();
  assert.equal(uiStateSlug("home", "open-1", used), "home_state_open_1");
  assert.equal(uiStateSlug("home", "open-1", used), "home_state_open_1_2");
  assert.equal(uiStateSlug("home", "open/1", used), "home_state_open_1_3");
});
