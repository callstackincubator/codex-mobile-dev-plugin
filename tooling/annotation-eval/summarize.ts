// node tooling/annotation-eval/summarize.ts <out>/results.json → Markdown tables of medians.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, type ScenarioId } from "./scenarios.ts";
import { grade } from "./grade.ts";

// Re-grade from each run's saved copy so grader fixes apply to finished runs.
const here = dirname(fileURLToPath(import.meta.url));
const results: any[] = JSON.parse(readFileSync(process.argv[2], "utf8")).map((item: any) => {
  const dir = join(dirname(process.argv[2]), "runs", item.id);
  return { ...item, ...grade(SCENARIOS[item.scenario as ScenarioId].grader, join(here, "fixture"), join(dir, "app"), readFileSync(join(dir, "diff.patch"), "utf8")) };
});
const median = (values: number[]) => { const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b), mid = sorted.length >> 1; return !sorted.length ? NaN : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const range = (values: number[]) => `${Math.min(...values).toFixed(0)}–${Math.max(...values).toFixed(0)}`;
const tally = (values: string[]) => Object.entries(values.reduce<Record<string, number>>((all, value) => ({ ...all, [value]: (all[value] ?? 0) + 1 }), {})).map(([value, count]) => `${count}× ${value}`).join(", ");
const versions = ["before", "after"].filter(version => results.some(item => item.version === version));
const device = results.some(item => item.mode === "device");

console.log(`| Scenario | Version | Runs | Median time (s) | Range (s) | Median to first edit (s) | Median tool calls${device ? " (device)" : ""} | Median tokens in / out | Correct | How it was done |`);
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const scenario of Object.keys(SCENARIOS) as ScenarioId[]) for (const version of versions) {
  const rows = results.filter(item => item.scenario === scenario && item.version === version);
  if (!rows.length) continue;
  const seconds = rows.map(item => item.seconds);
  const tools = `${median(rows.map(item => item.tools.length))}${device ? ` (${median(rows.map(item => item.mcp?.length ?? 0))})` : ""}`;
  console.log(`| ${scenario}. ${SCENARIOS[scenario].title} | ${version} | ${rows.length} | ${median(seconds).toFixed(1)} | ${range(seconds)} | ${median(rows.map(item => item.firstEditAt)).toFixed(1)} | ${tools} | ${(median(rows.map(item => item.inputTokens)) / 1000).toFixed(0)}k / ${(median(rows.map(item => item.outputTokens)) / 1000).toFixed(1)}k | ${rows.filter(item => item.pass).length}/${rows.length} | ${tally(rows.map(item => item.approach))} |`);
}
console.log(`\n| Version | Runs | Median time (s) | Mean time (s) | Runs over 60 s | Median to first edit (s) | Correct |`);
console.log("|---|---|---|---|---|---|---|");
for (const version of versions) {
  const rows = results.filter(item => item.version === version);
  console.log(`| ${version} | ${rows.length} | ${median(rows.map(item => item.seconds)).toFixed(1)} | ${(rows.reduce((sum, item) => sum + item.seconds, 0) / rows.length).toFixed(1)} | ${rows.filter(item => item.seconds > 60).length} | ${median(rows.map(item => item.firstEditAt)).toFixed(1)} | ${rows.filter(item => item.pass).length}/${rows.length} |`);
}
if (device) {
  console.log("\nDevice tool calls by version:");
  for (const version of versions) console.log(`- ${version}: ${tally(results.filter(item => item.version === version).flatMap(item => item.mcp ?? []))}`);
}
