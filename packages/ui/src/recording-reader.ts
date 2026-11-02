import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { recordingSchema } from "@mobile-dev/shared/recordings.ts";
import type { PerformanceRecording } from "@mobile-dev/shared/recordings.ts";
import type { HostBridge } from "./host-bridge.ts";

export function toolResultText(result: CallToolResult): string {
  return result.content.flatMap(item => item.type === "text" ? [item.text] : []).join("\n");
}

/** The server could not read the recording; the message is its explanation. */
export class RecordingReadError extends Error {}

/** The host dropped the recording's samples, as hosts that cap tool results do with long ones. */
export class RecordingTrimmedError extends Error {}

/** Reads a saved recording with all its samples, threads and frames. */
export async function readRecording(app: HostBridge, recordingId: string, signal: AbortSignal): Promise<PerformanceRecording> {
  const result = await app.callServerTool({ name: "mobile_read_performance_recording", arguments: { recordingId } }, { signal });
  if (result.isError) throw new RecordingReadError(toolResultText(result) || "Could not read the recording.");
  const recording = result.structuredContent?.recording;
  if (recording === undefined) throw new RecordingTrimmedError("The host returned the recording without its samples.");
  return recordingSchema.parse(recording);
}
