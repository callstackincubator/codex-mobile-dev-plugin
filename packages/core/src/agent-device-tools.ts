import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { forwardAgentDeviceCall, invalid } from "./agent-device-adapter.ts";
import type { AgentDeviceBackend } from "./agent-device-adapter.ts";
import { isObject } from "./agent-device-catalog.ts";
import { AgentDeviceRuntime } from "./agent-device-runtime.ts";
import type { ServerFeature } from "./server-feature.ts";
import { captureServerError } from "./telemetry.ts";

/** Each agent-device command is the tool `device_<command>`, beside Mobile Dev's own tools. */
export const AGENT_DEVICE_TOOL_PREFIX = "device_";

// Commands that Mobile Dev's own tools cover (logs, performance), or that need a remote
// daemon, a TV or a browser.
const omitted = new Set(["logs", "perf", "install-from-source", "artifacts", "viewport", "tv-remote", "audio"]);

type Runtime = { connect(): Promise<AgentDeviceBackend>; close(): Promise<void> };
type Schemas = Map<string, z.ZodType>;

/** The compact agent-device catalog that `npm run build` writes beside the runtime. */
export function readAgentDeviceCatalog(url = new URL("./agent-device/tools.json", import.meta.url)): Tool[] {
  return JSON.parse(readFileSync(url, "utf8"));
}

/**
 * Serves agent-device's commands from the host's server, for hosts that load one server
 * per plugin. The runtime starts on the first command.
 */
export function agentDeviceTools(catalog: Tool[], runtime: Runtime = new AgentDeviceRuntime()): ServerFeature {
  return server => {
    const tools = catalog.filter(tool => omitted.has(tool.name) === false);
    const schemas: Schemas = new Map(tools.map(tool => [tool.name, z.fromJSONSchema(tool.inputSchema as z.core.JSONSchema.JSONSchema)]));
    for (const tool of tools) {
      server.registerTool(`${AGENT_DEVICE_TOOL_PREFIX}${tool.name}`, {
        title: tool.title, description: tool.description, inputSchema: schemas.get(tool.name), annotations: tool.annotations,
      }, async (input: Record<string, unknown>, extra): Promise<CallToolResult> => {
        const issue = stepIssue(tool.name, input, schemas);
        if (issue !== undefined) return invalid(issue);
        let backend: AgentDeviceBackend;
        try { backend = await runtime.connect(); }
        catch {
          captureServerError(new Error("Agent Device adapter failed to start."), "agent_device.start");
          return invalid("Agent Device could not start. Check the local runtime diagnostics.");
        }
        return forwardAgentDeviceCall(backend, { name: tool.name, arguments: input, _meta: extra._meta }, extra);
      });
    }
    return () => runtime.close();
  };
}

// The server validates each tool's own input; batch steps name other commands, and saving
// a script needs a session.
function stepIssue(name: string, input: Record<string, unknown>, schemas: Schemas): string | undefined {
  if (name === "session" && input.action === "save-script" && typeof input.session !== "string") {
    return "session save-script requires a named session.";
  }
  if (name !== "batch" || Array.isArray(input.steps) === false) return;
  for (const [index, step] of input.steps.entries()) {
    if (isObject(step) === false || typeof step.command !== "string" || isObject(step.input) === false) continue;
    const schema = schemas.get(step.command);
    if (schema === undefined) return `Batch step ${index + 1}: Unknown Agent Device command: ${step.command}.`;
    const nested = { ...step.input, session: step.input.session ?? input.session };
    const parsed = schema.safeParse(nested);
    if (parsed.success === false) return `Batch step ${index + 1}: Invalid ${step.command} arguments: ${z.prettifyError(parsed.error)}`;
    const issue = stepIssue(step.command, nested, schemas);
    if (issue !== undefined) return `Batch step ${index + 1}: ${issue}`;
  }
}
