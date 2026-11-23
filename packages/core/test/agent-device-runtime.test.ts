import assert from "node:assert/strict";
import { mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentDeviceRuntime } from "../src/agent-device-runtime.ts";

test("the runtime can retry and start in a newly configured state directory", async t => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-state-test-"));
  const parent = join(root, "App Flow");
  const directory = join(parent, "agent-device");
  const previous = process.env.AGENT_DEVICE_STATE_DIR;
  process.env.AGENT_DEVICE_STATE_DIR = directory;
  const runtime = new AgentDeviceRuntime(new URL("../../runtimes/agent-device/", import.meta.url));
  t.after(async () => {
    try { await runtime.close(); }
    finally {
      if (previous === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
      else process.env.AGENT_DEVICE_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  await writeFile(parent, "temporarily blocks directory creation");
  await assert.rejects(runtime.connect());
  await unlink(parent);

  const client = await runtime.connect();
  const state = await client.callTool({ name: "session", arguments: { action: "state-dir" } }, {});
  assert.equal(state.isError, false);
  const reported = state.structuredContent?.stateDir
    ?? state.content.find(item => item.type === "text")?.text;
  assert.equal(reported, directory);
  assert.equal(process.env.AGENT_DEVICE_STATE_DIR, directory);
  await runtime.close();
  assert.ok((await stat(directory)).isDirectory(), "Closing the runtime keeps the configured state directory");
});
