import React, { useCallback, useState, useEffect, useRef } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ZoomState } from "../../performance/types";
import type { CpuPoint } from "../../../shared/cpu";
import {
  COLORS,
  TIMELINE_EXTENSION_PERCENT,
  TRACK_HEIGHT,
} from "../../performance/constants";
import {
  generateTicks,
  getAxisYDomain,
} from "../../performance/utils";
import { renderSelectionReferenceArea } from "./SelectionReferenceArea";
import { ChartToolTip } from "./ChartToolTip";
import { Button } from "../ui/button";

type PerformanceAreaChartProps = {
  data: CpuPoint[];
  viewDuration: number;
  zoomState: ZoomState;
  onZoomChange: (state: ZoomState) => void;
  onZoomOut: () => void;
  chartColors?: {
    stroke: string;
    fillStart: string;
    fillEnd: string;
  };
  gradientId?: string;
  tooltipPostfix?: string;
  trackHeight?: number;
};

export const PerformanceAreaChart: React.FC<PerformanceAreaChartProps> = ({
  data,
  viewDuration,
  zoomState,
  onZoomChange,
  onZoomOut,
  chartColors = {
    stroke: COLORS.areaChartStroke,
    fillStart: COLORS.areaChartFillStart,
    fillEnd: COLORS.areaChartFillEnd,
  },
  gradientId = "colorValue",
  tooltipPostfix,
  trackHeight = TRACK_HEIGHT,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [localState, setLocalState] = useState<{
    top: string | number;
    bottom: string | number;
  }>({
    top: "dataMax",
    bottom: "dataMin",
  });

  useEffect(() => {
    const [bottom, top] = getAxisYDomain(
      data,
      zoomState.left,
      zoomState.right,
      10
    );
    setLocalState({ bottom, top });
  }, [data, zoomState.left, zoomState.right]);

  const zoom = useCallback(() => {
    const { refAreaLeft, refAreaRight } = zoomState;

    if (
      refAreaLeft === refAreaRight ||
      refAreaRight === undefined ||
      refAreaLeft === undefined
    ) {
      onZoomChange({
        ...zoomState,
        refAreaLeft: undefined,
        refAreaRight: undefined,
      });
      return;
    }

    let left = refAreaLeft;
    let right = refAreaRight;

    if (left > right) {
      [left, right] = [right, left];
    }

    const [bottom, top] = getAxisYDomain(data, left, right, 0);

    setLocalState({ bottom, top });
    onZoomChange({
      left,
      right,
      refAreaLeft: undefined,
      refAreaRight: undefined,
    });
  }, [data, zoomState, onZoomChange]);

  const onMouseDown = useCallback(
    (e: any) => {
      if (e && e.activeLabel !== undefined) {
        onZoomChange({ ...zoomState, refAreaLeft: e.activeLabel });
      }
    },
    [zoomState, onZoomChange]
  );

  const onMouseMove = useCallback(
    (e: any) => {
      if (
        zoomState.refAreaLeft !== undefined &&
        e &&
        e.activeLabel !== undefined
      ) {
        onZoomChange({ ...zoomState, refAreaRight: e.activeLabel });
      }
    },
    [zoomState, onZoomChange]
  );

  const { refAreaLeft, refAreaRight, left, right } = zoomState;
  const { top, bottom } = localState;

  const currentZoomDuration = right - left;
  const extendedRight = right + (right - left) * TIMELINE_EXTENSION_PERCENT;
  const xAxisTicks = generateTicks(extendedRight, currentZoomDuration, left);

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex flex-col select-none relative group"
      style={{ userSelect: "none" }}
      onDoubleClick={onZoomOut}
    >
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onZoomOut}
        >
          Zoom Out
        </Button>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={zoom}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={chartColors.fillStart}
                stopOpacity={0.8}
              />
              <stop
                offset="100%"
                stopColor={chartColors.fillEnd}
                stopOpacity={0.1}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={true}
            horizontal={false}
            stroke={COLORS.gridLine}
            strokeWidth={1}
            strokeDasharray="0"
          />
          <XAxis
            allowDataOverflow
            dataKey="time"
            domain={[left, extendedRight]}
            type="number"
            ticks={xAxisTicks}
            hide
          />
          <YAxis allowDataOverflow domain={[bottom, top]} type="number" hide />
          <Area
            type="step"
            dataKey="value"
            stroke={chartColors.stroke}
            strokeWidth={1}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={false}
            animationDuration={300}
            isAnimationActive={false}
          />
          <Tooltip
            content={<ChartToolTip postfix={tooltipPostfix} />}
            isAnimationActive={false}
            cursor={false}
            position={{ y: trackHeight / 2 }}
            offset={4}
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
