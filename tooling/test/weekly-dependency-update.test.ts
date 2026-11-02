import test from "node:test";
import assert from "node:assert/strict";
import { dependencyLanes, laneHelpers, laneOf } from "../dependency-lanes.mjs";
import { pullRequestBody, runLane } from "../weekly-dependency-update.mjs";

const lane = dependencyLanes.find(candidate => candidate.name === "baguette");

function fakeSteps({ updated = true, prepares = [true], fixes = true, applyError }: { updated?: boolean; prepares?: boolean[]; fixes?: boolean; applyError?: Error }) {
  const calls: string[] = [];
  const steps = {
    head: async () => "base",
    apply: async () => {
      calls.push("apply");
      if (applyError) throw applyError;
      return updated;
    },
    prepare: async () => {
      calls.push("prepare");
      return prepares.shift() ?? false;
    },
    commit: async (message: string) => { calls.push(`commit ${message}`); },
    fix: async () => {
      calls.push("fix");
      return fixes;
    },
    revert: async (_lane: unknown, base: string) => { calls.push(`revert ${base}`); },
  };
  return { steps, calls };
}

test("a lane that prepares is committed and kept", async () => {
  const { steps, calls } = fakeSteps({});
  assert.deepEqual(await runLane(lane, steps), { lane: "baguette", outcome: "applied" });
  assert.deepEqual(calls, ["apply", "prepare", "commit chore(deps): update Baguette"]);
});

test("a lane without updates does nothing", async () => {
  const { steps, calls } = fakeSteps({ updated: false });
  assert.deepEqual(await runLane(lane, steps), { lane: "baguette", outcome: "none" });
  assert.deepEqual(calls, ["apply"]);
});

test("Claude's fix is a separate commit when it makes the lane prepare", async () => {
  const { steps, calls } = fakeSteps({ prepares: [false, true] });
  assert.deepEqual(await runLane(lane, steps), { lane: "baguette", outcome: "fixed" });
  assert.deepEqual(calls, ["apply", "prepare", "commit chore(deps): update Baguette", "fix", "prepare", "commit fix(deps): adapt to the Baguette updates"]);
});

test("a lane that still fails after Claude is reverted to where it started", async () => {
  const { steps, calls } = fakeSteps({ prepares: [false, false] });
  const result = await runLane(lane, steps);
  assert.equal(result.outcome, "left-out");
  assert.match(result.reason, /after Claude's changes/);
  assert.equal(calls.at(-1), "revert base");
});

test("without Claude a failing lane is reverted at once", async () => {
  const { steps, calls } = fakeSteps({ prepares: [false], fixes: false });
  assert.equal((await runLane(lane, steps)).outcome, "left-out");
  assert.deepEqual(calls, ["apply", "prepare", "commit chore(deps): update Baguette", "fix", "revert base"]);
});

test("a failed update is reverted and left out", async () => {
  const { steps, calls } = fakeSteps({ applyError: new Error("HTTP 502\nmore") });
  const result = await runLane(lane, steps);
  assert.deepEqual(result, { lane: "baguette", outcome: "left-out", reason: "the update itself failed: HTTP 502" });
  assert.deepEqual(calls, ["apply", "revert base"]);
});

test("lanes cover each update group and native helper", () => {
  assert.equal(laneOf("npm"), "js");
  assert.equal(laneOf("github-actions"), "js");
  assert.equal(laneOf("forked"), "forks");
  const helpers = ["baguette", "ios-fps", "ios-mirror"];
  assert.deepEqual(laneHelpers(dependencyLanes.find(candidate => candidate.name === "sentry-native"), helpers), helpers);
  assert.deepEqual(laneHelpers(lane, helpers), ["baguette"]);
  assert.deepEqual(laneHelpers(dependencyLanes[0], helpers), []);
});

test("the pull request lists left-out updates as held back with the reason", () => {
  const body = pullRequestBody({
    results: [
      { lane: "js", outcome: "applied" },
      { lane: "sentry-native", outcome: "none" },
      { lane: "baguette", outcome: "left-out", reason: "installing or building failed" },
    ],
    updates: [
      { lane: "js", group: "npm", name: "zod", from: "4.3.6", to: "4.6.7", applied: true },
      { lane: "baguette", group: "native", name: "Baguette", from: "0.2.1", to: "v0.2.11", applied: true },
    ],
    cargoChanges: 0,
    checks: "passed",
    checksSummary: "| Check | Result |\n",
    notes: [],
    runUrl: "https://example.test/run",
  });
  assert.match(body, /\*\*Mac checks: passed\.\*\*/);
  assert.match(body, /\| npm packages, device runtimes and GitHub Actions \| ✅ applied \|/);
  assert.match(body, /\| Baguette \| ↩️ left out: installing or building failed \|/);
  assert.doesNotMatch(body, /sentry-native \|/);
  assert.match(body, /### Applied[\s\S]*npm: zod \| 4\.3\.6 \| 4\.6\.7 \|[\s\S]*### Held back/);
  assert.match(body, /Native: Baguette \| 0\.2\.1 \| v0\.2\.11 \| left out this week: installing or building failed; see the run logs \|/);
  assert.doesNotMatch(body, /Changes by Claude/);
});
