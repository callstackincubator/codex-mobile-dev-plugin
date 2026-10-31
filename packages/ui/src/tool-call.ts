import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { HostBridge } from "./host-bridge.ts";

export type ToolCallParams = Parameters<HostBridge["callServerTool"]>[0];
export type ToolCallOptions = NonNullable<Parameters<HostBridge["callServerTool"]>[1]>;

/** What a failed result's `_meta` says about it. `retryable: false` means retrying cannot help. */
export type ToolFailure = { retryable?: boolean; inputBlocked: boolean; streamDisconnected: boolean; inputBusy: boolean };

/** A tool answered with `isError`; the message is its text. */
export class ToolCallError extends Error {
  readonly meta: ToolFailure;
  constructor(message: string, meta: ToolFailure) { super(message); this.meta = meta; }
}

export function toolResultText(result: CallToolResult): string {
  return result.content.flatMap(item => item.type === "text" ? [item.text] : []).join("\n");
}

type Options = ToolCallOptions & {
  /** The message when a failed result carries no text. */
  fallback?: string;
  /** Runs when the server answers, before a failure throws, so a timed round trip includes tool failures. */
  answered?: () => void;
};

/**
 * Calls a server tool and throws `ToolCallError` when it fails. With a schema, returns its
 * structured content parsed by it; a result that does not match throws `invalid`.
 */
export async function callTool(app: Pick<HostBridge, "callServerTool">, params: ToolCallParams, options?: Options): Promise<CallToolResult>;
export async function callTool<T>(app: Pick<HostBridge, "callServerTool">, params: ToolCallParams, options: Options & { schema: z.ZodType<T>; invalid?: string }): Promise<T>;
export async function callTool<T>(app: Pick<HostBridge, "callServerTool">, params: ToolCallParams, { fallback = "", answered, schema, invalid, ...request }: Options & { schema?: z.ZodType<T>; invalid?: string } = {}) {
  const result = await app.callServerTool(params, request);
  answered?.();
  if (result.isError) {
    const meta = result._meta;
    throw new ToolCallError(toolResultText(result) || fallback, {
      ...(typeof meta?.retryable === "boolean" ? { retryable: meta.retryable } : {}),
      inputBlocked: meta?.inputBlocked === true, streamDisconnected: meta?.streamDisconnected === true, inputBusy: meta?.inputBusy === true,
    });
  }
  if (schema === undefined) return result;
  const parsed = schema.safeParse(result.structuredContent);
  if (!parsed.success) throw new Error(invalid ?? `The plugin returned an invalid ${params.name} result.`);
  return parsed.data;
}
