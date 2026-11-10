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

test("the testing skill records, hands over, and never saves or runs", async () => {
  const skill = await readFile(new URL("../../skills/mobile-dev-testing/SKILL.md", import.meta.url), "utf8");

  // The loop, in the order the tools enforce it.
  assert.match(skill, /mobile_testing_agent_begin.*mobile_testing_agent_screen.*mobile_testing_agent_step.*mobile_testing_agent_finish/s);
  assert.match(skill, /Read the screen again after every step that acts/);
  // The prerequisites are the user's to set: an agent that opens the folder picker opens a system
  // dialog inside its own turn.
  assert.match(skill, /\*\*Never choose the project for them\*\*/);
  // Pinned locators are the point of recording; a sentence is the fallback for an element the
  // screen read reported no selector for.
  assert.match(skill, /## Never write a locator/);
  assert.match(skill, /no `selector` at all/);
  assert.match(skill, /\*\*Never save\.\*\*/);
  assert.match(skill, /\*\*Never run the test\.\*\*/);
  // And the handover, which is the whole deliverable: the user adjusts and saves.
  assert.match(skill, /in the Testing panel, unsaved/);
});

test("the testing skill says where a flow ends, not only where it starts", async () => {
  const skill = await readFile(new URL("../../skills/mobile-dev-testing/SKILL.md", import.meta.url), "utf8");

  // The bug this rule exists for: told to record "the Explore screen", the agent read the name as
  // a starting point, navigated on, and recorded the next screen's heading, sections and search.
  assert.match(skill, /## Where the flow ends/);
  assert.match(skill, /\*\*The screen the user named is the scope of the recording, not the place it starts\.\*\*/);
  assert.match(skill, /assert the arrival with \*\*one\*\* assertion/);
  assert.match(skill, /Record nothing on\s+the screen you arrived at/);
  // The hint the tool gives it, and the one case where crossing screens is the point.
  assert.match(skill, /`navigated: true`/);
  assert.match(skill, /\*\*A flow name is not a boundary\.\*\*/);
  // Saying what was left out costs a sentence; recording it costs the user an edit.
  assert.match(skill, /I stopped at Explore List/);
  // A disclosure left open is a screen the next step resolves against and the test will not reach.
  assert.match(skill, /A control you \*\*open\*\* is part of the screen, so assert what it revealed/);
});

test("the testing skill ships from every plugin that has the panel", async () => {
  const { sharedSkills } = await import("../../../tooling/plugin-hosts.mjs");
  assert.ok(sharedSkills.includes("packages/skills/mobile-dev-testing"), "Codex and Cursor");
  const claude = JSON.parse(await readFile(new URL("../../../apps/claude/plugin-host.json", import.meta.url), "utf8"));
  assert.ok(claude.skills.includes("../../packages/skills/mobile-dev-testing"), "Claude Code");
});
