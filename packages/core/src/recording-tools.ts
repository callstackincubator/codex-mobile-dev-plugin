import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerRequestContext } from "./request-session.ts";
import { z } from "zod";
import { cpuTargetSchema } from "@mobile-dev/shared/cpu.ts";
import type { CpuTarget } from "@mobile-dev/shared/cpu.ts";
import { RECORDING_URI, recordingIdSchema, recordingPreview, recordingRangeSchema, recordingReferenceSchema, recordingSchema, summarizeRecording } from "@mobile-dev/shared/recordings.ts";
import type { PerformanceRecording, RecordingRange } from "@mobile-dev/shared/recordings.ts";
import type { PerformanceRecordings } from "./performance-recordings.ts";
import type { DeviceResolver } from "./devices.ts";
import { displayFrameSchema } from "@mobile-dev/shared/display-fps.ts";
import { readRecordingFrames } from "./recording-frames.ts";
import { nullableDisplayFrameStatsSchema } from "@mobile-dev/shared/frame-statistics.ts";
import { guarded, jsonResult, READ_ONLY as read, WRITES } from "./tool-results.ts";
import { COMPARISON_URI, comparisonIdsSchema, comparisonReferenceSchema, comparisonSchema, comparisonTitleSchema, summarizeComparison } from "@mobile-dev/shared/performance-comparison.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";

const visibility: ("app" | "model")[] = ["app", "model"];
const inputSchema = { recordingId: recordingIdSchema, range: recordingRangeSchema.optional() };
const summarySchema = z.object({
  peakCpuPercent: z.number().nullable(), averageCpuPercent: z.number().nullable(),
  firstMemoryBytes: z.number().nullable(), lastMemoryBytes: z.number().nullable(), memoryChangeBytes: z.number().nullable(),
  averageFps: z.number().nullable(), minimumFps: z.number().nullable(), peakFps: z.number().nullable(), fpsSampleCount: z.number(),
  frameStats: nullableDisplayFrameStatsSchema,
  sampleCount: z.number(), threads: z.array(z.object({ id: z.string(), name: z.string(), averageCpuPercent: z.number(), peakCpuPercent: z.number() })),
});
const outputSchema = { recording: recordingSchema, summary: summarySchema, range: recordingRangeSchema.optional() };
// Tools that show a recording return its identity, summary and a preview; the card reads the full samples.
const referenceOutputSchema = { ...recordingReferenceSchema.shape, summary: summarySchema };
type RecordingSummary = ReturnType<typeof summarizeRecording>;
// Codex keeps about 50 KB of a tool result and turns larger ones into truncated text
// without their structured content. Results that show a recording stay under this.
export const RESULT_BYTES = 45_000;

/** The result with `extra` in its structured content when the whole result still fits every host. */
function withinResultBytes(result: CallToolResult & { structuredContent: Record<string, unknown> }, extra: Record<string, unknown>): CallToolResult {
  const extended = { ...result, structuredContent: { ...result.structuredContent, ...extra } };
  return Buffer.byteLength(JSON.stringify(extended)) <= RESULT_BYTES ? extended : result;
}

const percent = (value: number) => `${value.toFixed(1)}%`;
// Apps can run hundreds of threads; the agent gets the busiest, the card computes its own.
const REFERENCE_THREADS = 10;
const busiest = (summary: RecordingSummary) => ({ ...summary, threads: summary.threads.slice(0, REFERENCE_THREADS) });
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** One line of measured numbers for the model, in place of the samples the card shows. */
function describeMeasurements(summary: RecordingSummary) {
  const parts: string[] = [];
  if (summary.averageCpuPercent !== null && summary.peakCpuPercent !== null) parts.push(`CPU average ${percent(summary.averageCpuPercent)}, peak ${percent(summary.peakCpuPercent)} (100% is one core)`);
  if (summary.firstMemoryBytes !== null && summary.lastMemoryBytes !== null) {
    const change = summary.memoryChangeBytes ?? summary.lastMemoryBytes - summary.firstMemoryBytes;
    parts.push(`memory ${megabytes(summary.firstMemoryBytes)} to ${megabytes(summary.lastMemoryBytes)} (${change >= 0 ? "+" : "-"}${megabytes(Math.abs(change))})`);
  }
  if (summary.averageFps !== null) parts.push(`Display FPS average ${summary.averageFps.toFixed(1)}${summary.minimumFps === null ? "" : `, minimum ${summary.minimumFps.toFixed(1)}`}`);
  if (summary.frameStats?.jankRatePercent != null) parts.push(`jank rate ${percent(summary.frameStats.jankRatePercent)}`);
  const threads = summary.threads.slice(0, 3).map(thread => `${thread.name || `thread ${thread.id}`} ${percent(thread.averageCpuPercent)}`);
  if (threads.length > 0) parts.push(`busiest threads ${threads.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "no samples yet";
}

function describeRecording(recording: PerformanceRecording, summary: RecordingSummary, range?: RecordingRange) {
  const span = range ? `${range.start}–${range.end}s of ` : "";
  return `Showing ${span}“${recording.title}” (${recording.status}, ${recording.durationSeconds}s on ${recording.deviceName}, ${summary.sampleCount} samples) in an interactive chart. `
    + `${describeMeasurements(summary)}. The chart reads the samples itself; for sample-level detail call mobile_read_performance_recording with recordingId ${recording.id}.`;
}
const frameCursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const framePageInput = {
  recordingId: recordingIdSchema, range: recordingRangeSchema.optional(),
  after: frameCursor.default(0), limit: z.number().int().min(1).max(1000).default(200),
};
const safe = <T>(handler: (input: T) => Promise<CallToolResult>) => guarded("recording.tool", handler);

/** Shows a saved recording, as the chart card and the workspace do. */
export type ShowRecording = (input: z.infer<z.ZodObject<typeof inputSchema>>, context: ServerRequestContext) => Promise<CallToolResult>;

/** Registers the recording tools; returns the handler that shows a recording, for the workspace's own tool. */
export function registerRecordingTools(server: McpServer, recordings: PerformanceRecordings, devices: Pick<DeviceResolver, "resolve">): ShowRecording {
  registerAppTool(server, "mobile_record_performance", {
    title: "Record CPU, memory, and FPS for a timed run",
    description: "Always record native process/thread CPU, memory, and device-wide Display FPS together, even when the user asks about only one metric. Returns immediately with recording.id and status connecting; wait for status recording before asking the user to perform the interaction. Recording stops automatically after durationSeconds of sampling, detaches both collectors, and saves original samples locally after a brief finishing phase for delayed FPS readings. Uses the same target and device/development prerequisites as mobile_cpu_session; stop any existing CPU monitor for this app and FPS monitor for this device first. FPS requires Android 12+ or physical iOS 17.4+; unsupported or failed FPS is omitted from the chart while CPU and memory still save. Device-wide FPS cannot attribute a slowdown to one app. Use mobile_read_performance_recording to check readiness and completion, then mobile_render_performance_recording to show the interactive chart in chat. 100% CPU is one core. Android memory is RSS; iOS memory is physical footprint.",
    inputSchema: { target: cpuTargetSchema, title: z.string().min(1).max(160), durationSeconds: z.number().int().min(1).max(300).default(30) },
    outputSchema, annotations: WRITES, _meta: { ui: { visibility } },
  }, safe(async ({ target, title, durationSeconds }: { target: CpuTarget; title: string; durationSeconds: number }) => {
    const device = await devices.resolve(target, "cpu");
    const recording = recordings.start(target, title, durationSeconds, device.name);
    const summary = summarizeRecording(recording);
    return { content: [{ type: "text", text: "Connecting the CPU, memory, and FPS collectors. Check recording status before starting the interaction." }], structuredContent: { recording, summary } };
  }));

  const readRecording = safe(async ({ recordingId, range }: z.infer<z.ZodObject<typeof inputSchema>>) => {
    const recording = await recordings.read(recordingId);
    const summary = summarizeRecording(recording, range);
    return jsonResult({ recording, summary, ...(range ? { range } : {}) });
  });
  registerAppTool(server, "mobile_read_performance_recording", {
    title: "Read a saved performance recording or range",
    description: "Read original CPU, memory, FPS and thread samples, status, and summary for a recording ID. Android summary.frameStats includes jankRatePercent over classified presented display frames, classification coverage, separate dropped-frame count/rate, and frame-interval P50/P95/P99 in ms. Unknown jank classifications are excluded from the jank denominator; null means unavailable. Stats cover the entire requested range, not a frame page. Optional range uses recording-relative seconds; CPU/FPS/thread averages weight interval overlap. Android intervals retain exact frameTimeline data; mobile_read_performance_frames provides bounded frame pages. Show mobile_render_performance_recording when reporting jank so the user sees the chart. Device-wide frames cannot attribute a slowdown to one app. Works after plugin restarts.",
    inputSchema, outputSchema, annotations: read, _meta: { ui: { visibility } },
  }, readRecording);
  const readFrames = safe(async ({ recordingId, range, after, limit }: z.infer<z.ZodObject<typeof framePageInput>>) => {
    const recording = await recordings.read(recordingId);
    return jsonResult(readRecordingFrames(recording, range, after, limit));
  });
  registerAppTool(server, "mobile_read_performance_frames", {
    title: "Read Android display frames from a saved recording",
    description: "Read saved Android SurfaceFlinger display frames and frameStats after a run finishes or fails. Stats cover the whole requested range on every page: jankRatePercent over classified presented frames, classification coverage, dropped count/rate, and frame-interval P50/P95/P99 in ms. Unknown classifications are excluded from the jank denominator. Original startTimeNs/endTimeNs and token are decimal strings; device clock is CLOCK_BOOTTIME. presentType: 1 on-time, 2 late, 3 early, 4 dropped, 5 unknown. time aligns to recording-relative seconds through the host readback anchor. range is start-inclusive/end-exclusive; pass nextCursor as after with the same range, limit defaults to 200 and is at most 1000. available=false and frameStats=null mean no per-frame capture, including iOS/older recordings. Show mobile_render_performance_recording with the same range when reporting jank to keep the interactive chart visible. Device-wide data cannot attribute jank to an app.",
    inputSchema: framePageInput,
    outputSchema: {
      recordingId: recordingIdSchema, available: z.boolean(), clock: z.literal("boottime"),
      frameCount: z.number().int().nonnegative(), frames: z.array(displayFrameSchema.extend({ time: z.number().finite() })).max(1000),
      frameStats: nullableDisplayFrameStatsSchema,
      nextCursor: frameCursor.optional(),
    },
    annotations: read, _meta: { ui: { visibility } },
  }, readFrames);
  const showRecording: ShowRecording = safe(async ({ recordingId, range }: Parameters<ShowRecording>[0]) => {
    const recording = await recordings.read(recordingId);
    const summary = summarizeRecording(recording, range);
    const structuredContent = {
      recordingId: recording.id, title: recording.title, status: recording.status, durationSeconds: recording.durationSeconds,
      ...(range ? { range } : {}), summary: busiest(summary),
    };
    const result = { content: [{ type: "text" as const, text: describeRecording(recording, summary, range) }], structuredContent };
    return withinResultBytes(result, { preview: recordingPreview(recording) });
  });
  registerAppTool(server, "mobile_render_performance_recording", {
    title: "Show an interactive performance chart in chat",
    description: "Show a saved CPU/memory/FPS recording as an inline interactive chart with shared drag selection, thread breakdown and Ask. Android frame data adds jank rate, classification coverage, dropped frames and frame-interval P50/P95/P99, updating with the selected range. Call this when reporting scrolling FPS/jank or comparing implementations so the user sees the chart alongside the analysis. The full timeline stays visible; automatic change highlights do not select or limit a range. Omit range unless the user requested a selection. Pass recording.id from mobile_record_performance or mobile_list_performance_recordings. Active runs update until finished. Data tools return measurements without rendering a chart. Returns the recording ID and summary numbers; the chart reads the samples itself, so use mobile_read_performance_recording for sample-level detail.",
    inputSchema, outputSchema: referenceOutputSchema, annotations: read, _meta: { ui: { resourceUri: RECORDING_URI, visibility } },
  }, showRecording);
  const comparisonInput = {
    recordingIds: comparisonIdsSchema,
    title: comparisonTitleSchema.default("Performance comparison"),
    range: recordingRangeSchema.optional(),
  };
  const comparisonSummaries = z.array(z.object({ recordingId: recordingIdSchema, range: recordingRangeSchema.nullable(), summary: summarySchema.nullable() }));
  registerAppTool(server, "mobile_compare_performance_recordings", {
    title: "Compare performance runs in an inline overlay chart",
    description: "Overlay 2–6 distinct completed CPU, memory and FPS recordings in chat, aligned at recording start in elapsed seconds. Pass recordingIds from mobile_list_performance_recordings, an optional title and shared range. Finish active runs first. The interactive card has a color per run, visibility toggles, shared range selection and per-run summaries. Different durations retain their original time scale; missing data stays gaps. Android RSS and iOS physical footprint use separate memory tracks. Device-wide FPS cannot attribute changes to one app. Returns original recordings and interval-weighted summaries, clipped to each run's duration; a run outside the range has a null summary. Use this tool when comparing runs or implementations so the user sees their timelines together. Returns per-run summaries and recording IDs; the chart reads the samples itself.",
    inputSchema: comparisonInput,
    outputSchema: { ...comparisonReferenceSchema.shape, summaries: comparisonSummaries },
    annotations: read, _meta: { ui: { resourceUri: COMPARISON_URI, visibility } },
  }, safe(async ({ recordingIds, title, range }: z.infer<z.ZodObject<typeof comparisonInput>>) => {
    const runs = await Promise.all(recordingIds.map(id => recordings.read(id)));
    // Validate the runs here so the card only fails on reading them, not on comparing them.
    const comparison = comparisonSchema.parse({ title, recordings: runs, range });
    const summaries = summarizeComparison(comparison.recordings, comparison.range);
    const structuredContent = {
      title: comparison.title, recordingIds, ...(comparison.range ? { range: comparison.range } : {}),
      summaries: summaries.map(entry => ({ ...entry, summary: entry.summary && busiest(entry.summary) })),
    };
    const lines = comparison.recordings.map((recording, index) => {
      const summary = summaries[index].summary;
      return `${index + 1}. “${recording.title}” (${recording.durationSeconds}s on ${recording.deviceName}): ${summary ? describeMeasurements(summary) : "no samples in the range"}`;
    });
    const text = `Showing “${comparison.title}”, ${comparison.recordings.length} runs aligned at recording start, in an interactive overlay chart. `
      + `${lines.join(" ")} The chart reads the samples itself; for sample-level detail call mobile_read_performance_recording with each recordingId.`;
    return withinResultBytes({ content: [{ type: "text", text }], structuredContent }, { previews: comparison.recordings.map(recordingPreview) });
  }));
  registerAppTool(server, "mobile_finish_performance_recording", {
    title: "Finish and save a performance recording early",
    description: "Stop the recording and save its CPU, memory, and FPS samples after delayed FPS readback finishes. Leaves the monitored app running. Timed recordings finish automatically; use this to stop early.",
    inputSchema: { recordingId: recordingIdSchema }, outputSchema, annotations: WRITES, _meta: { ui: { visibility } },
  }, safe(async ({ recordingId }: { recordingId: string }) => {
    const recording = await recordings.finish(recordingId);
    const summary = summarizeRecording(recording);
    return { content: [{ type: "text", text: `Recording ${recording.status}.` }], structuredContent: { recording, summary } };
  }));
  registerAppTool(server, "mobile_list_performance_recordings", {
    title: "List saved performance recordings",
    description: "List recent local saved and active CPU/memory/FPS runs without returning samples. Use their IDs to read, render, or open a recording.",
    inputSchema: { limit: z.number().int().min(1).max(50).default(20) }, annotations: read, _meta: { ui: { visibility } },
  }, safe(async ({ limit }: { limit: number }) => {
    const recordingsList = await recordings.list(limit);
    const items = recordingsList.map(({ samples, fps, ...metadata }) => ({
      ...metadata, sampleCount: samples.length, fps: { status: fps.status, error: fps.error, sampleCount: fps.samples.length },
    }));
    return jsonResult({ recordings: items });
  }));
  return showRecording;
}

/** Opens a saved recording in Mobile Dev's workspace; the panel registers it with its page. */
export function registerOpenRecordingTool(server: McpServer, showRecording: ShowRecording, workspaceUri: string) {
  registerAppTool(server, "mobile_open_performance_recording", {
    title: "Open a recording in Mobile Dev",
    description: "Open the saved recording and selected time range in the Mobile Dev workspace. Does not start a live performance collector or boot a device.",
    inputSchema, outputSchema: referenceOutputSchema, annotations: read, _meta: { ui: { resourceUri: workspaceUri, visibility } },
  }, showRecording);
}
