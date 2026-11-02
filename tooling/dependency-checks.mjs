import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The checks the weekly dependency update must pass on the Mac runner, with native
 * helpers in place: unit tests, the build and package, the packaged server starting
 * Baguette, a simulator stream with a Baguette restart, Claude's packages with
 * agent-device's commands and the 5 MiB file limit, and the Codex host regression
 * tests. CI adds the Linux jobs and the visual comparison on the PR.
 *
 *   node tooling/dependency-checks.mjs <output directory>
 *
 * Writes `summary.md` and one log per check, and exits 1 if any check failed. A check
 * whose prerequisite failed is skipped.
 */
const output = process.argv[2] ?? "release/dependency-checks";
mkdirSync(output, { recursive: true });

function simulator() {
  const { devices } = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], { encoding: "utf8" }));
  const phones = Object.entries(devices).filter(([runtime]) => runtime.includes("iOS")).sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap(([, list]) => list).filter(device => device.name.startsWith("iPhone"));
  if (phones.length === 0) throw new Error("No iPhone simulator is available on this runner.");
  const { udid } = phones[0];
  spawnSync("xcrun", ["simctl", "boot", udid]);
  execFileSync("xcrun", ["simctl", "bootstatus", udid, "-b"], { stdio: "ignore", timeout: 600000 });
  return udid;
}

let udid;
const checks = [
  { name: "Unit tests", command: "npm test" },
  { name: "Telemetry types", command: "npm run typecheck:telemetry" },
  { name: "Build", command: "npm run build" },
  { name: "Package", command: "npm run package", needs: "Build" },
  { name: "Packaged server starts Baguette", command: "npm run test:package", needs: "Package" },
  { name: "Claude packages", command: "npm run package:claude && npm run test:claude", needs: "Build" },
  { name: "Simulator stream and Baguette restart", command: () => `npm run test:reconnect -- ${udid ??= simulator()}`, needs: "Package" },
  { name: "Codex host regression", command: "npm run build:hosts -- codex && npx playwright install chromium && npx playwright test -c tooling/hosts --project codex --grep-invert @visual" },
];

const results = new Map();
for (const check of checks) {
  const file = `${check.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.log`;
  if (check.needs && results.get(check.needs)?.outcome !== "passed") {
    results.set(check.name, { outcome: "skipped", file });
    continue;
  }
  const started = Date.now();
  let command;
  let result;
  try {
    command = typeof check.command === "function" ? check.command() : check.command;
    result = spawnSync("bash", ["-c", `${command} 2>&1`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 45 * 60000 });
  } catch (error) {
    result = { status: 1, stdout: String(error?.stack ?? error) };
  }
  writeFileSync(join(output, file), `$ ${command ?? check.name}\n${result.stdout ?? ""}${result.error ? `\n${result.error}` : ""}`);
  const outcome = result.status === 0 ? "passed" : "failed";
  results.set(check.name, { outcome, file, seconds: Math.round((Date.now() - started) / 1000) });
  console.log(`${outcome === "passed" ? "✓" : "✗"} ${check.name}`);
}
if (udid) spawnSync("xcrun", ["simctl", "shutdown", udid]);

const icon = { passed: "✅", failed: "❌", skipped: "⏭️" };
const failed = [...results].filter(([, result]) => result.outcome === "failed");
writeFileSync(join(output, "summary.md"), [
  "| Check | Result |", "| --- | --- |",
  ...[...results].map(([name, result]) => `| ${name} | ${icon[result.outcome]} ${result.outcome}${result.seconds === undefined ? "" : ` (${result.seconds}s)`} |`),
  "",
].join("\n"));
writeFileSync(join(output, "failed.txt"), failed.map(([name, result]) => `${name}: ${join(output, result.file)}`).join("\n"));
process.exit(failed.length > 0 ? 1 : 0);
