import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DOWNLOADED_RUNTIME_PARTS, PANEL_PARTS } from "../host-runtime.mjs";

test("the release metadata pins every bundled e2e runtime dependency", async () => {
  const root = "packages/runtimes/e2e";
  const manifest = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  const lockSource = await readFile(`${root}/package-lock.json`, "utf8");
  const lock = JSON.parse(lockSource);
  const release = JSON.parse(await readFile(`${root}/release.json`, "utf8"));

  assert.equal(release.lockfileSHA256, createHash("sha256").update(lockSource).digest("hex"));
  assert.deepEqual(Object.keys(release.packages).sort(), Object.keys(manifest.dependencies).sort());
  for (const name of Object.keys(manifest.dependencies)) {
    assert.equal(release.packages[name].version, lock.packages[`node_modules/${name}`].version);
    assert.match(release.packages[name].integrity, /^sha512-/);
  }
});

test("e2e ships notices and is included in the downloadable runtime", async () => {
  const notices = await readFile("packages/runtimes/e2e/THIRD_PARTY_NOTICES.txt", "utf8");
  assert.ok(notices.length > 10_000);
  assert.match(notices, /e2e 0\.23\.1/);
  assert.match(notices, /@ai-sdk\/gateway\/node_modules\/@ai-sdk\/provider 4\.0\.36/);
  assert.equal(PANEL_PARTS.includes("e2e"), false);
  assert.ok(DOWNLOADED_RUNTIME_PARTS.includes("e2e"));
});
