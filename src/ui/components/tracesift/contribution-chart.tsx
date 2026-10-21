/**
 * The drawings a card's contribution is read as, and the legend under them.
 *
 * A port of TraceSift's `src/app/contribution-chart.tsx`. Nothing in a bar or a
 * tile is about a stack frame: a slice is a name, a share of the level's whole,
 * a figure, and a palette slot — so this file knows only that, and the card
 * beside it keeps everything that is about a task.
 */

import type { ReactNode } from "react";
import { squarify } from "../../../shared/tracesift-contribution.ts";

export interface ChartSlice {
  key: string;
  kind: string;
  name: string;
  /** Share of this level's whole, 0-1 — the width or area the slice is drawn at. */
  share: number;
  ms: number;
  /** Palette slot counting from 0, or -1 for a residual. */
  colorIndex: number;
}

/** Which drawing a card carries. Both are part-of-whole readings of the same slices. */
export type ContributionChartKind = "bar" | "treemap";

/**
 * The treemap's shape, fixed rather than measured. The layout needs the
 * container's aspect ratio before it can place a tile, and taking it from the
 * DOM means a first paint with no tiles, a resize observer, and a relayout on
 * every card.
 */
const TREEMAP_ASPECT_W = 16;
const TREEMAP_ASPECT_H = 5;

/**
 * A nominal pixel size for the treemap, used only to decide which tiles are
 * big enough to label. Narrower than the web app's 880, because a card in a
 * chat transcript is narrower than a page — a label that would collide is
 * worth losing more than a tile that could have held one.
 */
const TREEMAP_NOMINAL_WIDTH = 560;
const TREEMAP_LABEL_MIN_PX = 66;
const TREEMAP_FIGURE_MIN_PX = 30;

/**
 * A named slice takes a palette slot; a residual takes neutral ink. The two
 * residuals that can sit side by side mean opposite things — work of yours that
 * is merely small, and work that was never yours — so they cannot share a fill
 * or they read as one band.
 */
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
 * Keeps the card's footprint stable while the active slice changes.
 *
 * Rendering only the active detail lets differently-sized answers move the
 * legend below them. A stationary pointer can then leave the row it just
 * entered, reset the active slice, and move that row back under itself in a
 * loop. Keeping every answer in the same grid cell makes the tallest one set
 * the height while only the active answer is visible and interactive.
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

/**
 * One bar, the level's whole wide, divided into its slices.
 *
 * Percentages rather than flex growth: a slice's width is its share, and
 * `flex-grow` would quietly redistribute the 2px gaps between fills into the
 * widths and make the drawing wrong by a few milliseconds per slice.
 */
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

/** The same slices as area. Tiles carry their own labels, so the fills are never alone in naming them. */
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

/**
 * Names and figures for every slice, in rank order.
 *
 * Present on both charts and not negotiable on either: it is what keeps
 * identity off colour alone, and it is the table view of the same numbers for a
 * reader who wants to compare them rather than look at them.
 */
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

/** The chart a `kind` names. */
export function ContributionChart<S extends ChartSlice>({ kind, ...chart }: ChartProps<S> & { kind: ContributionChartKind }) {
  return kind === "bar" ? <ContributionBar {...chart} /> : <ContributionTreemap {...chart} />;
}
