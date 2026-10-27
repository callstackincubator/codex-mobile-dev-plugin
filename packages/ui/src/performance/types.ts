export type DataPoint = { time: number; value: number };
export type ZoomState = { left: number; right: number; viewDuration: number; isZoomed: boolean; refAreaLeft: number | undefined; refAreaRight: number | undefined };
export type ThreadOrder = "activity" | "first-seen";
export type ThreadHistory = { number: number; peakCpuPercent: number };
