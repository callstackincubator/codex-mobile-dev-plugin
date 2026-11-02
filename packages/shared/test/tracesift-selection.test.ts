import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectionPrompt, frameSelectionEvidence, type SelectionCard } from "../src/tracesift-selection.ts";

/** A small task tree in the shape Explore is handed. `0.1.2` is the dotted sibling path, so nesting falls out of the ids. */
const card: SelectionCard = {
  durationMs: 1000,
  percentOfProfile: 40,
  boundaries: "tasks",
  headline: "A 1.00 s task 3.2 s into the recording",
  pathline: "Search_Search rendered the list",
  culprits: [
    { nodeId: "0.1.2", selfMs: 120, invocations: 3, longestCallMs: 60 },
  ],
  tree: {
    // Explore's tree starts at a synthetic `(root)`, so the drawn tree starts one level down.
    id: "0", name: "(root)", frameClass: "anonymous", totalMs: 1000, selfMs: 100, invocations: 1,
    children: [
      { id: "0.0", name: "batchedUpdates", frameClass: "framework", totalMs: 200, selfMs: 200, invocations: 1, children: [] },
      {
        id: "0.1", name: "Search_Search", frameClass: "app", totalMs: 700, selfMs: 40, invocations: 2,
        location: "src/search.tsx:12:3",
        children: [
          { id: "0.1.0", name: "useMemo", frameClass: "framework", totalMs: 60, selfMs: 60, invocations: 40, children: [] },
          { id: "0.1.1", name: "measureText", frameClass: "app", totalMs: 390, selfMs: 390, invocations: 12, location: "src/search.tsx:44:1", children: [] },
          { id: "0.1.2", name: "JSON_parse", frameClass: "native", totalMs: 120, selfMs: 120, invocations: 3, children: [] },
          { id: "0.1.3", name: "measureText", frameClass: "app", totalMs: 90, selfMs: 90, invocations: 400, location: "src/search.tsx:44:1", children: [] },
        ],
      },
    ],
  },
};

test("selection evidence reads the frames a reader picked, in the order they chose them", () => {
  const evidence = frameSelectionEvidence(card, ["0.1.2", "0.0"]);
  assert.deepEqual(evidence.frames.map(frame => frame.name), ["JSON_parse", "batchedUpdates"]);
  const parse = evidence.frames[0]!;
  assert.equal(parse.totalMs, 120);
  assert.equal(parse.selfMs, 120);
  assert.deepEqual(parse.path, ["Search_Search", "JSON_parse"]);
  // A frame the culprit table also lists is labelled as such.
  assert.deepEqual(parse.culprit, { selfMs: 120, invocations: 3, longestCallMs: 60 });
  assert.equal(evidence.overlaps.length, 0);
  // Two frames that do not contain each other, so their own times simply add.
  assert.equal(evidence.selfMsTogether, 320);
  assert.equal(evidence.selfShare, 32);
  // Measured over the tree; equals the task duration here because the fixture partitions it.
  assert.equal(evidence.treeSelfMs, 1000);
});

test("selection evidence names a nested pair rather than letting their totals add", () => {
  const evidence = frameSelectionEvidence(card, ["0.1", "0.1.2"]);
  assert.deepEqual(evidence.overlaps, [["0.1", "0.1.2"]]);
  // Self time charges each frame once, so parent and child don't double up like totals.
  assert.equal(evidence.selfMsTogether, 160);
});

test("selection evidence keeps a pick the tree cannot place rather than dropping it", () => {
  const evidence = frameSelectionEvidence(card, ["0.1.0", "0.9.9"]);
  assert.deepEqual(evidence.frames.map(frame => frame.nodeId), ["0.1.0"]);
  assert.deepEqual(evidence.unresolved, ["0.9.9"]);
});

test("selection evidence counts a frame once however many times it was picked", () => {
  const evidence = frameSelectionEvidence(card, ["0.1.2", "0.1.2", "0.1.2"]);
  assert.equal(evidence.frames.length, 1);
  assert.equal(evidence.selfMsTogether, 120);
});

test("the selection hand-off states what it asks, what was measured, and nothing else", () => {
  const prompt = buildSelectionPrompt({
    card,
    evidence: frameSelectionEvidence(card, ["0.1", "0.1.2", "0.1.3"]),
    profileTitle: "scroll-and-search.cpuprofile",
  });

  // The ask, and the reason the picks are not a finding.
  assert.match(prompt, /^Use the measured evidence below to investigate 3 frames/);
  assert.match(prompt, /starting point rather than a verdict/);
  assert.match(prompt, /## The task they sit in/);
  assert.match(prompt, /Search_Search rendered the list/);
  assert.match(prompt, /scroll-and-search\.cpuprofile/);
  assert.match(prompt, /1\. `Search_Search` — src\/search\.tsx:12:3/);
  assert.match(prompt, /700 ms including everything it called \(70\.0% of the task\), 40 ms of its own \(4\.0%\), 2 calls/);
  assert.match(prompt, /Reached through: the top of the task/);
  // Culprit figures span every call site, so the prompt must say so to avoid contradicting the node's own.
  assert.match(prompt, /counted across all of its call sites rather than this one: 120 ms of self time over 3 calls/);
  assert.match(prompt, /longest single call 60 ms/);
  // A picked culprit isn't treated as engine code just because the profiler says so, nor hidden.
  assert.match(prompt, /Classified as `native` code, not application code/);
  assert.match(prompt, /## How these overlap/);
  assert.match(prompt, /Selection 1 \(`Search_Search`, 700 ms\) contains selection 2/);
  assert.match(prompt, /## What they add up to/);
  assert.match(prompt, /Their own time together is 250 ms — 25\.0% of the task's 1\.00 s/);
  assert.match(prompt, /inclusive times are not additive/);
  assert.match(prompt, /The other 750 ms of the task's 1\.00 s of frame self time is in frames I did not select/);
  // A share is never rounded up to 100 (99.6 stays 99.6).
  assert.match(prompt, /40\.0% of the recording/);
  assert.match(prompt, /## Where those frames sit/);
  assert.match(prompt, /← selection #1/);
  assert.match(prompt, /├─ JSON_parse\s+← selection #2/);
  assert.match(prompt, /└─ measureText\s+← selection #3/);
  assert.match(prompt, /## How to read these numbers/);
  assert.match(prompt, /It has not read any source file/);
  assert.match(prompt, /Nothing here is a conclusion/);
});

test("the selection hand-off says what could not be placed instead of guessing", () => {
  const prompt = buildSelectionPrompt({ card, evidence: frameSelectionEvidence(card, ["0.1.2", "0.7.1"]) });
  assert.match(prompt, /## I could not place one selection/);
  assert.match(prompt, /rather than guessing at what they were/);
  assert.doesNotMatch(prompt, /## How these overlap/);
});

test("the selection hand-off says when two picks are the same function twice", () => {
  // `measureText` sits at two call sites; the prompt must say so or a model merges them or reports two problems.
  const prompt = buildSelectionPrompt({ card, evidence: frameSelectionEvidence(card, ["0.1.1", "0.1.3"]) });
  assert.match(prompt, /## Two selections are the same function/);
  assert.match(prompt, /`measureText` \(selection 1\) and `measureText` \(selection 2\) are the same function recorded at separate call sites of src\/search\.tsx:44:1/);
  assert.match(prompt, /Their own times are different work and do add/);
  assert.match(prompt, /Their own time together is 480 ms/);
});

test("the selection hand-off folds a run of framework frames rather than printing it", () => {
  // Four anonymous scaffolding frames fold to `four framework frames`.
  const deep: SelectionCard = {
    ...card,
    tree: {
      id: "0", name: "(root)", frameClass: "anonymous", totalMs: 1000, selfMs: 0, invocations: 1,
      children: [{
        id: "0.1", name: "Search_Search", frameClass: "app", totalMs: 700, selfMs: 40, invocations: 2,
        children: [{
          id: "0.1.0", name: "beginWork", frameClass: "framework", totalMs: 300, selfMs: 0, invocations: 1,
          children: [{
            id: "0.1.0.0", name: "performUnitOfWork", frameClass: "framework", totalMs: 300, selfMs: 0, invocations: 1,
            children: [{
              id: "0.1.0.0.0", name: "commitHookEffectList", frameClass: "framework", totalMs: 300, selfMs: 0, invocations: 1,
              children: [{
                id: "0.1.0.0.0.0", name: "runWithPriority", frameClass: "framework", totalMs: 300, selfMs: 0, invocations: 1,
                children: [{
                  id: "0.1.0.0.0.0.0", name: "formatDates", frameClass: "app", totalMs: 300, selfMs: 280, invocations: 12, children: [],
                }],
              }],
            }],
          }],
        }],
      }],
    },
  };
  const prompt = buildSelectionPrompt({ card: deep, evidence: frameSelectionEvidence(deep, ["0.1", "0.1.0.0.0.0.0"]) });
  // Scaffolding still appears in the path above; the tree folds it independently.
  const tree = /## Where those frames sit[\s\S]*?```([\s\S]*?)```/.exec(prompt)?.[1] ?? "";
  assert.match(tree, /… \(4 framework frames\)/);
  assert.equal(tree.includes("performUnitOfWork"), false);
  assert.ok(tree.includes("Search_Search"), "the outer pick is drawn");
  assert.ok(tree.includes("formatDates"), "the inner pick is drawn");
  assert.match(prompt, /Reached through: `Search_Search` › `beginWork` › `performUnitOfWork`/);
});

test("the selection hand-off skips the tree when nothing picked is in it", () => {
  const prompt = buildSelectionPrompt({ card, evidence: frameSelectionEvidence(card, ["9.9"]) });
  assert.doesNotMatch(prompt, /## Where those frames sit/);
});

test("the selection hand-off names an inferred task boundary as approximate", () => {
  const inferred = { ...card, boundaries: "inferred" };
  const prompt = buildSelectionPrompt({ card: inferred, evidence: frameSelectionEvidence(inferred, ["0.1.2"]) });
  assert.match(prompt, /reconstructed from the gaps between sample runs/);
});
