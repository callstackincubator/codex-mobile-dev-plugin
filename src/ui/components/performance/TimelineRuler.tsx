import React, { memo, useMemo, type ComponentProps, type RefObject } from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, ReferenceArea, ResponsiveContainer } from 'recharts';
import type { DataPoint, ZoomState } from '../../performance/types';
import { COLORS, TIMELINE_EXTENSION_PERCENT } from '../../performance/constants';
import { generateTicks, formatTime } from '../../performance/utils';
import { renderSelectionReferenceArea } from './SelectionReferenceArea';
import { TimelineCursorIndicator } from './TimelineCursorIndicator';

type TimelineRulerProps = {
  cursorLabel: RefObject<HTMLSpanElement | null>;
  zoomState: ZoomState;
  onZoomOut: () => void;
};

const chartMargin = { top: 0, right: 0, bottom: 0, left: 0 };
const tickStyle: ComponentProps<typeof XAxis>['tick'] = { fill: COLORS.timeLabel, fontSize: 10, fontFamily: 'monospace', dy: 0, dx: 5, textAnchor: 'start' };

export const TimelineRuler = memo(function TimelineRuler({
  cursorLabel,
  zoomState,
  onZoomOut
}: TimelineRulerProps) {
  const { left, right, refAreaLeft, refAreaRight } = zoomState;

  const extendedRight = right + (right - left) * TIMELINE_EXTENSION_PERCENT;
  const currentZoomDuration = right - left;
  const xAxisTicks = useMemo(() => {
    const ticks = generateTicks(extendedRight, currentZoomDuration, left);
    return ticks;
  }, [extendedRight, currentZoomDuration, left]);
  const xDomain = useMemo(() => [left, extendedRight], [left, extendedRight]);
  const timelineData = useMemo<DataPoint[]>(() => [{ time: left, value: 1 }, { time: extendedRight, value: 1 }], [left, extendedRight]);
  const formatTick = (seconds: number) => {
    if (currentZoomDuration >= 0.01) return formatTime(seconds);
    const milliseconds = seconds * 1000;
    const label = milliseconds.toFixed(3);
    return `${label} ms`;
  };

  return (
    <div
      className="h-full w-full flex flex-col relative"
      onDoubleClick={onZoomOut}
    >
      <ResponsiveContainer width="100%" height="100%" >
        <BarChart
          data={timelineData}
          margin={chartMargin}
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
      </ResponsiveContainer>
      <TimelineCursorIndicator labelRef={cursorLabel} />
    </div>
  );
});
