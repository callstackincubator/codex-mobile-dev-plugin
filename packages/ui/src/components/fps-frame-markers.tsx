import { memo, useState } from "react";
import { DefaultZIndexes, usePlotArea, useXAxisScale, useYAxisScale, ZIndexLayer } from "recharts";
import type { IosHitch } from "@mobile-dev/shared/ios-hitches.ts";
import { describeDisplayJank } from "@mobile-dev/shared/frame-statistics.ts";
import type { AndroidFrameMarker, FpsFrameOverlay } from "../fps-frame-overlay.ts";

export type FpsInspection = { kind: "marker" | "sample"; index: number };

function markerId(event: IosHitch | AndroidFrameMarker, index: number) {
  return "frame" in event ? event.frame.token + "/" + event.frame.endTimeNs : index;
}

// Late readback replaces an interval; eviction shifts every subsequent index.
export function useFpsInspection(overlay: FpsFrameOverlay | undefined, live = false) {
  const [picked, setPicked] = useState<{ kind: FpsInspection["kind"]; id: number | string }>();
  const inspection: FpsInspection = { kind: overlay?.markers.length ? "marker" : "sample", index: 0 };
  if (overlay && live) {
    inspection.index = inspection.kind === "marker" ? overlay.markers.length - 1 : Math.max(0, overlay.samples.length - 1);
  }
  if (picked && overlay) {
    const index = picked.kind === "sample" ? overlay.samples.findIndex(sample => sample.end === picked.id)
      : overlay.markers.findIndex((marker, index) => markerId(marker.event, index) === picked.id);
    if (index >= 0) {
      inspection.kind = picked.kind;
      inspection.index = index;
    }
  }
  function inspect(next: FpsInspection) {
    if (!overlay) return;
    const id = next.kind === "sample" ? overlay.samples[next.index].end : markerId(overlay.markers[next.index].event, next.index);
    setPicked({ kind: next.kind, id });
  }
  return { inspection, inspect };
}

function frameTiming(event: IosHitch | AndroidFrameMarker) {
  if ("frame" in event) {
    const { frame, label } = event;
    const reasons = describeDisplayJank(frame.jankType);
    const presentation = frame.presentType === 1 ? "on-time presentation" : "early presentation";
    const status = label === "Janky" ? `Janky display frame (${presentation})` : `${label} display frame`;
    return `${event.time.toFixed(3)} s · ${status} · ${reasons}`;
  }
  const hz = Math.round(1000 / event.refreshIntervalMs);
  const fraction = event.lateMs / event.refreshIntervalMs;
  const intervals = Math.round(fraction * 100) / 100;
  const unit = intervals === 1 ? "refresh interval" : "refresh intervals";
  return `${event.time.toFixed(3)} s · ${hz} Hz · ${event.lateMs.toFixed(2)} ms late · ${intervals} ${unit}`;
}

export const FrameMarkers = memo(function FrameMarkers({ overlay, selected, onPick }: { overlay: FpsFrameOverlay; selected?: number; onPick?: (index: number) => void }) {
  const x = useXAxisScale();
  const y = useYAxisScale();
  const plot = usePlotArea();
  if (x === undefined || y === undefined || plot === undefined) return null;
  const diamond = (index: number, active: boolean) => {
    const { event, sample } = overlay.markers[index];
    if (sample === undefined) return null;
    const cx = x(event.time);
    const cy = y(sample.fps);
    if (cx === undefined || cy === undefined || cx < plot.x || cx > plot.x + plot.width || cy < plot.y || cy > plot.y + plot.height) return null;
    const radius = active ? 6 : 4;
    const maxLabelX = plot.x + plot.width - 25 - cx;
    const rightBound = Math.min(0, maxLabelX);
    const labelX = Math.max(plot.x + 25 - cx, rightBound);
    return <g key={markerId(event, index)} data-frame-index={index} data-frame-time={event.time}
      transform={`translate(${cx} ${cy})`} className="fps-frame-marker" onClick={onPick && (() => onPick(index))}>
      {active && <text x={labelX} y={-11} textAnchor="middle" pointerEvents="none">{event.time.toFixed(3)} s</text>}
      <circle r={7} fill="transparent" />
      <path d={`M0,${-radius} L${radius},0 0,${radius} ${-radius},0Z`} stroke={active ? "var(--background)" : "none"} strokeWidth={1.5} />
      <title>{frameTiming(event)}</title>
    </g>;
  };
  return <ZIndexLayer zIndex={DefaultZIndexes.scatter}>
    {overlay.markers.map((_, index) => index === selected ? null : diamond(index, false))}
    {selected !== undefined && overlay.markers[selected] && diamond(selected, true)}
  </ZIndexLayer>;
});

const InspectionOptions = memo(function InspectionOptions({ overlay }: { overlay: FpsFrameOverlay }) {
  return <>
    {overlay.markers.length > 0 && <optgroup label={overlay.platform === "ios" ? "Visible hitches" : "Flagged display frames"}>
      {overlay.markers.map(({ event }, i) => <option key={markerId(event, i)} value={`marker-${i}`}>{event.time.toFixed(3)} s · {"frame" in event ? event.label : "hitch"}</option>)}
    </optgroup>}
    {overlay.samples.length > 0 && <optgroup label="FPS sample intervals">
      {overlay.samples.map((sample, i) => <option key={i} value={`sample-${i}`}>{sample.start.toFixed(3)}–{sample.end.toFixed(3)} s · {sample.fps.toFixed(1)} FPS</option>)}
    </optgroup>}
  </>;
});

export function FpsInspector({ overlay, inspection, onInspect }: {
  overlay: FpsFrameOverlay; inspection: FpsInspection; onInspect: (next: FpsInspection) => void;
}) {
  const marker = inspection.kind === "marker" ? overlay.markers[inspection.index] : undefined;
  const sample = inspection.kind === "sample" ? overlay.samples[inspection.index] : marker?.sample;
  const android = overlay.platform === "android";
  let detail = android ? "No flagged display frames in the captured interval." : "No visible hitches in the captured interval.";
  if (marker) {
    const fps = sample ? `${sample.fps.toFixed(1)} FPS in this sample` : "No FPS sample at this time";
    detail = `${frameTiming(marker.event)} · ${fps}`;
  } else if (sample) {
    const count = sample.markerCount;
    const singular = android ? "flagged display frame" : "visible hitch";
    const plural = android ? "flagged display frames" : "visible hitches";
    const unit = count === 1 ? singular : plural;
    const unavailable = android ? "FrameTimeline unavailable for this sample" : "Hitch count unavailable for the full sample";
    const timing = count === null ? unavailable : `${count} ${unit}`;
    detail = `${sample.fps.toFixed(1)} FPS · ${timing}`;
  }
  return <div className="recording-fps-inspector">
    {(marker || sample) && <label>Inspect <select value={`${inspection.kind}-${inspection.index}`} onChange={event => {
      const [kind, index] = event.target.value.split("-");
      onInspect({ kind: kind === "marker" ? "marker" : "sample", index: Number(index) });
    }}><InspectionOptions overlay={overlay} /></select></label>}
    <p aria-live="polite">{detail}</p>
  </div>;
}
