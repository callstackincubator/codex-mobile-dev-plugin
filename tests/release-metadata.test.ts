import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { releaseMetadata } from "../scripts/release-metadata.mjs";

async function fixture(t: TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-release-metadata-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const sourceDirectory = join(directory, "src/shared");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(`${directory}/plugin.json`, '{"name":"mobile-dev","version":"1.2.3"}');
  await writeFile(`${directory}/package.json`, '{"version":"1.2.3"}');
  await writeFile(`${directory}/package-lock.json`, '{"version":"1.2.3","packages":{"":{"version":"1.2.3"}}}');
  await writeFile(`${sourceDirectory}/version.ts`, 'export const PLUGIN_VERSION = "1.2.3";\n');
  return directory;
}

test("release metadata selects the versioned upload ZIP", async t => {
  const directory = await fixture(t);
  const metadata = await releaseMetadata("v1.2.3", directory);
  assert.deepEqual(metadata, {
    tag: "v1.2.3", version: "1.2.3", archive: "release/mobile-dev-1.2.3-darwin-arm64.zip",
  });
});

test("release metadata rejects a tag for a different release", async t => {
  const directory = await fixture(t);
  for (const tag of [undefined, "main", "v1.2.4", "v1.2.3\narchive=unexpected.zip"]) {
    const result = releaseMetadata(tag, directory);
    await assert.rejects(result, /Release tag must be v1\.2\.3/);
  }
});

test("release metadata rejects inconsistent package and runtime versions", async t => {
  const changes: Array<[string, string, RegExp]> = [
    ["package.json", '{"version":"1.2.4"}', /package.json version/],
    ["package-lock.json", '{"version":"1.2.4"}', /package-lock.json version/],
    ["package-lock.json", '{"version":"1.2.3","packages":{"":{"version":"1.2.4"}}}', /root package version/],
    ["src/shared/version.ts", 'export const PLUGIN_VERSION = "1.2.4";', /src\/shared\/version.ts/],
  ];
  for (const [file, contents, expectedError] of changes) {
    const directory = await fixture(t);
    await writeFile(`${directory}/${file}`, contents);
    const result = releaseMetadata("v1.2.3", directory);
    await assert.rejects(result, expectedError);
  }
});

test("release metadata rejects manifest values that could escape artifact paths or outputs", async t => {
  const directory = await fixture(t);
  await writeFile(`${directory}/plugin.json`, '{"name":"mobile-dev","version":"../1.2.3"}');
  const result = releaseMetadata("v../1.2.3", directory);
  await assert.rejects(result, /semantic release version/);
});
