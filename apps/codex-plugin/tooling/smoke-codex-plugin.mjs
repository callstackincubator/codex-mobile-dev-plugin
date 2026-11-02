import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createLaunchHome } from "./mcp-launch-fixture.mjs";

const source = resolve(process.argv[2] ?? "release/marketplace/plugins/mobile-dev");
const parent = tmpdir();
const prefix = join(parent, "mobile-dev-codex-test-");
const temporary = await mkdtemp(prefix);
const profile = join(temporary, "codex-profile");
const marketplace = join(temporary, "marketplace");
const codexCli = process.env.CODEX_CLI_PATH ?? "codex";
let client;
let transport;

try {
  await mkdir(profile);
  const catalogDirectory = join(marketplace, ".agents/plugins");
  await mkdir(catalogDirectory, { recursive: true });
  const plugin = join(marketplace, "plugins/mobile-dev");
  await cp(source, plugin, { recursive: true, verbatimSymlinks: true });
  const catalog = {
    name: "mobile-dev-smoke",
    plugins: [{ name: "mobile-dev", source: { source: "local", path: "./plugins/mobile-dev" } }],
  };
  const catalogText = JSON.stringify(catalog);
  const catalogPath = join(catalogDirectory, "marketplace.json");
  await writeFile(catalogPath, catalogText);
  const fixtureHome = await createLaunchHome(temporary, process.execPath);
  const env = { ...process.env, CODEX_HOME: profile, HOME: fixtureHome, MOBILE_DEV_TELEMETRY: "off" };
  function codex(args) {
    const output = execFileSync(codexCli, args, { env, encoding: "utf8", timeout: 30000 });
    return JSON.parse(output);
  }
  codex(["plugin", "marketplace", "add", marketplace, "--json"]);
  const installed = codex(["plugin", "add", "mobile-dev@mobile-dev-smoke", "--json"]);
  const server = codex(["mcp", "get", "mobile-dev", "--json"]);
  const expectedCwd = resolve(installed.installedPath);
  const resolvedCwd = resolve(server.transport.cwd);
  assert.equal(resolvedCwd, expectedCwd, "Codex must resolve the plugin working directory to its installed cache.");
  const config = server.transport;
  const serverEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", MOBILE_DEV_TELEMETRY: "off" };
  for (const name of config.env_vars) {
    if (env[name] !== undefined) serverEnv[name] = env[name];
  }
  transport = new StdioClientTransport({
    command: config.command, args: config.args, cwd: config.cwd, env: serverEnv, stderr: "pipe",
  });
  transport.stderr?.on("data", chunk => { process.stderr.write(chunk); });
  client = new Client({ name: "mobile-dev-codex-smoke", version: "1" });
  await client.connect(transport);
  const listed = await client.listTools();
  const workspace = listed.tools.find(tool => tool.name === "mobile_open_workspace");
  assert.ok(workspace);
  assert.deepEqual(workspace._meta["openai/ui"].entrypoints, [{ type: "global" }]);
  const manifestPath = join(installed.installedPath, ".codex-plugin/plugin.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(workspace._meta.ui.resourceUri, `ui://mobile-dev/${manifest.version}/workspace.html`);
  const resource = await client.readResource({ uri: workspace._meta.ui.resourceUri });
  assert.match(resource.contents[0].text, /data-view="workspace"/);
  assert.match(resource.contents[0].text, /mobile-dev-telemetry" content="off"/);
  console.log(`Codex installed ${manifest.version}, resolved its cache directory, and loaded the sidebar resource with no Node on MCP PATH.`);
} finally {
  if (client) await client.close();
  if (transport) await transport.close();
  await rm(temporary, { recursive: true, force: true });
}
