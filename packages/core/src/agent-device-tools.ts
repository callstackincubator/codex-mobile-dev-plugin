import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { RequestHandlerExtra, RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolRequest, CallToolResult, ServerNotification, ServerRequest, Tool } from "@modelcontextprotocol/sdk/types.js";
import { isObject } from "./agent-device-catalog.ts";
import { AgentDeviceRuntime } from "./agent-device-runtime.ts";
import type { AgentDeviceBackend } from "./agent-device-runtime.ts";
import type { ServerFeature, ServerServices } from "./server-feature.ts";
import { captureServerError } from "./telemetry.ts";
import { isPng, MAX_SCREENSHOT_BYTES } from "./png.ts";

type Schemas = Map<string, z.ZodType>;
type CallExtra = Pick<RequestHandlerExtra<ServerRequest, ServerNotification>, "signal" | "sendNotification" | "_meta">;

/** The catalog `npm run build` copies beside the runtime (see agentDeviceCatalog). */
export function readAgentDeviceCatalog(url = new URL("./agent-device/tools.json", import.meta.url)): Tool[] {
  return JSON.parse(readFileSync(url, "utf8"));
}

/**
 * Serves agent-device's commands as `device_<command>` tools from the host's own server,
 * for hosts that load one server per plugin. The runtime starts on the first command.
 */
export function agentDeviceTools(catalog: Tool[], runtime: Pick<AgentDeviceRuntime, "connect" | "close"> = new AgentDeviceRuntime()): ServerFeature {
  return { register: (server, services) => {
    const schemas: Schemas = new Map();
    for (const tool of catalog) {
      // The catalog's input schemas are JSON Schema objects, which zod reads as such.
      const inputSchema = z.fromJSONSchema(tool.inputSchema as z.core.JSONSchema.JSONSchema);
      schemas.set(tool.name, inputSchema);
      server.registerTool(`device_${tool.name}`, { title: tool.title, description: tool.description, inputSchema, annotations: tool.annotations }, async (input, extra) => {
        // The server validated the input against this object schema; its callback type cannot express that.
        const args = input as Record<string, unknown>;
        const issue = stepIssue(tool.name, args, schemas);
        if (issue !== undefined) return invalid(issue);
        if (tool.name === "shutdown") await closeDeviceSessions(args, services);
        let backend: AgentDeviceBackend;
        try { backend = await runtime.connect(); }
        catch (error) {
          console.error("[mobile-dev] agent-device failed to start:", error);
          captureServerError(new Error("Agent Device failed to start."), "agent_device.start");
          return invalid("Agent Device could not start. Check the local runtime diagnostics.");
        }
        return forward(backend, { name: tool.name, arguments: args, _meta: extra._meta }, extra);
      });
    }
    return () => runtime.close();
  } };
}

/** Closes the plugin's sessions on a device agent-device shuts down, when the command names it. */
async function closeDeviceSessions(args: Record<string, unknown>, services: ServerServices) {
  const deviceId = args.udid ?? args.serial;
  if (typeof deviceId !== "string") return;
  try { await services.closeDevice(deviceId); }
  catch (error) {
    // The shutdown goes ahead; a collector that failed to stop ends with its device.
    captureServerError(error, "agent_device.session_cleanup", { reportAs: new Error("Device sessions failed to close before shutdown.") });
  }
}

function invalid(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Forwards a command, relaying its progress: long runs such as builds keep the call open
 * while they report it. Reports failures other than unavailable devices and sessions,
 * without their details.
 */
async function forward(backend: AgentDeviceBackend, params: CallToolRequest["params"], extra: CallExtra): Promise<CallToolResult> {
  try {
    const options: RequestOptions = {
      signal: extra.signal,
      timeout: 30 * 60 * 1000,
      resetTimeoutOnProgress: true,
      onprogress: async progress => {
        const progressToken = params._meta?.progressToken;
        if (progressToken === undefined) return;
        await extra.sendNotification({ method: "notifications/progress", params: { ...progress, progressToken } });
      },
    };
    const result = await backend.callTool(params, options);
    const code = result.structuredContent?.code;
    if (result.isError && code !== "DEVICE_NOT_FOUND" && code !== "DEVICE_IN_USE" && code !== "SESSION_NOT_FOUND") {
      captureServerError(new Error("Agent Device command failed."), `agent_device.${params.name}`);
    }
    return params.name === "screenshot" ? withScreenshot(result) : result;
  } catch (error) {
    if (extra.signal.aborted) throw error;
    console.error("[mobile-dev] Agent Device tool transport failed:", error);
    captureServerError(new Error("Agent Device tool transport failed."), `agent_device.${params.name}`);
    return invalid("Agent Device could not complete the command. Check the local runtime diagnostics.");
  }
}

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * agent-device saves a screenshot to a file and returns its path; the model sees the
 * screen only as an image, so attach the saved PNG or JPEG.
 */
async function withScreenshot(result: CallToolResult): Promise<CallToolResult> {
  const path = result.structuredContent?.path;
  if (result.isError || typeof path !== "string") return result;
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (error) {
    console.error("[mobile-dev] Agent Device screenshot could not be read:", error);
    captureServerError(new Error("Agent Device screenshot could not be read."), "agent_device.screenshot");
    return result;
  }
  const mimeType = isPng(bytes) ? "image/png" : bytes.subarray(0, 3).equals(JPEG_SIGNATURE) ? "image/jpeg" : undefined;
  if (mimeType === undefined || bytes.length > MAX_SCREENSHOT_BYTES) return result;
  return { ...result, content: [...result.content, { type: "image", mimeType, data: bytes.toString("base64") }] };
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
