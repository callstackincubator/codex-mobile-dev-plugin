import { Ajv, type ValidateFunction } from "ajv";
import * as Sentry from "@sentry/node";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema,
  type CallToolRequest, type CallToolResult, type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { PLUGIN_VERSION } from "../shared/version.ts";
import { captureServerError } from "./telemetry.ts";
import { compactAgentDeviceTool, isObject } from "./agent-device-catalog.ts";

export type AgentDeviceBackend = {
  listTools: Client["listTools"];
  callTool(params: CallToolRequest["params"], options: RequestOptions): Promise<CallToolResult>;
};

export function agentDeviceBackend(client: Client): AgentDeviceBackend {
  return {
    listTools: client.listTools.bind(client),
    async callTool(params, options) {
      const result = await client.callTool(params, CallToolResultSchema, options);
      return CallToolResultSchema.parse(result);
    },
  };
}

function invalid(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export async function createAgentDeviceAdapter(backend: AgentDeviceBackend): Promise<Server> {
  const started = performance.now();
  const upstream: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await backend.listTools({ cursor });
    upstream.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  const tools = upstream.map(compactAgentDeviceTool);
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validators = new Map<string, ValidateFunction<Record<string, unknown>>>();
  for (const tool of tools) {
    const validate = ajv.compile<Record<string, unknown>>(tool.inputSchema);
    validators.set(tool.name, validate);
  }
  const duration = performance.now() - started;
  Sentry.metrics.distribution("agent_device.catalog.ready", duration, { unit: "millisecond" });
  const server = new Server({ name: "agent-device", version: PLUGIN_VERSION }, {
    capabilities: { tools: {} },
    instructions: "Choose a device with open and a named session. Reuse that session for interactions. See the Mobile Dev agent-device skill.",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const input = request.params.arguments ?? {};
    const issue = validateInput(name, input, validators);
    if (issue !== undefined) return invalid(issue);
    return Sentry.startSpan({ name: `tools/call ${name}`, op: "mcp.server", attributes: { "mcp.tool.name": name } }, async span => {
      try {
        const options: RequestOptions = {
          signal: extra.signal,
          timeout: 30 * 60 * 1000,
          resetTimeoutOnProgress: true,
          onprogress: async progress => {
            const progressToken = request.params._meta?.progressToken;
            if (progressToken === undefined) return;
            await extra.sendNotification({ method: "notifications/progress", params: { ...progress, progressToken } });
          },
        };
        const result = await backend.callTool(request.params, options);
        if (result.isError) {
          span.setStatus({ code: 2 });
          const code = result.structuredContent?.code;
          const unavailable = code === "DEVICE_NOT_FOUND" || code === "DEVICE_IN_USE" || code === "SESSION_NOT_FOUND";
          if (unavailable === false) {
            const error = new Error("Agent Device command failed.");
            captureServerError(error, `agent_device.${name}`);
          }
        }
        return result;
      } catch (error) {
        span.setStatus({ code: 2 });
        if (extra.signal.aborted) throw error;
        console.error("[mobile-dev] Agent Device tool transport failed:", error);
        const failure = new Error("Agent Device tool transport failed.");
        captureServerError(failure, `agent_device.${name}`);
        return invalid("Agent Device could not complete the command. Check the local runtime diagnostics.");
      }
    });
  });
  return server;
}

function validateInput(name: string, input: unknown, validators: Map<string, ValidateFunction<Record<string, unknown>>>): string | undefined {
  const validate = validators.get(name);
  if (validate === undefined) return `Unknown Agent Device tool: ${name}.`;
  if (validate(input) === false) {
    const details = JSON.stringify(validate.errors);
    return `Invalid ${name} arguments: ${details}. Use this tool's MCP input schema.`;
  }
  if (name === "session" && input.action === "save-script" && typeof input.session !== "string") {
    return "session save-script requires a named session.";
  }
  if (name !== "batch") return;
  if (Array.isArray(input.steps) === false) return;
  for (const [index, step] of input.steps.entries()) {
    if (isObject(step) === false || typeof step.command !== "string" || isObject(step.input) === false) continue;
    const nested = { ...step.input, session: step.input.session ?? input.session };
    const issue = validateInput(step.command, nested, validators);
    if (issue !== undefined) return `Batch step ${index + 1}: ${issue}`;
  }
}
