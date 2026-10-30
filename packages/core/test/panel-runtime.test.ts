import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { downloadedPanelRuntime, PANEL_RUNTIME_PARTS, panelRuntimeDirectory, panelRuntimeReleaseSchema, panelRuntimePath, PanelRuntimeUnavailableError, usePanelRuntime, type PanelRuntimeRelease } from "../src/panel-runtime.ts";
import { PANEL_PARTS } from "../../../tooling/host-runtime.mjs";

/** A runtime archive laid out like dist/, with extra entries a tampered archive might hold. */
async function archive(t: test.TestContext, extra?: (root: string) => Promise<string[]>) {
  const directory = await mkdtemp(join(tmpdir(), "panel-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "parts");
  await mkdir(join(root, "baguette/Baguette_Baguette.bundle"), { recursive: true });
  await writeFile(join(root, "baguette/Baguette"), "#!/bin/sh\necho baguette\n");
  await chmod(join(root, "baguette/Baguette"), 0o755);
  await mkdir(join(root, "serve-emu/src"), { recursive: true });
  await writeFile(join(root, "serve-emu/src/cli.mjs"), "");
  await mkdir(join(root, "ios-mirror"));
  await writeFile(join(root, "ios-mirror/darwin-arm64.node"), "addon");
  await writeFile(join(root, "ios-mirror-service.mjs"), "");
  const members = [...PANEL_RUNTIME_PARTS, ...await extra?.(root) ?? []];
  const file = join(directory, "runtime.tar.gz");
  execFileSync("tar", ["-czf", file, "-C", root, ...members], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const bytes = await readFile(file);
  const release: PanelRuntimeRelease = {
    version: "1.2.3", url: pathToFileURL(file).href, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
  };
  return { directory, release, bytes, data: join(directory, "data") };
}

async function serve(t: test.TestContext, respond: () => { status: number; body?: Buffer }) {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    const { status, body } = respond();
    response.writeHead(status);
    response.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/runtime.tar.gz`, requests: () => requests };
}

test("the runtime parts match the parts packaging leaves out", () => {
  assert.deepEqual([...PANEL_RUNTIME_PARTS], PANEL_PARTS);
});

test("the runtime downloads once, verifies, and is shared by later servers", async t => {
  const { release, bytes, data } = await archive(t);
  const server = await serve(t, () => ({ status: 200, body: bytes }));
  const pinned = { ...release, url: server.url };
  const first = downloadedPanelRuntime(pinned, data);
  const [root, again] = await Promise.all([first(), first()]);
  assert.equal(root, again);
  assert.equal(root, join(data, `1.2.3-${release.sha256.slice(0, 12)}`));
  assert.equal(execFileSync(join(root, "baguette/Baguette"), { encoding: "utf8" }), "baguette\n");
  assert.equal(server.requests(), 1);
  // Another server, as another session starts, finds the complete folder.
  assert.equal(await downloadedPanelRuntime(pinned, data)(), root);
  assert.equal(server.requests(), 1);
  assert.deepEqual(await readdir(data), [`1.2.3-${release.sha256.slice(0, 12)}`]);
  usePanelRuntime(first);
  assert.equal(await panelRuntimePath("serve-emu/src/cli.mjs"), join(root, "serve-emu/src/cli.mjs"));
});

test("an archive that does not match its pin is refused and leaves nothing behind", async t => {
  const { release, data } = await archive(t);
  for (const pinned of [{ ...release, sha256: "0".repeat(64) }, { ...release, bytes: release.bytes - 1 }]) {
    await assert.rejects(downloadedPanelRuntime(pinned, data)(), (error: Error) => {
      assert.ok(error instanceof PanelRuntimeUnavailableError);
      assert.match(error.message, /does not match|larger than/);
      return true;
    });
  }
  assert.deepEqual(await readdir(data), []);
});

test("an archive with files outside the parts or with links is refused", async t => {
  const outside = await archive(t, async root => { await writeFile(join(root, "payload.sh"), ""); return ["payload.sh"]; });
  await assert.rejects(downloadedPanelRuntime(outside.release, outside.data)(), /outside the device runtime/);
  const linked = await archive(t, async root => { await symlink("/etc/hosts", join(root, "ios-mirror/hosts")); return []; });
  await assert.rejects(downloadedPanelRuntime(linked.release, linked.data)(), /links or special files/);
  assert.deepEqual(await readdir(linked.data), []);
});

test("an unreachable release is an expected failure that the next open retries", async t => {
  const { release, bytes, data } = await archive(t);
  let status = 404;
  const server = await serve(t, () => ({ status, body: status === 200 ? bytes : undefined }));
  const runtime = downloadedPanelRuntime({ ...release, url: server.url }, data);
  await assert.rejects(runtime(), (error: Error) => {
    assert.ok(error instanceof ExpectedOperationError);
    assert.equal(error.outcome, "download_failed");
    assert.match(error.message, /HTTP 404/);
    return true;
  });
  status = 200;
  assert.match(await runtime(), /1\.2\.3-/);
  assert.equal(server.requests(), 2);
});

test("a new version keeps the newest other version and removes older ones", async t => {
  const { release, data } = await archive(t);
  for (const [name, age] of [["1.0.0-aaaaaaaaaaaa", 3], ["1.1.0-bbbbbbbbbbbb", 2], [".download-stale.tar.gz", 2]] as const) {
    const path = join(data, name);
    await mkdir(data, { recursive: true });
    if (name.startsWith(".")) await writeFile(path, "");
    else await mkdir(path);
    const time = new Date(Date.now() - age * 60 * 60_000);
    await utimes(path, time, time);
  }
  await downloadedPanelRuntime(release, data)();
  await t.waitFor(async () => assert.deepEqual((await readdir(data)).sort(), ["1.1.0-bbbbbbbbbbbb", `1.2.3-${release.sha256.slice(0, 12)}`]));
});

test("a prerelease pins and installs its runtime like a release", async t => {
  const { release, data } = await archive(t);
  const pinned = panelRuntimeReleaseSchema.parse({ ...release, version: "0.1.172-test.1" });
  assert.equal(await downloadedPanelRuntime(pinned, data)(), join(data, `0.1.172-test.1-${release.sha256.slice(0, 12)}`));
  // A later release replaces it like any other version.
  await downloadedPanelRuntime({ ...release, version: "0.1.172" }, data)();
  assert.equal((await readdir(data)).length, 2);
});

test("Claude Code's plugin data folder holds the runtime when it provides one", () => {
  assert.equal(panelRuntimeDirectory({ CLAUDE_PLUGIN_DATA: "/data/mobile-dev" }), "/data/mobile-dev/panel-runtime");
  assert.match(panelRuntimeDirectory({}), /Library\/Caches\/mobile-dev\/panel-runtime$/);
});
