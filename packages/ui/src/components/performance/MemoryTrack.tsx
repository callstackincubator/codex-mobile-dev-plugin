import { useMemo } from "react";
import { DatabaseIcon } from "lucide-react";
import type { CpuPhase, CpuSample } from "@mobile-dev/shared/cpu.ts";
import type { ZoomState } from "./types";
import { TRACK_COLORS } from "./constants";
import { PerformanceAreaChart } from "./PerformanceAreaChart";
import { MetricTrack, summaryMetrics, trackMessage } from "./MetricTrack";
import { createMemorySeries, formatMemory } from "./memorySeries";

type MemoryTrackProps = {
  samples: CpuSample[];
  platform: "ios" | "android";
  phase: CpuPhase;
  error: string | null;
  zoomState: ZoomState;
  onZoomChange: (state: ZoomState) => void;
  onZoomOut: () => void;
};

const copy = { idle: "Open an app on the selected device to measure memory.", connecting: "Connecting to the app’s memory counters…", recording: "Measuring memory usage…" };

export function MemoryTrack({ samples, platform, phase, error, zoomState, onZoomChange, onZoomOut }: MemoryTrackProps) {
  const series = useMemo(() => createMemorySeries(samples), [samples]);
  const average = series.average === null ? "—" : series.average.toFixed(1);
  const metrics = summaryMetrics({ current: formatMemory(series.current), average, maximum: formatMemory(series.maximum) }, { label: "Min", value: formatMemory(series.minimum) });
  const title = platform === "android"
    ? "Main process memory: RSS (resident set size). Shared resident pages are counted in full. 1 MiB = 1,048,576 bytes."
    : "Main process memory: physical footprint, including compressed memory. 1 MiB = 1,048,576 bytes.";
  const showMessage = series.current === null || phase === "failed";

  return <MetricTrack role="region" aria-label="Memory usage" label="Memory" icon={<DatabaseIcon className="size-4 text-orange-500" />} metrics={metrics} title={title}
    message={showMessage ? trackMessage(phase, copy, error) : undefined} alert={Boolean(error)}>
    <PerformanceAreaChart data={series.data} zoomState={zoomState}
      onZoomChange={onZoomChange} onZoomOut={onZoomOut} chartColors={TRACK_COLORS.memory}
      gradientId="memoryGradient" tooltipPostfix="MiB" />
  </MetricTrack>;
}
