/**
 * The parser's invocation contract, exercised from the side that depends on it.
 *
 * The contract is the seam that lets the parser's *distribution* change without touching anything
 * downstream, so it is worth a test that does not care how the binary was obtained. These run
 * against a stub that prints what the contract promises, which keeps them honest about the shape
 * without making the suite depend on a Swift toolchain; the one test that does need a real parser
 * skips itself when none is built, rather than failing on a machine that has no Xcode.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  SwiftParseUnavailableError,
  resolveSwiftParser,
  runSwiftParser,
  parseSwiftSourceRoots
} from "../src/app-flow/swift-parse.ts";
import { SWIFT_PARSE_CONTRACT_VERSION } from "../src/shared/app-flow.ts";

/** A stub standing in for the real binary: same stdout/stderr/exit-code promises, no Swift. */
async function stubParser(t: test.TestContext, body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-swift-parse-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "swift-appflow-parse");
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

function report(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    contractVersion: SWIFT_PARSE_CONTRACT_VERSION,
    app: "Demo",
    swiftFiles: 2,
    views: 3,
    viewsConstructible: 2,
    screens: 2,
    screensConstructible: 1,
    screenCoverage: 0.5,
    byRung: { noParams: 1, skipped: 1 },
    routes: {
      hashableRouteTypes: [],
      navigationDestinationTypes: [],
      navigationLinkValueCount: 0,
      navigationLinkDestinationCount: 0
    },
    routeEdges: [],
    routeEdgesConstructible: 0,
    resolutions: [],
    ...overrides
  });
}

/** Runs `fn` with the parser override pointed at `path`, restoring the environment afterwards. */
async function withParser<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.MOBILE_DEV_SWIFT_APPFLOW_PARSE;
  process.env.MOBILE_DEV_SWIFT_APPFLOW_PARSE = path;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_SWIFT_APPFLOW_PARSE;
    else process.env.MOBILE_DEV_SWIFT_APPFLOW_PARSE = previous;
  }
}

test("a report on stdout is read and its contract version checked", async (t) => {
  const path = await stubParser(t, `echo 'summary on stderr' >&2\ncat <<'JSON'\n${report()}\nJSON`);
  const parsed = await withParser(path, () => runSwiftParser("/some/source/root"));
  assert.equal(parsed.contractVersion, SWIFT_PARSE_CONTRACT_VERSION);
  assert.equal(parsed.screens, 2);
  // stderr is for humans; nothing on it may reach the report.
  assert.equal(parsed.app, "Demo");
});

test("a report from a different contract is refused rather than read", async (t) => {
  const path = await stubParser(t, `cat <<'JSON'\n${report({ contractVersion: 99 })}\nJSON`);
  await assert.rejects(
    withParser(path, () => runSwiftParser("/some/source/root")),
    (error: unknown) => {
      assert.ok(error instanceof SwiftParseUnavailableError);
      assert.equal(error.reason, "contract_mismatch");
      assert.match(error.message, /contract 99/);
      return true;
    }
  );
});

test("a usage error and an unreadable root are different sentences", async (t) => {
  const usage = await stubParser(t, "echo 'swift-appflow-parse: unexpected argument' >&2\nexit 2");
  await assert.rejects(
    withParser(usage, () => runSwiftParser("/some/source/root")),
    (error: unknown) => {
      assert.ok(error instanceof SwiftParseUnavailableError);
      assert.equal(error.reason, "parse_failed");
      assert.match(error.message, /rejected its arguments/);
      return true;
    }
  );

  const unreadable = await stubParser(t, "echo 'swift-appflow-parse: source root does not exist' >&2\nexit 3");
  await assert.rejects(
    withParser(unreadable, () => runSwiftParser("/some/source/root")),
    (error: unknown) => {
      assert.ok(error instanceof SwiftParseUnavailableError);
      assert.match(error.message, /could not read the source root/);
      return true;
    }
  );
});

test("a clean exit with no JSON is a failure, not an app with no screens", async (t) => {
  const path = await stubParser(t, "echo 'not json'");
  await assert.rejects(
    withParser(path, () => runSwiftParser("/some/source/root")),
    (error: unknown) => {
      assert.ok(error instanceof SwiftParseUnavailableError);
      assert.match(error.message, /did not print a JSON report/);
      return true;
    }
  );
});

test("an override that is not executable names itself", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-swift-parse-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "not-executable");
  await writeFile(path, "");
  await assert.rejects(
    withParser(path, () => resolveSwiftParser()),
    (error: unknown) => {
      assert.ok(error instanceof SwiftParseUnavailableError);
      assert.equal(error.reason, "parser_missing");
      assert.match(error.message, /not an executable file/);
      return true;
    }
  );
});

test("no source roots means no parser is run at all", async () => {
  // The guard matters: resolving the parser would otherwise build it for a project that has
  // nothing to parse.
  assert.deepEqual(await parseSwiftSourceRoots([]), []);
});

test("the real parser answers the contract", async (t) => {
  const binary = resolve("native/swift-appflow-parse/.build/release/swift-appflow-parse");
  try {
    await access(binary, constants.X_OK);
  } catch {
    t.skip("the Swift parser is not built here");
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-swift-parse-app-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "Sources"), { recursive: true });
  await writeFile(
    join(directory, "Sources/AboutView.swift"),
    [
      "import SwiftUI",
      "struct AboutView: View {",
      "  var body: some View { Text(\"About\").navigationTitle(\"About\") }",
      "}"
    ].join("\n")
  );

  // A second screen that reads the environment, because `environmentRequires` is what the
  // registry's audit is built from and an always-empty list would pass a weaker test.
  await writeFile(
    join(directory, "Sources/ThemedView.swift"),
    [
      "import SwiftUI",
      "struct ThemedView: View {",
      "  @EnvironmentObject var session: AppSession",
      "  @Environment(\\.themeAccent) private var accent",
      "  var body: some View { Text(\"Themed\").navigationTitle(\"Themed\") }",
      "}"
    ].join("\n")
  );

  const parsed = await withParser(binary, () => runSwiftParser(directory));
  assert.equal(parsed.contractVersion, SWIFT_PARSE_CONTRACT_VERSION);
  assert.equal(parsed.swiftFiles, 2);
  // A view with no parameters is the first rung, and `navigationTitle` is what makes it a screen
  // rather than a leaf component.
  assert.equal(parsed.screens, 2);
  assert.equal(parsed.screensConstructible, 2);
  assert.equal(parsed.resolutions[0]?.rung, "noParams");
  const themed = parsed.resolutions.find((row) => row.view === "ThemedView");
  // The type for the object, the key-path member for the key — the two things a syntax pass can
  // actually observe, and exactly what the audit compares against.
  assert.deepEqual(themed?.environmentRequires, ["AppSession", "themeAccent"]);
  // Contract 1 removed this rung; a report still carrying it would be a different contract.
  assert.equal("synthesized" in parsed.byRung, false);
  // Every row has the same keys whatever its rung: `expression` is an explicit null when the
  // parser refused, never an absent key.
  assert.equal("expression" in (parsed.resolutions[0] ?? {}), true);
  assert.deepEqual(parsed.resolutions[0]?.environmentRequires, []);

  // A root with no Swift at all is a report, not an error: "no screens" and "the parser broke"
  // must not look alike.
  const empty = await mkdtemp(join(tmpdir(), "mobile-dev-swift-parse-empty-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const nothing = await withParser(binary, () => runSwiftParser(empty));
  assert.equal(nothing.views, 0);
  assert.equal(nothing.screens, 0);
});

/** A source root holding `files`, for the tests that need the real binary. */
async function sourceRoot(
  t: test.TestContext,
  files: Record<string, readonly string[]>
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-swift-parse-app-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "Sources"), { recursive: true });
  for (const [name, lines] of Object.entries(files)) {
    await writeFile(join(directory, "Sources", name), lines.join("\n"));
  }
  return directory;
}

/** The real binary, or null when this machine has no Swift toolchain to have built it with. */
async function builtParser(t: test.TestContext): Promise<string | null> {
  const binary = resolve("native/swift-appflow-parse/.build/release/swift-appflow-parse");
  try {
    await access(binary, constants.X_OK);
    return binary;
  } catch {
    t.skip("the Swift parser is not built here");
    return null;
  }
}

test("a sheet's container is not the screen inside it", async (t) => {
  const binary = await builtParser(t);
  if (!binary) return;
  const root = await sourceRoot(t, {
    "HomeView.swift": [
      "import SwiftUI",
      "struct HomeView: View {",
      "  @State private var editing = false",
      "  var body: some View {",
      "    Text(\"Home\")",
      "      .navigationTitle(\"Home\")",
      "      .sheet(isPresented: $editing) { NavigationStack { EditorView() } }",
      "  }",
      "}"
    ],
    "EditorView.swift": [
      "import SwiftUI",
      "struct EditorView: View { var body: some View { Text(\"Editor\") } }"
    ]
  });

  const parsed = await withParser(binary, () => runSwiftParser(root));
  const editor = parsed.resolutions.find((row) => row.view === "EditorView");
  // The wrapper absorbed this evidence before: `.sheet { NavigationStack { EditorView() } }`
  // presents the editor, and a `NavigationStack` is not a screen in any reading.
  assert.deepEqual(editor?.screenEvidence, ["sheet"]);
  assert.deepEqual(
    (parsed.viewEdges ?? []).map((edge) => [edge.from, edge.to, edge.kind]),
    [["HomeView", "EditorView", "modal"]]
  );
});

test("a route value written at a link satisfies the destination it names", async (t) => {
  const binary = await builtParser(t);
  if (!binary) return;
  const root = await sourceRoot(t, {
    "Routing.swift": [
      "import SwiftUI",
      "enum Route: Hashable { case orderDetail(String) }",
      "struct RootView: View {",
      "  var body: some View {",
      "    NavigationStack {",
      "      NavigationLink(\"Order\", value: Route.orderDetail(\"A-1042\"))",
      "        .navigationDestination(for: Route.self) { route in",
      "          switch route {",
      "          case .orderDetail(let id): OrderDetailView(orderId: id)",
      "          }",
      "        }",
      "    }",
      "  }",
      "}",
      "struct OrderDetailView: View {",
      "  let orderId: String",
      "  var body: some View { Text(orderId).navigationTitle(\"Order\") }",
      "}"
    ]
  });

  const parsed = await withParser(binary, () => runSwiftParser(root));
  const order = parsed.resolutions.find((row) => row.view === "OrderDetailView");
  // A pattern-bound `String` has no value of its own, and `""` would render a lookup failure
  // dressed as content. The app wrote a real one down at the link, so this is observation.
  assert.equal(order?.rung, "callSite");
  assert.equal(order?.expression, 'OrderDetailView(orderId: "A-1042")');
  assert.deepEqual(order?.missing, []);
  assert.deepEqual(
    (parsed.observedRouteValues ?? []).map((value) => [value.routeType, value.caseName, value.arguments]),
    [["Route", "orderDetail", ['"A-1042"']]]
  );
});

test("a route value built from a local is not an observation", async (t) => {
  const binary = await builtParser(t);
  if (!binary) return;
  const root = await sourceRoot(t, {
    "Routing.swift": [
      "import SwiftUI",
      "enum Route: Hashable { case orderDetail(String) }",
      "struct RootView: View {",
      "  let selectedId: String",
      "  var body: some View {",
      "    NavigationStack {",
      "      NavigationLink(\"Order\", value: Route.orderDetail(selectedId))",
      "        .navigationDestination(for: Route.self) { route in",
      "          switch route {",
      "          case .orderDetail(let id): OrderDetailView(orderId: id)",
      "          }",
      "        }",
      "    }",
      "  }",
      "}",
      "struct OrderDetailView: View {",
      "  let orderId: String",
      "  var body: some View { Text(orderId).navigationTitle(\"Order\") }",
      "}"
    ]
  });

  const parsed = await withParser(binary, () => runSwiftParser(root));
  // `selectedId` is an instance property: it does not resolve at the lift site, so the value is
  // not written down anywhere this tool can read, and the screen stays refused.
  assert.deepEqual(parsed.observedRouteValues ?? [], []);
  const order = parsed.resolutions.find((row) => row.view === "OrderDetailView");
  assert.equal(order?.rung, "skipped");
  assert.deepEqual(order?.missing, ["Route.orderDetail(id: String)"]);
});

test("environment keys a child reads are reported, apart from the ones declared", async (t) => {
  const binary = await builtParser(t);
  if (!binary) return;
  const root = await sourceRoot(t, {
    "ScreenView.swift": [
      "import SwiftUI",
      "struct ScreenView: View {",
      "  @Environment(\\.themeAccent) private var accent",
      "  var body: some View { BadgeView().navigationTitle(\"Screen\") }",
      "}"
    ],
    "BadgeView.swift": [
      "import SwiftUI",
      "struct BadgeView: View {",
      "  @EnvironmentObject var session: AppSession",
      "  var body: some View { AvatarView() }",
      "}"
    ],
    "AvatarView.swift": [
      "import SwiftUI",
      "struct AvatarView: View {",
      "  @Environment(\\.quickLook) private var quickLook",
      "  var body: some View { Color.clear }",
      "}"
    ]
  });

  const parsed = await withParser(binary, () => runSwiftParser(root));
  const screen = parsed.resolutions.find((row) => row.view === "ScreenView");
  // Declared stays declared: a consumer reading only the old field reads the same answer it did
  // before the transitive closure existed.
  assert.deepEqual(screen?.environmentRequires, ["themeAccent"]);
  // Two levels down, because the child that needs the key is routinely not the immediate one.
  assert.deepEqual(screen?.environmentRequiresTransitive, ["AppSession", "quickLook"]);
  const badge = parsed.resolutions.find((row) => row.view === "BadgeView");
  assert.deepEqual(badge?.environmentRequiresTransitive, ["quickLook"]);
});

test("the app's own scenes say where a journey starts, and in what shape", async (t) => {
  const binary = await builtParser(t);
  if (!binary) return;
  const root = await sourceRoot(t, {
    "DemoApp.swift": [
      "import SwiftUI",
      "@main",
      "struct DemoApp: App {",
      "  var body: some Scene { WindowGroup { RootView() } }",
      "}"
    ],
    "RootView.swift": [
      "import SwiftUI",
      "struct RootView: View {",
      "  var body: some View { TabView { FeedView() } }",
      "}"
    ],
    "FeedView.swift": [
      "import SwiftUI",
      "struct FeedView: View {",
      "  var body: some View { NavigationStack { Text(\"Feed\") }.navigationTitle(\"Feed\") }",
      "}"
    ]
  });

  const parsed = await withParser(binary, () => runSwiftParser(root));
  // `WindowGroup` is the window, not the screen in it, and the entry is a view the app declares —
  // not every call the scene body happens to make.
  assert.deepEqual(
    (parsed.appEntries ?? []).map((entry) => [entry.name, entry.entryViews]),
    [["DemoApp", ["RootView"]]]
  );
  assert.deepEqual(
    (parsed.navigators ?? []).map((navigator) => [navigator.view, navigator.kind]),
    [["RootView", "tabs"], ["FeedView", "stack"]]
  );
});
