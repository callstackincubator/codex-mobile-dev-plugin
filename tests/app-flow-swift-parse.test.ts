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

  const parsed = await withParser(binary, () => runSwiftParser(directory));
  assert.equal(parsed.contractVersion, SWIFT_PARSE_CONTRACT_VERSION);
  assert.equal(parsed.swiftFiles, 1);
  // A view with no parameters is the first rung, and `navigationTitle` is what makes it a screen
  // rather than a leaf component.
  assert.equal(parsed.screens, 1);
  assert.equal(parsed.screensConstructible, 1);
  assert.equal(parsed.resolutions[0]?.rung, "noParams");
  // Contract 1 removed this rung; a report still carrying it would be a different contract.
  assert.equal("synthesized" in parsed.byRung, false);

  // A root with no Swift at all is a report, not an error: "no screens" and "the parser broke"
  // must not look alike.
  const empty = await mkdtemp(join(tmpdir(), "mobile-dev-swift-parse-empty-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const nothing = await withParser(binary, () => runSwiftParser(empty));
  assert.equal(nothing.views, 0);
  assert.equal(nothing.screens, 0);
});
