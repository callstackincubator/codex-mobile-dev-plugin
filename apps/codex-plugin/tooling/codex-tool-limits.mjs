// Codex's schema subset and tool limits, checked against rust-v0.163.0 (2026-10-21):
// https://github.com/openai/codex/blob/main/codex-rs/tools/src/json_schema/types.rs
// https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs
// Every MCP tool's input schema is compacted past 5,000 bytes (tool_input_schema_max_bytes).
// Only Agent Plugins, whose manifest is plugin.json at the plugin root, also have per-tool (8,000) and
// combined (64,000) byte limits; tools past them are hidden from the model. Plugins with
// .codex-plugin/plugin.json, such as this one, use the legacy format and have neither limit.
export const CODEX_TOOL_LIMITS = { schemaCompactBytes: 5000, agentToolBytes: 8000, agentTotalBytes: 64000 };
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

/**
 * Measures one MCP server's model-visible tools as Codex sends them: each tool's spec in
 * the server's namespace, with the plugin attribution, against Codex's limits.
 * `agentPlugin` applies the per-tool and combined limits of the Agent Plugin format.
 */
export function codexToolBudget({ server, instructions = "", tools, agentPlugin }) {
  const { schemaCompactBytes, agentToolBytes, agentTotalBytes } = CODEX_TOOL_LIMITS;
  const namespace = `mcp__${server.replaceAll("-", "_")}`;
  const description = truncate(instructions.trim(), 1000);
  let bytes = 0;
  let count = 0;
  const oversized = [];
  for (const tool of tools) {
    const visibility = tool._meta?.ui?.visibility;
    if (Array.isArray(visibility) && visibility.includes("model") === false) continue;
    const text = `${tool.description ?? ""} This tool is part of plugin \`Mobile Dev\`.`;
    const parameters = normalizeSchema(tool.inputSchema);
    const spec = { type: "namespace", name: namespace, description, tools: [{ type: "function", name: tool.name.replaceAll("-", "_"), description: truncate(text, 1000), strict: false, parameters }] };
    const specBytes = jsonBytes(spec);
    const schemaBytes = jsonBytes(parameters);
    if (schemaBytes > schemaCompactBytes || (agentPlugin && specBytes > agentToolBytes)) oversized.push({ server, tool: tool.name, schemaBytes, specBytes });
    bytes += specBytes;
    count++;
  }
  return { count, bytes, oversized, overTotal: agentPlugin && bytes > agentTotalBytes };
}

