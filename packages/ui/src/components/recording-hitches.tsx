import { useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { IosHitch } from "@mobile-dev/shared/ios-hitches.ts";
import type { RecordingRange } from "@mobile-dev/shared/recordings.ts";
import { InfoPopover } from "./card-parts";

function describeHitch(event: IosHitch) {
  const hz = Math.round(1000 / event.refreshIntervalMs);
  const intervals = event.lateMs / event.refreshIntervalMs;
  const rounded = Math.round(intervals * 100) / 100;
  const unit = rounded === 1 ? "refresh interval" : "refresh intervals";
  return `${event.time.toFixed(3)} s · ${hz} Hz · ${event.lateMs.toFixed(2)} ms late · ${rounded} ${unit}`;
}

export function RecordingHitches({ events, duration, range }: { events: IosHitch[]; duration: number; range?: RecordingRange }) {
  const [index, setIndex] = useState(0);
  const event = events[index];
  const paths = useMemo(() => {
    const lines = [];
    for (const hitch of events) {
      const x = 1000 * hitch.time / duration;
      lines.push(`M${x},6v16`);
    }
    return lines.join(" ");
  }, [events, duration]);
  function pick(click: MouseEvent<SVGSVGElement>) {
    const bounds = click.currentTarget.getBoundingClientRect();
    const time = duration * (click.clientX - bounds.left) / bounds.width;
    let closest = 0;
    let distance = Math.abs(events[0].time - time);
    for (let i = 1; i < events.length; i++) {
      const next = Math.abs(events[i].time - time);
      if (next >= distance) continue;
      distance = next;
      closest = i;
    }
    setIndex(closest);
  }
  function step(key: KeyboardEvent<SVGSVGElement>) {
    let next = index;
    switch (key.key) {
      case "ArrowLeft": next = Math.max(0, index - 1); break;
      case "ArrowRight": next = Math.min(events.length - 1, index + 1); break;
      case "Home": next = 0; break;
      case "End": next = events.length - 1; break;
      default: return;
    }
    key.preventDefault();
    setIndex(next);
  }
  const description = event && describeHitch(event);
  return <section className="recording-track" aria-label="Visible hitches">
    <div className="recording-track-heading"><h3>Visible hitches</h3><InfoPopover label="visible hitches">Frames presented late with this app’s content. The delay can occur in the app or the render server. Select a marker or use the arrow keys to inspect a frame.</InfoPopover></div>
    {event ? <>
      <svg className="recording-hitch-chart" viewBox="0 0 1000 28" preserveAspectRatio="none" role="slider" tabIndex={0}
        aria-label="Inspect hitch" aria-valuemin={1} aria-valuemax={events.length} aria-valuenow={index + 1} aria-valuetext={description} onKeyDown={step} onClick={pick}>
        {range && <rect x={1000 * range.start / duration} width={1000 * (range.end - range.start) / duration} height={28} fill="var(--recording-range-fill, #2583ff29)" />}
        <path d={paths} stroke="var(--destructive)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <line x1={1000 * event.time / duration} x2={1000 * event.time / duration} y1={1} y2={27} stroke="var(--foreground)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="recording-footnote" aria-live="polite">{description}</p>
    </> : <p className="recording-footnote">No visible hitches in the captured interval.</p>}
  </section>;
}
