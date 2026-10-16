import {
  attachMeasuredTasks,
  extractTasks,
  ruleClassTable,
  selectTaskCards,
  type TaskHandoff,
} from "@callstack/tracesift-explore";

/**
 * A small but genuinely analysed task, built by the same package code that builds
 * the cards the plugin hands to the explorer. Nothing here is invented, so the
 * flame graph has the heat spread a real recording has.
 */
export function taskHandoff(): TaskHandoff {
  const node = (id: number, name: string, children: number[] = [], url = "app.js", line = 0) => ({
    id,
    children,
    callFrame: { functionName: name, scriptId: "1", url, lineNumber: line, columnNumber: 0 },
  });
  const nodes = [
    node(0, "(root)", [1], ""),
    node(1, "performWorkOnRoot", [2, 6], "node_modules/react-dom/cjs/react-dom-client.development.js"),
    node(2, "beginWork", [3], "node_modules/react-dom/cjs/react-dom-client.development.js"),
    node(3, "Search_Search", [4, 5], "src/screens/Search.tsx", 11),
    node(4, "applyMerge", [], "src/screens/merge.ts", 4),
    node(5, "toLocaleString", [], "native date.js"),
    node(6, "commitPassiveMountEffects", [7], "node_modules/react-dom/cjs/react-dom-client.development.js"),
    node(7, "useSearchSnapshot", [8], "src/screens/Search.tsx", 40),
    node(8, "getReportSections", [], "src/reports/sections.ts", 88),
  ];
  // Weighted towards the leaf work so the flame graph's heat buckets all appear.
  const samples = Array.from({ length: 400 }, (_, index) => [4, 4, 4, 5, 8, 8, 3, 2, 1][index % 9]);
  const profile = attachMeasuredTasks(
    { nodes, samples, timeDeltas: samples.map(() => 1000), startTime: 0, endTime: 400_000 },
    [{ ts: 0, dur: 400_000 }],
  );
  const { cards } = selectTaskCards(profile, 400, extractTasks(profile), ruleClassTable());
  const card = cards.find(entry => entry.tree.children.length > 0) ?? cards[0];
  return { analysisId: "spike-visual", totalMs: 400, profileTitle: "spike.cpuprofile", card };
}
