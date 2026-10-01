import { useMemo } from "react";
import { GaugeIcon } from "lucide-react";
import type { CpuPhase } from "../../../shared/cpu";
import type { DisplayFpsSample } from "../../../shared/display-fps";
import type { ZoomState } from "../../performance/types";
import { TRACK_HEIGHT } from "../../performance/constants";
import { PerformanceAreaChart } from "./PerformanceAreaChart";
import { TrackLabel } from "./TrackLabel";
import { CursorIndicator } from "./CursorIndicator";
import { createFpsSeries } from "./fpsSeries";

const colors = { stroke: "#22c55e", fillStart: "#22c55e", fillEnd: "#166534" };
type Props = {
  samples: DisplayFpsSample[]; phase: CpuPhase; error: string; supported: boolean; platform: "ios" | "android";
  zoomState: ZoomState; onZoomChange: (state: ZoomState) => void; onZoomOut: () => void; onRetry: () => void;
};
function format(value: number | null) { return value === null ? "—" : value.toFixed(1); }

export function DisplayFpsTrack({ samples, phase, error, supported, platform, zoomState, onZoomChange, onZoomOut, onRetry }: Props) {
  const series = useMemo(() => createFpsSeries(samples), [samples]);
  const current = format(phase === "failed" ? null : series.current);
  const average = format(series.average);
  const maximum = format(series.maximum);
  const minimum = format(series.minimum);
  const metrics = [
    { label: "Current", value: current },
    { label: "Avg / Max", value: `${average} / ${maximum}` },
    { label: "Min", value: minimum },
  ];
  let message = "Start monitoring to measure display updates.";
  if (supported === false) message = "Display FPS requires a physical iOS paired device.";
  else if (phase === "connecting") message = "Connecting to the display counters…";
  else if (phase === "recording") message = "Waiting for a complete FPS interval…";
  if (error) message = error;
  const showMessage = series.current === null || phase === "failed";
  const source = platform === "android" ? "FrameTimeline actual display frames; delayed frames update their original interval." : "Core Animation display counter. Physical iOS 17.4+ paired devices.";
  const title = `${source} Includes all apps and system UI. Quiet screens can report zero. FPS measures updates, not refresh rate; it cannot identify the cause of a drop.`;
  return <div role="region" aria-label="Display FPS" className="group flex flex-row" style={{ height: TRACK_HEIGHT }}>
    <TrackLabel label="Display FPS" icon={<GaugeIcon className="size-4 text-green-500" />} metrics={metrics} title={title} />
    <div className="relative h-full min-w-0 flex-1 border-b border-border">
      <PerformanceAreaChart data={series.data} zoomState={zoomState} onZoomChange={onZoomChange} onZoomOut={onZoomOut}
        chartColors={colors} gradientId="displayFpsGradient" tooltipPostfix="FPS" />
      {showMessage && <div role={error ? "alert" : "status"} className="absolute inset-0 flex items-center justify-center gap-2 bg-background/90 px-4 text-xs text-muted-foreground">
        <span>{message}</span>{phase === "failed" && <button className="shrink-0 text-green-500" onClick={onRetry}>Retry FPS</button>}
      </div>}
      <CursorIndicator />
    </div>
  </div>;
}
