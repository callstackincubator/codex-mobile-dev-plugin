import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { foregroundCauses } from "@mobile-dev/shared/device-apps-command-diagnostics.ts";

const root = new URL("../../native/", import.meta.url);

test("TypeScript foreground causes are exactly the Rust and Baguette causes", async () => {
  const rust = await readFile(new URL("ios-fps/src/foreground.rs", root), "utf8");
  const rustList = /pub const CAUSES: \[&str; \d+\] = \[([^\]]*)\];/.exec(rust)?.[1];
  assert.ok(rustList, "ios-fps keeps its causes in one CAUSES array");
  const rustCauses = [...rustList.matchAll(/"([a-z_]+)"/g)].map(match => match[1]);
  const swift = await readFile(new URL("baguette/ForegroundFailure.swift", root), "utf8");
  const swiftCauses = [...swift.matchAll(/case \w+ = "([a-z_]+)"/g)].map(match => match[1]);
  assert.ok(rustCauses.length > 0 && swiftCauses.length > 0);
  const helpers = new Set([...rustCauses, ...swiftCauses]);
  assert.deepEqual([...foregroundCauses].sort(), [...helpers].sort());
});
