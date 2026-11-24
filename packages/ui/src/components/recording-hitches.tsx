import { memo } from "react";
import { DefaultZIndexes, usePlotArea, useXAxisScale, useYAxisScale, ZIndexLayer } from "recharts";
import type { IosHitch } from "@mobile-dev/shared/ios-hitches.ts";
import type { RecordingHitchOverlay } from "../recording-series.ts";

export type FpsInspection = { kind: "hitch" | "sample"; index: number };

function frameTiming(event: IosHitch) {
  const hz = Math.round(1000 / event.refreshIntervalMs);
  const fraction = event.lateMs / event.refreshIntervalMs;
  const intervals = Math.round(fraction * 100) / 100;
  const unit = intervals === 1 ? "refresh interval" : "refresh intervals";
  return `${event.time.toFixed(3)} s · ${hz} Hz · ${event.lateMs.toFixed(2)} ms late · ${intervals} ${unit}`;
}

export const HitchMarkers = memo(function HitchMarkers({ overlay, selected }: { overlay: RecordingHitchOverlay; selected?: number }) {
  const x = useXAxisScale();
  const y = useYAxisScale();
  const plot = usePlotArea();
  if (x === undefined || y === undefined || plot === undefined) return null;
  const diamond = (index: number, active: boolean) => {
    const { event, sample } = overlay.hitches[index];
    if (sample === undefined) return null;
    const cx = x(event.time);
    const cy = y(sample.fps);
    if (cx === undefined || cy === undefined) return null;
    const radius = active ? 6 : 4;
    const maxLabelX = plot.x + plot.width - 25 - cx;
    const rightBound = Math.min(0, maxLabelX);
    const labelX = Math.max(plot.x + 25 - cx, rightBound);
    return <g key={index} data-hitch-index={index} transform={`translate(${cx} ${cy})`} className="recording-hitch-marker">
      {active && <text x={labelX} y={-11} textAnchor="middle" pointerEvents="none">{event.time.toFixed(3)} s</text>}
      <circle r={7} fill="transparent" />
      <path d={`M0,${-radius} L${radius},0 0,${radius} ${-radius},0Z`} stroke={active ? "var(--background)" : "none"} strokeWidth={1.5} />
      <title>{frameTiming(event)}</title>
    </g>;
  };
  return <ZIndexLayer zIndex={DefaultZIndexes.scatter}>
    {overlay.hitches.map((_, index) => index === selected ? null : diamond(index, false))}
    {selected !== undefined && overlay.hitches[selected] && diamond(selected, true)}
  </ZIndexLayer>;
});

const InspectionOptions = memo(function InspectionOptions({ overlay }: { overlay: RecordingHitchOverlay }) {
  return <>
    {overlay.hitches.length > 0 && <optgroup label="Visible hitches">
      {overlay.hitches.map(({ event }, i) => <option key={i} value={`hitch-${i}`}>{event.time.toFixed(3)} s · hitch</option>)}
    </optgroup>}
    {overlay.samples.length > 0 && <optgroup label="FPS sample intervals">
      {overlay.samples.map((sample, i) => <option key={i} value={`sample-${i}`}>{sample.start.toFixed(3)}–{sample.end.toFixed(3)} s · {sample.fps.toFixed(1)} FPS</option>)}
    </optgroup>}
  </>;
});

export function FpsInspector({ overlay, inspection, onInspect }: {
  overlay: RecordingHitchOverlay; inspection: FpsInspection; onInspect: (next: FpsInspection) => void;
}) {
  const hitch = inspection.kind === "hitch" ? overlay.hitches[inspection.index] : undefined;
  const sample = inspection.kind === "sample" ? overlay.samples[inspection.index] : hitch?.sample;
  let detail = "No visible hitches in the captured interval.";
  if (hitch) {
    const fps = sample ? `${sample.fps.toFixed(1)} FPS in this sample` : "No FPS sample at this time";
    detail = `${frameTiming(hitch.event)} · ${fps}`;
  } else if (sample) {
    const count = sample.hitchCount;
    const unit = count === 1 ? "visible hitch" : "visible hitches";
    const timing = count === null ? "Hitch count unavailable for the full sample" : `${count} ${unit}`;
    detail = `${sample.fps.toFixed(1)} FPS · ${timing}`;
  }
  return <div className="recording-fps-inspector">
    {(hitch || sample) && <label>Inspect <select value={`${inspection.kind}-${inspection.index}`} onChange={event => {
      const [kind, index] = event.target.value.split("-");
      onInspect({ kind: kind === "hitch" ? "hitch" : "sample", index: Number(index) });
    }}><InspectionOptions overlay={overlay} /></select></label>}
    <p aria-live="polite">{detail}</p>
  </div>;
}
