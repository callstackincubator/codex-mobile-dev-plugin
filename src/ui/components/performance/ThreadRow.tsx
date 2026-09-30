import { memo } from 'react';
import type { ZoomState } from '../../performance/types';
import { PerformanceAreaChart } from './PerformanceAreaChart';
import { THREAD_COLORS } from '../../performance/constants';
import type { CpuPoint } from '../../../shared/cpu';
import { CursorIndicator } from './CursorIndicator';
import { TrackLabel } from './TrackLabel';
import { formatCpu } from './cpuSeries';
import { threadLabel } from './threadLabels';

type ThreadRowProps = {
  threadName: string;
  threadId: string;
  threadNumber: number;
  platform: 'ios' | 'android';
  data: CpuPoint[];
  running: boolean;
  zoomState: ZoomState;
  onZoomChange: (state: ZoomState) => void;
  onZoomOut: () => void;
  height: number;
};

const chartColors = {
  stroke: THREAD_COLORS.areaChartStroke,
  fillStart: THREAD_COLORS.areaChartFillStart,
  fillEnd: THREAD_COLORS.areaChartFillEnd,
};

export const ThreadRow = memo(function ThreadRow({
  threadName,
  threadId,
  threadNumber,
  platform,
  data,
  running,
  zoomState,
  onZoomChange,
  onZoomOut,
  height
}: ThreadRowProps) {
  const gradientId = `threadGradient-${threadId}`;
  const label = threadLabel(threadName, threadNumber, platform);
  const state = running ? 'active' : 'exited';
  const nativeName = threadName || '(unnamed)';
  const nativeId = platform === 'ios' ? `0x${threadId}` : threadId;
  const title = `${label}\nNative name: ${nativeName}\nID: ${nativeId}\nState: ${state}`;
  const latest = data.at(-1);
  const usage = formatCpu(latest?.value ?? null);
  const metrics = [{ label: running ? 'Current' : 'Exited', value: usage }];

  return (
    <div
      data-cpu-thread={threadId}
      className="flex flex-row overflow-hidden"
      style={{ height: `${height}px` }}
    >

      <TrackLabel label={label} title={title} metrics={metrics} wrapLabel />

      <div className="min-w-0 flex-1 h-full relative border-b border-border">
        <PerformanceAreaChart
          data={data}
          zoomState={zoomState}
          onZoomChange={onZoomChange}
          onZoomOut={onZoomOut}
          chartColors={chartColors}
          gradientId={gradientId}
          tooltipPostfix="%"
          trackHeight={height}
        />
        <CursorIndicator />

      </div>
    </div>
  );
});
