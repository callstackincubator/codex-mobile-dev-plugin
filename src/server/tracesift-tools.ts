import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorMessage } from "../shared/protocol.ts";
import { TRACESIFT_URI, traceSiftAnalysisSchema, traceSiftHandoffSchema, traceSiftProfileInputSchema, traceSiftReactCardSchema, traceSiftTaskCardSchema } from "../shared/tracesift.ts";
import { gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { TRACE_SIFT_PAYLOAD_GZIP_MIN_BYTES, TRACE_SIFT_PAYLOAD_MAX_BYTES, traceSiftExploreEnvelopeSchema, traceSiftPayloadTooDeep } from "../shared/tracesift-explore.ts";
import { captureServerError, recordTraceSiftOperation, recordTraceSiftPayload } from "./telemetry.ts";
import type { TraceSiftClient } from "./tracesift-client.ts";
import { TraceSiftError } from "./tracesift-client.ts";

const TOO_LARGE = "This finding is larger than the panel can open. Use Open in browser for it.";

// Async on purpose: compressing a megabyte tree on the main thread would stall
// every other tool call sharing this process.
const gzip = promisify(gzipCallback);
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const visibility: ("app" | "model")[] = ["app", "model"];
const analysisOutput = {
  apiVersion: z.literal(1), analysisId: z.string(), profileType: z.enum(["cpu", "react"]), title: z.string(),
  summary: z.record(z.string(), z.unknown()), cards: z.array(z.union([traceSiftTaskCardSchema, traceSiftReactCardSchema])),
};

function failure(error: unknown, operation: "analyze" | "remember" | "restore" | "handoff" | "task" | "payload", startedAt: number, signal: AbortSignal): CallToolResult {
  recordTraceSiftOperation(operation, "failed", performance.now() - startedAt);
  captureServerError(error, `tracesift.${operation}`, { signal });
  return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
}

export function registerTraceSiftTools(server: McpServer, client: TraceSiftClient) {
  registerAppTool(server, "mobile_analyze_profile", {
    title: "Analyze a CPU or React profile with TraceSift",
    description: "Upload a local CPU profile or React DevTools profiling export to the local TraceSift service and render its measured findings as inline cards, each dividing its task between the features it entered, with an Explore view for the call tree and timeline. Use when the user provides a profile path and asks to investigate performance or find a root cause. Set profileType only when the format is known; auto detects supported JSON formats. After rendering, wait for the user to choose Investigate before changing code.",
    inputSchema: traceSiftProfileInputSchema.shape,
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

  registerAppTool(server, "mobile_remember_tracesift_analysis", {
    title: "Remember a TraceSift analysis for this card",
    description: "Associate an inline TraceSift card's stable host view with its persisted compact analysis so the card can be restored after Codex restarts.",
    inputSchema: { viewId: z.union([z.string(), z.number()]), analysisId: z.string().min(1).max(256) },
    outputSchema: { remembered: z.literal(true) }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ viewId, analysisId }, context) => {
    const startedAt = performance.now();
    try {
      await client.remember(viewId, analysisId);
      recordTraceSiftOperation("remember", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: "TraceSift analysis remembered for this card." }], structuredContent: { remembered: true as const } };
    } catch (error) { return failure(error, "remember", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_restore_tracesift_analysis", {
    title: "Restore a TraceSift analysis",
    description: "Reload the compact saved analysis for an existing inline TraceSift card after its host view is recreated.",
    inputSchema: { viewId: z.union([z.string(), z.number()]) },
    outputSchema: { apiVersion: z.literal(1), restored: z.boolean(), analysis: traceSiftAnalysisSchema.optional() }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ viewId }, context) => {
    const startedAt = performance.now();
    try {
      const analysis = await client.restore(viewId);
      recordTraceSiftOperation("restore", "success", performance.now() - startedAt);
      const structuredContent = { apiVersion: 1 as const, restored: analysis !== undefined, ...(analysis ? { analysis } : {}) };
      return { content: [{ type: "text", text: analysis ? "TraceSift analysis restored." : "No saved TraceSift analysis was found." }], structuredContent };
    } catch (error) { return failure(error, "restore", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_restore_tracesift_analysis_by_input", {
    title: "Restore a TraceSift analysis from its original profile input",
    description: "Reload the latest compact saved analysis for the profile input replayed by a recreated inline TraceSift card.",
    inputSchema: traceSiftProfileInputSchema.shape,
    outputSchema: { apiVersion: z.literal(1), restored: z.boolean(), analysis: traceSiftAnalysisSchema.optional() }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ path, profileType }, context) => {
    const startedAt = performance.now();
    try {
      const analysis = await client.restoreInput(path, profileType);
      recordTraceSiftOperation("restore", "success", performance.now() - startedAt);
      const structuredContent = { apiVersion: 1 as const, restored: analysis !== undefined, ...(analysis ? { analysis } : {}) };
      return { content: [{ type: "text", text: analysis ? "TraceSift analysis restored." : "No saved TraceSift analysis was found." }], structuredContent };
    } catch (error) { return failure(error, "restore", startedAt, context.signal); }
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

  registerAppTool(server, "mobile_tracesift_explore_payload", {
    title: "Load the full data one TraceSift finding explores",
    description: "Return the complete call tree and timeline for one CPU task, or every commit timeline for one React analysis, so the inline card can render the Explore view itself. This app-only action is called when the user presses Explore; the payload is large, travels compressed as one text item, and is never read back by the model.",
    inputSchema: {
      analysisId: z.string().min(1).max(256), taskIndex: z.number().int().nonnegative().optional(),
    },
    // Only the envelope is schema-checked: the tree inside is megabytes the host
    // would walk node by node to prove a shape the explorer checks as it draws.
    outputSchema: traceSiftExploreEnvelopeSchema.shape,
    annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ analysisId, taskIndex }, context) => {
    const startedAt = performance.now();
    try {
      const handoff = taskIndex === undefined
        ? { kind: "react" as const, value: await client.exploreReact(analysisId, context.signal) as unknown }
        : { kind: "task" as const, value: await client.exploreTask(analysisId, taskIndex, context.signal) as unknown };
      // Depth first, and iteratively: `JSON.stringify` recurses, so a runaway
      // tree would overflow the stack before the byte guard below could see it.
      if (traceSiftPayloadTooDeep(handoff.value)) throw new TraceSiftError(TOO_LARGE, "response");
      const raw = { kind: handoff.kind, json: JSON.stringify(handoff.value) };
      if (raw.json.length > TRACE_SIFT_PAYLOAD_MAX_BYTES) throw new TraceSiftError(TOO_LARGE, "response");
      // Small payloads cross as plain JSON; anything worth compressing does, so
      // the bridge carries a string the host's structured decoder never walks.
      const compressed = raw.json.length > TRACE_SIFT_PAYLOAD_GZIP_MIN_BYTES;
      const text = compressed ? (await gzip(raw.json, { level: 6 })).toString("base64") : raw.json;
      const result: CallToolResult = {
        content: [{ type: "text", text }],
        structuredContent: {
          apiVersion: 1 as const, kind: raw.kind,
          encoding: compressed ? "gzip+base64" as const : "json" as const,
          payloadBytes: raw.json.length,
        },
      };
      recordTraceSiftOperation("payload", "success", performance.now() - startedAt);
      recordTraceSiftPayload(result.structuredContent.kind, result.structuredContent.payloadBytes);
      return result;
    } catch (error) { return failure(error, "payload", startedAt, context.signal); }
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
