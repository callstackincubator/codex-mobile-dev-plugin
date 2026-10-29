import { useMemo } from "react";
import { GaugeIcon } from "lucide-react";
import type { CpuPhase } from "@mobile-dev/shared/cpu.ts";
import type { DisplayFpsSample } from "@mobile-dev/shared/display-fps.ts";
import type { ZoomState } from "./types";
import { TRACK_COLORS } from "./constants";
import { PerformanceAreaChart } from "./PerformanceAreaChart";
import { MetricTrack, summaryMetrics, trackMessage } from "./MetricTrack";
import { createFpsSeries } from "./fpsSeries";

type Props = {
  samples: DisplayFpsSample[]; phase: CpuPhase; error: string; supported: boolean; platform: "ios" | "android";
  zoomState: ZoomState; onZoomChange: (state: ZoomState) => void; onZoomOut: () => void; onRetry: () => void;
};
function format(value: number | null) { return value === null ? "—" : value.toFixed(1); }
const copy = { idle: "Start monitoring to measure display updates.", connecting: "Connecting to the display counters…", recording: "Waiting for a complete FPS interval…" };
const unsupportedCopy = { ...copy, idle: "Display FPS requires a physical iOS paired device." };

export function DisplayFpsTrack({ samples, phase, error, supported, platform, zoomState, onZoomChange, onZoomOut, onRetry }: Props) {
  const series = useMemo(() => createFpsSeries(samples), [samples]);
  const metrics = summaryMetrics({ current: format(phase === "failed" ? null : series.current), average: format(series.average), maximum: format(series.maximum) },
    { label: "Min", value: format(series.minimum) });
  // Unsupported devices say so whatever the phase; only an error replaces it.
  const message = supported ? trackMessage(phase, copy, error) : trackMessage("idle", unsupportedCopy, error);
  const showMessage = series.current === null || phase === "failed";
  const source = platform === "android" ? "FrameTimeline actual display frames; delayed frames update their original interval." : "Core Animation display counter. Physical iOS 17.4+ paired devices.";
  const title = `${source} Includes all apps and system UI. Quiet screens can report zero. FPS measures updates, not refresh rate; it cannot identify the cause of a drop.`;
  return <MetricTrack role="region" aria-label="Display FPS" label="Display FPS" icon={<GaugeIcon className="size-4 text-green-500" />} metrics={metrics} title={title}
    message={showMessage ? message : undefined} alert={Boolean(error)}
    action={phase === "failed" && <button className="shrink-0 text-green-500" onClick={onRetry}>Retry FPS</button>}>
    <PerformanceAreaChart data={series.data} zoomState={zoomState} onZoomChange={onZoomChange} onZoomOut={onZoomOut}
      chartColors={TRACK_COLORS.fps} gradientId="displayFpsGradient" tooltipPostfix="FPS" curveType="linear" />
  </MetricTrack>;
}
