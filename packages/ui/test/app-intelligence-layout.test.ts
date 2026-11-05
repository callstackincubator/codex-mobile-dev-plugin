import assert from "node:assert/strict";
import test from "node:test";
import type { AppIntelSnapshot, IntelEdge } from "@mobile-dev/shared/app-intelligence.ts";
import { boundaryOf, buildFlow, buildTrie, depthHue, depthTint, findNode, flowBoundaries, heat, heatT, leavesOf, maxReach, ownerScreen, platformsFor, squarify } from "../src/app-intelligence-layout.ts";

function snapshotOf(edges: IntelEdge[], files: Record<string, number>, packages: Record<string, number> = {}): AppIntelSnapshot {
  const indexes: AppIntelSnapshot["indexes"] = { screens: Object.create(null), incoming: Object.create(null), outgoing: Object.create(null) };
  edges.forEach((edge, index) => { (indexes.outgoing[edge.from] ??= []).push(index); if (edge.to) (indexes.incoming[edge.to] ??= []).push(index); });
  return {
    formatVersion: 1,
    meta: { projectId: "p", generation: "g", analyzedAt: "", analyzerVersion: "t", sourceFingerprint: "f" },
    files: Object.fromEntries(Object.entries(files).map(([path, reach]) => [path, { fingerprint: "x", kind: "source" as const, reach }])),
    packages: Object.fromEntries(Object.entries(packages).map(([name, reach]) => [name, { name, reach }])),
    screens: { home: { title: "Home", route: "/", source: "src/screens/home.tsx", layouts: [] } },
    edges, diagnostics: [], indexes,
  };
}

const importEdge = (from: string, to: string, platforms: IntelEdge["platforms"] = ["ios", "android"]): IntelEdge => ({ from: from as IntelEdge["from"], to: to as IntelEdge["to"], kind: "import", platforms });

test("squarify tiles its rectangle without gaps or overlap", () => {
  const items = [40, 25, 15, 12, 8].map((value, index) => ({ name: `n${index}`, path: `n${index}`, value, reach: value, kids: [], leaf: null, parent: null }));
  const rect = { x: 0, y: 0, width: 600, height: 400 };
  const placed = squarify(items, rect);
  assert.equal(placed.length, items.length);
  const area = placed.reduce((sum, item) => sum + item.rect.width * item.rect.height, 0);
  assert.ok(Math.abs(area - rect.width * rect.height) < 1, `tiled area ${area} should fill ${rect.width * rect.height}`);
  for (const { rect: box } of placed) {
    assert.ok(box.x >= -0.001 && box.y >= -0.001 && box.x + box.width <= rect.width + 0.001 && box.y + box.height <= rect.height + 0.001, "stays inside the rect");
  }
  for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) {
    const first = placed[a].rect, second = placed[b].rect;
    const overlaps = first.x < second.x + second.width - 0.001 && second.x < first.x + first.width - 0.001
      && first.y < second.y + second.height - 0.001 && second.y < first.y + first.height - 0.001;
    assert.ok(!overlaps, `${placed[a].node.name} overlaps ${placed[b].node.name}`);
  }
});

test("squarify ignores zero-valued items and an empty list", () => {
  assert.deepEqual(squarify([], { x: 0, y: 0, width: 100, height: 100 }), []);
  const zero = [{ name: "z", path: "z", value: 0, reach: 0, kids: [], leaf: null, parent: null }];
  assert.deepEqual(squarify(zero, { x: 0, y: 0, width: 100, height: 100 }), []);
});

test("the trie rolls counts up and hides packages on request", () => {
  const snapshot = snapshotOf(
    [importEdge("file:src/a/one.ts", "package:left-pad")],
    { "src/a/one.ts": 4, "src/a/two.ts": 2, "src/b/three.ts": 1 },
    { "left-pad": 4 },
  );
  const withPackages = buildTrie(snapshot, { withPackages: true });
  assert.deepEqual(withPackages.kids.map(kid => kid.name).sort(), ["node_modules", "src"]);
  const appOnly = buildTrie(snapshot, { withPackages: false });
  assert.deepEqual(appOnly.kids.map(kid => kid.name), ["src"]);
  assert.equal(appOnly.value, 3, "three files in the app tree");

  const a = findNode(appOnly, "src/a");
  assert.ok(a);
  assert.equal(a.value, 2);
  assert.equal(a.reach, 3, "value-weighted mean of 4 and 2");
  assert.equal(leavesOf(appOnly).length, 3);
  assert.equal(findNode(appOnly, "src/nope"), null);
  assert.equal(findNode(appOnly, "")?.path, "", "an empty path is the root");
});

test("a file reached only on one platform reports that platform", () => {
  const snapshot = snapshotOf([
    importEdge("file:src/screen.tsx", "file:src/value.ios.ts", ["ios"]),
    importEdge("file:src/screen.tsx", "file:src/both.ts"),
  ], { "src/screen.tsx": 1, "src/value.ios.ts": 1, "src/both.ts": 1 });
  assert.equal(platformsFor(snapshot, "file:src/value.ios.ts"), "ios");
  assert.equal(platformsFor(snapshot, "file:src/both.ts"), "both");
  assert.equal(platformsFor(snapshot, "file:src/screen.tsx"), "both", "nothing reaches it, so it is not platform-specific");
});

test("buildFlow layers by hop, caps each level and counts the overflow", () => {
  const edges = [
    { from: "screen:home", to: "file:src/screens/home.tsx", kind: "source", platforms: ["ios", "android"] } as IntelEdge,
    { from: "screen:home", to: "screen:other", kind: "navigation", platforms: ["ios", "android"] } as IntelEdge,
  ];
  const files: Record<string, number> = { "src/screens/home.tsx": 1 };
  for (let index = 0; index < 20; index++) {
    const path = `src/lib/dep${index}.ts`;
    files[path] = 20 - index;
    edges.push(importEdge("file:src/screens/home.tsx", `file:${path}`));
  }
  const snapshot = snapshotOf(edges, files);
  const flow = buildFlow(snapshot, "screen:home", [1, 1, 12, 5]);
  assert.deepEqual(flow.levels[0], ["screen:home"]);
  assert.deepEqual(flow.levels[1], ["file:src/screens/home.tsx"]);
  assert.equal(flow.levels[2].length, 12, "depth 2 is capped");
  assert.equal(flow.hidden[2], 8, "and the rest are counted, not dropped");
  assert.ok(!flow.levels.flat().includes("screen:other"), "navigation edges never enter the flow");
  assert.equal(flow.parent.get("file:src/screens/home.tsx"), "screen:home");
  for (const ref of flow.levels[2]) assert.equal(flow.parent.get(ref), "file:src/screens/home.tsx");
  assert.ok(flow.levels[2].every(ref => flow.parent.has(ref)), "capped-out nodes leave no dangling parent");
});

test("buildFlow terminates on an import cycle", () => {
  const snapshot = snapshotOf([
    importEdge("file:a.ts", "file:b.ts"),
    importEdge("file:b.ts", "file:a.ts"),
  ], { "a.ts": 1, "b.ts": 1 });
  const flow = buildFlow(snapshot, "file:a.ts");
  assert.deepEqual(flow.levels[1], ["file:b.ts"]);
  assert.deepEqual(flow.levels[2], [], "a.ts is already visited");
});

test("the heat scale is log-shaped, monotonic and clamped", () => {
  assert.equal(heatT(0, 100), 0);
  assert.equal(heatT(100, 100), 1);
  assert.equal(heatT(500, 100), 1, "clamps above the max");
  assert.equal(heatT(5, 0), 0, "an empty snapshot is cold, not NaN");
  let previous = -1;
  for (const reach of [0, 1, 2, 5, 10, 50, 100]) {
    const value = heatT(reach, 100);
    assert.ok(value > previous || (reach === 0 && value === 0), `heat rises at ${reach}`);
    previous = value;
  }
  assert.ok(heatT(10, 100) > 0.5, "log scale lifts small counts clear of the floor");
  assert.match(heat(50, 100), /^rgb\(\d+,\d+,\d+\)$/);
  assert.match(heat(0, 100), /^rgb\(\d+,\d+,\d+\)$/);
  assert.match(heat(100, 100), /^rgb\(\d+,\d+,\d+\)$/);
});

test("maxReach spans files and packages", () => {
  const snapshot = snapshotOf([], { "a.ts": 3 }, { "left-pad": 11 });
  assert.equal(maxReach(snapshot), 11);
  assert.equal(maxReach(snapshotOf([], {})), 1, "never zero, so the scale cannot divide by it");
});

test("ownerScreen walks back to a screen that reaches the file", () => {
  const snapshot = snapshotOf([
    { from: "screen:home", to: "file:app/index.tsx", kind: "source", platforms: ["ios", "android"] } as IntelEdge,
    importEdge("file:app/index.tsx", "file:src/shared.ts"),
    importEdge("file:src/shared.ts", "package:left-pad"),
  ], { "app/index.tsx": 1, "src/shared.ts": 1, "orphan.ts": 0 }, { "left-pad": 1 });
  assert.equal(ownerScreen(snapshot, "file:src/shared.ts"), "home", "two hops back to the screen");
  assert.equal(ownerScreen(snapshot, "package:left-pad"), "home", "packages resolve too");
  assert.equal(ownerScreen(snapshot, "file:orphan.ts"), null, "nothing reaches an orphan");
});

test("boundaryOf reads a role off the path", () => {
  assert.equal(boundaryOf("screen:home"), "screen");
  assert.equal(boundaryOf("package:left-pad"), "package");
  assert.equal(boundaryOf("file:src/state/usePostThread.ts"), "hook", "a use-prefixed file is a hook wherever it lives");
  assert.equal(boundaryOf("file:src/hooks/session.ts"), "hook");
  assert.equal(boundaryOf("file:src/lib/api/feed.ts"), "api");
  assert.equal(boundaryOf("file:src/state/queries/post.ts"), "api", "the nearer folder wins over the outer one");
  assert.equal(boundaryOf("file:src/store/index.ts"), "state");
  assert.equal(boundaryOf("file:src/navigation/Root.tsx"), "navigation");
  assert.equal(boundaryOf("file:src/components/Button.tsx"), "component");
  assert.equal(boundaryOf("file:src/view/shell/index.tsx"), "screen");
  assert.equal(boundaryOf("file:src/types/post.d.ts"), "model");
  assert.equal(boundaryOf("file:ios/AppDelegate.swift"), "native");
  assert.equal(boundaryOf("file:assets/icon.png"), "asset");
  assert.equal(boundaryOf("file:src/lib/strings.ts"), "util");
});

test("the Flow filter prunes a boundary and everything only it reached", () => {
  const snapshot = snapshotOf([
    importEdge("screen:home", "file:src/screens/home.tsx"),
    importEdge("file:src/screens/home.tsx", "file:src/hooks/usePosts.ts"),
    importEdge("file:src/screens/home.tsx", "file:src/components/Avatar.tsx"),
    importEdge("file:src/hooks/usePosts.ts", "file:src/api/feed.ts"),
  ], { "src/screens/home.tsx": 1, "src/hooks/usePosts.ts": 1, "src/components/Avatar.tsx": 1, "src/api/feed.ts": 1 });

  assert.deepEqual(flowBoundaries(snapshot, "screen:home").map(entry => entry.boundary).sort(), ["api", "component", "hook", "screen"]);
  const all = buildFlow(snapshot, "screen:home").levels.flat();
  assert.ok(all.includes("file:src/api/feed.ts"), "the hook's own import is reached without a filter");

  const filtered = buildFlow(snapshot, "screen:home", undefined, new Set(["screen", "component"])).levels.flat();
  assert.ok(!filtered.includes("file:src/hooks/usePosts.ts"), "the dropped boundary is gone");
  assert.ok(!filtered.includes("file:src/api/feed.ts"), "and so is the subtree only it reached");
  assert.ok(filtered.includes("file:src/components/Avatar.tsx"), "a kept boundary still draws");
  assert.equal(filtered[0], "screen:home", "the root always survives its own filter");
});

test("flowBoundaries counts only what the graph contains", () => {
  const snapshot = snapshotOf([
    importEdge("screen:home", "file:src/hooks/useA.ts"),
    importEdge("screen:home", "file:src/hooks/useB.ts"),
    importEdge("screen:home", "file:src/lib/strings.ts"),
  ], { "src/hooks/useA.ts": 1, "src/hooks/useB.ts": 1, "src/lib/strings.ts": 1 });
  assert.deepEqual(flowBoundaries(snapshot, "screen:home"), [{ boundary: "hook", count: 2 }, { boundary: "util", count: 1 }]);
});

test("depth tints differ per hop and settle at the last one", () => {
  assert.notEqual(depthHue(0), depthHue(1));
  assert.equal(depthHue(40), depthHue(4));
  assert.match(depthTint(0, 0.2), /^rgba\(\d+,\d+,\d+,0\.2\)$/);
});
