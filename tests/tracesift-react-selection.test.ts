import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReactSelectionPrompt,
  parseReactPick,
  reactSelectionEvidence,
  type ReactSelectionRecording,
} from "../src/shared/tracesift-react-selection.ts";

/**
 * A small recording, in the shape Explore is handed.
 *
 * Two commits, so the thing this feature exists for is covered: a pick names its
 * commit, and a reader stepping through a cascade keeps the ones they made
 * behind them. The figures add up the way React's do — every component's own
 * time plus the reconciler's own walk is the commit's duration — because the
 * hand-off states arithmetic built on exactly that, and a fixture that did not
 * add up would let a wrong claim through.
 */
const node = (
  id: number,
  name: string,
  selfMs: number,
  actualMs: number,
  extra: Partial<{ componentClass: string; cause: string; changedProps: string[]; sourceHint: string | null; children: unknown[] }> = {},
) => ({
  id, name, selfMs, actualMs,
  componentClass: extra.componentClass ?? "app",
  cause: extra.cause ?? "props",
  changedProps: extra.changedProps ?? [],
  changedHooks: [],
  compiledWithForget: false,
  sourceHint: extra.sourceHint === undefined ? `src/${name.toLowerCase()}.tsx:1` : extra.sourceHint,
  children: (extra.children ?? []) as never[],
});

const recording: ReactSelectionRecording = {
  budgetMs: 16,
  spanMs: 300,
  commitsOverBudget: 2,
  commits: [
    {
      rootId: 1, commitIndex: 0, startMs: 0, durationMs: 40, renderedCount: 4,
      summedSelfMs: 38, unattributedMs: 2, overBudget: true, causesRecorded: true, treeDropped: false,
      tree: [
        node(2, "Screen", 1, 38, {
          componentClass: "library",
          children: [
            node(3, "Provider", 0, 37, { componentClass: "framework", sourceHint: null, children: [
              node(4, "Chart", 30, 30, { cause: "nothing-changed" }),
            ] }),
            node(5, "Legend", 7, 7, { cause: "state" }),
          ],
        }),
      ],
    },
    {
      rootId: 1, commitIndex: 1, startMs: 50, durationMs: 20, renderedCount: 2,
      summedSelfMs: 19, unattributedMs: 1, overBudget: true, causesRecorded: false, treeDropped: false,
      tree: [
        node(2, "Screen", 4, 19, { componentClass: "library", cause: "unknown", children: [
          node(4, "Chart", 15, 15, { cause: "unknown" }),
        ] }),
      ],
    },
  ],
};

test("a React pick names its commit, and a key that names nothing is read as nothing", () => {
  assert.deepEqual(parseReactPick("1.0.4"), { rootId: 1, commitIndex: 0, fiberId: 4 });
  // A commit key is not a component pick, and neither is anything else that
  // happens to have dots in it.
  assert.equal(parseReactPick("1.0"), undefined);
  assert.equal(parseReactPick("1.0.x"), undefined);
  assert.equal(parseReactPick(""), undefined);
});

test("selection evidence reads the components a reader picked, in the order they chose them", () => {
  const evidence = reactSelectionEvidence(recording, ["1.0.4", "1.0.5"]);
  assert.deepEqual(evidence.components.map(pick => pick.name), ["Chart", "Legend"]);
  const chart = evidence.components[0]!;
  assert.equal(chart.selfMs, 30);
  assert.equal(chart.actualMs, 30);
  assert.equal(chart.cause, "nothing-changed");
  // Nesting is by the nearest ancestor that also rendered, which is the path
  // the prompt prints rather than anything about the source.
  assert.deepEqual(chart.path, ["Screen", "Provider", "Chart"]);
  assert.equal(evidence.overlaps.length, 0, "neither picked component rendered the other");
  assert.equal(evidence.selfMsTogether, 37);
  assert.equal(evidence.commits.length, 1);
  assert.equal(evidence.commits[0]!.selfShare, 92.5, "37 ms of a 40 ms commit");
  assert.equal(evidence.pickedCommitsMs, 40);
  assert.equal(evidence.recordedCommitsMs, 60, "both commits, which do not overlap in time");
});

test("picks in two commits are two renders, grouped by the commit that measured them", () => {
  // The reason a pick names its commit at all: a reader walks a cascade with the
  // commit picker, and a per-commit set would empty itself under exactly that.
  const evidence = reactSelectionEvidence(recording, ["1.1.4", "1.0.4"]);
  assert.deepEqual(evidence.components.map(pick => [pick.pick, pick.commitIndex]), [[1, 1], [2, 0]]);
  assert.deepEqual(evidence.commits.map(commit => commit.commitIndex), [0, 1], "grouped in commit order");
  assert.equal(evidence.selfMsTogether, 45, "15 ms in one commit and 30 in the other, which do add");
  assert.equal(evidence.overlaps.length, 0, "two commits never overlap, whatever the components are called");

  const text = buildReactSelectionPrompt({ recording, evidence });
  assert.match(text, /### Commit 0 — 40 ms rendering, over the 16 ms budget/);
  assert.match(text, /### Commit 1 — 20 ms rendering/);
  // The same component twice is the finding here rather than a coincidence, and
  // the numbering follows the reader's own order, not the commit order.
  assert.match(text, /`Chart` is selections 1, 2: the same component rendering in 2 separate commits, 45 ms/);
  assert.match(text, /Why it rendered: nothing changed\./);
  assert.match(text, /recorded without "Record why each component rendered"/);
});

test("a pick that rendered another pick is named, because only the inclusive figures overlap", () => {
  const evidence = reactSelectionEvidence(recording, ["1.0.2", "1.0.4"]);
  assert.deepEqual(evidence.overlaps, [["1.0.2", "1.0.4"]]);
  // Own time never double-counts across a nested pair, which is why the sum is
  // still quotable and the inclusive figures are not.
  assert.equal(evidence.selfMsTogether, 31);

  const text = buildReactSelectionPrompt({ recording, evidence });
  assert.match(text, /Selection 1 \(`Screen`\) rendered selection 2 \(`Chart`\) in commit 0/);
  assert.match(text, /Their own times do not overlap and do add/);
  assert.match(text, /Classified as `library`, not application code/);
});

test("the prompt accounts for the commit it did not ask about, and draws where the picks sit", () => {
  const evidence = reactSelectionEvidence(recording, ["1.0.4"]);
  const text = buildReactSelectionPrompt({ recording, evidence, profileTitle: "Search.reactprofile", headline: "Heavy component" });

  assert.match(text, /investigate 1 component render I selected/);
  assert.match(text, /Recording: Search\.reactprofile/);
  assert.match(text, /- Heavy component/);
  assert.match(text, /2 commits across 300 ms, 60 ms of it spent rendering/);
  // Both sides of the subtraction are figures this document states: 38 ms of
  // component time less the 30 ms picked, plus the reconciler's own 2 ms.
  assert.match(text, /my picks are 30 ms of its 40 ms \(75\.0%\)/);
  assert.match(text, /8 ms in the other components it rendered, and 2 ms in React's own walk of the tree/);
  assert.match(text, /← selection #1/);
  assert.match(text, /Screen/, "the ancestors joining the commit to the pick are drawn");

  // The caveats that decide how the figures read travel with them, and they are
  // React's rather than the CPU side's: nothing here was sampled.
  assert.match(text, /render phase only/);
  assert.match(text, /nearest ancestor that also rendered/);
  assert.match(text, /React's own measurements, not samples/);
  assert.doesNotMatch(text, /A CPU profile is samples/, "the CPU prompt's sampling language describes a measurement this recording did not make");
  assert.doesNotMatch(text, /on top of the stack/);
});

test("a pick the recording no longer holds is named rather than guessed at", () => {
  // A commit that is gone, and a fiber that is not in the commit it names.
  const evidence = reactSelectionEvidence(recording, ["1.0.4", "9.9.9", "1.0.404"]);
  assert.deepEqual(evidence.unresolved.sort(), ["1.0.404", "9.9.9"]);
  assert.equal(evidence.components.length, 1);
  // The pick's own number is carried, so dropping one does not renumber the
  // ones the reader counted off the screen.
  assert.equal(evidence.components[0]!.pick, 1);

  const text = buildReactSelectionPrompt({ recording, evidence });
  assert.match(text, /## I could not place 2 selections/);
  assert.match(text, /Say which selections those are rather than guessing/);
});

test("an empty selection produces no components and no commits", () => {
  const evidence = reactSelectionEvidence(recording, []);
  assert.deepEqual(evidence.components, []);
  assert.deepEqual(evidence.commits, []);
  assert.equal(evidence.selfMsTogether, 0);
  assert.equal(evidence.pickedCommitsMs, 0);
});
