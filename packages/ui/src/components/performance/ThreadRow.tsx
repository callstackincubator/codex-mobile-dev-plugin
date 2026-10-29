import { memo } from "react";
import type { CpuPoint } from "@mobile-dev/shared/cpu.ts";
import type { ZoomState } from "./types";
import { TRACK_COLORS } from "./constants";
import { PerformanceAreaChart } from "./PerformanceAreaChart";
import { MetricTrack } from "./MetricTrack";
import { formatCpu } from "./cpuSeries";
import { threadLabel } from "./threadLabels";

type ThreadRowProps = {
  threadName: string;
  threadId: string;
  threadNumber: number;
  platform: "ios" | "android";
  data: CpuPoint[];
  running: boolean;
  zoomState: ZoomState;
  onZoomChange: (state: ZoomState) => void;
  onZoomOut: () => void;
  height: number;
};

export const ThreadRow = memo(function ThreadRow({ threadName, threadId, threadNumber, platform, data, running, zoomState, onZoomChange, onZoomOut, height }: ThreadRowProps) {
  const label = threadLabel(threadName, threadNumber, platform);
  const state = running ? "active" : "exited";
  const nativeName = threadName || "(unnamed)";
  const nativeId = platform === "ios" ? `0x${threadId}` : threadId;
  const title = `${label}\nNative name: ${nativeName}\nID: ${nativeId}\nState: ${state}`;
  const usage = formatCpu(data.at(-1)?.value ?? null);
  return <MetricTrack data-cpu-thread={threadId} label={label} title={title} metrics={[{ label: running ? "Current" : "Exited", value: usage }]} height={height} wrapLabel>
    <PerformanceAreaChart data={data} zoomState={zoomState} onZoomChange={onZoomChange} onZoomOut={onZoomOut}
      chartColors={TRACK_COLORS.thread} gradientId={`threadGradient-${threadId}`} tooltipPostfix="%" trackHeight={height} />
  </MetricTrack>;
});
