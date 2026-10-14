import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePathStep } from "../src/app-flow/manual/path-commands.ts";
import {
  agentDeviceOpenCommand,
  baselineLaunchCommands,
  walkCommands,
  walkStepCommand,
} from "../src/app-flow/walk-commands.ts";
import type { AppFlowStep } from "../src/shared/app-flow.ts";

const device = {
  setupCommands: ["agent-device boot --platform ios --target mobile"],
  launchTarget: "xyz.blueskyweb.app",
  launchUrl: null,
};

describe("App Flow walk command serialization", () => {
  it("round trips taps, inputs, quoted locators, and swipes through the path parser", () => {
    assert.deepEqual(
      parsePathStep(walkStepCommand({ type: "tap", locator: { by: "id", value: "homeBtn" } })!),
      { kind: "press", selector: 'id="homeBtn"' },
    );
    assert.deepEqual(
      parsePathStep(walkStepCommand({
        type: "input",
        locator: { by: "label", value: "Search" },
        value: "hello world",
      })!),
      { kind: "fill", selector: 'label="Search"', value: "hello world" },
    );
    assert.deepEqual(
      parsePathStep(walkStepCommand({ type: "tap", locator: { by: "text", value: 'say "hi"' } })!),
      { kind: "press", selector: 'text="say \\"hi\\""' },
    );
    assert.deepEqual(parsePathStep(walkStepCommand({ type: "swipe", direction: "down" })!), {
      kind: "scroll",
      direction: "down",
    });
    assert.deepEqual(parsePathStep(walkStepCommand({ type: "swipe" })!), {
      kind: "scroll",
      direction: "up",
    });
  });

  it("rejects unrenderable actions while intentionally omitting waits", () => {
    assert.equal(walkStepCommand({ type: "tap" }), null);
    assert.equal(walkStepCommand({ type: "input", value: "x" }), null);
    assert.equal(walkStepCommand({ type: "wait", duration: 2_000 }), null);
    assert.equal(
      walkCommands([
        { type: "tap", locator: { by: "id", value: "a" } },
        { type: "tap" },
        { type: "tap", locator: { by: "id", value: "b" } },
      ]),
      null,
    );
    assert.deepEqual(walkCommands([{ type: "wait" }]), []);
  });

  it("keeps serializable steps in order", () => {
    const steps: AppFlowStep[] = [
      { type: "tap", locator: { by: "id", value: "tabSearch" } },
      { type: "wait", duration: 1_000 },
      { type: "input", locator: { by: "id", value: "q" }, value: "bsky" },
      { type: "tap", locator: { by: "label", value: "First result" } },
    ];
    assert.deepEqual(walkCommands(steps), [
      `agent-device press 'id="tabSearch"' --settle`,
      `agent-device fill 'id="q"' bsky --settle`,
      `agent-device press 'label="First result"' --settle`,
    ]);
  });
});

describe("App Flow baseline launch commands", () => {
  it("preserves setup order and round trips seed and fallback URLs", () => {
    assert.deepEqual(baselineLaunchCommands(device), [
      "agent-device boot --platform ios --target mobile",
      "agent-device open xyz.blueskyweb.app --platform ios",
    ]);
    const [, seeded] = baselineLaunchCommands(device, "bluesky://profile/alice");
    assert.deepEqual(parsePathStep(seeded), {
      kind: "open",
      app: "xyz.blueskyweb.app",
      url: "bluesky://profile/alice",
    });
    const [, fallback] = baselineLaunchCommands({ ...device, launchUrl: "exp://127.0.0.1:8081/--/" });
    assert.deepEqual(parsePathStep(fallback), {
      kind: "open",
      app: "xyz.blueskyweb.app",
      url: "exp://127.0.0.1:8081/--/",
    });
  });

  it("quotes app ids and URLs for the shell", () => {
    assert.equal(
      agentDeviceOpenCommand("my app", "it's"),
      "agent-device open 'my app' 'it'\\''s' --platform ios",
    );
  });
});
