import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorMessage } from "../shared/protocol.ts";
import { TRACESIFT_URI, traceSiftHandoffSchema, traceSiftProfileTypeSchema, traceSiftReactCardSchema, traceSiftTaskCardSchema } from "../shared/tracesift.ts";
import { captureServerError, recordTraceSiftOperation } from "./telemetry.ts";
import type { TraceSiftClient } from "./tracesift-client.ts";

const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const visibility: ("app" | "model")[] = ["app", "model"];
const analysisOutput = {
  apiVersion: z.literal(1), analysisId: z.string(), profileType: z.enum(["cpu", "react"]), title: z.string(),
  summary: z.record(z.string(), z.unknown()), cards: z.array(z.union([traceSiftTaskCardSchema, traceSiftReactCardSchema])),
};

function failure(error: unknown, operation: "analyze" | "handoff" | "task", startedAt: number, signal: AbortSignal): CallToolResult {
  recordTraceSiftOperation(operation, "failed", performance.now() - startedAt);
  captureServerError(error, `tracesift.${operation}`, { signal });
  return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
}

export function registerTraceSiftTools(server: McpServer, client: TraceSiftClient) {
  registerAppTool(server, "mobile_analyze_profile", {
    title: "Analyze a CPU or React profile with TraceSift",
    description: "Upload a local CPU profile or React DevTools profiling export to the local TraceSift service and render its measured findings as inline cards, each dividing its task between the features it entered, with an Explore view for the call tree and timeline. Use when the user provides a profile path and asks to investigate performance or find a root cause. Set profileType only when the format is known; auto detects supported JSON formats. After rendering, wait for the user to choose Investigate before changing code.",
    inputSchema: { path: z.string().min(1).max(16_384), profileType: traceSiftProfileTypeSchema.default("auto") },
    outputSchema: analysisOutput, annotations: read,
    _meta: { ui: { resourceUri: TRACESIFT_URI, visibility } },
  }, async ({ path, profileType }, context) => {
    const startedAt = performance.now();
    try {
      const analysis = await client.analyze(path, profileType, context.signal,
        (outcome, duration) => recordTraceSiftOperation("ready", outcome, duration));
      recordTraceSiftOperation("analyze", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: `TraceSift found ${analysis.cards.length} ${analysis.profileType === "cpu" ? "task" : "React commit"} cards. Show the inline cards and wait for the user to choose Investigate.` }], structuredContent: analysis };
    } catch (error) { return failure(error, "analyze", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_open_tracesift_explore", {
    title: "Open a TraceSift finding in its web explorer",
    description: "Open one CPU task or React commit through `tracesift explore`. This app-only action is called after the user presses Explore; the persisted compact analysis carries the selection while full Explore data stays in TraceSift instead of crossing MCP.",
    inputSchema: {
      analysisId: z.string().min(1).max(256), taskIndex: z.number().int().nonnegative().optional(),
      rootId: z.number().int().nonnegative().optional(), commitIndex: z.number().int().nonnegative().optional(),
      focus: z.string().max(16_384).optional(),
    },
    outputSchema: { opened: z.literal(true) }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ analysisId, taskIndex, rootId, commitIndex, focus }, context) => {
    const startedAt = performance.now();
    try {
      if (taskIndex !== undefined && rootId === undefined && commitIndex === undefined) {
        await client.openExplore(analysisId, taskIndex, focus, context.signal);
      } else if (taskIndex === undefined && rootId !== undefined && commitIndex !== undefined && focus === undefined) {
        await client.openReactExplore(analysisId, rootId, commitIndex, context.signal);
      } else {
        throw new Error("Explore requires either a CPU task index or a React root and commit index.");
      }
      recordTraceSiftOperation("task", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: "TraceSift Explore opened." }], structuredContent: { opened: true as const } };
    } catch (error) { return failure(error, "task", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_get_tracesift_handoff", {
    title: "Get a TraceSift card handoff",
    description: "Return the authoritative TraceSift investigation handoff for a selected card. This app-only action is called by the inline card after the user presses Investigate.",
    inputSchema: { analysisId: z.string().min(1).max(256), cardId: z.string().min(1).max(256) },
    outputSchema: traceSiftHandoffSchema.shape, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ analysisId, cardId }, context) => {
    const startedAt = performance.now();
    try {
      const handoff = await client.handoff(analysisId, cardId, context.signal);
      recordTraceSiftOperation("handoff", "success", performance.now() - startedAt);
      const structuredContent = { apiVersion: 1 as const, handoff };
      return { content: [{ type: "text", text: "TraceSift handoff ready." }], structuredContent };
    } catch (error) { return failure(error, "handoff", startedAt, context.signal); }
  });
}
