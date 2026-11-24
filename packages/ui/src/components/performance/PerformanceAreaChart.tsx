import React, { memo, useCallback, useContext, useMemo, useRef, type ComponentProps } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceArea,
  Tooltip,
  type MouseHandlerDataParam,
} from "recharts";
import type { ZoomState } from "../../performance/types";
import { TimelineChartWidth } from "../../performance/TimelineChartWidth";
import type { CpuPoint } from "@mobile-dev/shared/cpu.ts";
import {
  COLORS,
  CHART_MARGIN,
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
  children?: React.ReactNode;
  data: CpuPoint[];
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
  curveType?: ComponentProps<typeof Area>["type"];
};

const defaultChartColors = {
  stroke: COLORS.areaChartStroke,
  fillStart: COLORS.areaChartFillStart,
  fillEnd: COLORS.areaChartFillEnd,
};

export const PerformanceAreaChart = memo(function PerformanceAreaChart({
  children,
  data,
  zoomState,
  onZoomChange,
  onZoomOut,
  chartColors = defaultChartColors,
  gradientId = "colorValue",
  tooltipPostfix,
  trackHeight = TRACK_HEIGHT,
  curveType = "step",
}: PerformanceAreaChartProps) {
  const chartWidth = useContext(TimelineChartWidth);
  const markerPress = useRef<{ x: number; time: number } | undefined>(undefined);
  const { refAreaLeft, refAreaRight, left, right, viewDuration } = zoomState;
  const yDomain = useMemo(() => {
    const domain = getAxisYDomain(data, left, right, 10);
    return domain;
  }, [data, left, right]);
  const xDomain = useMemo(() => [left, right], [left, right]);
  const xAxisTicks = useMemo(() => {
    const ticks = generateTicks(right, viewDuration, left);
    return ticks;
  }, [left, right, viewDuration]);
  const tooltip = useMemo(() => <ChartToolTip postfix={tooltipPostfix} />, [tooltipPostfix]);
  const tooltipPosition = useMemo(() => ({ y: trackHeight / 2 }), [trackHeight]);

  const zoom = useCallback(() => {
    if (markerPress.current) {
      markerPress.current = undefined;
      return;
    }
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
    onZoomChange({
      left,
      right,
      viewDuration: right - left,
      isZoomed: true,
      refAreaLeft: undefined,
      refAreaRight: undefined,
    });
  }, [zoomState, onZoomChange]);

  const onMouseDown = useCallback(
    (e: MouseHandlerDataParam, event: React.MouseEvent) => {
      markerPress.current = undefined;
      const marker = event.target instanceof Element ? event.target.closest<SVGGElement>("[data-frame-time]") : null;
      if (marker) {
        markerPress.current = { x: event.clientX, time: Number(marker.dataset.frameTime) };
        return;
      }
      if (typeof e.activeLabel === "number") onZoomChange({ ...zoomState, refAreaLeft: e.activeLabel });
    },
    [zoomState, onZoomChange]
  );

  const onMouseMove = useCallback(
    (e: MouseHandlerDataParam, event: React.MouseEvent) => {
      const press = markerPress.current;
      if (press) {
        if (event.buttons !== 1 || typeof e.activeLabel !== "number") return;
        const distance = Math.abs(event.clientX - press.x);
        if (distance <= 3) return;
        markerPress.current = undefined;
        onZoomChange({ ...zoomState, refAreaLeft: press.time, refAreaRight: e.activeLabel });
        return;
      }
      if (
        zoomState.refAreaLeft !== undefined &&
        typeof e.activeLabel === "number"
      ) {
        onZoomChange({ ...zoomState, refAreaRight: e.activeLabel });
      }
    },
    [zoomState, onZoomChange]
  );

  return (
    <div
      className="h-full w-full flex flex-col select-none relative group"
      style={{ userSelect: "none" }}
      onDoubleClick={onZoomOut}
    >
      {zoomState.isZoomed && <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onZoomOut}
        >
          Zoom Out
        </Button>
      </div>}

      <AreaChart
        width={chartWidth}
        height={trackHeight - 1}
        data={data}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={zoom}
        margin={CHART_MARGIN}
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
          domain={xDomain}
          type="number"
          ticks={xAxisTicks}
          hide
        />
        <YAxis allowDataOverflow domain={yDomain} type="number" hide />
        <Area
          type={curveType}
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
          content={tooltip}
          isAnimationActive={false}
          cursor={false}
          position={tooltipPosition}
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
        {children}
      </AreaChart>
    </div>
  );
});
