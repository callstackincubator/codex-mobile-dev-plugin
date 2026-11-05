import assert from "node:assert/strict";
import test from "node:test";
import type { AppIntelSnapshot, IntelEdge } from "@mobile-dev/shared/app-intelligence.ts";
import { FLOW_METRICS, boundariesIn, boundaryOf, buildFlow, clampName, depthHue, depthTint, ellipsize, flowLink, groupKey, labelOf, openByDefault, pathOf, placeFlow, platformsFor } from "../src/app-intelligence-layout.ts";

function snapshotOf(edges: IntelEdge[], files: Record<string, number>, packages: Record<string, number> = {}): AppIntelSnapshot {
  const indexes: AppIntelSnapshot["indexes"] = { screens: Object.create(null), incoming: Object.create(null), outgoing: Object.create(null) };
  edges.forEach((edge, index) => { (indexes.outgoing[edge.from] ??= []).push(index); if (edge.to) (indexes.incoming[edge.to] ??= []).push(index); });
  return {
    formatVersion: 1,
    meta: { projectId: "p", generation: "g", analyzedAt: "", analyzerVersion: "t", sourceFingerprint: "f" },
    files: Object.fromEntries(Object.entries(files).map(([path, reach]) => [path, { fingerprint: "x", kind: "source" as const, reach }])),
    packages: Object.fromEntries(Object.entries(packages).map(([name, reach]) => [name, { name, reach, entry: null }])),
    screens: { home: { title: "Home", route: "/", source: "src/screens/home.tsx", layouts: [] } },
    edges, diagnostics: [], indexes,
  };
}

const importEdge = (from: string, to: string, platforms: IntelEdge["platforms"] = ["ios", "android"]): IntelEdge => ({ from: from as IntelEdge["from"], to: to as IntelEdge["to"], kind: "import", platforms });

test("a file reached only on one platform reports that platform", () => {
  const snapshot = snapshotOf([
    importEdge("file:src/screen.tsx", "file:src/value.ios.ts", ["ios"]),
    importEdge("file:src/screen.tsx", "file:src/both.ts"),
  ], { "src/screen.tsx": 1, "src/value.ios.ts": 1, "src/both.ts": 1 });
  assert.equal(platformsFor(snapshot, "file:src/value.ios.ts"), "ios");
  assert.equal(platformsFor(snapshot, "file:src/both.ts"), "both");
  assert.equal(platformsFor(snapshot, "file:src/screen.tsx"), "both", "nothing reaches it, so it is not platform-specific");
});

const refsIn = (level: ReturnType<typeof buildFlow>["levels"][number]) => level.flatMap(group => group.refs);
const groupsIn = (level: ReturnType<typeof buildFlow>["levels"][number]) => level.map(group => group.boundary);

test("buildFlow terminates on an import cycle", () => {
  const snapshot = snapshotOf([
    importEdge("file:a.ts", "file:b.ts"),
    importEdge("file:b.ts", "file:a.ts"),
  ], { "a.ts": 1, "b.ts": 1 });
  const flow = buildFlow(snapshot, "file:a.ts");
  assert.deepEqual(refsIn(flow.levels[1]), ["file:b.ts"]);
  assert.equal(flow.levels[2], undefined, "a.ts is already visited, so the walk stops");
});

/** One screen reaching a component, a hook and two packages: enough to group, fold and overflow. */
function groupedSnapshot() {
  return snapshotOf([
    { from: "screen:home", to: "file:src/screens/home.tsx", kind: "source", platforms: ["ios", "android"] },
    importEdge("file:src/screens/home.tsx", "file:src/components/Button.tsx"),
    importEdge("file:src/screens/home.tsx", "file:src/components/Card.tsx"),
    importEdge("file:src/screens/home.tsx", "file:src/hooks/useThing.ts"),
    importEdge("file:src/screens/home.tsx", "package:react"),
    importEdge("file:src/screens/home.tsx", "package:react-native"),
    importEdge("file:src/components/Button.tsx", "file:src/util/text.ts"),
  ], { "src/screens/home.tsx": 1, "src/components/Button.tsx": 1, "src/components/Card.tsx": 1, "src/hooks/useThing.ts": 1, "src/util/text.ts": 1 }, { react: 2, "react-native": 2 });
}

/**
 * The keys to toggle so every boundary down to `depth` is open. Opening one hop reveals the next,
 * so this repeats until the graph stops growing rather than guessing at the key names.
 */
function openTo(depth: number) {
  const toggled = new Set<string>();
  for (let round = 0; round <= depth; round++) {
    for (const level of buildFlow(groupedSnapshot(), "screen:home", { toggled }).levels) {
      for (const group of level) if (group.collapsed && Number(group.key.split(":")[0]) <= depth) toggled.add(group.key);
    }
  }
  return toggled;
}

test("a hop opens its first boundary and names the rest", () => {
  assert.equal(openByDefault(1, 3), true, "the screen's own source is always open");
  assert.equal(openByDefault(2, 0), true, "and so is the first boundary of every hop below it");
  assert.equal(openByDefault(2, 1), false);
  const flow = buildFlow(groupedSnapshot(), "screen:home");
  assert.deepEqual(refsIn(flow.levels[1]), ["file:src/screens/home.tsx"]);
  assert.deepEqual(flow.levels[2].map(group => [group.boundary, group.collapsed, group.count]), [["hook", false, 1], ["component", true, 2], ["package", true, 2]]);
  assert.deepEqual(refsIn(flow.levels[2]), ["file:src/hooks/useThing.ts"], "one readable spine, not a wall of cards");
  assert.equal(flow.levels[3], undefined, "the boundary left open here imports nothing further");
});

test("buildFlow splits each hop into boundaries, in display order", () => {
  const flow = buildFlow(groupedSnapshot(), "screen:home", { toggled: openTo(2) });
  assert.deepEqual(refsIn(flow.levels[1]), ["file:src/screens/home.tsx"]);
  assert.deepEqual(groupsIn(flow.levels[2]), ["hook", "component", "package"], "boundaries keep the display order, not discovery order");
  assert.deepEqual(flow.levels[2].find(group => group.boundary === "package")?.refs, ["package:react", "package:react-native"]);
  assert.deepEqual(refsIn(buildFlow(groupedSnapshot(), "screen:home", { toggled: openTo(3) }).levels[3]), ["file:src/util/text.ts"]);
  assert.equal(flow.levels[2][0].key, groupKey(2, "hook"));
});

test("folding a boundary drops its rows and everything they would have pulled in", () => {
  // openTo flips the folded boundaries open; dropping one key leaves that boundary at its default.
  const open = openTo(3);
  open.delete(groupKey(2, "component"));
  const flow = buildFlow(groupedSnapshot(), "screen:home", { toggled: open });
  const components = flow.levels[2].find(group => group.boundary === "component");
  assert.deepEqual(components?.refs, []);
  assert.equal(components?.collapsed, true);
  assert.equal(components?.count, 2, "the header still reports what it is hiding");
  assert.equal(flow.levels[3], undefined, "Button.tsx was the only path to the next hop");
  assert.deepEqual(refsIn(flow.levels[2]), ["file:src/hooks/useThing.ts", "package:react", "package:react-native"], "the other boundaries are untouched");
});

test("a boundary past its cap folds the rest into an overflow its key can open", () => {
  const snapshot = groupedSnapshot();
  const capped = buildFlow(snapshot, "screen:home", { groupCap: 1, toggled: openTo(3) });
  const components = capped.levels[2].find(group => group.boundary === "component");
  assert.deepEqual(components?.refs, ["file:src/components/Button.tsx"]);
  assert.equal(components?.hidden, 1);
  assert.deepEqual(refsIn(capped.levels[3]), ["file:src/util/text.ts"], "the row that is drawn still seeds the next hop");
  const opened = buildFlow(snapshot, "screen:home", { groupCap: 1, toggled: openTo(3), expanded: new Set([groupKey(2, "component")]) });
  const all = opened.levels[2].find(group => group.boundary === "component");
  assert.deepEqual(all?.refs, ["file:src/components/Button.tsx", "file:src/components/Card.tsx"]);
  assert.equal(all?.hidden, 0);
});

test("placeFlow stacks a hop into a column without overlapping its cards", () => {
  const placed = placeFlow(buildFlow(groupedSnapshot(), "screen:home", { toggled: openTo(3) }));
  assert.equal(placed.cards.length, 8, "it places every drawn row");
  assert.equal(placed.headers.length, 5, "one header per boundary, and none for the root");
  assert.ok(placed.cards.every(card => placed.rectOf.get(card.ref) === card.rect));
  for (let a = 0; a < placed.cards.length; a++) for (let b = a + 1; b < placed.cards.length; b++) {
    const first = placed.cards[a].rect, second = placed.cards[b].rect;
    const overlaps = first.x < second.x + second.width - 0.001 && second.x < first.x + first.width - 0.001
      && first.y < second.y + second.height - 0.001 && second.y < first.y + first.height - 0.001;
    assert.ok(!overlaps, `${placed.cards[a].ref} overlaps ${placed.cards[b].ref}`);
  }
  for (const card of placed.cards) {
    assert.ok(card.rect.x >= 0 && card.rect.y >= 0 && card.rect.x + card.rect.width <= placed.width + 0.001 && card.rect.y + card.rect.height <= placed.height + 0.001, "every card stays inside the board");
  }
});

test("each hop steps one column along, anchored so a fold moves nothing before it", () => {
  const flow = buildFlow(groupedSnapshot(), "screen:home", { toggled: openTo(3) });
  const columns = placeFlow(flow);
  const depthOf = (placed: ReturnType<typeof placeFlow>, depth: number) => placed.cards.filter(card => card.depth === depth);
  // Rows under a header are indented past it, which the root card has no header to sit under.
  assert.equal(columns.headers[0].rect.x - depthOf(columns, 0)[0].rect.x, FLOW_METRICS.column);
  assert.equal(depthOf(columns, 1)[0].rect.x - depthOf(columns, 0)[0].rect.x, FLOW_METRICS.column + FLOW_METRICS.indent);
  assert.equal(depthOf(columns, 2).every(card => card.rect.x === depthOf(columns, 1)[0].rect.x + FLOW_METRICS.column), true);
  assert.equal(depthOf(columns, 0)[0].rect.y, FLOW_METRICS.pad);
  const folded = placeFlow(buildFlow(groupedSnapshot(), "screen:home"));
  assert.deepEqual(depthOf(folded, 0)[0].rect, depthOf(columns, 0)[0].rect, "the root sits where it sat before the fold");
  assert.deepEqual(depthOf(folded, 1)[0].rect, depthOf(columns, 1)[0].rect);
});

test("a folded boundary still records what feeds it, and where its header landed", () => {
  const folded = buildFlow(groupedSnapshot(), "screen:home");
  const components = folded.levels[2].find(group => group.boundary === "component");
  assert.deepEqual(components?.sources, ["file:src/screens/home.tsx"], "the connector has somewhere to come from");
  const placed = placeFlow(folded);
  assert.ok(placed.headerRectOf.get(groupKey(2, "component")), "and somewhere to land");
  assert.deepEqual(placed.headerRectOf.get(groupKey(2, "component")), placed.headers.find(header => header.key === groupKey(2, "component"))?.rect);
  // Sources are the cards above, so a boundary fed by two files records both of them once each.
  const deep = buildFlow(groupedSnapshot(), "screen:home", { toggled: openTo(3) });
  assert.deepEqual(deep.levels[3].find(group => group.boundary === "util")?.sources, ["file:src/components/Button.tsx"]);
});

test("a link leaves the right edge and lands on the left", () => {
  const from = { x: 0, y: 0, width: 100, height: 40 }, to = { x: 200, y: 80, width: 100, height: 40 };
  assert.equal(flowLink(from, to), "M100 20 C145 20 155 100 200 100");
});

test("boundaryOf reads a role off the path", () => {
  assert.equal(boundaryOf("screen:home"), "entry", "an analyzer root is an entry point, not necessarily a screen");
  assert.equal(boundaryOf("package:left-pad"), "package");
  assert.equal(boundaryOf("file:src/state/usePostThread.ts"), "hook", "a use-prefixed file is a hook wherever it lives");
  assert.equal(boundaryOf("file:src/hooks/session.ts"), "hook");
  assert.equal(boundaryOf("file:src/lib/api/feed.ts"), "api");
  assert.equal(boundaryOf("file:src/state/queries/post.ts"), "api", "the nearer folder wins over the outer one");
  assert.equal(boundaryOf("file:src/store/index.ts"), "state");
  assert.equal(boundaryOf("file:src/navigation/Root.tsx"), "navigation");
  assert.equal(boundaryOf("file:src/components/Button.tsx"), "component");
  assert.equal(boundaryOf("file:src/view/shell/index.tsx"), "entry");
  assert.equal(boundaryOf("file:src/types/post.d.ts"), "model");
  assert.equal(boundaryOf("file:ios/AppDelegate.swift"), "native");
  assert.equal(boundaryOf("file:assets/icon.png"), "asset");
  assert.equal(boundaryOf("file:src/lib/strings.ts"), "util");
  assert.equal(boundaryOf("file:src/lexicons/getProfile.ts"), "model", "generated schema definitions are not utilities");
  assert.equal(boundaryOf("file:src/weird/thing.ts"), "other", "an unrecognised path says so rather than claiming a role");
  assert.equal(boundaryOf("file:node_modules/@atproto/api/dist/index.js"), "package", "a dependency is a package however the analyzer recorded it");
  assert.equal(boundaryOf("file:node_modules/react-native/Libraries/Image/Image.ios.js"), "package", "a dependency's own folder names never classify it");
});

test("boundariesIn counts in display order and lists only what it was given", () => {
  assert.deepEqual(boundariesIn(["hook", "entry", "hook", "model"]), [
    { boundary: "entry", count: 1 }, { boundary: "hook", count: 2 }, { boundary: "model", count: 1 },
  ]);
  assert.deepEqual(boundariesIn([]), []);
});

test("depth tints differ per hop and settle at the last one", () => {
  assert.notEqual(depthHue(0), depthHue(1));
  assert.equal(depthHue(40), depthHue(4));
  assert.match(depthTint(0, 0.2), /^rgba\(\d+,\d+,\d+,0\.2\)$/);
});

test("a barrel file is named for the folder it indexes, and keeps its whole path", () => {
  assert.equal(labelOf("file:src/components/forms/Toggle/index.tsx"), "Toggle");
  assert.equal(pathOf("file:src/components/forms/Toggle/index.tsx"), "src/components/forms");
  assert.equal(labelOf("file:src/components/Typography.tsx"), "Typography.tsx");
  assert.equal(pathOf("file:src/components/Typography.tsx"), "src/components");
  assert.equal(labelOf("file:index.ts"), "index.ts", "a barrel at the root has no folder to borrow");
  assert.equal(labelOf("package:react-native-screens"), "react-native-screens");
  assert.equal(pathOf("package:react-native-screens"), "node_modules/");
});

test("a long path truncates from the left and a long name from the right", () => {
  assert.equal(ellipsize("src/screens/Settings/components", 14), "…gs/components");
  assert.equal(ellipsize("src/alf", 14), "src/alf");
  assert.equal(clampName("ModerationInboxSettings.tsx", 12), "ModerationI…");
  assert.equal(clampName("Toggle", 12), "Toggle");
});
