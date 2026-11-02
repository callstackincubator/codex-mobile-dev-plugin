import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CODEX_TOOL_LIMITS, codexToolBudget } from "./codex-tool-limits.mjs";

// Measures a packaged Codex plugin's MCP tools against Codex's limits (see
// codex-tool-limits.mjs). The host regression tests run the same measurement against
// Codex's server on every pull request.
//   npm run check:mcp-budget [-- <plugin directory>]
const { schemaCompactBytes, agentToolBytes, agentTotalBytes } = CODEX_TOOL_LIMITS;
const plugin = resolve(process.argv[2] ?? "release/marketplace/plugins/mobile-dev");
const manifest = JSON.parse(await readFile(join(plugin, ".mcp.json"), "utf8"));
const agentPlugin = await access(join(plugin, "plugin.json")).then(() => true, () => false);
let total = 0;
let count = 0;
const oversized = [];
for (const [name, config] of Object.entries(manifest.mcpServers)) {
  const client = new Client({ name: "mobile-dev-catalog-budget", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [config.args[1]], cwd: plugin, stderr: "pipe", env: { ...process.env, MOBILE_DEV_TELEMETRY: "off" } });
  try {
    await client.connect(transport);
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    const budget = codexToolBudget({ server: name, instructions: client.getInstructions(), tools, agentPlugin });
    total += budget.bytes;
    count += budget.count;
    oversized.push(...budget.oversized);
    console.log(`${name}: ${budget.count} model-visible tools, ${budget.bytes.toLocaleString("en-US")} estimated bytes`);
  } finally { await client.close(); await transport.close(); }
}
console.log(`Combined: ${count} model-visible tools, ${total.toLocaleString("en-US")} estimated bytes, including namespace overhead and the plugin attribution.`);
if (agentPlugin) {
  console.log(`Agent Plugin manifest: the combined limit is ${agentTotalBytes.toLocaleString("en-US")} bytes and each tool's is ${agentToolBytes.toLocaleString("en-US")}; tools past them are hidden from the model.`);
  if (total > agentTotalBytes) console.log("Over the Agent Plugin limit. Some tools will be hidden from the model.");
} else console.log("Legacy .codex-plugin manifest: Codex has no combined or per-tool size limit for these tools.");
if (oversized.length > 0) {
  console.log(`Input schemas over ${schemaCompactBytes.toLocaleString("en-US")} bytes are compacted, dropping descriptions${agentPlugin ? "; specs over the per-tool limit are hidden" : ""}:`);
  console.table(oversized);
}
if (oversized.length > 0 || (agentPlugin && total > agentTotalBytes)) process.exitCode = 1;
