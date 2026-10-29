import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundles the check as a server ships it, so its own file is a server.mjs the test can remove or replace.
async function bundledServer(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-install-integrity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = join(directory, "server.mjs");
  await build({
    stdin: { contents: 'export * from "./packages/core/src/install-integrity.ts";', resolveDir: resolve("."), loader: "ts" },
    outfile: server, bundle: true, format: "esm", platform: "node", target: "node22.18",
  });
  const module: typeof import("../src/install-integrity.ts") = await import(pathToFileURL(server).href);
  return { server, module };
}

test("a runtime missing beside intact server files is an incomplete installation to reinstall", async t => {
  const { module } = await bundledServer(t);
  assert.equal(module.installIntegrity(), "intact");
  assert.deepEqual(module.installIntegrityTags(new Error("other")), {});
  const error = new module.MissingRuntimeError("serve-emu");
  assert.equal(error.integrity, "incomplete");
  assert.match(error.message, /missing its Android streaming backend\. Reinstall Mobile Dev/);
  assert.deepEqual(module.installIntegrityTags(error), { install_integrity: "incomplete", bundled_runtime: "serve-emu" });
  assert.deepEqual(module.tagInstallIntegrity({ tags: { operation: "android.tool" } }).tags, { operation: "android.tool" });
});

test("server files deleted while running mark every error event removed and ask for a restart", async t => {
  const { server, module } = await bundledServer(t);
  await rm(server);
  const error = new module.MissingRuntimeError("baguette");
  assert.equal(error.integrity, "removed");
  assert.match(error.message, /updated or removed while it was running and cannot find its simulator backend\. Restart the app running Mobile Dev/);
  assert.deepEqual(module.installIntegrityTags(error), { install_integrity: "removed", bundled_runtime: "baguette" });
  assert.deepEqual(module.installIntegrityTags(new Error("spawn ENOENT")), {});
  assert.deepEqual(module.tagInstallIntegrity({ tags: { operation: "device_apps.discover" } }).tags, { install_integrity: "removed", operation: "device_apps.discover" });
  assert.equal(module.tagInstallIntegrity({ type: "transaction" }).tags, undefined);
});

test("server files installed over while running are replaced", async t => {
  const { server, module } = await bundledServer(t);
  const replacement = `${server}.new`;
  await writeFile(replacement, await readFile(server));
  await rename(replacement, server);
  assert.equal(module.installIntegrity(), "replaced");
  assert.equal(new module.MissingRuntimeError("serve-emu").integrity, "replaced");
});
