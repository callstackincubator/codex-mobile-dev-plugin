import { recordingSchema } from "@mobile-dev/shared/recordings.ts";
import type { PerformanceRecording } from "@mobile-dev/shared/recordings.ts";
import type { HostBridge } from "./host-bridge.ts";
import { callTool } from "./tool-call.ts";

/** The host dropped the recording's samples, as hosts that cap tool results do with long ones. */
export class RecordingTrimmedError extends Error {}

/** Reads a saved recording with all its samples, threads and frames. A server that cannot read it throws ToolCallError with its explanation. */
export async function readRecording(app: HostBridge, recordingId: string, signal: AbortSignal): Promise<PerformanceRecording> {
  const result = await callTool(app, { name: "mobile_read_performance_recording", arguments: { recordingId } }, { signal, fallback: "Could not read the recording." });
  const recording = result.structuredContent?.recording;
  if (recording === undefined) throw new RecordingTrimmedError("The host returned the recording without its samples.");
  return recordingSchema.parse(recording);
}
