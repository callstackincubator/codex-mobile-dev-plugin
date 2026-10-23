import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppFlowEdge, AppFlowNode, ManualSnapshotNode, ManualSnapshotRect } from "../src/shared/app-flow.ts";
import { NODE_WIDTH, UI_STATE_COL_GAP, UI_STATE_NODE_HEIGHT, UI_STATE_NODE_WIDTH, UI_STATE_ROW_GAP, captureTally, displayableUiStates, hasUiStates, layoutTopology, layoutUiStates, nodeTitle, screenOptions, uiStateCount, uiStateNodeId, uiStateOptions, unresolvedSummary, type ResolvedEdge } from "../src/ui/components/app-flow-layout.ts";
import { isTextInput, layoutWireframe, STATUS_BAR_POINTS } from "../src/ui/components/manual-wireframe.ts";

function screen(id: string, status?: string): AppFlowNode {
  return { id, urlPath: null, reach: "navigation-only", groups: [], group: "root", navigator: null,
    capture: status ? { status } as AppFlowNode["capture"] : null } as unknown as AppFlowNode;
}
function edge(from: string, to: string, extra: Partial<AppFlowEdge> = {}): ResolvedEdge {
  return { from, to, raw: `navigate('${to}')`, target: to, ...extra } as ResolvedEdge;
}

describe("App Flow topology", () => {
  test("bands unreachable captured and uncaptured screens below the connected tree", () => {
    const topology = layoutTopology([screen("Home"), screen("Details"), screen("Photo", "ok"), screen("Gone", "missing")], [edge("Home", "Details")], ["Home"]);
    assert.equal(topology.placement.get("Details"), "connected");
    assert.equal(topology.placement.get("Photo"), "deep-link-only");
    assert.equal(topology.placement.get("Gone"), "uncaptured");
    assert.ok(topology.positions.get("Photo")!.y > topology.positions.get("Details")!.y);
    assert.deepEqual(topology.bandHeadings.map(item => [item.placement, item.count]), [["deep-link-only", 1], ["uncaptured", 1]]);
  });

  test("navigator chrome stays a root and reaches entry screens", () => {
    const chrome = { ...screen("chrome:tabs"), origin: "chrome" } as AppFlowNode;
    const topology = layoutTopology([chrome, screen("Home"), screen("Search")], [edge(chrome.id, "Home"), edge(chrome.id, "Search")], ["Home", "Search"]);
    assert.equal(topology.positions.get(chrome.id)?.y, 0);
    assert.ok(topology.positions.get("Home")!.y > 0);
    assert.equal(topology.placement.get("Search"), "connected");
  });

  test("old documents without entry IDs fall back to indegree roots", () => {
    const topology = layoutTopology([screen("A"), screen("B")], [edge("A", "B")], []);
    assert.deepEqual(topology.bandHeadings, []);
    assert.equal(topology.placement.get("B"), "connected");
  });
});

describe("App Flow capture tally", () => {
  function node(id: string, capture: Record<string, unknown> | null, origin?: string): AppFlowNode {
    return { ...screen(id), capture, ...(origin ? { origin } : {}) } as unknown as AppFlowNode;
  }

  test("counts a screen as captured only when it has a screenshot", () => {
    const tally = captureTally([
      node("Home", { status: "ok", screenshot: "home.png" }),
      node("Empty", { status: "empty-state", screenshot: "empty.png" }),
      node("Params", { status: "missing", screenshot: null, captureMethod: "unreached", note: "Unresolved route parameters: id" }),
      node("Gone", { status: "unavailable", screenshot: null, captureMethod: "unreached", note: "No mounted navigator found" }),
      node("chrome:tabs", { status: "ok", screenshot: "tabs.png" }, "chrome"),
      node("Untouched", null)
    ]);
    assert.deepEqual({ captured: tally.captured, unableToCapture: tally.unableToCapture, total: tally.total },
      { captured: 2, unableToCapture: 2, total: 5 });
    assert.deepEqual(tally.reasons, ["Unresolved route parameters: id", "No mounted navigator found"]);
  });

  test("de-duplicates reasons and ignores notes on captured screens", () => {
    const tally = captureTally([
      node("A", { status: "missing", screenshot: null, note: "No mounted navigator found" }),
      node("B", { status: "missing", screenshot: null, note: "No mounted navigator found" }),
      node("C", { status: "ok", screenshot: "c.png", note: "Deep-link fallback" })
    ]);
    assert.equal(tally.unableToCapture, 2);
    assert.deepEqual(tally.reasons, ["No mounted navigator found"]);
  });

  test("an empty or chrome-only node list has no screens to report", () => {
    assert.deepEqual(captureTally([]), { captured: 0, unableToCapture: 0, total: 0, reasons: [] });
    assert.equal(captureTally([node("chrome:tabs", { status: "ok", screenshot: "tabs.png" }, "chrome")]).total, 0);
  });

  test("groups deterministic misses into actionable AI, auth and unavailable buckets", () => {
    const summary = unresolvedSummary([
      node("Captured", { status: "ok", screenshot: "captured.png" }),
      node("Params", { status: "missing", screenshot: null, note: "Unresolved route parameters: id" }),
      node("Unclear", { status: "missing", screenshot: null, note: "Runtime could not verify arrival" }),
      node("Auth", { status: "auth-wall", screenshot: null, note: "Sign in required" }),
      node("Gone", { status: "unavailable", screenshot: null, note: "Not in this build" }),
    ]);
    assert.deepEqual(summary, { aiEligible: 2, parameters: 1, authentication: 1, unavailable: 1 });
  });

});

describe("App Flow UI states", () => {
  function node(id: string, uiStates?: unknown[]): AppFlowNode {
    return { ...screen(id), capture: { status: "ok", screenshot: `${id}.png`, ...(uiStates ? { uiStates } : {}) } } as unknown as AppFlowNode;
  }
  const sheet = { id: "cart", name: "Cart Sheet", screenshot: "home-cart.png", file: "app/home.tsx", line: 12 };
  const failed = { id: "error", name: "Error Dialog", screenshot: null, error: "Setter threw", file: "app/home.tsx", line: 40 };

  test("a screen the explore pass never visited has nothing to show", () => {
    assert.deepEqual(displayableUiStates(node("Home")), []);
    assert.equal(hasUiStates(node("Home")), false);
    assert.equal(hasUiStates({ ...screen("Blank"), capture: null } as unknown as AppFlowNode), false);
  });

  test("a variant that failed keeps its row, and a row with neither frame nor reason is dropped", () => {
    const home = node("Home", [sheet, failed, { id: "ghost", name: "Ghost", screenshot: null, file: "app/home.tsx", line: 7 }]);
    assert.deepEqual(displayableUiStates(home).map(state => state.id), ["cart", "error"]);
    assert.equal(hasUiStates(home), true);
  });

  test("the rendered variant count spans the node set and never touches the screen tally", () => {
    const nodes = [node("Home", [sheet, failed]), node("Settings", [sheet]), node("About")];
    assert.equal(uiStateCount(nodes), 3);
    assert.equal(uiStateCount([]), 0);
    assert.equal(captureTally(nodes).captured, 3, "variants are not screens");
    assert.equal(captureTally(nodes).total, 3);
  });

  test("the UI-states graph gives every captured variant a node under its screen", () => {
    const topology = layoutUiStates([node("Home", [sheet, failed]), node("About"), node("Settings", [sheet])]);
    assert.deepEqual(topology.placements.map(placement => [placement.kind, placement.id]), [
      ["screen", "Home"], ["state", "Home::cart"], ["state", "Home::error"],
      ["screen", "Settings"], ["state", "Settings::cart"],
    ], "a screen with no states is not drawn, and a state id is only unique within its screen");
    assert.deepEqual(topology.edges.map(edge => [edge.source, edge.target]), [
      ["Home", "Home::cart"], ["Home", "Home::error"], ["Settings", "Settings::cart"],
    ]);
    const at = (id: string) => topology.placements.find(placement => placement.id === id)!.position;
    assert.equal(at("Home").y, 0);
    assert.equal(at("Home::cart").y, UI_STATE_NODE_HEIGHT + UI_STATE_ROW_GAP, "states sit one row below their screen");
    assert.equal(at("Home::error").x - at("Home::cart").x, UI_STATE_NODE_WIDTH + UI_STATE_COL_GAP, "siblings are laid out left to right");
    assert.ok(at("Settings").x > at("Home").x + NODE_WIDTH, "one screen's family never overlaps the next");
    assert.deepEqual(layoutUiStates([node("About")]), { placements: [], edges: [] });
  });

  test("a failed variant still gets a node, carrying its reason", () => {
    const placement = layoutUiStates([node("Home", [failed])]).placements.find(entry => entry.kind === "state")!;
    assert.equal(placement.state!.error, "Setter threw");
    assert.equal(placement.state!.screenshot, null);
    assert.equal(placement.id, uiStateNodeId("Home", "error"));
  });

  test("the pickers list screens by title and states by screen, keeping uncaptured ones", () => {
    const chrome = { ...node("chrome:tabs"), origin: "chrome" } as AppFlowNode;
    const nodes = [node("Settings", [sheet]), node("Home", [sheet, failed]), chrome];
    assert.deepEqual(screenOptions(nodes).map(option => option.id), ["Home", "Settings"], "alphabetical, and navigator chrome is not a screen");
    assert.deepEqual(uiStateOptions(nodes), [
      { id: "Settings::cart", nodeId: "Settings", stateId: "cart", label: "Settings — Cart Sheet", captured: true },
      { id: "Home::cart", nodeId: "Home", stateId: "cart", label: "Home — Cart Sheet", captured: true },
      { id: "Home::error", nodeId: "Home", stateId: "error", label: "Home — Error Dialog", captured: false },
    ], "qualified by screen, because two screens may open a state of the same name");
  });

  test("a node with no title is named after its route segment", () => {
    assert.equal(nodeTitle({ id: "app/user-profile", title: undefined, urlPath: null } as never), "User Profile");
    assert.equal(nodeTitle({ id: "app/[id]", title: undefined, urlPath: "/u" } as never), "Id");
    assert.equal(nodeTitle({ id: "app/home", title: "Home", urlPath: null } as never), "Home");
  });
});

const BOUNDS: ManualSnapshotRect = { x: 0, y: 0, width: 390, height: 844 };
const at = (rect: ManualSnapshotRect, fields: Partial<ManualSnapshotNode> = {}): ManualSnapshotNode => ({ ref: "@e1", rect, ...fields });
describe("manual recorder wireframe", () => {
  test("scales, filters device chrome, and puts smaller hit targets last", () => {
    const result = layoutWireframe([
      at({ x: 0, y: 0, width: 390, height: STATUS_BAR_POINTS - 1 }, { label: "9:41" }),
      at({ x: 0, y: 60, width: 390, height: 700 }, { identifier: "container" }),
      at({ x: 39, y: 84.4, width: 195, height: 42.2 }, { label: "Sign in" }),
    ], BOUNDS, 195);
    assert.equal(result.scale, 0.5); assert.equal(result.height, 422);
    assert.deepEqual(result.boxes.map(box => box.node.identifier ?? box.node.label), ["container", "Sign in"]);
    assert.equal(result.boxes[1].left, 19.5); assert.equal(result.boxes[1].addressable, true);
  });

  test("recognises text controls and rejects degenerate layouts", () => {
    assert.equal(isTextInput({ ref: "@e1", type: "XCUIElementTypeSearchField" }), true);
    assert.equal(isTextInput({ ref: "@e2", role: "button" }), false);
    assert.deepEqual(layoutWireframe([at({ x: 0, y: 100, width: 1, height: 1 })], BOUNDS, 0).boxes, []);
  });
});
