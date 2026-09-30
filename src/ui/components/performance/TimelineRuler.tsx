import React, { useRef, useState, useEffect } from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, ReferenceArea, ResponsiveContainer } from 'recharts';
import type { DataPoint, ZoomState } from '../../performance/types';
import { COLORS, TIMELINE_EXTENSION_PERCENT } from '../../performance/constants';
import { generateTicks, formatTime } from '../../performance/utils';
import { renderSelectionReferenceArea } from './SelectionReferenceArea';
import { TimelineCursorIndicator } from './TimelineCursorIndicator';

type TimelineRulerProps = {
  cursorX: number | null;
  viewDuration: number;
  zoomState: ZoomState;
  onZoomOut: () => void;
};

export const TimelineRuler: React.FC<TimelineRulerProps> = ({
  cursorX,
  viewDuration,
  zoomState,
  onZoomOut
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const { left, right, refAreaLeft, refAreaRight } = zoomState;

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const extendedRight = right + (right - left) * TIMELINE_EXTENSION_PERCENT;
  const cursorTime = cursorX !== null && containerWidth > 0
    ? left + (cursorX / containerWidth) * (extendedRight - left)
    : null;

  const currentZoomDuration = right - left;
  const xAxisTicks = generateTicks(extendedRight, currentZoomDuration, left);

  const timelineData: DataPoint[] = [{ time: left, value: 1 }, { time: extendedRight, value: 1 }];
  const formatTick = (seconds: number) => {
    if (currentZoomDuration >= 0.01) return formatTime(seconds);
    const milliseconds = seconds * 1000;
    const label = milliseconds.toFixed(3);
    return `${label} ms`;
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex flex-col relative"
      onDoubleClick={onZoomOut}
    >
      <ResponsiveContainer width="100%" height="100%" >
        <BarChart
          data={timelineData}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
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
            domain={[left, extendedRight]}
            allowDataOverflow
            ticks={xAxisTicks}
            tickFormatter={formatTick}
            tick={{ fill: COLORS.timeLabel, fontSize: 10, fontFamily: 'monospace', dy: 0, dx: 5, textAnchor: 'start' }}
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
      <TimelineCursorIndicator cursorX={cursorX} cursorTime={cursorTime} />
    </div>
  );
};
