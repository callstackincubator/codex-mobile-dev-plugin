import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type CallOptions = Parameters<App["callServerTool"]>[1];

export type ToolCall = { name: string; arguments: Record<string, unknown> };
/** Answers one tool call from its arguments. */
export type ToolHandler = (args: Record<string, unknown>, options?: CallOptions) => CallToolResult | Promise<CallToolResult>;

export type FakeAppOptions = Partial<Omit<App, "callServerTool">> & {
  /** Handlers by tool name. */
  tools?: Record<string, ToolHandler>;
  /** Answers tools without a handler. Defaults to an empty result. */
  fallback?: (call: ToolCall, options?: CallOptions) => CallToolResult | Promise<CallToolResult>;
};

/**
 * A host connection for panels and cards: tool calls go to `tools` by name and are
 * recorded in `calls`; the other members are the ones given. The panels under test
 * use only those members, so the rest of `App` is absent.
 */
export function fakeApp({ tools = {}, fallback = () => ({ content: [] }), ...members }: FakeAppOptions = {}) {
  const calls: ToolCall[] = [];
  const app = {
    ...members,
    async callServerTool(params: { name: string; arguments?: Record<string, unknown> }, options?: CallOptions) {
      const call = { name: params.name, arguments: params.arguments ?? {} };
      calls.push(call);
      const handler = tools[call.name];
      return handler ? handler(call.arguments, options) : fallback(call, options);
    },
  };
  return Object.assign(app as unknown as App, { calls });
}
