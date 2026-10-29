import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { captureServerError } from "./telemetry.ts";
import type { ServerRequestContext } from "./request-session.ts";
import { retryableFailure } from "./simulator-unavailable.ts";

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/** A result whose text is its structured content as JSON, unless `text` says something else. */
export function jsonResult<T extends Record<string, unknown>>(data: T, text = JSON.stringify(data)): CallToolResult & { structuredContent: T } {
  return { content: [{ type: "text", text }], structuredContent: data };
}

export function failureResult(text: string, meta?: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text }], ...(meta ? { _meta: meta } : {}) };
}

export type Guard<I> = {
  /** Names the operation in server error telemetry. */
  operation: string;
  /** Adds `_meta.retryable`, which tells the panel whether reconnecting can help. */
  retryable?: boolean;
  /** Records each call's outcome and duration in milliseconds. */
  timed?: (outcome: "success" | "failed", duration: number, input: I) => void;
  /** Reports a failure in place of the default capture, for errors whose messages can carry private values. */
  capture?: (error: unknown, input: I, context: ServerRequestContext) => void;
  /** The failure text the caller sees; the error's message by default. */
  message?: (error: unknown) => string;
  meta?: (error: unknown, input: I) => Record<string, unknown>;
};

/**
 * Turns a handler's failures into `isError` results and reports them with the request's
 * signal, so failures after cancellation count as cancelled.
 */
export function guarded<I>(guard: string | Guard<I>, handler: (input: I, context: ServerRequestContext) => Promise<CallToolResult>) {
  const options: Guard<I> = typeof guard === "string" ? { operation: guard } : guard;
  return async (input: I, context: ServerRequestContext): Promise<CallToolResult> => {
    const startedAt = performance.now();
    try {
      const result = await handler(input, context);
      options.timed?.("success", performance.now() - startedAt, input);
      return result;
    } catch (error) {
      options.timed?.("failed", performance.now() - startedAt, input);
      if (options.capture) options.capture(error, input, context);
      else captureServerError(error, options.operation, { signal: context.signal });
      const meta = { ...(options.retryable ? { retryable: retryableFailure(error) } : {}), ...options.meta?.(error, input) };
      return failureResult(options.message?.(error) ?? errorMessage(error), Object.keys(meta).length > 0 ? meta : undefined);
    }
  };
}
