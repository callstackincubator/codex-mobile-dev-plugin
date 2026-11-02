import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dependencyLanes, laneHelpers, renderUpdates, reportLane } from "./dependency-lanes.mjs";
import { downloadNativeArtifact, nativeHelpers, nativeToolchain, prepareNativeHelper } from "./release-native.mjs";

/**
 * The weekly dependency update on the Mac runner. Each lane of
 * `tooling/dependency-lanes.mjs` is applied, committed and prepared (installed or its
 * native helpers rebuilt) on its own. When preparing fails, Claude gets the log; if
 * it still fails, the lane is reset and left out, and the next lane starts. The lanes
 * that remain then go through `tooling/dependency-checks.mjs`, which Claude may fix
 * once more.
 *
 *   node tooling/weekly-dependency-update.mjs <work directory>
 *
 * Expects the update branch checked out with dependencies installed. Writes
 * `body.md` (the pull request), `result.json`, logs and Claude's notes to the work
 * directory, and `changed`, `checks` and `left_out` to `GITHUB_OUTPUT`.
 * `ANTHROPIC_API_KEY` enables Claude; without `UPDATE_TOKEN`, action pins are only
 * reported.
 */

// Per attempt, so five lanes and the checks stay within the job's five hours.
const agentBudgetUsd = { lane: 10, checks: 20 };
const agentMinutes = { lane: 30, checks: 60 };

/**
 * Applies and prepares one lane. `steps` does the work, so the decisions can be
 * tested: `apply` returns false when the lane has nothing to update, `prepare` returns
 * whether installs and builds passed, `fix` asks Claude and returns whether it ran,
 * and `revert` resets the lane and restores what it had prepared.
 */
export async function runLane(lane, steps) {
  const base = await steps.head();
  let updated;
  try {
    updated = await steps.apply(lane);
  } catch (error) {
    await steps.revert(lane, base);
    return { lane: lane.name, outcome: "left-out", reason: `the update itself failed: ${error.message.split("\n")[0]}` };
  }
  if (!updated) return { lane: lane.name, outcome: "none" };
  const prepared = await steps.prepare(lane);
  await steps.commit(`chore(deps): update ${lane.label}`);
  if (prepared) return { lane: lane.name, outcome: "applied" };
  if (await steps.fix(lane)) {
    const fixed = await steps.prepare(lane);
    await steps.commit(`fix(deps): adapt to the ${lane.label} updates`);
    if (fixed) return { lane: lane.name, outcome: "fixed" };
    await steps.revert(lane, base);
    return { lane: lane.name, outcome: "left-out", reason: "installing or building still failed after Claude's changes" };
  }
  await steps.revert(lane, base);
  return { lane: lane.name, outcome: "left-out", reason: "installing or building failed" };
}

const outcomeText = {
  applied: "✅ applied",
  fixed: "✅ applied with Claude's fixes",
  "left-out": "↩️ left out",
};

/** The pull request body. */
export function pullRequestBody({ results, updates, cargoChanges, checks, checksSummary, notes, runUrl }) {
  const laneLabel = name => dependencyLanes.find(lane => lane.name === name)?.label ?? name;
  const leftOut = new Map(results.filter(result => result.outcome === "left-out").map(result => [result.lane, result.reason]));
  const shown = updates.map(update => update.applied && leftOut.has(update.lane)
    ? { ...update, applied: false, reason: `left out this week: ${leftOut.get(update.lane)}; see the run logs` }
    : update);
  const checksText = { passed: "passed", fixed: "passed after Claude's fixes", failed: "failed" }[checks];
  const groups = results.filter(result => result.outcome !== "none");
  return [
    "Weekly update of every dependency with a compatible release, one group at a time. Native helpers whose pins changed were rebuilt on the Mac runner. A group that failed to install or build, even after Claude's attempt, is left out and listed below.",
    "",
    `**Mac checks: ${checksText}.** CI adds the unit tests on Linux, the Codex regression tests and the visual comparison with main.`,
    "",
    "### Groups",
    "",
    "| Group | Result |",
    "| --- | --- |",
    ...groups.map(result => `| ${laneLabel(result.lane)} | ${outcomeText[result.outcome]}${result.reason ? `: ${result.reason}` : ""} |`),
    "",
    renderUpdates(shown, { cargoChanges: leftOut.has("ios-mirror-crates") ? 0 : cargoChanges }),
    ...(checksSummary ? ["### Checks on macOS", "", checksSummary] : []),
    ...(notes.length > 0 ? ["### Changes by Claude", "", "Review these in the `fix(deps)` commits.", "", ...notes, ""] : []),
    `Logs: [workflow run](${runUrl}). Check physical-iPhone features (mirroring, logs) on a device before merging when their native pins changed.`,
    "",
  ].join("\n");
}

function shell(command, log) {
  appendFileSync(log, `$ ${command}\n`);
  console.log(`$ ${command}`);
  const result = spawnSync("bash", ["-c", `set -o pipefail; { ${command}; } 2>&1 | tee -a ${JSON.stringify(log)}`], { stdio: "inherit" });
  return result.status === 0;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

async function main(work) {
  mkdirSync(join(work, "lanes"), { recursive: true });
  mkdirSync(join(work, "notes"), { recursive: true });
  // Installs and builds run third-party code, so only Claude gets the key.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const agentEnabled = Boolean(apiKey);
  const skipWorkflows = !process.env.UPDATE_TOKEN;
  const helperNames = nativeHelpers.map(helper => helper.name);
  const toolchain = await nativeToolchain();
  const runs = new Map();
  const prepared = new Set();
  const logOf = lane => join(work, "lanes", `${lane.name}.log`);

  async function prepareHelpers(names, log) {
    const request = async path => JSON.parse(execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/${path}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
    const download = (artifact, archive, helper) => downloadNativeArtifact(artifact, archive, helper, process.env);
    const build = async helper => {
      if (!shell(`npm run ${helper.command}`, log)) throw new Error(`npm run ${helper.command} failed.`);
    };
    for (const helper of nativeHelpers.filter(helper => names.includes(helper.name))) {
      try {
        await prepareNativeHelper(helper, { directory: process.cwd(), toolchain, request, runs, download, build, outputDirectory: join(work, "native-artifacts") });
      } catch (error) {
        appendFileSync(log, `\n${error?.stack ?? error}\n`);
        return false;
      }
    }
    return true;
  }

  async function prepare(lane) {
    if (lane.commands) return lane.commands.every(command => shell(command, logOf(lane)));
    const names = laneHelpers(lane, helperNames);
    const ok = await prepareHelpers(names, logOf(lane));
    if (ok) for (const name of names) prepared.add(name);
    return ok;
  }

  function askClaude(title, prompt, budget, minutes) {
    if (!agentEnabled) return false;
    console.log(`Asking Claude: ${title}`);
    const env = { ...process.env, ANTHROPIC_API_KEY: apiKey, GH_TOKEN: "", GITHUB_TOKEN: "", UPDATE_TOKEN: "" };
    const result = spawnSync("npx", ["-y", "@anthropic-ai/claude-code@2.1.311", "-p", prompt, "--model", "opus", "--max-budget-usd", String(budget),
      "--permission-mode", "bypassPermissions", "--output-format", "text"], { encoding: "utf8", env, maxBuffer: 256 * 1024 * 1024, timeout: minutes * 60000 });
    appendFileSync(join(work, "agent-output.md"), `## ${title}\n\n${result.stdout ?? ""}${result.stderr ?? ""}\n`);
    return true;
  }

  const rules = notes => [
    "- Fix the code, Baguette's source patches (tooling/baguette-*.mjs, tooling/rebuild-baguette.mjs) or other build scripts so they work with the new versions. Follow AGENTS.md.",
    "- Never weaken, skip or delete tests or checks to make them pass.",
    "- If one update cannot work without a larger change, revert only that dependency's pin (and its lockfile) and explain why.",
    "- Do not commit or push.",
    `Finish by writing what you changed and why, as short Markdown bullet points, to ${notes}.`,
  ].join("\n");

  const steps = {
    head: () => git("rev-parse", "HEAD"),
    async apply(lane) {
      const flags = ["--apply", "--only", lane.name, "--json", join(work, "lanes", `${lane.name}.json`), ...(skipWorkflows ? ["--skip-workflows"] : [])];
      if (!shell(`node tooling/update-dependencies.mjs ${flags.join(" ")}`, logOf(lane))) throw new Error(`update-dependencies.mjs failed; see lanes/${lane.name}.log`);
      return git("status", "--porcelain") !== "";
    },
    prepare,
    async commit(message) {
      git("add", "-A");
      if (git("diff", "--cached", "--name-only") !== "") git("commit", "-q", "-m", message);
    },
    async fix(lane) {
      const verify = lane.commands ?? laneHelpers(lane, helperNames).map(name => `npm run ${nativeHelpers.find(helper => helper.name === name).command}`);
      return askClaude(lane.label, [
        `You are fixing one part of this repository's weekly dependency update on a macOS CI runner: ${lane.label}.`,
        "The updates are committed on the current branch: `git show --stat HEAD` lists them. Installing or building them failed; the log is",
        logOf(lane),
        "",
        "Make these commands pass, in order, while keeping the updates:",
        ...verify.map(command => `- ${command}`),
        "",
        rules(join(work, "notes", `${lane.name}.md`)),
      ].join("\n"), agentBudgetUsd.lane, agentMinutes.lane);
    },
    async revert(lane, base) {
      git("reset", "-q", "--hard", base);
      git("clean", "-fdq");
      const ok = lane.commands ? lane.commands.every(command => shell(command, logOf(lane))) : await prepareHelpers(laneHelpers(lane, helperNames), logOf(lane));
      if (!ok) throw new Error(`Could not restore ${lane.label} after leaving it out; see lanes/${lane.name}.log.`);
      if (!lane.commands) for (const name of laneHelpers(lane, helperNames)) prepared.add(name);
    },
  };

  const results = [];
  for (const lane of dependencyLanes) {
    const result = await runLane(lane, steps);
    console.log(`${lane.label}: ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`);
    results.push(result);
  }
  shell(`node tooling/update-dependencies.mjs --only ${reportLane} --json ${join(work, "lanes", `${reportLane}.json`)}`, join(work, "lanes", `${reportLane}.log`));

  const changed = results.some(result => result.outcome === "applied" || result.outcome === "fixed");
  let checks;
  let checksSummary;
  if (changed) {
    const missing = helperNames.filter(name => !prepared.has(name));
    if (missing.length > 0 && !await prepareHelpers(missing, join(work, "native-restore.log"))) throw new Error("Could not restore the unchanged native helpers; see native-restore.log.");
    const checksDirectory = join(work, "checks");
    const runChecks = () => {
      rmSync(checksDirectory, { recursive: true, force: true });
      return spawnSync("node", ["tooling/dependency-checks.mjs", checksDirectory], { stdio: "inherit" }).status === 0;
    };
    checks = "passed";
    if (!runChecks()) {
      checks = "failed";
      const failed = readFileSync(join(checksDirectory, "failed.txt"), "utf8");
      if (askClaude("checks", [
        "You are fixing this repository's weekly dependency update on a macOS CI runner.",
        "The updates are committed on the current branch: `git log --stat main..HEAD` lists them. These checks failed, with their logs:",
        "",
        failed,
        "",
        "Make the checks pass while keeping the updates. Rebuild native helpers you touch with their npm scripts (see package.json), then rerun the",
        `failing check, for example: node tooling/dependency-checks.mjs ${join(work, "agent-checks")}`,
        "",
        rules(join(work, "notes", "checks.md")),
      ].join("\n"), agentBudgetUsd.checks, agentMinutes.checks)) {
        if (runChecks()) checks = "fixed";
        await steps.commit("fix(deps): adapt to the weekly dependency updates");
      }
    }
    checksSummary = readFileSync(join(checksDirectory, "summary.md"), "utf8");
  }

  const updates = [];
  let cargoChanges = 0;
  for (const name of [...dependencyLanes.map(lane => lane.name), reportLane]) {
    const file = join(work, "lanes", `${name}.json`);
    if (!existsSync(file)) continue;
    const report = JSON.parse(readFileSync(file, "utf8"));
    updates.push(...report.updates);
    cargoChanges += report.cargoChanges;
  }
  // A left-out lane's notes describe changes that are not in the pull request.
  const kept = results.filter(result => result.outcome === "fixed").map(result => result.lane);
  const notes = [...kept, "checks"].map(name => join(work, "notes", `${name}.md`))
    .filter(existsSync).map(file => readFileSync(file, "utf8").trim()).filter(Boolean);
  const runUrl = process.env.RUN_URL ?? "";
  writeFileSync(join(work, "body.md"), pullRequestBody({ results, updates, cargoChanges, checks, checksSummary, notes, runUrl }));
  const leftOut = results.filter(result => result.outcome === "left-out");
  writeFileSync(join(work, "result.json"), JSON.stringify({ changed, checks, results }, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nchecks=${checks ?? "skipped"}\nleft_out=${leftOut.map(result => result.lane).join(",")}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(resolve(process.argv[2] ?? "release/dependency-update"));
