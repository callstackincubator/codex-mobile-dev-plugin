import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function lockedAgentDevice(runtime: string): Promise<string> {
  const lock = JSON.parse(await readFile(new URL(`../../runtimes/${runtime}/package-lock.json`, import.meta.url), "utf8"));
  const version = lock.packages?.["node_modules/agent-device"]?.version;
  assert.equal(typeof version, "string", `${runtime} runtime locks agent-device`);
  return version;
}

test("Mobile Dev's agent-device matches the one the bundled e2e runner uses", async () => {
  // Both share one state directory (BUNDLED_STATE_DIR is the app's pinned directory), and a daemon
  // started by a newer runner makes the older client refuse: "Daemon (…, v0.21.37) is newer than
  // this client (v0.21.33)". Android locator capture after a failed run then fails.
  assert.equal(await lockedAgentDevice("agent-device"), await lockedAgentDevice("e2e"));
});
