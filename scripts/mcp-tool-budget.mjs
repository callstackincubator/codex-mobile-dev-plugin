import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Codex's schema subset and tool limits, checked against rust-v0.163.0 (2026-10-21):
// https://github.com/openai/codex/blob/main/codex-rs/tools/src/json_schema/types.rs
// https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs
// Every MCP tool's input schema is compacted past 5,000 bytes (tool_input_schema_max_bytes).
// Only Agent Plugins, whose manifest is plugin.json at the plugin root, also have per-tool (8,000) and
// combined (64,000) byte limits; tools past them are hidden from the model. Plugins with
// .codex-plugin/plugin.json, such as this one, use the legacy format and have neither limit.
const schemaCompactBytes = 5000;
const agentToolBytes = 8000;
const agentTotalBytes = 64000;
const schemaKeys = ["$ref", "type", "description", "encrypted", "enum", "items", "minItems", "properties", "required", "additionalProperties", "anyOf", "oneOf", "allOf", "$defs", "definitions"];
function object(value) { return value !== null && typeof value === "object" && Array.isArray(value) === false; }
function normalizeSchema(schema) {
  if (typeof schema === "boolean") return { type: "string" };
  if (object(schema) === false) throw new Error("Expected a JSON Schema object.");
  const result = {};
  for (const key of schemaKeys) {
    const value = schema[key];
    if (value === undefined || value === null) continue;
    if (["properties", "$defs", "definitions"].includes(key)) {
      const children = {};
      for (const [name, child] of Object.entries(value)) children[name] = normalizeSchema(child);
      result[key] = children;
    } else if (["anyOf", "oneOf", "allOf"].includes(key)) {
      result[key] = value.map(normalizeSchema);
    } else if (key === "items" || key === "additionalProperties" && object(value)) {
      result[key] = normalizeSchema(value);
    } else result[key] = value;
  }
  if (schema.const !== undefined) result.enum = [schema.const];
  if (result.type === undefined && result.$ref === undefined && result.anyOf === undefined && result.oneOf === undefined && result.allOf === undefined) {
    if (result.properties !== undefined || result.required !== undefined || result.additionalProperties !== undefined) result.type = "object";
    else if (result.items !== undefined) result.type = "array";
    else if (result.enum !== undefined || schema.format !== undefined) result.type = "string";
    else if (schema.minimum !== undefined || schema.maximum !== undefined) result.type = "number";
    else return {};
  }
  const types = Array.isArray(result.type) ? result.type : [result.type];
  if (types.includes("object") && result.properties === undefined) result.properties = {};
  if (types.includes("array") && result.items === undefined) result.items = { type: "string" };
  return result;
}
function truncate(text, limit) {
  let result = "";
  let bytes = 0;
  for (const character of text) {
    bytes += Buffer.byteLength(character);
    if (bytes > limit) break;
    result += character;
  }
  return result;
}
function jsonBytes(value) {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json);
}

const plugin = resolve(process.argv[2] ?? "release/marketplace/plugins/mobile-dev");
const manifestPath = join(plugin, ".mcp.json");
const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const agentPlugin = await access(join(plugin, "plugin.json")).then(() => true, () => false);
let total = 0;
let count = 0;
const oversized = [];
for (const [name, config] of Object.entries(manifest.mcpServers)) {
  const client = new Client({ name: "mobile-dev-catalog-budget", version: "1" });
  const cwd = plugin;
  const transport = new StdioClientTransport({ command: process.execPath, args: [config.args[1]], cwd, stderr: "pipe", env: { ...process.env, MOBILE_DEV_TELEMETRY: "off" } });
  try {
    await client.connect(transport);
    const namespace = `mcp__${name.replaceAll("-", "_")}`;
    const instruction = client.getInstructions()?.trim() ?? "";
    const description = truncate(instruction, 1000);
    let serverBytes = 0;
    let serverCount = 0;
    let cursor;
    do {
      const page = await client.listTools({ cursor });
      for (const tool of page.tools) {
        const visibility = tool._meta?.ui?.visibility;
        if (Array.isArray(visibility) && visibility.includes("model") === false) continue;
        const text = `${tool.description ?? ""} This tool is part of plugin \`Mobile Dev\`.`;
        const parameters = normalizeSchema(tool.inputSchema);
        const spec = { type: "namespace", name: namespace, description, tools: [{ type: "function", name: tool.name.replaceAll("-", "_"), description: truncate(text, 1000), strict: false, parameters }] };
        const bytes = jsonBytes(spec);
        const schemaBytes = jsonBytes(parameters);
        if (schemaBytes > schemaCompactBytes || (agentPlugin && bytes > agentToolBytes)) oversized.push({ server: name, tool: tool.name, schemaBytes, specBytes: bytes });
        serverBytes += bytes;
        serverCount++;
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    total += serverBytes;
    count += serverCount;
    const formatted = serverBytes.toLocaleString("en-US");
    console.log(`${name}: ${serverCount} model-visible tools, ${formatted} estimated bytes`);
  } finally { await client.close(); await transport.close(); }
}
const formattedTotal = total.toLocaleString("en-US");
console.log(`Combined: ${count} model-visible tools, ${formattedTotal} estimated bytes, including namespace overhead and the plugin attribution.`);
if (agentPlugin) {
  console.log(`Agent Plugin manifest: the combined limit is ${agentTotalBytes.toLocaleString("en-US")} bytes and each tool's is ${agentToolBytes.toLocaleString("en-US")}; tools past them are hidden from the model.`);
  if (total > agentTotalBytes) console.log("Over the Agent Plugin limit. Some tools will be hidden from the model.");
} else console.log("Legacy .codex-plugin manifest: Codex has no combined or per-tool size limit for these tools.");
if (oversized.length > 0) {
  console.log(`Input schemas over ${schemaCompactBytes.toLocaleString("en-US")} bytes are compacted, dropping descriptions${agentPlugin ? "; specs over the per-tool limit are hidden" : ""}:`);
  console.table(oversized);
}
if (oversized.length > 0 || (agentPlugin && total > agentTotalBytes)) process.exitCode = 1;
