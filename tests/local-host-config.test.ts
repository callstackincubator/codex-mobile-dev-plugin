import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localHostConfig } from "../scripts/local-host-config.mjs";

test("editor configs relocate the bundle with spaces without assuming a shell or Codex runtime", async t => {
  const root = await mkdtemp(join(tmpdir(), "mobile dev config "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(localHostConfig("cursor", root), /ENOENT/);
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist/server.mjs"), "");
  for (const host of ["cursor", "vscode"]) {
    const config = await localHostConfig(host, root, "/Node Runtime/bin/node");
    const key = host === "vscode" ? "servers" : "mcpServers";
    assert.deepEqual(Object.keys(config), [key]);
    assert.deepEqual(config[key]["mobile-dev"], {
      type: "stdio", command: "/Node Runtime/bin/node", args: [join(root, "dist/server.mjs")], env: { MOBILE_DEV_HOST: host },
    });
  }
  await assert.rejects(localHostConfig("other", root), /Unsupported/);
});
