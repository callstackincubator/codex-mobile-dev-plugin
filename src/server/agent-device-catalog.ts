import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const pluginOptions = new Set([
  "deviceTarget", "iosSimulatorDeviceSet", "iosXctestrunFile", "iosXctestDerivedDataPath", "iosXctestEnvDir",
  "androidDeviceAllowlist", "daemonBaseUrl", "daemonAuthToken", "tenant", "runId", "leaseId", "debug",
  "stateDir", "mcpOutputFormat", "includeCost", "responseLevel",
]);
const deviceOptions = new Set(["platform", "device", "udid", "serial"]);
const deviceCommands = new Set([
  "apps", "appstate", "boot", "capabilities", "devices", "doctor", "install", "install-from-source",
  "open", "reinstall", "replay", "shutdown", "test",
]);
const independentCommands = new Set([
  ...deviceCommands, "artifacts", "debug", "events", "metro", "session",
]);
const fileCommands = new Set([
  "artifacts", "batch", "debug", "diff", "install", "install-from-source", "logs", "metro", "open",
  "perf", "record", "reinstall", "replay", "screenshot", "session", "test", "trace",
]);

export function requiresAgentDeviceSession(name: string): boolean {
  return independentCommands.has(name) === false;
}

export function compactAgentDeviceTool(tool: Tool): Tool {
  const properties: Record<string, object> = {};
  const acceptsDevice = deviceCommands.has(tool.name);
  for (const [key, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
    if (pluginOptions.has(key)) continue;
    if (deviceOptions.has(key) && acceptsDevice === false) continue;
    if (key === "cwd" && fileCommands.has(tool.name) === false) continue;
    if (key === "target" && isObject(schema) && schema.type === "string") continue;
    properties[key] = key === "target" ? { ...schema, description: "UI element ref, selector, or screen point." } : schema;
  }
  if (properties.session !== undefined) {
    properties.session = { type: "string", minLength: 1, pattern: "\\S", description: "Named session opened with open." };
  }
  const required = [...tool.inputSchema.required ?? []];
  if (requiresAgentDeviceSession(tool.name) || tool.name === "open") {
    if (required.includes("session") === false) required.push("session");
  }
  if (tool.name === "open" && required.includes("platform") === false) required.push("platform");
  return { ...tool, inputSchema: { ...tool.inputSchema, properties, required, additionalProperties: false } };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}
