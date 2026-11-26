import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPanel } from "../src/panel-tools.ts";

test("the MCP instructions and skill use the panel by default for Android viewing and control", async () => {
  const skillPath = new URL("../../skills/mobile-dev/SKILL.md", import.meta.url);
  const skill = await readFile(skillPath, "utf8");
  const android = skill.split("## Android\n")[1];
  const panel = createPanel();
  for (const guidance of [panel.instructions, android]) {
    assert.match(guidance, /Mobile Dev panel to show or control (?:an )?Android device/);
    assert.match(guidance, /scrcpy[^.]*?explicit/i);
  }
});

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

  assert.match(skill, /iOS or Android app/);
  assert.match(skill, /Testing Studio tab must be open/);
  assert.match(skill, /Never ask the user for a project, device or target up front/);
  // A closed tab is the agent's to open, not the user's.
  assert.match(skill, /mobile_open_simulator\(\{ workspaceTool: "testing", projectPath \}\)/);
  assert.match(skill, /Always pass `projectPath`: your workspace root/, "the tab follows the chat's project");
  assert.match(skill, /Do not ask the user to open it/);
  assert.doesNotMatch(skill, /tell the user to \*\*open Mobile Dev's Testing Studio tab\*\*/);

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
  assert.match(skill, /\*\*Never save\*\* a project's test/);
  assert.match(skill, /\*\*Never run the test\*\* while recording/);
  // And the handover, which is the whole deliverable: the user adjusts and saves.
  assert.match(skill, /in the Testing Studio panel, unsaved/);
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
  const antigravity = JSON.parse(await readFile(new URL("../../../apps/antigravity/plugin-host.json", import.meta.url), "utf8"));
  assert.ok(antigravity.skills.includes("../../packages/skills/mobile-dev-testing"), "Antigravity");
});

test("the testing skill teaches Testing Studio mode: record saves, run, add the missing app, repair by locator only", async () => {
  const skill = await readFile(new URL("../../skills/mobile-dev-testing/SKILL.md", import.meta.url), "utf8");

  assert.match(skill, /## Testing Studio mode: record, run, repair/);
  // The tab must be open, and the agent opens it itself rather than guessing a project.
  assert.match(skill, /open it yourself with `mobile_open_simulator\(\{ workspaceTool: "testing", projectPath \}\)`/);
  // Record now saves, and says where.
  assert.match(skill, /`mobile_testing_agent_finish` \*\*writes the test\*\*.*`relativePath`/s);
  // Run: one device or several, and devices that are off are the matrix's to boot.
  assert.match(skill, /`mobile_testing_run_matrix/);
  assert.match(skill, /\*\*Devices that are off are booted by the matrix\*\*/);
  // A platform with no app: ask, wait, add without asking, report the id, run again.
  assert.match(skill, /mobile_testing_wait_for_app.*mobile_testing_set_target.*mode: "add".*\*\*without asking\*\*.*which id you added/s);
  // Failure: branch that platform's line only, two tries, then report; never touch an assertion.
  assert.match(skill, /mobile_testing_branch_line/);
  assert.match(skill, /\*\*At most two tries per failure\.\*\*.*likely app\s+bug/s);
  assert.match(skill, /\*\*Never weaken or remove an assertion\*\*/);
});
