import { w as PlatformSelector } from "./sdk-contracts.js";
import { t as AgentDeviceClient } from "./client-types.js";
import { ToolApprovalStatus, ToolSet } from "ai";
//#region src/ai-sdk/index.d.ts
/**
 * `'core'` — the curated perceive/act loop (see the `frameworkTier` pinning
 * test in `src/__tests__/command-descriptor-parity.test.ts`). `'all'`
 * exposes every MCP-exposed command, same set the MCP server surfaces.
 */
type AgentDeviceToolSet = 'core' | 'all';
type CreateAgentDeviceToolsOptions = {
  /**
   * The agent-device session every tool call targets. Required: pinning one
   * session here is what lets the model call these tools without ever seeing
   * (or being able to typo) a session name — mirroring the "keep the client
   * outside tool execution so calls share one named session" guidance in the
   * AI SDK doc.
   */
  session: string;
  /**
   * When set, pins every tool call to this platform the same way `session` is
   * pinned, and removes `platform` from the tools' input schemas. Omit it to
   * let each call (and the daemon's own default-device selection) decide.
   */
  platform?: PlatformSelector;
  /** Which tools to build. Defaults to `'core'`. */
  set?: AgentDeviceToolSet;
  /**
   * Per-command approval policy, keyed by command name (e.g. `install`,
   * `close`). Returned as `toolApproval`, ready to pass straight to
   * `ToolLoopAgent`/`generateText`/`streamText` — see
   * https://ai-sdk.dev/docs/agents/tool-approvals. `tool()`'s own
   * `needsApproval` option is deprecated in favor of this, so this factory
   * never sets it.
   */
  approval?: Partial<Record<string, ToolApprovalStatus>>;
};
type AgentDeviceTools = {
  tools: ToolSet;
  client: AgentDeviceClient;
  toolApproval?: Partial<Record<string, ToolApprovalStatus>>;
};
/**
 * Builds an AI SDK tool set from the same command registry the MCP server
 * exposes (`listCommandTools()` / `createCommandToolExecutor()`), so the two
 * integrations stay in lockstep without a hand-maintained tool list. Uses
 * `jsonSchema()` against the registry's JSON Schema directly — no zod layer.
 *
 * `ai` is an optional peer dependency, so it is imported lazily here rather
 * than at module scope: importing `agent-device/ai-sdk` itself never
 * requires `ai` to be installed, only calling this function does.
 *
 * The returned `client` is a plain `agent-device` client for the same
 * session, for the host's own setup/teardown (e.g. `client.apps.open(...)`
 * before the loop, `client.sessions.close()` in a `finally`); the tools
 * themselves execute through the registry's own executor, independent of
 * this instance.
 */
declare function createAgentDeviceTools(options: CreateAgentDeviceToolsOptions): Promise<AgentDeviceTools>;
//#endregion
export { AgentDeviceToolSet, AgentDeviceTools, CreateAgentDeviceToolsOptions, createAgentDeviceTools };