// Before/after benchmark for annotation edits in Codex.
//
//   node tooling/annotation-eval/run.ts [--out <dir>] [--codex-home <CODEX_HOME with auth>]
//     [--before-ref main] [--scenarios A,B,C,D,E,F,G] [--runs 3] [--concurrency 4]
//     [--device <simulator UDID> --app <running app checkout> --plugin <built plugin dir>]
//   node tooling/annotation-eval/summarize.ts <out>/results.json
//
// "before" uses the annotation formatter and Mobile Dev skill at --before-ref; "after" uses the
// working tree. Each version gets its own CODEX_HOME with the template's auth and top-level
// model settings only, so the user's MCP servers and plugins stay out.
// Code mode edits a fresh copy of ./fixture with no MCP servers or skills, so it measures how
// the prompt steers code edits. Device mode runs one at a time against a copy of ./fixture
// running in the simulator with Metro, adds the plugin's MCP server and the version's skills,
// and restores the app checkout between runs, so that checkout must start clean.
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPrompt, SCENARIOS, type ScenarioId } from "./scenarios.ts";
import { grade } from "./grade.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const out = resolve(args.get("out") ?? join(tmpdir(), "mobile-dev-annotation-eval"));
const scenarios = (args.get("scenarios") ?? Object.keys(SCENARIOS).join(",")).split(",") as ScenarioId[];
const runs = Number(args.get("runs") ?? 3);
const device = args.get("device");
const deviceApp = args.get("app") && resolve(args.get("app")!);
const plugin = args.get("plugin") && resolve(args.get("plugin")!);
const concurrency = device ? 1 : Number(args.get("concurrency") ?? 4);
const beforeRef = args.get("before-ref") ?? "HEAD";
const template = args.get("codex-home") ?? join(homedir(), ".codex");
if (device && (!deviceApp || !plugin)) throw new Error("--device needs --app and --plugin.");
// Device mode resets the app checkout between runs; never discard someone's work.
if (deviceApp && git(deviceApp, "status", "--porcelain").trim()) throw new Error(`${deviceApp} has uncommitted changes; commit or stash them first.`);
mkdirSync(out, { recursive: true });

function git(cwd: string, ...rest: string[]) { return execFileSync("git", rest, { cwd, encoding: "utf8" }); }
function atRef(path: string) { return execFileSync("git", ["show", `${beforeRef}:${path}`], { cwd: repo }); }

const FORMATTER = "packages/shared/src/screen-annotations.ts";
async function formatter(version: "before" | "after") {
  if (version === "after") return import(pathToFileURL(join(repo, FORMATTER)).href);
  const path = join(out, "before-screen-annotations.ts");
  writeFileSync(path, atRef(FORMATTER));
  return import(pathToFileURL(path).href);
}

// One CODEX_HOME per version: the template's auth and top-level settings (model, effort,
// provider), plus in device mode the Mobile Dev MCP server and that version's skills.
function codexHome(version: "before" | "after") {
  const home = join(out, "codex-homes", version);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  for (const file of ["auth.json", "opencodex-catalog.json"]) if (existsSync(join(template, file))) cpSync(join(template, file), join(home, file));
  const source = readFileSync(join(template, "config.toml"), "utf8");
  const settings = source.slice(0, source.search(/^\[/m) < 0 ? source.length : source.search(/^\[/m))
    .replace(/^(approval_policy|sandbox_mode|notify) *=.*$/gm, "")
    .replace(/^model_catalog_json = .*$/m, `model_catalog_json = ${JSON.stringify(join(home, "opencodex-catalog.json"))}`);
  let config = `${settings.trim()}\napproval_policy = "never"\n`;
  if (device) {
    config += `\n[mcp_servers.mobile-dev]\ncommand = "./scripts/launch-mcp"\nargs = ["./dist/server.mjs"]\ncwd = ${JSON.stringify(plugin)}\nenv_vars = ["HOME", "DEVELOPER_DIR"]\nstartup_timeout_sec = 60\ntool_timeout_sec = 180\n\n[mcp_servers.mobile-dev.env]\nMOBILE_DEV_TELEMETRY = "off"\n`;
    for (const skill of ["mobile-dev", "agent-device"]) {
      cpSync(join(repo, "packages/skills", skill), join(home, "skills", skill), { recursive: true });
      if (version === "before") writeFileSync(join(home, "skills", skill, "SKILL.md"), atRef(`packages/skills/${skill}/SKILL.md`));
    }
  }
  writeFileSync(join(home, "config.toml"), config);
  return home;
}

const versions = {
  before: { formatter: await formatter("before"), home: codexHome("before") },
  after: { formatter: await formatter("after"), home: codexHome("after") },
};
const versionNames = Object.keys(versions) as (keyof typeof versions)[];

type Job = { id: string; scenario: ScenarioId; version: keyof typeof versions; run: number };
const jobs: Job[] = [];
for (const scenario of scenarios) for (const version of versionNames) for (let run = 1; run <= runs; run++)
  jobs.push({ id: `${device ? "device" : "code"}-${scenario}-${version}-${run}`, scenario, version, run });
// Interleave versions so load and rate limits affect each alike.
for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }

function metrics(events: { at: number; event: any }[]) {
  const tools: string[] = [], mcp: string[] = [];
  let inputTokens = 0, outputTokens = 0, finalText = "", firstEditAt: number | undefined;
  for (const { at, event } of events) {
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "command_execution") tools.push(`shell: ${String(item.command).slice(0, 200)}`);
    if (event.type === "item.completed" && item?.type === "file_change") { tools.push("file_change"); firstEditAt ??= at; }
    if (event.type === "item.completed" && item?.type === "mcp_tool_call") { tools.push(`mcp: ${item.tool}`); mcp.push(item.tool); }
    if (event.type === "item.completed" && item?.type === "agent_message") finalText = item.text;
    if (event.type === "turn.completed") { inputTokens += event.usage?.input_tokens ?? 0; outputTokens += (event.usage?.output_tokens ?? 0) + (event.usage?.reasoning_output_tokens ?? 0); }
  }
  return { tools, mcp, inputTokens, outputTokens, finalText, firstEditAt };
}

function resetApp(app: string) {
  git(app, "checkout", "-q", "--", ".");
  git(app, "clean", "-fdq");
}

async function runJob(job: Job) {
  const dir = join(out, "runs", job.id);
  if (existsSync(join(dir, "result.json"))) return JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
  mkdirSync(dir, { recursive: true });
  let app: string;
  if (device) {
    app = deviceApp!;
    resetApp(app);
    await new Promise(done => setTimeout(done, 3000)); // let Fast Refresh show the clean app
  } else {
    app = join(dir, "app");
    cpSync(join(here, "fixture"), app, { recursive: true });
    git(app, "init", "-q"); git(app, "add", "."); git(app, "-c", "user.name=eval", "-c", "user.email=eval@example.invalid", "commit", "-qm", "fixture");
  }
  const version = versions[job.version];
  const prompt = buildPrompt(app, job.scenario, version.formatter, { udid: device });
  writeFileSync(join(dir, "prompt.txt"), prompt);
  const started = performance.now();
  const events: { at: number; event: any }[] = [];
  const { stderr, code } = await new Promise<{ stderr: string; code: number | null }>(done => {
    const child = spawn("codex", ["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-C", app, prompt],
      { cwd: app, env: { ...process.env, CODEX_HOME: version.home }, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "", stderr = "";
    child.stdout.on("data", chunk => {
      buffer += chunk;
      const lines = buffer.split("\n"); buffer = lines.pop()!;
      for (const line of lines) { try { events.push({ at: (performance.now() - started) / 1000, event: JSON.parse(line) }); } catch {} }
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
    child.on("close", code => { clearTimeout(timer); done({ stderr, code }); });
  });
  const seconds = (performance.now() - started) / 1000;
  writeFileSync(join(dir, "events.jsonl"), events.map(item => JSON.stringify(item)).join("\n"));
  writeFileSync(join(dir, "stderr.txt"), stderr);
  const diff = git(app, "diff");
  writeFileSync(join(dir, "diff.patch"), diff);
  if (device) { mkdirSync(join(dir, "app"), { recursive: true }); cpSync(join(app, "src"), join(dir, "app/src"), { recursive: true }); cpSync(join(app, "App.tsx"), join(dir, "app/App.tsx")); }
  const result = { ...job, mode: device ? "device" : "code", seconds, exitCode: code, ...metrics(events), ...grade(SCENARIOS[job.scenario].grader, join(here, "fixture"), app, diff) };
  if (device) resetApp(app);
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
  console.log(`${job.id.padEnd(22)} ${seconds.toFixed(1).padStart(6)}s  edit@${result.firstEditAt?.toFixed(1) ?? "-"}s  tools ${String(result.tools.length).padStart(2)}  mcp ${result.mcp.length}  ${result.pass ? "pass" : "FAIL"}  ${result.approach}`);
  return result;
}

const results: any[] = [];
const queue = [...jobs];
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    try { results.push(await runJob(job)); }
    catch (error) { console.error(`${job.id} failed: ${error instanceof Error ? error.message : error}`); }
  }
}));
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length}/${jobs.length} runs. Results: ${join(out, "results.json")}`);
