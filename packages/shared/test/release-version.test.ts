import assert from "node:assert/strict";
import { test } from "node:test";
import { compareReleaseVersions, isReleaseVersion, parseReleaseVersion } from "../src/release-version.ts";

test("release versions are plain major.minor.patch numbers", () => {
  for (const version of ["0.1.169", "1.0.0", "10.20.30"]) assert.equal(isReleaseVersion(version), true, version);
  for (const version of ["1.2.3-rc.1", "1.2.3+build", "01.2.3", "1.2", "v1.2.3", "../1.2.3", " 1.2.3", "1.2.3\n", undefined, 123]) {
    assert.equal(isReleaseVersion(version), false, String(version));
  }
  assert.throws(() => parseReleaseVersion("1.2.3-rc.1"), /not a release version/);
});

test("release versions compare numerically", () => {
  assert.equal(compareReleaseVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareReleaseVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareReleaseVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareReleaseVersions("0.1.169", "0.1.169"), 0);
  assert.throws(() => compareReleaseVersions("1.2.3", "1.2.3-rc.1"), /not a release version/);
});
