import React, { memo, useContext, useMemo, type ComponentProps, type RefObject } from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, ReferenceArea } from 'recharts';
import type { DataPoint, ZoomState } from '../../performance/types';
import { COLORS, CHART_MARGIN, TIMELINE_HEIGHT } from '../../performance/constants';
import { TimelineChartWidth } from '../../performance/TimelineChartWidth';
import { generateTicks, formatTime } from '../../performance/utils';
import { renderSelectionReferenceArea } from './SelectionReferenceArea';
import { TimelineCursorIndicator } from './TimelineCursorIndicator';

type TimelineRulerProps = {
  cursorLabel: RefObject<HTMLSpanElement | null>;
  zoomState: ZoomState;
  onZoomOut: () => void;
};

const tickStyle: ComponentProps<typeof XAxis>['tick'] = { fill: COLORS.timeLabel, fontSize: 10, fontFamily: 'monospace', dy: 0, dx: 5, textAnchor: 'start' };

export const TimelineRuler = memo(function TimelineRuler({
  cursorLabel,
  zoomState,
  onZoomOut
}: TimelineRulerProps) {
  const chartWidth = useContext(TimelineChartWidth);
  const { left, right, viewDuration, refAreaLeft, refAreaRight } = zoomState;

  const xAxisTicks = useMemo(() => {
    const ticks = generateTicks(right, viewDuration, left);
    return ticks;
  }, [right, viewDuration, left]);
  const xDomain = useMemo(() => [left, right], [left, right]);
  const timelineData = useMemo<DataPoint[]>(() => [{ time: left, value: 1 }, { time: right, value: 1 }], [left, right]);
  const formatTick = (seconds: number) => {
    if (viewDuration >= 0.01) return formatTime(seconds);
    const milliseconds = seconds * 1000;
    const label = milliseconds.toFixed(3);
    return `${label} ms`;
  };

  return (
    <div
      className="h-full w-full flex flex-col relative"
      onDoubleClick={onZoomOut}
    >
      <BarChart
        width={chartWidth}
        height={TIMELINE_HEIGHT - 1}
        data={timelineData}
        margin={CHART_MARGIN}
        accessibilityLayer={false}
      >
        <CartesianGrid
          vertical={true}
          horizontal={false}
          stroke={COLORS.gridLine}
          strokeWidth={1}
          strokeDasharray="0"
        />
        <XAxis
          dataKey="time"
          type="number"
          domain={xDomain}
          allowDataOverflow
          ticks={xAxisTicks}
          tickFormatter={formatTick}
          tick={tickStyle}
          axisLine={false}
          tickLine={false}
          height={25}
          orientation="bottom"
          mirror={true}
        />
        <Bar
          dataKey="value"
          fill="transparent"
          isAnimationActive={false}
        />
        {refAreaLeft !== undefined && refAreaRight !== undefined ? (
          <ReferenceArea
            x1={refAreaLeft}
            x2={refAreaRight}
            strokeOpacity={0.8}
            fill={COLORS.selectionOverlay}
            fillOpacity={0.2}
            strokeWidth={1}
            stroke={COLORS.selectionOverlay}
            shape={renderSelectionReferenceArea}
          />
        ) : null}
      </BarChart>
      <TimelineCursorIndicator labelRef={cursorLabel} />
    </div>
  );
});
