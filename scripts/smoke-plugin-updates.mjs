import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PluginUpdates } from "../src/server/plugin-updates.ts";

const execute = promisify(execFile);
const parent = tmpdir();
const prefix = join(parent, "mobile-dev-update-smoke-");
const directory = await mkdtemp(prefix);
const repo = join(directory, "repo");
const profile = join(directory, "profile");
const fixtureHome = join(directory, "home");
const codexCli = process.env.CODEX_CLI_PATH ?? "codex";
const env = { ...process.env, HOME: fixtureHome, CODEX_HOME: profile, MOBILE_DEV_TELEMETRY: "off", GIT_TERMINAL_PROMPT: "0" };
const repositoryUrl = "https://github.com/callstackincubator/codex-mobile-dev-plugin.git";
let http;

async function git(args) { await execute("/usr/bin/git", args, { cwd: repo, env }); }
async function codex(args) {
  const result = await execute(codexCli, args, { env, timeout: 30000 });
  return JSON.parse(result.stdout);
}
async function writeJson(path, data) {
  const text = JSON.stringify(data);
  await writeFile(path, text);
}
async function release(version) {
  const path = join(repo, "plugins/mobile-dev/.codex-plugin/plugin.json");
  await writeJson(path, { name: "mobile-dev", version, description: "Update fixture", mcpServers: "./.mcp.json" });
  await git(["add", "."]);
  await git(["commit", "-m", `chore(release): ${version}`]);
  await git(["update-server-info"]);
}
try {
  await mkdir(profile);
  await mkdir(fixtureHome);
  await mkdir(repo);
  await git(["init", "-b", "release/latest"]);
  await git(["config", "user.name", "Mobile Dev smoke test"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "commit.gpgsign", "false"]);
  const catalog = join(repo, ".agents/plugins");
  const plugin = join(repo, "plugins/mobile-dev");
  const manifestDirectory = join(plugin, ".codex-plugin");
  await mkdir(catalog, { recursive: true });
  await mkdir(manifestDirectory, { recursive: true });
  const catalogPath = join(catalog, "marketplace.json");
  await writeJson(catalogPath, { name: "mobile-dev", plugins: [{ name: "mobile-dev", source: { source: "local", path: "./plugins/mobile-dev" } }] });
  const mcpPath = join(plugin, ".mcp.json");
  await writeJson(mcpPath, { mcpServers: { "mobile-dev": { command: "/bin/echo", args: ["update fixture"], cwd: "." } } });
  await release("0.1.1");
  http = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const path = join(repo, ".git", url.pathname);
      const bytes = await readFile(path);
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  const mirrorUrl = `http://127.0.0.1:${address.port}/`;
  await git(["config", "--global", `url.${mirrorUrl}.insteadOf`, repositoryUrl]);
  await codex(["plugin", "marketplace", "add", repositoryUrl, "--ref", "release/latest", "--json"]);
  const initial = await codex(["plugin", "add", "mobile-dev@mobile-dev", "--json"]);
  assert.equal(initial.version, "0.1.1");
  await release("0.1.2");
  const fetchRelease = async input => {
    const url = String(input);
    const data = url.includes("api.github.com")
      ? { tag_name: "v0.1.2", draft: false, prerelease: false }
      : { name: "mobile-dev", version: "0.1.2" };
    const text = JSON.stringify(data);
    return new Response(text);
  };
  const options = { enabled: true, profile, currentVersion: "0.1.1", run: codex, fetch: fetchRelease };
  const updates = new PluginUpdates(options);
  const available = await updates.check();
  assert.equal(available.status, "available");
  const installed = await updates.install();
  assert.equal(installed.status, "updated");
  assert.equal(installed.latestVersion, "0.1.2");
  const mcp = await codex(["mcp", "get", "mobile-dev", "--json"]);
  const refreshedCwd = resolve(mcp.transport.cwd);
  const usesNewVersion = refreshedCwd.endsWith("/mobile-dev/mobile-dev/0.1.2");
  assert.ok(usesNewVersion);
  const anotherChat = new PluginUpdates(options);
  const notice = await anotherChat.check();
  assert.equal(notice.status, "updated");
  const restarted = new PluginUpdates({ ...options, currentVersion: "0.1.2" });
  const current = await restarted.check();
  assert.equal(current.status, "current");
  console.log("Verified real Codex CLI upgrade, installed cache, and restart notices in an isolated profile using a local Git mirror.");
} finally {
  if (http) http.close();
  await rm(directory, { recursive: true, force: true });
}
