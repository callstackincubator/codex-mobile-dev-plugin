import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { serverBundleBanner } from "../server-bundle.mjs";

test("server ESM bundles provide the CommonJS path globals used by bundled dependencies", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-server-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "server.mjs");

  await build({
    stdin: {
      contents: "console.log(JSON.stringify({ filename: __filename, dirname: __dirname, resolved: require.resolve('node:path') }));",
      resolveDir: process.cwd(),
    },
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    banner: { js: serverBundleBanner },
  });

  const result = JSON.parse(execFileSync(process.execPath, [output], { encoding: "utf8" }));
  const canonicalOutput = await realpath(output);
  assert.equal(result.filename, canonicalOutput);
  assert.equal(result.dirname, dirname(canonicalOutput));
  assert.equal(result.resolved, "node:path");
});
