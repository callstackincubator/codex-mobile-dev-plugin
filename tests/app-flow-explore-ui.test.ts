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
  EXPLORE_UI_SWEEP_LIMIT,
  attachSweepUiStates,
  attributeToNode,
  captureScreenUiStates,
  createSweepUiStateCapturer,
  exploreUiStates,
  uiStateSlug,
  type ExploreUiPorts,
  type ExploreUiRuntimePort,
} from "../src/app-flow/explore-ui.ts";
import type { AppFlowCapture, AppFlowNode, AppFlowPresentationAction, AppFlowPresentations } from "../src/shared/app-flow.ts";

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

// ---- The sweep's in-line capture: one catalog, one session, many screens ------------------------

/** A sweep session over a recording runtime: `available` is what `list` offers on every screen. */
function sweepSession(available: string[], log: string[], overrides: Partial<ExploreUiRuntimePort> = {}, screenshots: string[] = [], signal?: AbortSignal) {
  const entries = available.map(id => action(id, `Sheet ${id}`));
  const runtimePort = runtime({
    async setup() { log.push("setup"); return { ok: true, bindings: 1, matched: 1 }; },
    async list() { log.push("list"); return { available: available.map(id => ({ id, kind: "state" as const })), unavailable: 0 }; },
    ...overrides,
  }, log);
  const { focusedRoute: _focusedRoute, ...screenPorts } = ports(runtimePort, {
    async screenshot(slug) { log.push(`shot:${slug}`); screenshots.push(slug); return `screens/${slug}.png`; },
    ...(signal ? { signal } : {}),
  });
  return { catalog: catalog(entries), ports: screenPorts };
}

test("the per-screen primitive targets the node it is given and never asks the device which screen it is on", async () => {
  const log: string[] = [];
  const session = sweepSession(["a"], log);
  let asked = false;
  const outcome = await captureScreenUiStates({ catalog: session.catalog, node: { id: "Settings", slug: "settings" } }, {
    ...session.ports, ...({ focusedRoute: async () => { asked = true; return "Home"; } } as object),
  });
  assert.equal(asked, false);
  assert.deepEqual(outcome.uiStates.map(state => state.screenshot), ["screens/settings_state_a.png"]);
  assert.equal(outcome.rolledBack, true);
  assert.equal(outcome.error, undefined);
});

test("the sweep captures per delivered screen: the session opens once, collection runs per screen, rollback precedes the next screen", async () => {
  const log: string[] = [];
  let opens = 0;
  const capturer = createSweepUiStateCapturer({
    open: async () => { opens += 1; log.push("open-session"); return sweepSession(["a"], log); },
    note: message => log.push(`note:${message}`),
  });
  const first = await capturer.capture({ id: "Home", slug: "home" });
  log.push("advance");
  const second = await capturer.capture({ id: "Settings", slug: "settings" });

  assert.equal(opens, 1, "catalog and connection are per sweep, not per screen");
  // `setup` is the live-binding collection, which only sees what is mounted, so it is per screen.
  assert.deepEqual(log.filter(entry => entry === "setup").length, 2);
  assert.deepEqual(first!.map(state => state.screenshot), ["screens/home_state_a.png"]);
  assert.deepEqual(second!.map(state => state.screenshot), ["screens/settings_state_a.png"]);
  // Everything this screen opened is unwound to level 0 before the sweep is allowed to advance.
  const advance = log.indexOf("advance");
  assert.equal(log.slice(0, advance).at(-1), "rollback:0");
  assert.ok(log.slice(0, advance).includes("open:a"));
  assert.equal(capturer.captured, 2);
});

test("a delivery gets its node's own states, and only a reached, photographed delivery does", async () => {
  const capturer = createSweepUiStateCapturer({ open: async () => sweepSession(["a"], []), note() {} });
  const base: AppFlowCapture = { status: "ok", needsNavigation: false, note: null, screenshot: "screens/home.png", pressables: [] };
  const attached = await attachSweepUiStates(capturer, { id: "Home", slug: "home" }, { kind: "reached", capture: base });
  assert.equal(attached.uiStates?.[0]?.screenshot, "screens/home_state_a.png");
  assert.equal(base.uiStates, undefined, "the delivery's own capture is not mutated");
  assert.equal(attached.screenshot, "screens/home.png", "the rest of the capture is untouched");

  // Nothing the device is standing on: no states, and the capture is returned as it came.
  const missing = { ...base, screenshot: null };
  assert.equal(await attachSweepUiStates(capturer, { id: "Gone", slug: "gone" }, { kind: "reached", capture: missing }), missing);
  assert.equal(await attachSweepUiStates(capturer, { id: "Gone", slug: "gone" }, { kind: "unavailable", capture: base }), base);
  assert.equal(await attachSweepUiStates(null, { id: "Home", slug: "home" }, { kind: "reached", capture: base }), base, "switch off");
  assert.equal(capturer.captured, 1, "only the reached screen was presented on");
});

test("the sweep keeps one cap across all screens and shares screenshot slugs", async () => {
  assert.equal(EXPLORE_UI_SWEEP_LIMIT, 10);
  const log: string[] = [];
  const shots: string[] = [];
  const capturer = createSweepUiStateCapturer({
    limit: 3,
    open: async () => sweepSession(["a", "b"], log, {}, shots),
    note() {},
  });
  const one = await capturer.capture({ id: "One", slug: "one" });
  const two = await capturer.capture({ id: "Two", slug: "two" });
  const three = await capturer.capture({ id: "Three", slug: "three" });
  assert.equal(one!.length, 2);
  assert.equal(two!.length, 1, "only the remainder of the sweep's budget is offered to the next screen");
  assert.equal(three, undefined, "a spent budget opens nothing and costs the screen nothing");
  assert.equal(capturer.done, true);
  assert.deepEqual(log.filter(entry => entry.startsWith("open:")).length, 3);
  assert.equal(new Set(shots).size, shots.length);
});

test("a pass that throws on one screen costs that screen its states, never the sweep, and still unwinds", async () => {
  const log: string[] = [];
  const reported: unknown[] = [];
  let calls = 0;
  const capturer = createSweepUiStateCapturer({
    open: async () => sweepSession(["a"], log, {
      async list() { log.push("list"); calls += 1; if (calls === 1) throw new Error("the runtime stopped replying"); return { available: [{ id: "a", kind: "state" as const }], unavailable: 0 }; },
    }),
    note() {},
    report: error => reported.push(error),
  });
  assert.equal(await capturer.capture({ id: "Home", slug: "home" }), undefined);
  assert.equal(log.at(-1), "rollback:0", "the failed pass unwound before returning");
  assert.equal(reported.length, 1);
  // The sweep moves on, and the next screen is still captured.
  const next = await capturer.capture({ id: "Settings", slug: "settings" });
  assert.equal(next?.[0]?.screenshot, "screens/settings_state_a.png");
});

test("a session that cannot open latches the capturer off and says so once", async () => {
  const notes: string[] = [];
  let opens = 0;
  const capturer = createSweepUiStateCapturer({
    open: async () => { opens += 1; throw new Error("the app’s runtime could not be reached (no Metro)"); },
    note: message => notes.push(message),
  });
  assert.equal(await capturer.capture({ id: "Home", slug: "home" }), undefined);
  assert.equal(await capturer.capture({ id: "Settings", slug: "settings" }), undefined);
  assert.equal(opens, 1, "an unavailable runtime is not retried per screen");
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /UI states unavailable/);
});

test("a failed unwind stops the sweep presenting anything further and is reported, not swallowed", async () => {
  const log: string[] = [];
  const notes: string[] = [];
  const reported: unknown[] = [];
  const capturer = createSweepUiStateCapturer({
    open: async () => sweepSession(["a", "b"], log, {
      async rollback() { log.push("rollback:0"); return { ok: false, error: "The presentation control refused to close.", checkpoint: 1 }; },
    }),
    note: message => notes.push(message),
    report: error => reported.push(error),
  });
  const first = await capturer.capture({ id: "Home", slug: "home" });
  // The first unwind failed, so the second presentation was never opened on top of it.
  assert.deepEqual(log.filter(entry => entry.startsWith("open:")), ["open:a"]);
  assert.equal(first?.length, 1, "what was captured before the failure is kept");
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /may still be showing/);
  assert.equal(reported.length, 1);
  // And the next screen is not touched at all.
  assert.equal(await capturer.capture({ id: "Settings", slug: "settings" }), undefined);
  assert.deepEqual(log.filter(entry => entry.startsWith("open:")), ["open:a"]);
});

test("a cancelled sweep opens nothing further, and a pass cancelled mid-screen still unwinds", async () => {
  const controller = new AbortController();
  const log: string[] = [];
  const capturer = createSweepUiStateCapturer({
    signal: controller.signal,
    open: async () => sweepSession(["a", "b"], log, {
      async open(id) { log.push(`open:${id}`); controller.abort(); return { ok: true, kind: "state" as const, checkpoint: 1 }; },
    }, [], controller.signal),
    note() {},
  });
  const partial = await capturer.capture({ id: "Home", slug: "home" });
  assert.equal(partial?.length, 1);
  assert.equal(log.at(-1), "rollback:0");
  assert.equal(await capturer.capture({ id: "Settings", slug: "settings" }), undefined);
  assert.deepEqual(log.filter(entry => entry.startsWith("open:")), ["open:a"]);
});

test("the standalone run is unchanged in its throw-on-failure contract and reports an unwound-failed app in the message", async () => {
  const runtimePort = runtime({
    async list() { throw new Error("the runtime stopped replying"); },
    async rollback() { return { ok: false, error: "refused", checkpoint: 1 }; },
  });
  await assert.rejects(
    exploreUiStates({ catalog: catalog([action("open-1", "Sheet1")]), nodes: [node("Home")] }, ports(runtimePort)),
    /stopped replying\. The app may still be showing/,
  );
});

test("the per-screen log carries counts and categories: refused at list, refused at open, opened, unwound", async () => {
  const runtimePort = runtime({
    async list() {
      return {
        available: [{ id: "a", kind: "control" as const }, { id: "b", kind: "control" as const }],
        unavailable: 3,
        rejected: { unbound: 2, "not-in-view": 1 },
        aliased: 1,
        kinds: { control: 2 },
      };
    },
    async open(id) {
      return id === "a"
        ? { ok: true as const, kind: "control" as const, checkpoint: 1 }
        : { ok: false as const, error: "More than one live control matches this opening.", reason: "ambiguous-control", checkpoint: 0 };
    },
    async rollback() { return { ok: true, checkpoint: 0, evidence: "tree" }; },
  });
  const outcome = await captureScreenUiStates(
    { catalog: catalog([action("a", "A"), action("b", "B")]), node: { id: "Home", slug: "home" } },
    ports(runtimePort),
  );
  assert.deepEqual(outcome.diagnostics, {
    candidates: 6,
    listed: 2,
    listedKinds: { control: 2 },
    aliased: 1,
    refusedAtList: { unbound: 2, "not-in-view": 1 },
    opened: 1,
    refusedAtOpen: { "ambiguous-control": 1 },
    captured: 1,
    unbound: 0,
    rolledBack: true,
    dismissEvidence: "tree",
    latched: false,
  });
  // Nothing in the record can name the app: no ids, no component names, no paths.
  assert.doesNotMatch(JSON.stringify(outcome.diagnostics), /Screen|Button|src\/|"a"|"b"/);
});

test("an unknown refusal reason is bucketed as other, and a failed unwind is categorised, not quoted", async () => {
  const runtimePort = runtime({
    async list() { return { available: [{ id: "a", kind: "control" as const }], unavailable: 0 }; },
    async open() { return { ok: false as const, error: "something about SecretComponent", reason: "SecretComponent", checkpoint: 0 }; },
    async rollback() { return { ok: false, error: "Native presentation dismissal has not finished.", checkpoint: 1 }; },
  });
  const outcome = await captureScreenUiStates(
    { catalog: catalog([action("a", "A")]), node: { id: "Home", slug: "home" } },
    ports(runtimePort),
  );
  assert.deepEqual(outcome.diagnostics.refusedAtOpen, { other: 1 });
  assert.equal(outcome.diagnostics.rollbackFailure, "dismissal-timeout");
  assert.equal(outcome.diagnostics.rolledBack, false);
  assert.doesNotMatch(JSON.stringify(outcome.diagnostics), /SecretComponent/);
});

test("records the join could not place are marked checked, and a join that failed marks nothing", async () => {
  const configured: Array<{ matches: number; checked: readonly string[] | undefined }> = [];
  const setup = async () => ({
    ok: true, bindings: 0, matched: 0,
    unbound: [
      { id: "1", owner: "X", kind: "state" as const, stack: "" },
      { id: "entry-2", owner: "Button", kind: "entry" as const, stack: "" },
      { id: "entry-3", owner: "Button", kind: "entry" as const, stack: "" },
    ],
  });
  const configure = async (matches: readonly unknown[], checked?: readonly string[]) => {
    configured.push({ matches: matches.length, checked });
    return { configured: matches.length };
  };
  const node = { id: "Home", slug: "home" };
  await captureScreenUiStates({ catalog: catalog([]), node }, ports(runtime({ setup, configure }), {
    async bind() { return [{ binding: "entry-2", site: "a" }]; },
  }));
  assert.deepEqual(configured, [{ matches: 1, checked: ["1", "entry-3"] }]);

  configured.length = 0;
  const outcome = await captureScreenUiStates({ catalog: catalog([]), node }, ports(runtime({ setup, configure }), {
    async bind() { throw new Error("Metro unreachable"); },
  }));
  assert.deepEqual(configured, [], "an unreachable Metro must not declare anything unplaceable");
  assert.equal(outcome.diagnostics.unbound, 3);
});

test("the sweep hands every screen's counts to the run log, and marks the screen that latched it off", async () => {
  const logged: Array<{ id: string; latched: boolean; rolledBack: boolean; failure?: string }> = [];
  const capturer = createSweepUiStateCapturer({
    open: async () => sweepSession(["a"], [], {
      async rollback() { return { ok: false, error: "Native presentation dismissal has not finished.", checkpoint: 1 }; },
    }),
    note: () => {},
    onScreen: (screen, log) => logged.push({ id: screen.id, latched: log.latched, rolledBack: log.rolledBack, ...(log.failure ? { failure: log.failure } : {}) }),
  });
  await capturer.capture({ id: "Home", slug: "home" });
  await capturer.capture({ id: "Settings", slug: "settings" });
  // Settings was never attempted: the log shows exactly which screen stopped the sweep.
  assert.deepEqual(logged, [{ id: "Home", latched: true, rolledBack: false }]);

  const unavailable: typeof logged = [];
  const failing = createSweepUiStateCapturer({
    open: async () => { throw new Error("no Metro"); },
    note: () => {},
    onScreen: (screen, log) => unavailable.push({ id: screen.id, latched: log.latched, rolledBack: log.rolledBack, ...(log.failure ? { failure: log.failure } : {}) }),
  });
  await failing.capture({ id: "Home", slug: "home" });
  assert.deepEqual(unavailable, [{ id: "Home", latched: true, rolledBack: true, failure: "session-unavailable" }]);
});

test("a join that lost a Metro lookup does not mark records unplaceable, and the stage counts are logged", async () => {
  const configured: Array<{ matches: number; checked: readonly string[] | undefined }> = [];
  const setup = async () => ({
    ok: true, bindings: 1, matched: 0, entries: 5, entriesMatched: 1,
    unbound: [
      { id: "1", owner: "X", kind: "state" as const, stack: "" },
      { id: "entry-2", owner: "Button", kind: "entry" as const, stack: "" },
    ],
  });
  const configure = async (matches: readonly unknown[], checked?: readonly string[]) => {
    configured.push({ matches: matches.length, checked });
    return { configured: matches.length };
  };
  const stats = { records: 2, entryRecords: 1, noFrames: 0, foreignFrames: 0, frames: 4, resolved: 0, failedBatches: 1, projectFrames: 0, placed: 0, entryPlaced: 0 };
  const outcome = await captureScreenUiStates({ catalog: catalog([]), node: { id: "Home", slug: "home" } }, ports(runtime({ setup, configure }), {
    async bind(_bindings, report) { report?.(stats); return []; },
  }));
  assert.deepEqual(configured, [], "a lost lookup has judged nothing, so nothing is latched");
  assert.deepEqual(outcome.diagnostics.join, {
    emittedState: 1, emittedEntry: 1, entriesLive: 5, entriesPlacedBefore: 1, noFrames: 0, foreignFrames: 0,
    frames: 4, resolved: 0, failedBatches: 1, projectFrames: 0, placed: 0, entryPlaced: 0, configured: 0,
  });
});

test("a pass that fails before it lists names the stage and whether it timed out", async () => {
  const node = { id: "Home", slug: "home" };
  const timedOut = await captureScreenUiStates({ catalog: catalog([]), node }, ports(runtime({
    async setup() { throw new Error("presentation-setup did not complete within 20000ms"); },
  })));
  assert.equal(timedOut.diagnostics.failure, "setup-timeout");
  assert.equal(timedOut.diagnostics.candidates, 0);
  const refused = await captureScreenUiStates({ catalog: catalog([]), node }, ports(runtime({
    async setup() { return { ok: false, bindings: 0, matched: 0, error: "no" }; },
  })));
  assert.equal(refused.diagnostics.failure, "setup-failed");
  const listing = await captureScreenUiStates({ catalog: catalog([]), node }, ports(runtime({
    async list() { throw new Error("presentations did not complete within 2000ms"); },
  })));
  assert.equal(listing.diagnostics.failure, "list-timeout");
});
