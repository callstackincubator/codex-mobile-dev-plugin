import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * The host operations shared views use. Hosts without a chat leave `message` and
 * `updateModelContext` out of their capabilities, and views hide actions that need them.
 */
export type HostBridge = Pick<App,
  | "callServerTool"
  | "readServerResource"
  | "getHostCapabilities"
  | "getHostContext"
  | "sendMessage"
  | "updateModelContext"
  | "requestDisplayMode">;

/** Whether the host lets views call server tools. Hosts without it, such as Claude Code, show only what the tool result carries; Mobile Dev's panel needs it. */
export function cardsCallTools(app: Pick<HostBridge, "getHostCapabilities">): boolean {
  return app.getHostCapabilities()?.serverTools !== undefined;
}

type ContextParams = Parameters<App["updateModelContext"]>[0];

/**
 * Hosts that show the panel's context as removable attachments in their composer,
 * such as Codex, own selection and removal there. `getCurrent` returns the context
 * the host holds: `null` once the user cleared it, `undefined` while unknown.
 */
export interface HostAttachments {
  getCurrent(): (ContextParams & { updateId: string }) | null | undefined;
  update(params: ContextParams, options?: Parameters<App["updateModelContext"]>[1]): Promise<{ updateId: string } | undefined>;
}

/** Reads the host's attachments when needed; hosts advertise them only after connecting. */
export type HostAttachmentsSource = () => HostAttachments | undefined;
