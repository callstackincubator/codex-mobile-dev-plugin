import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenizeAgentDeviceCommand } from "../src/app-flow-deps/profiling/agent-device-command.ts";
import { quoteCliArg } from "../src/app-flow/cli-args.ts";
import { parsePathStep } from "../src/app-flow/manual/path-commands.ts";
import { selectorParts } from "../src/app-flow/path-minimize.ts";
import { stepToPathCommand, triggerToPathCommand } from "../src/app-flow/reach/chrome-path.ts";
import { unguardPressSteps } from "../src/app-flow/ad-script.ts";

// These exercise the escaping fixes that CodeQL and the Copilot review flagged: a selector or
// shell-quoted value that itself contains a backslash or apostrophe must round trip, not just a
// plain-text one.

describe("agent-device command tokenizer", () => {
  it("round trips the POSIX escape quoteCliArg() emits for an embedded apostrophe", () => {
    const quoted = quoteCliArg("it's");
    assert.deepEqual(tokenizeAgentDeviceCommand(`press ${quoted}`), ["press", "it's"]);
  });

  it("keeps an empty quoted argument as its own (empty) token", () => {
    assert.deepEqual(tokenizeAgentDeviceCommand("fill id=search ''"), ["fill", "id=search", ""]);
  });

  it("preserves a trailing unquoted backslash with nothing to escape", () => {
    assert.deepEqual(tokenizeAgentDeviceCommand("press foo\\"), ["press", "foo\\"]);
  });
});

describe("pathToReach selector escaping", () => {
  it("round trips a tap locator value that ends in a backslash", () => {
    const command = stepToPathCommand({ type: "tap", locator: { by: "id", value: "foo\\" } });
    assert.ok(command);
    assert.deepEqual(parsePathStep(command!), { kind: "press", selector: 'id="foo\\\\"' });
  });

  it("round trips a trigger value carrying both a quote and a backslash", () => {
    const command = triggerToPathCommand({ by: "label", value: 'say "hi"\\' });
    assert.deepEqual(parsePathStep(command), { kind: "press", selector: 'label="say \\"hi\\"\\\\"' });
  });

  it("selectorParts recovers the original value from an escaped selector", () => {
    const command = stepToPathCommand({ type: "tap", locator: { by: "id", value: 'a\\"b' } })!;
    const step = parsePathStep(command);
    assert.equal(step?.kind, "press");
    assert.deepEqual(selectorParts((step as { selector: string }).selector), { by: "id", value: 'a\\"b' });
  });
});

describe("ad-script wait-guard escaping", () => {
  it("unguardPressSteps writes a wait selector that survives a value ending in a backslash", () => {
    // Build the input the way `saveAndReplayRecording` would have recorded it: an identity
    // comment above a press whose selector's value happens to end in a backslash. The press line
    // itself uses the module's own escape scheme (`\\`, then `\"`), matched here rather than
    // reimplemented, so this exercises `waitLineFor`'s matching encode through the public API.
    const encode = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const selector = 'id="foo\\"'; // a decoded selector whose value itself ends in a backslash
    const identity = JSON.stringify({ ancestry: [{ role: "application", label: "Blue Sky" }] });
    const lines = [`# agent-device:target-v1 ${identity}`, `press "${encode(selector)}"`];

    const result = unguardPressSteps(lines, 1);
    assert.ok(result);
    const waitLine = result!.lines.find(line => line.trim().startsWith("wait "));
    assert.ok(waitLine, "expected an inserted wait line");
    const match = /^wait\s+"(.*)"\s+\d+$/.exec(waitLine!.trim());
    assert.ok(match);
    assert.equal(match![1].replace(/\\(["\\])/g, "$1"), selector);
  });
});
