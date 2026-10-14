import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAppFlow } from "../src/app-flow/app-flow-normalize.ts";
import type { AppFlowNode, AppFlowResult } from "../src/shared/app-flow.ts";

function v3Node(overrides: Partial<AppFlowNode> = {}): AppFlowNode {
  return {
    id: "Home",
    urlPath: "/home",
    reach: "deep-link",
    title: "Home",
    file: "/app/home.tsx",
    slug: "home",
    group: "root",
    groups: ["root"],
    navigator: null,
    params: [],
    presentation: null,
    stateHints: [],
    guard: null,
    capture: null,
    ...overrides,
  };
}

function v3Document(): AppFlowResult {
  return {
    manifest: {
      formatVersion: 3,
      generator: "ai-harness/app-flow",
      generatedAt: "2026-01-01T00:00:00.000Z",
      project: {
        name: "demo",
        path: "/demo",
        scheme: "demo",
        platform: "ios",
        mode: "expo-router",
      },
    },
    nodes: [v3Node(), v3Node({ id: "Profile", urlPath: "/profile" })],
    edges: [{ from: "Home", to: "Profile", raw: 'navigate("Profile")', target: "Profile" }],
  };
}

describe("normalizeAppFlow", () => {
  it("backfills origins and empty v4 runtime fields for a v3 document", () => {
    const normalized = normalizeAppFlow(v3Document());
    assert.deepEqual(normalized.nodes.map(node => node.origin), ["parsed", "parsed"]);
    assert.deepEqual(normalized.edges.map(edge => edge.origin), ["parsed"]);
    assert.deepEqual(normalized.chrome, []);
    assert.deepEqual(normalized.runtimeEdges, []);
    assert.equal(normalized.navigation, null);
  });

  it("preserves fields that already exist", () => {
    const document = v3Document();
    document.nodes[0].origin = "runtime";
    document.edges[0].origin = "runtime-walk";
    document.navigation = {
      layouts: [],
      rootNavigator: "Tabs",
      entryLayouts: ["home"],
      entryScreenIds: ["Home"],
    };

    const normalized = normalizeAppFlow(document);
    assert.equal(normalized.nodes[0].origin, "runtime");
    assert.equal(normalized.edges[0].origin, "runtime-walk");
    assert.equal(normalized.navigation, document.navigation);
  });

  it("backfills chrome kind from its reveal steps", () => {
    const document = v3Document();
    document.chrome = [
      {
        id: "chrome:tabs:Home",
        entryNodeId: "Home",
        reveal: [],
        items: [],
        observedAt: "2026-01-01T00:00:00.000Z",
        structureRevision: "rev-1",
      },
      {
        id: "chrome:drawer:Home",
        entryNodeId: "Home",
        reveal: [{ type: "tap", locator: { by: "id", value: "menu-button" } }],
        items: [],
        observedAt: "2026-01-01T00:00:00.000Z",
        structureRevision: "rev-1",
      },
    ];

    assert.deepEqual(normalizeAppFlow(document).chrome?.map(chrome => chrome.kind), ["tabs", "drawer"]);
  });

  it("is idempotent", () => {
    const once = normalizeAppFlow(v3Document());
    assert.deepEqual(normalizeAppFlow(once), once);
  });
});
