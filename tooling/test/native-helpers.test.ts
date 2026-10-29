import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileSHA256, nativeExecutables, nativeHelpers, nativeRuntimeFiles } from "../native-helpers.mjs";

test("every committed helper records its binaries as { sourceSHA256, binaries: { path: { sha256 } } }", async () => {
  for (const helper of nativeHelpers.filter(entry => entry.committed)) {
    const root = `packages/native/vendor/${helper.name}`;
    const metadata = JSON.parse(await readFile(`${root}/release.json`, "utf8"));
    assert.equal(helper.release, undefined, `${helper.name} uses the shared release shape`);
    assert.match(metadata.sourceSHA256, /^[a-f0-9]{64}$/);
    assert.equal(metadata.binarySHA256, undefined);
    for (const binary of helper.binaries) assert.ok(metadata.binaries[binary], `${helper.name} records ${binary}`);
    for (const [path, binary] of Object.entries<{ sha256: string }>(metadata.binaries)) {
      assert.equal(await fileSHA256(`${root}/${path}`), binary.sha256, `${helper.name}/${path}`);
    }
  }
});

test("helper runtime files, executables and copied sources exist", async () => {
  const names = nativeHelpers.map(helper => helper.name);
  assert.equal(new Set(names).size, names.length);
  for (const path of [...nativeRuntimeFiles(), ...nativeExecutables()]) {
    const [name, ...rest] = path.split("/");
    const helper = nativeHelpers.find(entry => entry.name === name);
    assert.ok(helper);
    if (helper.committed === false) continue;
    const file = rest.join("/");
    const extra = helper.extraFiles.find(([, target]) => target === file);
    await access(extra ? extra[0] : `packages/native/vendor/${path}`);
  }
  for (const helper of nativeHelpers) for (const [source] of helper.extraFiles) await access(source);
  assert.deepEqual(nativeRuntimeFiles(["android-cpu"]).slice(0, 1), ["android-cpu/arm64-v8a/mobile-dev-cpu"]);
});
