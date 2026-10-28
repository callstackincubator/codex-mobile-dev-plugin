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
  "perf", "record", "reinstall", "replay", "session", "test", "trace",
]);
// Options that write files where the agent says, left out so these commands can run
// without asking (see commandAnnotations): screenshots return their image, and scripts
// are saved with session.
const fileOutputs: Record<string, string[]> = { open: ["saveScript", "force"], close: ["saveScript", "force"], screenshot: ["path"] };

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
    if (fileOutputs[tool.name]?.includes(key)) continue;
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

// Commands that Mobile Dev's own tools cover (logs, performance), or that need a remote
// daemon, a TV or a browser.
const omitted = new Set(["logs", "perf", "install-from-source", "artifacts", "viewport", "tv-remote", "audio"]);

type Annotations = NonNullable<Tool["annotations"]>;
const read: Annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write: Annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructive: Annotations = { ...write, destructiveHint: true };

/**
 * What each served command does, which hosts read to decide when to ask the user, with
 * the annotations of Mobile Dev's own matching tools. Reads, device input and app
 * control run without asking, as the panel's tools did. Commands that install apps,
 * run scripts or app-defined events, write files where the agent says, read or replace
 * the clipboard (which simulators can share with the Mac), or reach development
 * servers keep asking. agent-device declares none of its own.
 */
const commandAnnotations: Record<string, Annotations> = {
  apps: read, appstate: read, capabilities: read, devices: read, events: read, get: read, is: read,
  network: read, screenshot: read, snapshot: read, wait: read,
  alert: write, "app-switcher": write, back: write, boot: write, click: write, close: write, fill: write,
  find: write, focus: write, gesture: write, home: write, keyboard: write, longpress: write, open: write,
  orientation: write, press: write, push: write, "react-native": write, scroll: write, settings: write,
  shutdown: write, swipe: write, type: write,
  batch: destructive, clipboard: destructive, debug: destructive, diff: destructive, install: destructive,
  record: destructive, reinstall: destructive, replay: destructive, session: destructive, test: destructive,
  trace: destructive, "trigger-app-event": destructive,
  doctor: { ...write, openWorldHint: true }, metro: { ...write, openWorldHint: true },
};

/**
 * The agent-device commands Mobile Dev serves, with compact schemas, our annotations,
 * and without output schemas, since the tools return agent-device's own results.
 * `npm run catalog:agent-device` writes it from the pinned runtime, and fails on a new
 * command until it is classified in commandAnnotations.
 */
export function agentDeviceCatalog(tools: Tool[]): Tool[] {
  return tools.filter(tool => omitted.has(tool.name) === false).map(compactAgentDeviceTool)
    .map(({ name, title, description, inputSchema }) => {
      const annotations = commandAnnotations[name];
      if (annotations === undefined) throw new Error(`Classify agent-device's ${name} command in commandAnnotations before serving it.`);
      return { name, title, description, inputSchema, annotations };
    });
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}
