import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppFlowEdge, AppFlowNode, ManualSnapshotNode, ManualSnapshotRect } from "../src/shared/app-flow.ts";
import { layoutTopology, type ResolvedEdge } from "../src/ui/components/app-flow-layout.ts";
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
