import { useMemo } from "react";
import { DatabaseIcon } from "lucide-react";
import type { CpuPhase, CpuSample } from "../../../shared/cpu";
import type { ZoomState } from "../../performance/types";
import { MEMORY_COLORS, TRACK_HEIGHT } from "../../performance/constants";
import { PerformanceAreaChart } from "./PerformanceAreaChart";
import { TrackLabel } from "./TrackLabel";
import { CursorIndicator } from "./CursorIndicator";
import { createMemorySeries, formatMemory } from "./memorySeries";

type MemoryTrackProps = {
  samples: CpuSample[];
  platform: "ios" | "android";
  phase: CpuPhase;
  error: string | null;
  cursorX: number | null;
  viewDuration: number;
  zoomState: ZoomState;
  onZoomChange: (state: ZoomState) => void;
  onZoomOut: () => void;
};

export function MemoryTrack({ samples, platform, phase, error, cursorX, viewDuration, zoomState, onZoomChange, onZoomOut }: MemoryTrackProps) {
  const series = useMemo(() => createMemorySeries(samples), [samples]);
  const current = formatMemory(series.current);
  const average = series.average === null ? "—" : series.average.toFixed(1);
  const maximum = formatMemory(series.maximum);
  const minimum = formatMemory(series.minimum);
  const metrics = [
    { label: "Current", value: current },
    { label: "Avg / Max", value: `${average} / ${maximum}` },
    { label: "Min", value: minimum },
  ];
  const title = platform === "android"
    ? "Main process memory: RSS (resident set size). Shared resident pages are counted in full. 1 MiB = 1,048,576 bytes."
    : "Main process memory: physical footprint, including compressed memory. 1 MiB = 1,048,576 bytes.";
  let message = "Open an app on the selected device to measure memory.";
  if (phase === "connecting") message = "Connecting to the app’s memory counters…";
  else if (phase === "recording") message = "Measuring memory usage…";
  if (error) message = error;
  const showMessage = series.current === null || phase === "failed";

  return <div role="region" aria-label="Memory usage" className="group flex flex-row overflow-hidden" style={{ height: TRACK_HEIGHT }}>
    <TrackLabel label="Memory" icon={<DatabaseIcon className="size-4 text-orange-500" />} metrics={metrics} title={title} />
    <div className="min-w-0 flex-1 h-full relative border-b border-border">
      <PerformanceAreaChart data={series.data} viewDuration={viewDuration} zoomState={zoomState}
        onZoomChange={onZoomChange} onZoomOut={onZoomOut} chartColors={MEMORY_COLORS}
        gradientId="memoryGradient" tooltipPostfix="MiB" />
      {showMessage && <div role={error ? "alert" : "status"} className="absolute inset-0 flex items-center justify-center px-4 text-xs text-muted-foreground bg-background/90">{message}</div>}
      <CursorIndicator cursorX={cursorX} />
    </div>
  </div>;
}
