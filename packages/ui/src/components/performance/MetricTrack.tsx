import type { ComponentProps, ReactNode } from "react";
import type { CpuPhase } from "@mobile-dev/shared/cpu.ts";
import { TRACK_HEIGHT } from "./constants";
import { CursorIndicator } from "./CursorIndicator";
import { TrackLabel } from "./TrackLabel";

type Metric = { label: string; value: string };

/** Current, average / maximum, then one track-specific metric. */
export function summaryMetrics({ current, average, maximum }: { current: string; average: string; maximum: string }, last: Metric): Metric[] {
  return [{ label: "Current", value: current }, { label: "Avg / Max", value: `${average} / ${maximum}` }, last];
}

/** What a track says before it has readings to chart. */
export type TrackCopy = { idle: string; connecting: string; recording?: string };

/** The message for `phase`; an error always wins. */
export function trackMessage(phase: CpuPhase, copy: TrackCopy, error?: string | null) {
  if (error) return error;
  if (phase === "connecting") return copy.connecting;
  if (phase === "recording" && copy.recording !== undefined) return copy.recording;
  return copy.idle;
}

/**
 * One row of the live timeline: the sticky label with its metrics, and the chart.
 * `message` covers the chart, such as before the first readings.
 */
export function MetricTrack({ label, icon, title, metrics, message, alert = false, action, height = TRACK_HEIGHT, wrapLabel, expanded, onToggle, children, ...props }: Omit<ComponentProps<"div">, "title" | "className" | "style"> & {
  label: string; icon?: ReactNode; title: string; metrics: Metric[];
  message?: string; alert?: boolean; action?: ReactNode;
  height?: number; wrapLabel?: boolean; expanded?: boolean; onToggle?: () => void;
}) {
  return <div {...props} className="group flex flex-row" style={{ height }}>
    <TrackLabel label={label} icon={icon} metrics={metrics} title={title} wrapLabel={wrapLabel} isExpanded={expanded} onToggle={onToggle} />
    <div className="relative h-full min-w-0 flex-1 border-b border-border">
      {children}
      {message !== undefined && <div role={alert ? "alert" : "status"} className="absolute inset-0 flex items-center justify-center gap-2 bg-background/90 px-4 text-xs text-muted-foreground">
        <span>{message}</span>{action}
      </div>}
      <CursorIndicator />
    </div>
  </div>;
}
