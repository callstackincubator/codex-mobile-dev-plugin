/**
 * What a Swift parse report is allowed to become.
 *
 * The graph builder is the point where a report stops being the parser's own vocabulary and starts
 * being a map a user reads, so the tests here are about what it must refuse to say: no node for a
 * leaf component, no edge drawn to something there is no node for, no screen quietly dropped
 * because the parser could not construct it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildSwiftScreenGraph } from "../src/app-flow/swift-graph.ts";
import { readAppUrlScheme } from "../src/app-flow/swift-project.ts";
import { readBundleId } from "../src/app-flow/swift-sweep.ts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AppFlowSwiftParseReport,
  AppFlowSwiftResolution,
  AppFlowSwiftViewEdge
} from "../src/shared/app-flow.ts";

function resolution(
  view: string,
  overrides: Partial<AppFlowSwiftResolution> = {}
): AppFlowSwiftResolution {
  return {
    view,
    rung: "noParams",
    expression: `${view}()`,
    missing: [],
    file: `Sources/${view}.swift`,
    line: 1,
    screenEvidence: ["navigationTitle"],
    environmentRequires: [],
    ...overrides
  };
}

function report(
  app: string,
  resolutions: AppFlowSwiftResolution[],
  viewEdges: AppFlowSwiftViewEdge[] = []
): AppFlowSwiftParseReport {
  return {
    contractVersion: 1,
    app,
    swiftFiles: resolutions.length,
    views: resolutions.length,
    viewsConstructible: resolutions.length,
    screens: resolutions.length,
    screensConstructible: resolutions.length,
    screenCoverage: 1,
    byRung: {},
    routes: {
      hashableRouteTypes: [],
      navigationDestinationTypes: [],
      navigationLinkValueCount: 0,
      navigationLinkDestinationCount: 0
    },
    routeEdges: [],
    routeEdgesConstructible: 0,
    viewEdges,
    resolutions
  };
}

function edge(
  from: string,
  to: string,
  kind: AppFlowSwiftViewEdge["kind"] = "push"
): AppFlowSwiftViewEdge {
  return { from, to, kind, via: "NavigationLink", file: "Sources/X.swift", line: 2 };
}

// `screens` and `views` are different counts in the parser's own report, and the difference is the
// whole claim: a view with no evidence of being a destination is a button, a row, a header. Minting
// a node for one would put components in a map of screens.
test("a leaf component is not a screen, and gets no node", async () => {
  const graph = buildSwiftScreenGraph([
    report("Demo", [
      resolution("FeedView"),
      resolution("AvatarBadge", { screenEvidence: [] })
    ])
  ]);
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ["FeedView"]
  );
});

// The parser records an edge wherever it can read both ends, including to leaf components and to
// views another source root owns. An edge pointing at nothing would render as an arrow into empty
// space — a claim the map has nothing to back.
test("an edge to something with no node is dropped, not drawn to nothing", async () => {
  const graph = buildSwiftScreenGraph([
    report(
      "Demo",
      [resolution("FeedView"), resolution("AvatarBadge", { screenEvidence: [] })],
      [edge("FeedView", "AvatarBadge"), edge("FeedView", "ProfileView")]
    )
  ]);
  assert.deepEqual(graph.edges, []);
});

test("the same relation written twice is one edge", async () => {
  const graph = buildSwiftScreenGraph([
    report(
      "Demo",
      [resolution("GalleryView"), resolution("EditorView")],
      [edge("GalleryView", "EditorView"), edge("GalleryView", "EditorView")]
    )
  ]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]?.from, "GalleryView");
  assert.equal(graph.edges[0]?.to, "EditorView");
});

test("a push and a route arm to the same screen are one arrow", async () => {
  // Both emit `push`, so two edges here are two identical arrows between the same pair. A real run
  // found nine of them on IceCubesApp's settings tab, where each screen is both a `NavigationLink`
  // and an arm of the route switch.
  const graph = buildSwiftScreenGraph([
    report(
      "Demo",
      [resolution("SettingsTabs"), resolution("DisplaySettingsView")],
      [
        edge("SettingsTabs", "DisplaySettingsView", "push"),
        edge("SettingsTabs", "DisplaySettingsView", "route")
      ]
    )
  ]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]?.kind, "push");
});

// A modal and a push between the same two screens are two different things a user can do, so they
// stay two edges — and `kind` is what the renderer draws them differently by.
test("a modal and a push between the same screens stay distinct", async () => {
  const graph = buildSwiftScreenGraph([
    report(
      "Demo",
      [resolution("HomeView"), resolution("SettingsView")],
      [edge("HomeView", "SettingsView", "push"), edge("HomeView", "SettingsView", "modal")]
    )
  ]);
  assert.deepEqual(graph.edges.map((e) => e.kind).sort(), ["modal", "push"]);
});

// A refused screen is in the app whether or not it can be constructed. Dropping it would make the
// map smaller and cleaner and wrong: the user would have no way to know the screen exists.
test("a screen the parser refused is still a node, carrying what it was missing", async () => {
  const graph = buildSwiftScreenGraph([
    report("Demo", [
      resolution("OrderDetailView", {
        rung: "skipped",
        expression: null,
        missing: ["id: String"]
      })
    ])
  ]);
  assert.equal(graph.nodes.length, 1);
  assert.deepEqual(graph.nodes[0]?.params, ["id: String"]);
  assert.deepEqual(graph.refusedByParser, { OrderDetailView: ["id: String"] });
});

// Every source root of one project is one app, under one flat namespace of Swift type names — the
// same namespace the registry the capture loop drives is keyed by. Two nodes for one name would be
// two map entries racing for one screenshot.
test("a view name two source roots both declare becomes one node", async () => {
  const graph = buildSwiftScreenGraph([
    report("App", [resolution("SettingsView")]),
    report("Package", [resolution("SettingsView")])
  ]);
  assert.equal(graph.nodes.length, 1);
  assert.deepEqual(graph.nodes[0]?.groups, ["App"]);
});

// SwiftUI screens have no route path and nothing here reads a URL scheme, so claiming either would
// send the explorer at a deep link that does not exist.
test("a Swift node claims no route and no deep link", async () => {
  const graph = buildSwiftScreenGraph([report("Demo", [resolution("FeedView")])]);
  const node = graph.nodes[0];
  assert.equal(node?.urlPath, null);
  assert.equal(node?.reach, "navigation-only");
  assert.equal(node?.navigator, null);
});

// A report from a parser built before `viewEdges` existed does not carry the field. Adding a field
// is explicitly not a contract bump, so such a report has to read as "no edges", not as a crash.
test("a report with no viewEdges field is read as having none", async () => {
  const older = report("Demo", [resolution("FeedView")]);
  delete (older as { viewEdges?: unknown }).viewEdges;
  const graph = buildSwiftScreenGraph([older]);
  assert.deepEqual(graph.edges, []);
  // The same rule for every field added after contract 1: an older parser carries none of them,
  // and a missing field reads as empty rather than as a refusal to read the report.
  assert.deepEqual(graph.layouts, []);
  assert.equal(graph.rootNavigator, null);
  assert.deepEqual(graph.entryScreenIds, []);
});

test("only an entry's own navigator becomes a layout", async () => {
  const base = report("Demo", [
    resolution("RootView", { screenEvidence: ["appRoot"] }),
    resolution("FeedView")
  ]);
  const graph = buildSwiftScreenGraph([
    {
      ...base,
      appEntries: [{ name: "DemoApp", entryViews: ["RootView"], file: "Sources/App.swift", line: 1 }],
      navigators: [
        { view: "RootView", kind: "tabs", via: "TabView", file: "Sources/RootView.swift", line: 3 },
        { view: "FeedView", kind: "stack", via: "NavigationStack", file: "Sources/FeedView.swift", line: 3 }
      ]
    }
  ]);

  assert.deepEqual(graph.entryScreenIds, ["RootView"]);
  // `FeedView` builds a `NavigationStack` too, and reporting it as a layout would be a claim that
  // it is mounted at the app root — which nothing observed says. See the module header.
  assert.deepEqual(graph.layouts, [{ name: "RootView", navigator: "Tabs", parent: null }]);
  assert.deepEqual(graph.entryLayouts, ["RootView"]);
  assert.equal(graph.rootNavigator, "Tabs");
});

test("an entry the graph has no node for is not named as one", async () => {
  // `AppView` is the app's root in source, but the parser refused to call it a screen, so the map
  // has no node for it. A journey cannot start at a screen the map does not have.
  const base = report("Demo", [resolution("FeedView")]);
  const graph = buildSwiftScreenGraph([
    {
      ...base,
      appEntries: [{ name: "DemoApp", entryViews: ["AppView"], file: "Sources/App.swift", line: 1 }],
      navigators: [
        { view: "AppView", kind: "splitView", via: "NavigationSplitView", file: "Sources/AppView.swift", line: 3 }
      ]
    }
  ]);

  assert.deepEqual(graph.entryScreenIds, []);
  assert.deepEqual(graph.layouts, []);
  assert.equal(graph.rootNavigator, null);
});

async function xcodeProject(
  t: test.TestContext,
  pbxproj: string,
  xcconfigs: Record<string, string> = {}
): Promise<{ projectPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-swift-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectPath = join(root, "App.xcodeproj");
  await mkdir(projectPath, { recursive: true });
  await writeFile(join(projectPath, "project.pbxproj"), pbxproj);
  for (const [name, body] of Object.entries(xcconfigs)) {
    await writeFile(join(root, name), body);
  }
  return { projectPath };
}

function swiftProject(projectPath: string) {
  return {
    container: "xcodeproj" as const,
    workspacePath: null,
    projectPath,
    packageManifestPath: null,
    sourceRoots: [],
    schemes: []
  };
}

// An extension's identifier is the app's with a suffix, and the test bundle's is the app's with
// `Tests` on the end — so the shortest is the app. Driving a widget extension would launch nothing.
test("the app's bundle id is read, not an extension's", async (t) => {
  const { projectPath } = await xcodeProject(
    t,
    [
      'PRODUCT_BUNDLE_IDENTIFIER = "com.example.App.Widget";',
      'PRODUCT_BUNDLE_IDENTIFIER = "com.example.App";',
      'PRODUCT_BUNDLE_IDENTIFIER = "com.example.AppTests";'
    ].join("\n")
  );
  assert.equal(await readBundleId(swiftProject(projectPath)), "com.example.App");
});

// Real projects write the identifier as `$(PREFIX).App` so a fork can change it in one file.
// Without expanding that there is no bundle id to read at all — IceCubesApp is exactly this shape.
test("a bundle id built from an xcconfig variable is expanded", async (t) => {
  const { projectPath } = await xcodeProject(
    t,
    'PRODUCT_BUNDLE_IDENTIFIER = "$(BUNDLE_ID_PREFIX).App";',
    { "App.xcconfig": "BUNDLE_ID_PREFIX = com.example\n" }
  );
  assert.equal(await readBundleId(swiftProject(projectPath)), "com.example.App");
});

// The harness is `#if DEBUG`, so a release build cannot answer the control channel whatever its
// identifier says. Reading the release config could only ever name an app that will not respond.
test("a release xcconfig does not supply the bundle id", async (t) => {
  const { projectPath } = await xcodeProject(
    t,
    'PRODUCT_BUNDLE_IDENTIFIER = "$(BUNDLE_ID_PREFIX).App";',
    {
      "App.xcconfig": "BUNDLE_ID_PREFIX = com.example\n",
      "App-release.xcconfig": "BUNDLE_ID_PREFIX = com.shipping\n"
    }
  );
  assert.equal(await readBundleId(swiftProject(projectPath)), "com.example.App");
});

// An identifier that still holds a build-setting reference resolves to something only `xcodebuild`
// knows. Half-expanding it would produce a plausible identifier for an app that does not exist.
test("an unresolvable variable yields no bundle id rather than a half-expanded one", async (t) => {
  const { projectPath } = await xcodeProject(
    t,
    'PRODUCT_BUNDLE_IDENTIFIER = "$(UNKNOWN_PREFIX).App";'
  );
  assert.equal(await readBundleId(swiftProject(projectPath)), null);
});

/**
 * A project root named `name`, holding each of `plists` at the given relative path.
 *
 * The root's own name matters: the app target's folder is conventionally named after the project,
 * and that is how the reader tells the app's plist from a sibling bundle's.
 */
async function projectWithPlists(
  t: test.TestContext,
  name: string,
  plists: Record<string, string>
): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "mobile-dev-swift-scheme-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, name);
  await mkdir(root, { recursive: true });
  for (const [relative, body] of Object.entries(plists)) {
    const path = join(root, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        body,
        "</dict></plist>"
      ].join("\n")
    );
  }
  return root;
}

/** The `CFBundleURLTypes` entry that registers one scheme. */
function urlTypes(scheme: string): string {
  return [
    "<key>CFBundleURLTypes</key><array><dict>",
    `<key>CFBundleURLSchemes</key><array><string>${scheme}</string></array>`,
    "</dict></array>"
  ].join("\n");
}

test("the app's registered URL scheme is read, not an extension's", async (t) => {
  const root = await projectWithPlists(t, "IceCubesApp", {
    // The app target's folder, named after the project the way Xcode lays one out.
    "IceCubesApp/Info.plist": urlTypes("icecubesapp"),
    // A share extension registers its own. Reading that one would hand the capture loop a scheme
    // that opens a share sheet rather than the app.
    "IceCubesShareExtension/Info.plist": urlTypes("icecubesshare")
  });
  assert.equal(await readAppUrlScheme(root), "icecubesapp");
});

test("an app under a platform folder still has its scheme found", async (t) => {
  // `isowords` keeps it at `App/iOS/Info.plist`, which no single-level read reaches.
  const root = await projectWithPlists(t, "isowords", { "App/iOS/Info.plist": urlTypes("isowords") });
  assert.equal(await readAppUrlScheme(root), "isowords");
});

test("an app that registers no scheme reports none rather than failing", async (t) => {
  const root = await projectWithPlists(t, "Plain", {
    "App/Info.plist": "<key>CFBundleName</key><string>App</string>"
  });
  // `plutil -extract` exits non-zero for an absent key, which is the common case and not an error.
  assert.equal(await readAppUrlScheme(root), null);
});
