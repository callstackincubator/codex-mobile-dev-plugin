// Port of TraceSift's `src/app/contribution-chart.tsx`. Knows only slices (name, share,
// figure, palette slot); the card beside it keeps everything about a task.

import type { ReactNode } from "react";
import { squarify, type ContributionChartKind } from "../../tracesift/contribution.ts";

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

// Fixed rather than measured, so the first paint has tiles without a resize observer.
const TREEMAP_ASPECT_W = 16;
const TREEMAP_ASPECT_H = 5;

// Nominal size, used only to decide which tiles get labels. Narrower than the web app's 880
// because chat cards are narrower than a page.
const TREEMAP_NOMINAL_WIDTH = 560;
const TREEMAP_LABEL_MIN_PX = 66;
const TREEMAP_FIGURE_MIN_PX = 30;

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
  onHover: (key: string | null) => void;
  onOpen: (slice: S) => void;
}

/**
 * Every answer shares one grid cell so the tallest sets the height. Rendering only the
 * active one would move the legend under a stationary pointer, which then flips the
 * active slice back and forth in a loop.
 */
export function ContributionDetailStack<S extends ChartSlice>({
  slices,
  active,
  render,
}: {
  slices: S[];
  active: S;
  render: (slice: S) => ReactNode;
}) {
  return <div className="contribution-detail-stack">
    {slices.map(slice => {
      const selected = slice.key === active.key;
      return <div
        key={slice.key}
        className={`contribution-detail-layer${selected ? " is-active" : ""}`}
        aria-hidden={selected ? undefined : true}
      >
        {render(slice)}
      </div>;
    })}
  </div>;
}

const sliceLabel = (slice: ChartSlice, format: MsFormat) =>
  `${slice.name}, ${format(slice.ms)}, ${Math.round(slice.share * 100)}%`;

// Percentage widths, not flex-grow, which would spread the 2px gaps into the slice widths.
export function ContributionBar<S extends ChartSlice>({ slices, active, format, onHover, onOpen }: ChartProps<S>) {
  return <div className="contribution-bar">
    {slices.map(slice => <button
      type="button"
      key={slice.key}
      className={`contribution-band${slice.key === active.key ? " is-active" : ""}${slice.kind === "outside" ? " is-outside" : ""}`}
      style={{ width: `${slice.share * 100}%`, background: sliceColor(slice) }}
      onMouseEnter={() => onHover(slice.key)}
      onFocus={() => onHover(slice.key)}
      onClick={() => onOpen(slice)}
      aria-label={sliceLabel(slice, format)}
    />)}
  </div>;
}

export function ContributionTreemap<S extends ChartSlice>({ slices, active, format, onHover, onOpen }: ChartProps<S>) {
  const rects = squarify(slices.map(slice => slice.share), TREEMAP_ASPECT_H / TREEMAP_ASPECT_W);
  const nominalHeight = (TREEMAP_NOMINAL_WIDTH * TREEMAP_ASPECT_H) / TREEMAP_ASPECT_W;

  return <div
    className="contribution-treemap"
    style={{ aspectRatio: `${TREEMAP_ASPECT_W} / ${TREEMAP_ASPECT_H}` }}
  >
    {slices.map((slice, index) => {
      const rect = rects[index];
      const named = rect.w * TREEMAP_NOMINAL_WIDTH >= TREEMAP_LABEL_MIN_PX && rect.h * nominalHeight >= TREEMAP_FIGURE_MIN_PX;
      return <button
        type="button"
        key={slice.key}
        className={`contribution-tile${slice.key === active.key ? " is-active" : ""}${slice.kind === "outside" ? " is-outside" : ""}${slice.colorIndex < 0 ? " is-neutral" : ""}`}
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
          <span className="contribution-tile-figure">{format(slice.ms)} · {Math.round(slice.share * 100)}%</span>
        </span>}
      </button>;
    })}
  </div>;
}

// Required on both charts: keeps slice identity off colour alone.
export function SliceLegend<S extends ChartSlice>({ slices, active, format, onHover, onOpen }: ChartProps<S>) {
  return <ul className="contribution-legend">
    {slices.map(slice => <li key={slice.key}>
      <button
        type="button"
        className={`contribution-legend-row${slice.key === active.key ? " is-active" : ""}`}
        onMouseEnter={() => onHover(slice.key)}
        onFocus={() => onHover(slice.key)}
        onClick={() => onOpen(slice)}
      >
        <span className="contribution-swatch" style={{ background: sliceColor(slice) }} aria-hidden="true" />
        <span className="contribution-legend-name">{slice.name}</span>
        <span className="contribution-legend-ms">{format(slice.ms)}</span>
        <span className="contribution-legend-share">{Math.round(slice.share * 100)}%</span>
      </button>
    </li>)}
  </ul>;
}

export function ContributionChart<S extends ChartSlice>({ kind, ...chart }: ChartProps<S> & { kind: ContributionChartKind }) {
  return kind === "bar" ? <ContributionBar {...chart} /> : <ContributionTreemap {...chart} />;
}
