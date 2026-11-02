import test from "node:test";
import assert from "node:assert/strict";
import { targets } from "../dependency-versions.mjs";

test("compatible updates stay within the major version, or the minor for 0.x", () => {
  assert.deepEqual(targets("1.31.0", ["1.30.0", "1.31.0", "1.32.2", "2.0.0", "2.1.0-beta.1"]), { latest: "2.0.0", safe: "1.32.2" });
  assert.deepEqual(targets("0.20.9", ["0.20.9", "0.20.10", "0.21.32"]), { latest: "0.21.32", safe: "0.20.10" });
  assert.deepEqual(targets("0.2.1", ["v0.2.1", "v0.2.11", "v0.2.9"]), { latest: "v0.2.11", safe: "v0.2.11" });
  assert.deepEqual(targets("0.0.6", ["0.0.6", "0.0.7", "0.1.0"]), { latest: "0.1.0", safe: undefined });
});

test("current, older, prerelease and unparseable versions are not updates", () => {
  assert.deepEqual(targets("4.0", ["4.0", "3.9", "5.0-rc1", "nightly"]), { latest: undefined, safe: undefined });
  assert.deepEqual(targets("main", ["1.0.0"]), {});
});
