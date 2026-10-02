import { Curve, type AreaProps, type AreaRevealShapeProps, type CurveProps } from "recharts";
import type { RecordingPoint } from "../recording-series.ts";

type Point = { x: number; y: number };
type Points = NonNullable<CurveProps["points"]>;
type ChartPointInterpolation = NonNullable<AreaProps<RecordingPoint, number | null>["animationInterpolateFn"]>;

function isMeasuredPoint(point: Points[number]): point is Point {
  return typeof point.x === "number" && typeof point.y === "number";
}

export function traceRecordingPoints(points: Points, progress: number): Points {
  if (progress >= 1) return points;
  if (progress <= 0) return [];

  let length = 0;
  let previous: Point | undefined;
  for (const point of points) {
    if (isMeasuredPoint(point) === false) {
      previous = undefined;
      continue;
    }
    if (previous !== undefined) {
      const segmentLength = Math.hypot(point.x - previous.x, point.y - previous.y);
      length += segmentLength;
    }
    previous = point;
  }

  let remaining = length * progress;
  const drawn: Array<Points[number]> = [];
  previous = undefined;
  for (const point of points) {
    if (isMeasuredPoint(point) === false) {
      drawn.push(point);
      previous = undefined;
      continue;
    }
    if (previous !== undefined) {
      const segmentLength = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (segmentLength > remaining) {
        const fraction = remaining / segmentLength;
        drawn.push({
          x: previous.x + (point.x - previous.x) * fraction,
          y: previous.y + (point.y - previous.y) * fraction,
        });
        break;
      }
      remaining -= segmentLength;
    }
    drawn.push(point);
    previous = point;
  }
  return drawn;
}

// Keep measured coordinates fixed; the shape draws a growing prefix of the curve.
export const recordingChartPoints: ChartPointInterpolation = items => {
  const points: Array<ReturnType<ChartPointInterpolation>[number]> = [];
  for (const item of items ?? []) {
    if (item.status !== "removed") points.push(item.next);
  }
  return points;
};

export function RecordingChartShape({ points = [], animationElapsedTime = 1, baseLine, stroke, strokeWidth, fill, fillOpacity }: AreaRevealShapeProps) {
  const drawn = traceRecordingPoints(points, animationElapsedTime);
  return <>
    <Curve className="recharts-area-area" type="linear" points={drawn} baseLine={baseLine} connectNulls={false} stroke="none" fill={fill} fillOpacity={fillOpacity} />
    <Curve className="recharts-area-curve" type="linear" points={drawn} connectNulls={false} stroke={stroke} strokeWidth={strokeWidth} fill="none" />
  </>;
}
