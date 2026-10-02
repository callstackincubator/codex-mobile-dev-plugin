import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { cpuTargetSchema } from "../shared/cpu.ts";
import type { CpuTarget } from "../shared/cpu.ts";
import { RECORDING_URI, recordingIdSchema, recordingRangeSchema, recordingSchema, summarizeRecording } from "../shared/recordings.ts";
import { errorMessage } from "../shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";
import type { PerformanceRecordings } from "./performance-recordings.ts";
import { displayFrameSchema } from "../shared/display-fps.ts";
import { readRecordingFrames } from "./recording-frames.ts";
import { nullableDisplayFrameStatsSchema } from "../shared/frame-statistics.ts";

const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
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
const pageNumber = z.number();
const pageInteger = pageNumber.int();
const nonnegativePageInteger = pageInteger.nonnegative();
const boundedCursor = nonnegativePageInteger.max(Number.MAX_SAFE_INTEGER);
const frameCursor = boundedCursor.default(0);
const positivePageInteger = pageInteger.min(1);
const boundedFrameLimit = positivePageInteger.max(1000);
const frameLimit = boundedFrameLimit.default(200);
const framePageRange = recordingRangeSchema.optional();
const framePageInput = {
  recordingId: recordingIdSchema, range: framePageRange,
  after: frameCursor, limit: frameLimit,
};
const frameTime = pageNumber.finite();
const recordingDisplayFrameSchema = displayFrameSchema.extend({ time: frameTime });
const recordingDisplayFrames = z.array(recordingDisplayFrameSchema);
const recordingDisplayFramePage = recordingDisplayFrames.max(1000);
const framePageAvailable = z.boolean();
const framePageClock = z.literal("boottime");
const optionalFrameCursor = boundedCursor.optional();

function safe<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try { return await handler(input); }
    catch (error) {
      captureServerError(error, "recording.tool");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  };
}

export function registerRecordingTools(server: McpServer, recordings: PerformanceRecordings,
  validateDevice: (target: CpuTarget) => Promise<string>, workspaceUri: string) {
  registerAppTool(server, "mobile_record_performance", {
    title: "Record CPU, memory, and FPS for a timed run",
    description: "Always record native process/thread CPU, memory, and device-wide Display FPS together, even when the user asks about only one metric. Returns immediately with recording.id and status connecting; wait for status recording before asking the user to perform the interaction. Recording stops automatically after durationSeconds of sampling, detaches both collectors, and saves original samples locally after a brief finishing phase for delayed FPS readings. Uses the same target and device/development prerequisites as mobile_cpu_session; stop any existing CPU monitor for this app and FPS monitor for this device first. FPS requires Android 12+ or physical iOS 17.4+; unsupported or failed FPS is omitted from the chart while CPU and memory still save. Device-wide FPS cannot attribute a slowdown to one app. Use mobile_read_performance_recording to check readiness and completion, then mobile_render_performance_recording to show the interactive chart in chat. 100% CPU is one core. Android memory is RSS; iOS memory is physical footprint.",
    inputSchema: { target: cpuTargetSchema, title: z.string().min(1).max(160), durationSeconds: z.number().int().min(1).max(300).default(30) },
    outputSchema, annotations: { ...read, readOnlyHint: false }, _meta: { ui: { visibility } },
  }, safe(async ({ target, title, durationSeconds }: { target: CpuTarget; title: string; durationSeconds: number }) => {
    const deviceName = await validateDevice(target);
    const recording = recordings.start(target, title, durationSeconds, deviceName);
    const summary = summarizeRecording(recording);
    return { content: [{ type: "text", text: "Connecting the CPU, memory, and FPS collectors. Check recording status before starting the interaction." }], structuredContent: { recording, summary } };
  }));

  const readRecording = safe(async ({ recordingId, range }: z.infer<z.ZodObject<typeof inputSchema>>) => {
    const recording = await recordings.read(recordingId);
    const summary = summarizeRecording(recording, range);
    const structuredContent = { recording, summary, ...(range ? { range } : {}) };
    const text = JSON.stringify(structuredContent);
    return { content: [{ type: "text", text }], structuredContent };
  });
  registerAppTool(server, "mobile_read_performance_recording", {
    title: "Read a saved performance recording or range",
    description: "Read original CPU, memory, FPS and thread samples, status, and summary for a recording ID. Android summary.frameStats includes jankRatePercent over classified presented display frames, classification coverage, separate dropped-frame count/rate, and frame-interval P50/P95/P99 in ms. Unknown jank classifications are excluded from the jank denominator; null means unavailable. Stats cover the entire requested range, not a frame page. Optional range uses recording-relative seconds; CPU/FPS/thread averages weight interval overlap. Android intervals retain exact frameTimeline data; mobile_read_performance_frames provides bounded frame pages. Show mobile_render_performance_recording when reporting jank so the user sees the chart. Device-wide frames cannot attribute a slowdown to one app. Works after plugin restarts.",
    inputSchema, outputSchema, annotations: read, _meta: { ui: { visibility } },
  }, readRecording);
  const readFrames = safe(async ({ recordingId, range, after, limit }: z.infer<z.ZodObject<typeof framePageInput>>) => {
    const recording = await recordings.read(recordingId);
    const data = readRecordingFrames(recording, range, after, limit);
    const text = JSON.stringify(data);
    return { content: [{ type: "text", text }], structuredContent: data };
  });
  registerAppTool(server, "mobile_read_performance_frames", {
    title: "Read Android display frames from a saved recording",
    description: "Read saved Android SurfaceFlinger display frames and frameStats after a run finishes or fails. Stats cover the whole requested range on every page: jankRatePercent over classified presented frames, classification coverage, dropped count/rate, and frame-interval P50/P95/P99 in ms. Unknown classifications are excluded from the jank denominator. Original startTimeNs/endTimeNs and token are decimal strings; device clock is CLOCK_BOOTTIME. presentType: 1 on-time, 2 late, 3 early, 4 dropped, 5 unknown. time aligns to recording-relative seconds through the host readback anchor. range is start-inclusive/end-exclusive; pass nextCursor as after with the same range, limit defaults to 200 and is at most 1000. available=false and frameStats=null mean no per-frame capture, including iOS/older recordings. Show mobile_render_performance_recording with the same range when reporting jank to keep the interactive chart visible. Device-wide data cannot attribute jank to an app.",
    inputSchema: framePageInput,
    outputSchema: {
      recordingId: recordingIdSchema, available: framePageAvailable, clock: framePageClock,
      frameCount: nonnegativePageInteger, frames: recordingDisplayFramePage,
      frameStats: nullableDisplayFrameStatsSchema,
      nextCursor: optionalFrameCursor,
    },
    annotations: read, _meta: { ui: { visibility } },
  }, readFrames);
  registerAppTool(server, "mobile_render_performance_recording", {
    title: "Show an interactive performance chart in chat",
    description: "Show a saved CPU/memory/FPS recording as an inline interactive chart with shared drag selection, thread breakdown, Ask and Open in Mobile Dev. Android frame data adds jank rate, classification coverage, dropped frames and frame-interval P50/P95/P99, updating with the selected range. Call this when reporting scrolling FPS/jank or comparing implementations so the user sees the chart alongside the analysis. The full timeline stays visible; automatic change highlights do not select or limit a range. Omit range unless the user requested a selection. Pass recording.id from mobile_record_performance or mobile_list_performance_recordings. Active runs update until finished. Data tools return measurements without rendering a chart.",
    inputSchema, outputSchema, annotations: read, _meta: { ui: { resourceUri: RECORDING_URI, visibility } },
  }, readRecording);
  registerAppTool(server, "mobile_open_performance_recording", {
    title: "Open a recording in Mobile Dev",
    description: "Open the saved recording and selected time range in the Mobile Dev workspace. Does not start a live performance collector or boot a device.",
    inputSchema, outputSchema, annotations: read, _meta: { ui: { resourceUri: workspaceUri, visibility } },
  }, readRecording);
  registerAppTool(server, "mobile_finish_performance_recording", {
    title: "Finish and save a performance recording early",
    description: "Stop the recording and save its CPU, memory, and FPS samples after delayed FPS readback finishes. Leaves the monitored app running. Timed recordings finish automatically; use this to stop early.",
    inputSchema: { recordingId: recordingIdSchema }, outputSchema, annotations: { ...read, readOnlyHint: false }, _meta: { ui: { visibility } },
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
    const text = JSON.stringify({ recordings: items });
    return { content: [{ type: "text", text }], structuredContent: { recordings: items } };
  }));
}
