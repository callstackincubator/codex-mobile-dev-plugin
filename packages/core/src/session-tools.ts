import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { parseResourceInput } from "./resource-input.ts";
import { openRequestSession } from "./request-session.ts";
import { sessionIdSchema } from "./session-registry.ts";
import { guarded, jsonResult, READ_ONLY, WRITES } from "./tool-results.ts";

const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resourceCursor = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metadata = { ui: { visibility: ["app", "model"] as ("app" | "model")[] } };

type Tool = { name: string; title: string; description: string };
export type SessionTools<Shape extends z.ZodRawShape, B extends Record<string, unknown>> = {
  /** The resource's URI scheme; batches read from `<scheme>://mobile-dev/<sessionId>/batch?after=<cursor>`. */
  scheme: string;
  resource: { name: string; description: string };
  /** Names failures in server error telemetry. */
  operation: string;
  /** Session and close tools change device state; log tools only read. */
  writes: boolean;
  sessions: {
    read(id: string, after: number, waitMs?: number, signal?: AbortSignal): Promise<B>;
    closeSession(id: string): Promise<void>;
  };
  start: Tool & {
    inputSchema: Shape;
    /** Checks the target before the request takes ownership of a session. */
    validate: (input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
    open: (input: z.infer<z.ZodObject<Shape>>) => string;
    /** The start result for the new session and its first batch URI. */
    describe: (input: z.infer<z.ZodObject<Shape>>, sessionId: string, uri: string) => CallToolResult;
  };
  read: Tool;
  close: Tool & { text: string };
  /** Registers tools between read and close. */
  between?: () => void;
};

/** Registers a session's batch resource and its start, read and close tools. */
export function registerSessionTools<Shape extends z.ZodRawShape, B extends Record<string, unknown>>(server: McpServer, tools: SessionTools<Shape, B>) {
  const { sessions } = tools;
  const changes = tools.writes ? WRITES : READ_ONLY;
  server.registerResource(tools.resource.name, new ResourceTemplate(`${tools.scheme}://mobile-dev/{sessionId}/batch?after={sequence}`, { list: undefined }), {
    mimeType: "application/json", description: tools.resource.description,
  }, async (uri, variables, extra) => {
    const id = parseResourceInput(sessionIdSchema, variables.sessionId);
    const after = parseResourceInput(resourceCursor, variables.sequence);
    const batch = await sessions.read(id, after, 1000, extra.signal);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(batch) }] };
  });
  const { start } = tools;
  const inputSchema: z.ZodRawShape = start.inputSchema;
  registerAppTool(server, start.name, {
    title: start.title, description: start.description, inputSchema, annotations: changes, _meta: metadata,
  }, guarded(tools.operation, async (input, context) => {
    // registerAppTool validated input against this exact shape; its generic callback type cannot express that.
    const parsed = input as z.infer<z.ZodObject<Shape>>;
    await start.validate(parsed);
    const id = await openRequestSession(context.signal, async () => start.open(parsed), id => sessions.closeSession(id));
    return start.describe(parsed, id, `${tools.scheme}://mobile-dev/${id}/batch?after=0`);
  }));
  registerAppTool(server, tools.read.name, {
    title: tools.read.title, description: tools.read.description,
    inputSchema: { sessionId: sessionIdSchema, after: cursor.default(0) }, annotations: READ_ONLY, _meta: metadata,
  }, guarded(tools.operation, async ({ sessionId, after }: { sessionId: string; after: number }) => jsonResult({ ...await sessions.read(sessionId, after, 0) })));
  tools.between?.();
  registerAppTool(server, tools.close.name, {
    title: tools.close.title, description: tools.close.description, inputSchema: { sessionId: sessionIdSchema }, annotations: changes, _meta: metadata,
  }, guarded(tools.operation, async ({ sessionId }: { sessionId: string }) => {
    await sessions.closeSession(sessionId);
    return { content: [{ type: "text", text: tools.close.text }], structuredContent: {} };
  }));
}
