import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { TRACESIFT_URI, traceSiftAnalysisSchema, traceSiftHandoffSchema, traceSiftProfileInputSchema, traceSiftReactCardSchema, traceSiftTaskCardSchema } from "@mobile-dev/shared/tracesift.ts";
import { gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { TRACE_SIFT_PAYLOAD_GZIP_MIN_BYTES, TRACE_SIFT_PAYLOAD_MAX_BYTES, traceSiftExploreEnvelopeSchema, TRACE_SIFT_PAYLOAD_TOO_LARGE, traceSiftPayloadTooDeep } from "@mobile-dev/shared/tracesift-explore.ts";
import { recordTraceSiftOperation, recordTraceSiftPayload } from "./telemetry.ts";
import { guarded, jsonResult, READ_ONLY as read, WRITES } from "./tool-results.ts";
import type { TraceSiftClient } from "./tracesift-client.ts";
import { TraceSiftError } from "./tracesift-client.ts";
import { pickProfileFile, pickProjectFolder } from "./profile-picker.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";

// Async so compressing a large tree does not stall other tool calls.
const gzip = promisify(gzipCallback);
// Analysis replaces the latest-input reference; remember replaces the host-view reference.
const persist = { ...WRITES, destructiveHint: true };
// Service-backed reads can start a local background process; Explore also opens a browser.
const localService = WRITES;
const visibility: ("app" | "model")[] = ["app", "model"];
type TraceSiftProfileInput = z.infer<typeof traceSiftProfileInputSchema>;
const analysisOutput = {
  apiVersion: z.literal(1), analysisId: z.string(), profileType: z.enum(["cpu", "react"]), title: z.string(),
  summary: z.record(z.string(), z.unknown()), cards: z.array(z.union([traceSiftTaskCardSchema, traceSiftReactCardSchema])),
};

type TraceSiftOperation = Parameters<typeof recordTraceSiftOperation>[0];
const timed = (operation: TraceSiftOperation) => ({
  operation: `tracesift.${operation}`, timed: (outcome: "success" | "failed", duration: number) => recordTraceSiftOperation(operation, outcome, duration),
});

export function registerTraceSiftTools(server: McpServer, client: TraceSiftClient) {
  registerAppTool(server, "mobile_analyze_profile", {
    title: "Analyze a CPU or React profile with TraceSift",
    description: "Upload a local CPU profile or React DevTools profiling export to the local TraceSift service and render its measured findings as inline cards, each dividing its task between the features it entered, with an Explore view for the call tree and timeline. Use when the user provides a profile path and asks to investigate performance or find a root cause. Set profileType only when the format is known; auto detects supported JSON formats. May start the local TraceSift service, saves analysis files, and replaces the latest analysis reference for this profile input. After rendering, wait for the user to choose Investigate before changing code.",
    inputSchema: traceSiftProfileInputSchema.shape,
    outputSchema: analysisOutput, annotations: persist,
    _meta: { ui: { resourceUri: TRACESIFT_URI, visibility } },
  }, guarded(timed("analyze"), async ({ path, profileType }: TraceSiftProfileInput, context) => {
    const analysis = await client.analyze(path, profileType, context.signal,
      (outcome, duration) => recordTraceSiftOperation("ready", outcome, duration));
    // Name each card with its ID so the agent can fetch a card's handoff where the card cannot.
    const kind = analysis.profileType === "cpu" ? "task" : "React commit";
    const cards = analysis.cards.map((card, index) => `#${index + 1} (card ${card.id}, ${Math.round(card.durationMs)} ms): ${card.headline}`).join("; ");
    return { content: [{ type: "text", text: `TraceSift found ${analysis.cards.length} ${kind} cards in analysis ${analysis.analysisId}: ${cards}. Show the inline cards and wait for the user to choose Investigate.` }], structuredContent: analysis };
  }));

  registerAppTool(server, "mobile_pick_profile_file", {
    title: "Choose a profile file to analyze",
    description: "Open the host's file dialog so the TraceSift panel can choose a local CPU or React profile, and return the chosen path. A panel frame only sees a browser file, which carries no path, so this is how its upload pane reaches `mobile_analyze_profile`. Opens a window and waits for a person; pressing Cancel returns picked false.",
    inputSchema: {},
    outputSchema: { picked: z.boolean(), path: z.string().optional() }, annotations: localService,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("pick"), async () => {
    const chosen = await pickProfileFile();
    return {
      content: [{ type: "text", text: chosen.picked ? "A profile file was chosen." : "No profile file was chosen." }],
      structuredContent: chosen.picked ? { picked: true, path: chosen.path } : { picked: false },
    };
  }));

  registerAppTool(server, "mobile_get_tracesift_project", {
    title: "Read the project TraceSift findings are investigated in",
    description: "Return the source folder a TraceSift investigation should land in, as the panel last chose it. Returns none when nothing is chosen or the saved folder no longer exists.",
    inputSchema: {},
    outputSchema: { path: z.string().optional() }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("project"), async () => {
    const path = await client.readProject();
    return {
      content: [{ type: "text", text: path ? "A project folder is chosen." : "No project folder is chosen." }],
      structuredContent: path ? { path } : {},
    };
  }));

  registerAppTool(server, "mobile_pick_tracesift_project", {
    title: "Choose the project TraceSift findings are investigated in",
    description: "Open the host's folder dialog so the TraceSift panel can choose the source folder an investigation should land in, and save that choice. Opens a window and waits for a person; pressing Cancel returns picked false and leaves the saved folder alone. Replaces the previously saved folder.",
    inputSchema: {},
    outputSchema: { picked: z.boolean(), path: z.string().optional() }, annotations: persist,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("project"), async () => {
    const chosen = await pickProjectFolder();
    // Cancel leaves the saved folder standing, so nothing is written for it.
    const path = chosen.picked ? await client.writeProject(chosen.path) : undefined;
    return {
      content: [{ type: "text", text: path ? "A project folder was chosen." : "No project folder was chosen." }],
      structuredContent: path ? { picked: true, path } : { picked: false },
    };
  }));

  registerAppTool(server, "mobile_remember_tracesift_analysis", {
    title: "Remember a TraceSift analysis for this card",
    description: "Associate an inline TraceSift card's stable host view with its persisted compact analysis so the card can be restored after Codex restarts. Writes a local reference file, replacing the previous association for this host view.",
    inputSchema: { viewId: z.union([z.string(), z.number()]), analysisId: z.string().min(1).max(256) },
    outputSchema: { remembered: z.literal(true) }, annotations: persist,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("remember"), async ({ viewId, analysisId }: { viewId: string | number; analysisId: string }) => {
    await client.remember(viewId, analysisId);
    return { content: [{ type: "text", text: "TraceSift analysis remembered for this card." }], structuredContent: { remembered: true as const } };
  }));

  registerAppTool(server, "mobile_restore_tracesift_analysis", {
    title: "Restore a TraceSift analysis",
    description: "Reload the compact saved analysis for an existing inline TraceSift card after its host view is recreated.",
    inputSchema: { viewId: z.union([z.string(), z.number()]) },
    outputSchema: { apiVersion: z.literal(1), restored: z.boolean(), analysis: traceSiftAnalysisSchema.optional() }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("restore"), async ({ viewId }: { viewId: string | number }) => {
    const analysis = await client.restore(viewId);
    const structuredContent = { apiVersion: 1 as const, restored: analysis !== undefined, ...(analysis ? { analysis } : {}) };
    return { content: [{ type: "text", text: analysis ? "TraceSift analysis restored." : "No saved TraceSift analysis was found." }], structuredContent };
  }));

  registerAppTool(server, "mobile_restore_tracesift_analysis_by_input", {
    title: "Restore a TraceSift analysis from its original profile input",
    description: "Reload the latest compact saved analysis for the profile input replayed by a recreated inline TraceSift card.",
    inputSchema: traceSiftProfileInputSchema.shape,
    outputSchema: { apiVersion: z.literal(1), restored: z.boolean(), analysis: traceSiftAnalysisSchema.optional() }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("restore"), async ({ path, profileType }: TraceSiftProfileInput) => {
    const analysis = await client.restoreInput(path, profileType);
    const structuredContent = { apiVersion: 1 as const, restored: analysis !== undefined, ...(analysis ? { analysis } : {}) };
    return { content: [{ type: "text", text: analysis ? "TraceSift analysis restored." : "No saved TraceSift analysis was found." }], structuredContent };
  }));

  registerAppTool(server, "mobile_open_tracesift_explore", {
    title: "Open a TraceSift finding in its web explorer",
    description: "Open one CPU task or React commit through `tracesift explore`. May start the local service and opens a browser. This app-only action is called after the user presses Explore; the persisted compact analysis carries the selection while full Explore data stays in TraceSift instead of crossing MCP.",
    inputSchema: {
      analysisId: z.string().min(1).max(256), taskIndex: z.number().int().nonnegative().optional(),
      rootId: z.number().int().nonnegative().optional(), commitIndex: z.number().int().nonnegative().optional(),
      focus: z.string().max(16_384).optional(),
    },
    outputSchema: { opened: z.literal(true) }, annotations: localService,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("task"), async ({ analysisId, taskIndex, rootId, commitIndex, focus }: { analysisId: string; taskIndex?: number; rootId?: number; commitIndex?: number; focus?: string }, context) => {
    if (taskIndex !== undefined && rootId === undefined && commitIndex === undefined) {
      await client.openExplore(analysisId, taskIndex, focus, context.signal);
    } else if (taskIndex === undefined && rootId !== undefined && commitIndex !== undefined && focus === undefined) {
      await client.openReactExplore(analysisId, rootId, commitIndex, context.signal);
    } else {
      throw new Error("Explore requires either a CPU task index or a React root and commit index.");
    }
    return { content: [{ type: "text", text: "TraceSift Explore opened." }], structuredContent: { opened: true as const } };
  }));

  registerAppTool(server, "mobile_tracesift_explore_payload", {
    title: "Load the full data one TraceSift finding explores",
    description: "Return the complete call tree and timeline for one CPU task, or every commit timeline for one React analysis, so the inline card can render the Explore view itself. May start the local TraceSift service. This app-only action is called when the user presses Explore; the payload is large, travels compressed as one text item, and is never read back by the model.",
    inputSchema: {
      analysisId: z.string().min(1).max(256), taskIndex: z.number().int().nonnegative().optional(),
    },
    // Only the envelope is schema-checked; the tree inside is megabytes the explorer validates as it draws.
    outputSchema: traceSiftExploreEnvelopeSchema.shape,
    annotations: localService,
    _meta: { ui: { visibility: ["app"] } },
  }, guarded(timed("payload"), async ({ analysisId, taskIndex }: { analysisId: string; taskIndex?: number }, context) => {
    const handoff = taskIndex === undefined
      ? { kind: "react" as const, value: await client.exploreReact(analysisId, context.signal) as unknown }
      : { kind: "task" as const, value: await client.exploreTask(analysisId, taskIndex, context.signal) as unknown };
    // Checked iteratively: `JSON.stringify` recurses and a runaway tree would overflow the stack first.
    if (traceSiftPayloadTooDeep(handoff.value)) throw new TraceSiftError(TRACE_SIFT_PAYLOAD_TOO_LARGE, "response");
    // V8 can still overflow under the depth bound; treat it as too large.
    let json: string;
    try { json = JSON.stringify(handoff.value); }
    catch (error) { throw error instanceof RangeError ? new TraceSiftError(TRACE_SIFT_PAYLOAD_TOO_LARGE, "response") : error; }
    const raw = { kind: handoff.kind, json };
    if (raw.json.length > TRACE_SIFT_PAYLOAD_MAX_BYTES) throw new TraceSiftError(TRACE_SIFT_PAYLOAD_TOO_LARGE, "response");
    // Compressed payloads cross as a string the host's structured decoder never walks.
    const compressed = raw.json.length > TRACE_SIFT_PAYLOAD_GZIP_MIN_BYTES;
    const text = compressed ? (await gzip(raw.json, { level: 6 })).toString("base64") : raw.json;
    recordTraceSiftPayload(raw.kind, raw.json.length);
    return jsonResult({
      apiVersion: 1 as const, kind: raw.kind,
      encoding: compressed ? "gzip+base64" as const : "json" as const,
      payloadBytes: raw.json.length,
    }, text);
  }));

  registerAppTool(server, "mobile_get_tracesift_handoff", {
    title: "Get a TraceSift card handoff",
    description: "Return the authoritative TraceSift investigation handoff for one card of an analysis, by the analysisId and card ID mobile_analyze_profile reports. The inline card calls it when the user presses Investigate; call it yourself only when the user asks to investigate a card the card cannot hand off. May start the local TraceSift service.",
    inputSchema: { analysisId: z.string().min(1).max(256), cardId: z.string().min(1).max(256) },
    outputSchema: traceSiftHandoffSchema.shape, annotations: localService,
    _meta: { ui: { visibility } },
  }, guarded(timed("handoff"), async ({ analysisId, cardId }: { analysisId: string; cardId: string }, context) => {
    const handoff = await client.handoff(analysisId, cardId, context.signal);
    const structuredContent = { apiVersion: 1 as const, handoff };
    // The handoff is the evidence an investigation starts from; the agent reads it as text.
    return { content: [{ type: "text", text: handoff }], structuredContent };
  }));
}
