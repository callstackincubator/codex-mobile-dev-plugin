import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("App Flow opens saved and runtime-only screens without extra device verification", async () => {
  const skill = await readFile(new URL("../../skills/mobile-dev/SKILL.md", import.meta.url), "utf8");

  assert.match(skill, /capture has `replayable: true`.*`mobile_appflow_manual_replay`/s);
  assert.match(skill, /Otherwise call `mobile_appflow_runtime_replay`/);
  assert.match(skill, /same navigator dispatch as the App Flow panel's primary \*\*Replay\*\* button/);
  assert.match(skill, /When either replay tool returns `ok: true`, stop/);
  assert.match(skill, /Do not take a snapshot, verify the destination, open an agent-device session/);
});
