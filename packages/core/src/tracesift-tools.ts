import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { TRACESIFT_URI, traceSiftAnalysisSchema, traceSiftCaptureSchema, traceSiftCaptureUrlSchema, traceSiftHandoffSchema, traceSiftMetroUrlSchema, traceSiftProfileInputSchema, traceSiftReactCardSchema, traceSiftRnTargetsSchema, traceSiftTaskCardSchema } from "@mobile-dev/shared/tracesift.ts";
import { gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { TRACE_SIFT_PAYLOAD_GZIP_MIN_BYTES, TRACE_SIFT_PAYLOAD_MAX_BYTES, traceSiftExploreEnvelopeSchema, TRACE_SIFT_PAYLOAD_TOO_LARGE, traceSiftPayloadTooDeep } from "@mobile-dev/shared/tracesift-explore.ts";
import { captureServerError, recordTraceSiftOperation, recordTraceSiftPayload } from "./telemetry.ts";
import type { TraceSiftClient } from "./tracesift-client.ts";
import { TraceSiftError } from "./tracesift-client.ts";
import { pickProfileFile, pickProjectFolder } from "./profile-picker.ts";

// Async so compressing a large tree does not stall other tool calls.
const gzip = promisify(gzipCallback);
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
// Analysis replaces the latest-input reference; remember replaces the host-view reference.
const persist = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
// Service-backed reads can start a local background process; Explore also opens a browser.
const localService = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const visibility: ("app" | "model")[] = ["app", "model"];
const analysisOutput = {
  apiVersion: z.literal(1), analysisId: z.string(), profileType: z.enum(["cpu", "react"]), title: z.string(),
  summary: z.record(z.string(), z.unknown()), cards: z.array(z.union([traceSiftTaskCardSchema, traceSiftReactCardSchema])),
};

function failure(error: unknown, operation: "analyze" | "remember" | "restore" | "handoff" | "task" | "payload" | "pick" | "project" | "record", startedAt: number, signal: AbortSignal): CallToolResult {
  recordTraceSiftOperation(operation, "failed", performance.now() - startedAt);
  captureServerError(error, `tracesift.${operation}`, { signal });
  return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
}

export function registerTraceSiftTools(server: McpServer, client: TraceSiftClient) {
  registerAppTool(server, "mobile_analyze_profile", {
    title: "Analyze a CPU or React profile with TraceSift",
    description: "Upload a local CPU profile or React DevTools profiling export to the local TraceSift service and render its measured findings as inline cards, each dividing its task between the features it entered, with an Explore view for the call tree and timeline. Use when the user provides a profile path and asks to investigate performance or find a root cause. Set profileType only when the format is known; auto detects supported JSON formats. May start the local TraceSift service, saves analysis files, and replaces the latest analysis reference for this profile input. After rendering, wait for the user to choose Investigate before changing code.",
    inputSchema: traceSiftProfileInputSchema.shape,
    outputSchema: analysisOutput, annotations: persist,
    _meta: { ui: { resourceUri: TRACESIFT_URI, visibility } },
  }, async ({ path, profileType }, context) => {
    const startedAt = performance.now();
    try {
      const analysis = await client.analyze(path, profileType, context.signal,
        (outcome, duration) => recordTraceSiftOperation("ready", outcome, duration));
      recordTraceSiftOperation("analyze", "success", performance.now() - startedAt);
      // Name each card with its ID so the agent can fetch a card's handoff where the card cannot.
      const kind = analysis.profileType === "cpu" ? "task" : "React commit";
      const cards = analysis.cards.map((card, index) => `#${index + 1} (card ${card.id}, ${Math.round(card.durationMs)} ms): ${card.headline}`).join("; ");
      return { content: [{ type: "text", text: `TraceSift found ${analysis.cards.length} ${kind} cards in analysis ${analysis.analysisId}: ${cards}. Show the inline cards and wait for the user to choose Investigate.` }], structuredContent: analysis };
    } catch (error) { return failure(error, "analyze", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_pick_profile_file", {
    title: "Choose a profile file to analyze",
    description: "Open the host's file dialog so the TraceSift panel can choose a local CPU or React profile, and return the chosen path. A panel frame only sees a browser file, which carries no path, so this is how its upload pane reaches `mobile_analyze_profile`. Opens a window and waits for a person; pressing Cancel returns picked false.",
    inputSchema: {},
    outputSchema: { picked: z.boolean(), path: z.string().optional() }, annotations: localService,
    _meta: { ui: { visibility: ["app"] } },
  }, async (_input, context) => {
    const startedAt = performance.now();
    try {
      const chosen = await pickProfileFile();
      recordTraceSiftOperation("pick", "success", performance.now() - startedAt);
      return {
        content: [{ type: "text", text: chosen.picked ? "A profile file was chosen." : "No profile file was chosen." }],
        structuredContent: chosen.picked ? { picked: true, path: chosen.path } : { picked: false },
      };
    } catch (error) { return failure(error, "pick", startedAt, context.signal); }
  });

  // Recording a running app. The web and React Native routes differ in who may
  // drive them, and the difference is the point.
  //
  // Web takes four verbs and is app-only: the recording has to begin after the
  // person has signed in or navigated, the browser outlives the trace so
  // several recordings can come from one sign-in, and a model that started a
  // browser nobody is sitting at would record an empty page.
  //
  // React Native is model-callable, because none of that holds. Nothing is
  // launched, no window opens, and the app is already running in a simulator,
  // emulator or device — so an agent can list, start and stop a recording on
  // its own without control ever leaving the harness.
  registerAppTool(server, "mobile_tracesift_capture_state", {
    title: "Read where a TraceSift recording stands",
    description: "Return whether a recording is running and which app or browser it is attached to, whether a TraceSift-launched Chrome is open, and the trace the last recording wrote. Reads the recorder's own state files and starts nothing, so a reopened panel finds a recording that is still going.",
    inputSchema: {},
    outputSchema: traceSiftCaptureSchema.shape, annotations: read,
    _meta: { ui: { visibility } },
  }, async (_input, context) => {
    const startedAt = performance.now();
    try {
      const state = await client.captureState();
      recordTraceSiftOperation("record", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: state.recording ? "A TraceSift recording is running." : "No TraceSift recording is running." }], structuredContent: state };
    } catch (error) { return failure(error, "record", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_tracesift_launch_browser", {
    title: "Open a web app in a Chrome TraceSift can record",
    description: "Launch Chrome against a throwaway profile with the DevTools Protocol enabled and open the given http or https address, leaving it running. Sign in or navigate there by hand, then start the recording so the trace covers the state you reached. Opens a window on this machine.",
    inputSchema: { url: traceSiftCaptureUrlSchema },
    outputSchema: traceSiftCaptureSchema.shape, annotations: localService,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ url }, context) => {
    const startedAt = performance.now();
    try {
      const state = await client.launchBrowser(url, context.signal);
      recordTraceSiftOperation("record", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: "Chrome is open and ready to record." }], structuredContent: state };
    } catch (error) { return failure(error, "record", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_tracesift_start_recording", {
    title: "Start recording the open browser",
    description: "Begin a Chrome performance trace of whatever the TraceSift-launched browser is already showing, without navigating it. The trace is written as a local file rather than streamed into the running TraceSift, so the panel can analyze it by path. Only one recording runs at a time.",
    inputSchema: {},
    outputSchema: { recording: z.literal(true) }, annotations: localService,
    _meta: { ui: { visibility: ["app"] } },
  }, async (_input, context) => {
    const startedAt = performance.now();
    try {
      await client.startRecording(context.signal);
      recordTraceSiftOperation("record", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: "Recording." }], structuredContent: { recording: true as const } };
    } catch (error) { return failure(error, "record", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_tracesift_stop_recording", {
    title: "Stop recording and keep the trace",
    description: "End the running recording, wait for the trace to be written, and return the file it wrote. Stops whichever recording is running, React Native or Chrome. Pass the returned path to mobile_analyze_profile to read it. A launched browser stays open, so another recording can follow from the same signed-in session.",
    inputSchema: {},
    outputSchema: { path: z.string(), sizeBytes: z.number(), eventCount: z.number() }, annotations: persist,
    _meta: { ui: { visibility } },
  }, async (_input, context) => {
    const startedAt = performance.now();
    try {
      const capture = await client.stopRecording(context.signal);
      recordTraceSiftOperation("record", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: `Recorded ${capture.eventCount.toLocaleString()} events.` }], structuredContent: capture };
    } catch (error) { return failure(error, "record", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_tracesift_close_browser", {
    title: "Close the browser TraceSift launched",
    description: "Quit the Chrome opened for recording and delete the throwaway profile it used. Refuses while a recording is still running. Traces already written are left alone.",
    inputSchema: {},
    outputSchema: { closed: z.literal(true) }, annotations: persist,
    _meta: { ui: { visibility: ["app"] } },
  }, async (_input, context) => {
    const startedAt = performance.now();
    try {
      await client.closeBrowser(context.signal);
      recordTraceSiftOperation("record", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: "The browser is closed." }], structuredContent: { closed: true as const } };
    } catch (error) { return failure(error, "record", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_tracesift_list_react_native_targets", {
    title: "List the React Native apps TraceSift could record",
    description: "Return the React Native apps connected to the Metro dev server, each with the id that names it and which one would be recorded by default. Use before recording to confirm an app is connected, or to pick between several. Reads Metro's inspector and starts nothing; Metro must be running and the app must be a debug build.",
    inputSchema: { metro: traceSiftMetroUrlSchema.optional() },
    outputSchema: traceSiftRnTargetsSchema.shape, annotations: read,
    _meta: { ui: { visibility } },
  }, async ({ metro }, context) => {
    const startedAt = performance.now();
    try {
      const targets = await client.reactNativeTargets(metro, context.signal);
      recordTraceSiftOperation("record", "success", performance.now() - startedAt);
      const text = targets.targets.length
        ? `Metro on ${targets.metro} has ${targets.targets.length} React Native app(s): ${targets.targets.map(target => `${target.title}${target.recommended ? " (default)" : ""} [${target.id}]`).join("; ")}.`
        : `Metro on ${targets.metro} has no React Native app connected to it.`;
      return { content: [{ type: "text", text }], structuredContent: targets };
    } catch (error) { return failure(error, "record", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_tracesift_record_react_native", {
    title: "Start recording a running React Native app",
    description: "Begin a Hermes CPU profile of a React Native app that is already running in a simulator, emulator or device, over the Metro inspector. Nothing is launched and no window opens, so you can drive the recording yourself: start it, exercise the app or ask the user to, then stop it with mobile_tracesift_stop_recording to get the trace. Picks the connected app on its own unless targetId names one; requires Metro to be running and a debug build, and refuses while React Native DevTools is attached or another recording is going.",
    inputSchema: { metro: traceSiftMetroUrlSchema.optional(), targetId: z.string().min(1).max(512).optional() },
    outputSchema: { recording: z.literal(true) }, annotations: localService,
    _meta: { ui: { visibility } },
  }, async ({ metro, targetId }, context) => {
    const startedAt = performance.now();
    try {
      await client.startReactNativeRecording({ metro, targetId }, context.signal);
      recordTraceSiftOperation("record", "success", performance.now() - startedAt);
      return { content: [{ type: "text", text: "Recording. Use the app, then stop the recording." }], structuredContent: { recording: true as const } };
    } catch (error) { return failure(error, "record", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_get_tracesift_project", {
    title: "Read the project TraceSift findings are investigated in",
    description: "Return the source folder a TraceSift investigation should land in, as the panel last chose it. Returns none when nothing is chosen or the saved folder no longer exists.",
    inputSchema: {},
    outputSchema: { path: z.string().optional() }, annotations: read,
    _meta: { ui: { visibility: ["app"] } },
  }, async (_input, context) => {
    const startedAt = performance.now();
    try {
      const path = await client.readProject();
      recordTraceSiftOperation("project", "success", performance.now() - startedAt);
      return {
        content: [{ type: "text", text: path ? "A project folder is chosen." : "No project folder is chosen." }],
        structuredContent: path ? { path } : {},
      };
    } catch (error) { return failure(error, "project", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_pick_tracesift_project", {
    title: "Choose the project TraceSift findings are investigated in",
    description: "Open the host's folder dialog so the TraceSift panel can choose the source folder an investigation should land in, and save that choice. Opens a window and waits for a person; pressing Cancel returns picked false and leaves the saved folder alone. Replaces the previously saved folder.",
    inputSchema: {},
    outputSchema: { picked: z.boolean(), path: z.string().optional() }, annotations: persist,
    _meta: { ui: { visibility: ["app"] } },
  }, async (_input, context) => {
    const startedAt = performance.now();
    try {
      const chosen = await pickProjectFolder();
      // Cancel leaves the saved folder standing, so nothing is written for it.
      const path = chosen.picked ? await client.writeProject(chosen.path) : undefined;
      recordTraceSiftOperation("project", "success", performance.now() - startedAt);
      return {
        content: [{ type: "text", text: path ? "A project folder was chosen." : "No project folder was chosen." }],
        structuredContent: path ? { picked: true, path } : { picked: false },
      };
    } catch (error) { return failure(error, "project", startedAt, context.signal); }
  });

  registerAppTool(server, "mobile_remember_tracesift_analysis", {
    title: "Remember a TraceSift analysis for this card",
    description: "Associate an inline TraceSift card's stable host view with its persisted compact analysis so the card can be restored after Codex restarts. Writes a local reference file, replacing the previous association for this host view.",
    inputSchema: { viewId: z.union([z.string(), z.number()]), analysisId: z.string().min(1).max(256) },
    outputSchema: { remembered: z.literal(true) }, annotations: persist,
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
    description: "Open one CPU task or React commit through `tracesift explore`. May start the local service and opens a browser. This app-only action is called after the user presses Explore; the persisted compact analysis carries the selection while full Explore data stays in TraceSift instead of crossing MCP.",
    inputSchema: {
      analysisId: z.string().min(1).max(256), taskIndex: z.number().int().nonnegative().optional(),
      rootId: z.number().int().nonnegative().optional(), commitIndex: z.number().int().nonnegative().optional(),
      focus: z.string().max(16_384).optional(),
    },
    outputSchema: { opened: z.literal(true) }, annotations: localService,
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
    description: "Return the complete call tree and timeline for one CPU task, or every commit timeline for one React analysis, so the inline card can render the Explore view itself. May start the local TraceSift service. This app-only action is called when the user presses Explore; the payload is large, travels compressed as one text item, and is never read back by the model.",
    inputSchema: {
      analysisId: z.string().min(1).max(256), taskIndex: z.number().int().nonnegative().optional(),
    },
    // Only the envelope is schema-checked; the tree inside is megabytes the explorer validates as it draws.
    outputSchema: traceSiftExploreEnvelopeSchema.shape,
    annotations: localService,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ analysisId, taskIndex }, context) => {
    const startedAt = performance.now();
    try {
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
    description: "Return the authoritative TraceSift investigation handoff for one card of an analysis, by the analysisId and card ID mobile_analyze_profile reports. The inline card calls it when the user presses Investigate; call it yourself only when the user asks to investigate a card the card cannot hand off. May start the local TraceSift service.",
    inputSchema: { analysisId: z.string().min(1).max(256), cardId: z.string().min(1).max(256) },
    outputSchema: traceSiftHandoffSchema.shape, annotations: localService,
    _meta: { ui: { visibility } },
  }, async ({ analysisId, cardId }, context) => {
    const startedAt = performance.now();
    try {
      const handoff = await client.handoff(analysisId, cardId, context.signal);
      recordTraceSiftOperation("handoff", "success", performance.now() - startedAt);
      const structuredContent = { apiVersion: 1 as const, handoff };
      // The handoff is the evidence an investigation starts from; the agent reads it as text.
      return { content: [{ type: "text", text: handoff }], structuredContent };
    } catch (error) { return failure(error, "handoff", startedAt, context.signal); }
  });
}
