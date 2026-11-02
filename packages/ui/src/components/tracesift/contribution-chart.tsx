// Port of TraceSift's `src/app/contribution-chart.tsx`. Knows only slices (name, share,
// figure, palette slot); the finding beside it keeps everything about a task or commit.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { squarify } from "@mobile-dev/shared/tracesift-contribution.ts";

export interface ChartSlice {
  key: string;
  kind: string;
  name: string;
  /** Share of this level's whole, 0-1. */
  share: number;
  ms: number;
  /** Palette slot counting from 0, or -1 for a residual. */
  colorIndex: number;
}

export type ContributionChartKind = "bar" | "treemap";

// Fixed aspect so tiles are placed before measuring; the width is measured only to drop labels that would not fit.
const TREEMAP_ASPECT_W = 16;
const TREEMAP_ASPECT_H = 5;
const LABEL_MIN_WIDTH = 60;
const LABEL_MIN_HEIGHT = 40;
/** Below this a tile shows its time alone; its area already shows the share. */
const FIGURE_FULL_WIDTH = 84;

// Named slices take a palette slot, residuals neutral ink. The two residual kinds mean
// opposite things (small work of yours vs work that was never yours), so they differ in fill.
export const sliceColor = (slice: ChartSlice) => {
  if (slice.colorIndex >= 0) return `var(--series-${slice.colorIndex + 1})`;
  if (slice.kind === "tail") return "var(--series-tail)";
  if (slice.kind === "outside") return "var(--series-outside)";
  return "var(--series-rest)";
};

export type MsFormat = (ms: number) => string;

export interface ChartProps<S extends ChartSlice> {
  slices: S[];
  active: S;
  format: MsFormat;
  onHover: (key: string) => void;
  onOpen: (slice: S) => void;
}

const percent = (slice: ChartSlice) => `${Math.round(slice.share * 100)}%`;
const sliceLabel = (slice: ChartSlice, format: MsFormat) => `${slice.name}, ${format(slice.ms)}, ${percent(slice)}`;
const partClass = (base: string, slice: ChartSlice, active: ChartSlice) =>
  `${base}${slice.key === active.key ? " is-active" : ""}${slice.kind === "outside" ? " is-outside" : ""}${slice.colorIndex < 0 ? " is-neutral" : ""}`;

// Percentage widths, not flex-grow, which would spread the 2px gaps into the slice widths.
export function ContributionBar<S extends ChartSlice>({ slices, active, format, onHover, onOpen }: ChartProps<S>) {
  return <div className="contribution-bar">
    {slices.map(slice => <button
      type="button"
      key={slice.key}
      className={partClass("contribution-band", slice, active)}
      style={{ width: `${slice.share * 100}%`, background: sliceColor(slice) }}
      onMouseEnter={() => onHover(slice.key)}
      onFocus={() => onHover(slice.key)}
      onClick={() => onOpen(slice)}
      aria-label={sliceLabel(slice, format)}
    />)}
  </div>;
}

export function ContributionTreemap<S extends ChartSlice>({ slices, active, format, onHover, onOpen }: ChartProps<S>) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rects = squarify(slices.map(slice => slice.share), TREEMAP_ASPECT_H / TREEMAP_ASPECT_W);
  const height = (width * TREEMAP_ASPECT_H) / TREEMAP_ASPECT_W;

  return <div ref={root} className="contribution-treemap" style={{ aspectRatio: `${TREEMAP_ASPECT_W} / ${TREEMAP_ASPECT_H}` }}>
    {slices.map((slice, index) => {
      const rect = rects[index];
      const tileWidth = rect.w * width;
      const named = tileWidth >= LABEL_MIN_WIDTH && rect.h * height >= LABEL_MIN_HEIGHT;
      return <button
        type="button"
        key={slice.key}
        className={partClass("contribution-tile", slice, active)}
        style={{
          left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, background: sliceColor(slice),
        }}
        onMouseEnter={() => onHover(slice.key)}
        onFocus={() => onHover(slice.key)}
        onClick={() => onOpen(slice)}
        aria-label={sliceLabel(slice, format)}
      >
        {named && <span className="contribution-tile-copy">
          <span className="contribution-tile-name">{slice.name}</span>
          <span className="contribution-tile-figure">{tileWidth >= FIGURE_FULL_WIDTH ? `${format(slice.ms)} · ${percent(slice)}` : format(slice.ms)}</span>
        </span>}
      </button>;
    })}
  </div>;
}

export function ContributionChart<S extends ChartSlice>({ kind, ...chart }: ChartProps<S> & { kind: ContributionChartKind }) {
  return kind === "bar" ? <ContributionBar {...chart} /> : <ContributionTreemap {...chart} />;
}

/** The part in focus in two lines, at a fixed height so moving across the chart never moves the legend. */
export function SliceSummary<S extends ChartSlice>({ slice, format, meta, action }: {
  slice: S;
  format: MsFormat;
  meta: ReactNode;
  action: { label: string; run: () => void };
}) {
  return <div className="contribution-summary" aria-live="polite">
    <div className="contribution-summary-line">
      <span className="contribution-summary-name"><span className={`contribution-swatch${slice.kind === "outside" ? " is-outside" : ""}`} style={{ background: sliceColor(slice) }} aria-hidden="true" />{slice.name}</span>
      <span className="contribution-summary-figures"><strong>{format(slice.ms)}</strong> <span>· {percent(slice)}</span></span>
    </div>
    <div className="contribution-summary-line">
      <span className="contribution-summary-meta">{meta}</span>
      <button type="button" className="contribution-summary-action" onClick={action.run}>{action.label} ›</button>
    </div>
  </div>;
}

// Keeps slice identity off colour alone, and the longest list's height so opening a part never shrinks the card.
export function SliceLegend<S extends ChartSlice>({ slices, active, format, onHover, onOpen, rows }: ChartProps<S> & { rows: number }) {
  const style = { "--legend-rows": rows, "--legend-rows-wide": Math.ceil(rows / 2) } as CSSProperties;
  return <ul className="contribution-legend" style={style}>
    {slices.map(slice => <li key={slice.key}>
      <button
        type="button"
        className={`contribution-legend-row${slice.key === active.key ? " is-active" : ""}`}
        onMouseEnter={() => onHover(slice.key)}
        onFocus={() => onHover(slice.key)}
        onClick={() => onOpen(slice)}
      >
        <span className={`contribution-swatch${slice.kind === "outside" ? " is-outside" : ""}`} style={{ background: sliceColor(slice) }} aria-hidden="true" />
        <span className="contribution-legend-name">{slice.name}</span>
        <span className="contribution-legend-ms">{format(slice.ms)}</span>
        <span className="contribution-legend-share">{percent(slice)}</span>
      </button>
    </li>)}
  </ul>;
}
