import test from "node:test";
import assert from "node:assert/strict";
import { ComparisonController } from "../src/comparison-controller.ts";
import { recordingFixture } from "../../test-support/recording-fixtures.ts";
import type { HostBridge } from "../src/host-bridge.ts";

function controller(send: () => Promise<{ isError?: boolean }>) {
  const options: unknown[] = [];
  const app = {
    getHostCapabilities: () => ({ message: { text: {} } }),
    async sendMessage(_message: unknown, option: unknown) { options.push(option); return send(); },
    async callServerTool() { throw new Error("Complete comparisons are not read again."); },
  } as unknown as HostBridge;
  const comparison = new ComparisonController(app);
  comparison.hostChanged();
  const first = recordingFixture();
  const second = { ...recordingFixture(), id: "5b1f2b5e-8a0d-4c3e-9f1a-2b3c4d5e6f70" };
  comparison.accept({ content: [], structuredContent: { title: "Before and after", recordings: [first, second] } });
  return { comparison, options };
}

test("Ask bounds its send and tells an unconfirmed delivery from a missing composer", async () => {
  const sent = controller(async () => ({}));
  await sent.comparison.ask();
  assert.deepEqual(sent.options, [{ timeout: 5000, maxTotalTimeout: 5000 }]);
  assert.equal(sent.comparison.getSnapshot().error, "");

  const timeout = controller(async () => { throw Object.assign(new Error("MCP error -32001: Request timed out"), { code: -32001 }); });
  await timeout.comparison.ask();
  assert.equal(timeout.options.length, 1, "An unconfirmed question is never resent automatically.");
  assert.match(timeout.comparison.getSnapshot().error, /did not confirm delivery.*twice/);
  assert.equal(timeout.comparison.getSnapshot().busy, false);

  const rejected = controller(async () => ({ isError: true }));
  await rejected.comparison.ask();
  assert.equal(rejected.comparison.getSnapshot().error, "The host could not send this comparison to chat.");

  const missing = controller(async () => { throw new Error("No active composer is available."); });
  await missing.comparison.ask();
  assert.equal(missing.options.length, 5, "A composer that is still registering gets the same wait as other sends.");
  assert.match(missing.comparison.getSnapshot().error, /could not find this chat's input/);
});
