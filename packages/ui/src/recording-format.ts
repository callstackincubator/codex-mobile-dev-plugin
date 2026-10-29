import type { PerformanceRecording } from "@mobile-dev/shared/recordings.ts";

export const BYTES_PER_MIB = 1024 * 1024;

export function mebibytes(bytes: number) { return bytes / BYTES_PER_MIB; }
export function seconds(value: number) { return `${value.toFixed(1)}s`; }
export function percent(value: number | null) { return value === null ? "—" : `${value.toFixed(1)}%`; }

const statusLabels: Record<PerformanceRecording["status"], string> = {
  connecting: "Connecting", recording: "Recording", finishing: "Finishing", finished: "Finished", failed: "Failed",
};
export function recordingStatusLabel(status: PerformanceRecording["status"]) { return statusLabels[status]; }
