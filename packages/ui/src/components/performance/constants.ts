export const LIVE_VIEW_DURATION = 30;
export const TRACK_HEIGHT = 90;
export const TIMELINE_HEIGHT = 25;
export const SIDEBAR_WIDTH = 170;
export const CHART_RIGHT_PADDING = 12;
export const CHART_MARGIN = { top: 0, right: CHART_RIGHT_PADDING, bottom: 0, left: 0 };
export const COLORS = { gridLine: "var(--border)", selectionOverlay: "#3b82f6", timeLabel: "var(--muted-foreground)" };

/** An area chart's line and the top and bottom of its fill gradient. */
export type ChartColors = { stroke: string; fillStart: string; fillEnd: string };
export const TRACK_COLORS = {
  cpu: { stroke: "#3b82f6", fillStart: "#3b82f6", fillEnd: "#3b82f6" },
  thread: { stroke: "#6b7280", fillStart: "#6b7280", fillEnd: "#6b7280" },
  memory: { stroke: "#f97316", fillStart: "#f97316", fillEnd: "#f97316" },
  fps: { stroke: "#22c55e", fillStart: "#22c55e", fillEnd: "#166534" },
} satisfies Record<string, ChartColors>;
