import React from 'react';
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
  cursorX: number | null;
  viewDuration: number;
  zoomState: ZoomState;
  onZoomChange: (state: ZoomState) => void;
  onZoomOut: () => void;
  height: number;
};

export const ThreadRow: React.FC<ThreadRowProps> = ({
  threadName,
  threadId,
  threadNumber,
  platform,
  data,
  running,
  cursorX,
  viewDuration,
  zoomState,
  onZoomChange,
  onZoomOut,
  height
}) => {
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
      className="flex flex-row overflow-hidden"
      style={{ height: `${height}px` }}
    >

      <TrackLabel label={label} title={title} metrics={metrics} wrapLabel />

      <div className="flex-1 h-full relative border-b border-border">
        <PerformanceAreaChart
          data={data}
          viewDuration={viewDuration}
          zoomState={zoomState}
          onZoomChange={onZoomChange}
          onZoomOut={onZoomOut}
          chartColors={{
            stroke: THREAD_COLORS.areaChartStroke,
            fillStart: THREAD_COLORS.areaChartFillStart,
            fillEnd: THREAD_COLORS.areaChartFillEnd,
          }}
          gradientId={gradientId}
          tooltipPostfix="%"
          trackHeight={height}
        />
        <CursorIndicator cursorX={cursorX} />

      </div>
    </div>
  );
};
