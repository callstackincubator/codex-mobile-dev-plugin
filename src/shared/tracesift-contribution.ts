/**
 * How a task divides, computed from the card the analysis already shipped.
 *
 * A port of TraceSift's own `src/lib/contribution.ts`, kept deliberately
 * line-for-line rather than reinterpreted: the card in this plugin and the card
 * on the web have to agree about which bands exist, how wide they are and which
 * colour each one takes, and the only way to guarantee that is to run the same
 * arithmetic. The analysis payload carries no slices — it carries boundary
 * frames and their culprits, and both ends derive the drawing from those.
 */

import type { TraceSiftBoundaryCulprit, TraceSiftBoundaryFrame, TraceSiftTaskCard } from "./tracesift.ts";

/**
 * Slices a level carries before it folds its tail away. The eighth is where a
 * stacked bar runs out of room for a distinguishable fill and a treemap runs
 * out of room for a label; it is also the size of the palette.
 */
export const CHART_SLICES = 8;

/**
 * A slice below this much of its level is narrower than its own 2px gap, so it
 * reads as a seam between its neighbours rather than as a part.
 */
export const MIN_SLICE_SHARE = 0.005;

/** The server's own floor for a boundary frame, which the tail sentence quotes. */
export const BOUNDARY_MIN_SHARE = 0.02;

/**
 * What a slice stands for. Only `boundary` and `culprit` are frames that ran;
 * the other three are the residuals that make a level add up to its whole, and
 * each one is a different statement about where the unnamed time went.
 */
export type SliceKind = "boundary" | "culprit" | "tail" | "outside" | "rest";

export interface ContributionSlice {
  /** Stable across renders — a node id, or the residual's kind. */
  key: string;
  kind: SliceKind;
  name: string;
  /** Share of this level's whole, 0-1. The width or area the slice is drawn at. */
  share: number;
  /** Inclusive time at the top level, self time inside a feature. */
  ms: number;
  /**
   * Which categorical slot paints this slice, counting from 0, or -1 for a
   * residual. Fixed by the slice's own place in the ranking, never by how many
   * slices survived the fold, so a colour means one frame rather than one
   * position.
   */
  colorIndex: number;
  boundary?: TraceSiftBoundaryFrame;
  culprit?: TraceSiftBoundaryCulprit;
  /** How many frames the `tail` slice stands for. */
  tailCount?: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** A residual, or nothing when it is too thin to draw. */
function residual(
  kind: SliceKind, name: string, ms: number, whole: number, extra: Partial<ContributionSlice> = {},
): ContributionSlice | undefined {
  if (whole <= 0 || ms / whole < MIN_SLICE_SHARE) return undefined;
  return { key: kind, kind, name, share: ms / whole, ms: round1(ms), colorIndex: -1, ...extra };
}

/**
 * The task divided by feature: one slice per boundary frame, then the two
 * residuals.
 *
 * The residuals are slices rather than footnotes because they are the same kind
 * of claim as the others — this much of the task went here — and because a bar
 * that stops at 63% with no mark for the rest invites the reader to read 63% as
 * the whole.
 */
export function taskBreakdownSlices(card: TraceSiftTaskCard): ContributionSlice[] {
  const duration = card.durationMs;
  if (duration <= 0) return [];

  const slices: ContributionSlice[] = [];
  let shownMs = 0;
  // `colorIndex` counts the frames offered a slot, not the ones that took one:
  // a frame folded into the tail must not shift the colour of the frame below
  // it, or the palette would change with the fold.
  for (const [index, boundary] of card.boundaryFrames.slice(0, CHART_SLICES).entries()) {
    const share = boundary.totalMs / duration;
    if (share < MIN_SLICE_SHARE) continue;
    shownMs += boundary.totalMs;
    slices.push({ key: boundary.nodeId, kind: "boundary", name: boundary.name, share, ms: boundary.totalMs, colorIndex: index, boundary });
  }

  // Frames folded by the share floor above are already counted in the server's
  // tail, so the two cannot be added — the difference between what the task was
  // and what is drawn is the tail, whatever folded it.
  const drawnBoundaryMs = card.boundaryFrames.reduce((sum, frame) => sum + frame.totalMs, 0);
  const tailMs = card.boundaryTailMs + Math.max(0, drawnBoundaryMs - shownMs);
  const tailCount = card.boundaryTailCount + (card.boundaryFrames.length - slices.length);
  const tail = residual("tail", tailCount === 1 ? "1 smaller entry point" : `${tailCount} smaller entry points`, tailMs, duration, { tailCount });
  if (tail && tailCount > 0) slices.push(tail);

  const outside = residual("outside", "never entered your code", card.outsideBoundariesMs, duration);
  if (outside) slices.push(outside);
  return slices;
}

/**
 * One feature divided by what burned its time: its culprits by self time, then
 * whatever is spread too thin to draw.
 *
 * The whole here is the feature's inclusive time, not the task's, because the
 * question at this level is how one frame spent its own milliseconds — a slice
 * measured against the task again would redraw the slice the reader just
 * opened, at a ninth of the width.
 */
export function boundaryDrillSlices(boundary: TraceSiftBoundaryFrame): ContributionSlice[] {
  const whole = boundary.totalMs;
  if (whole <= 0) return [];

  const slices: ContributionSlice[] = [];
  let named = 0;
  for (const [index, culprit] of boundary.culprits.slice(0, CHART_SLICES).entries()) {
    const share = culprit.selfMs / whole;
    if (share < MIN_SLICE_SHARE) continue;
    named += culprit.selfMs;
    slices.push({ key: culprit.nodeId, kind: "culprit", name: culprit.name, share, ms: culprit.selfMs, colorIndex: index, culprit });
  }

  const rest = residual("rest", "spread too thin to draw", Math.max(0, whole - named), whole);
  if (rest) slices.push(rest);
  return slices;
}

export interface TreemapRect {
  /** Fractions of the container's width and height, 0-1, so CSS can use percentages. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst aspect ratio in a row of `areas` laid across `short`, 1 being square. */
function worstRatio(areas: readonly number[], short: number, sum: number): number {
  const thickness = sum / short;
  let worst = 1;
  for (const area of areas) {
    const length = area / thickness;
    worst = Math.max(worst, thickness / length, length / thickness);
  }
  return worst;
}

/**
 * Squarified treemap layout: areas proportional to `values`, tiles as near
 * square as the values allow.
 *
 * Bruls, Huizing and van Wijk's algorithm — fill the free rectangle's shorter
 * side with a row, admitting values while doing so improves the row's worst
 * aspect ratio, then recurse on what is left. The naive slice-and-dice
 * alternative produces slivers a label cannot sit in as soon as the values are
 * skewed, and a task's frames are always skewed.
 *
 * `aspect` is the container's height over its width. Returned rects are
 * normalised back to 0-1 on both axes, so the caller can position them as
 * percentages without knowing the pixel size.
 */
export function squarify(values: readonly number[], aspect: number): TreemapRect[] {
  const empty = { x: 0, y: 0, w: 0, h: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || aspect <= 0) return values.map(() => empty);

  // Laid out in a container one unit wide and `aspect` tall, so an area is
  // comparable with a length and the aspect ratios below are the real ones.
  const areas = values.map(value => (value / total) * aspect);
  const out: TreemapRect[] = values.map(() => empty);

  let free = { x: 0, y: 0, w: 1, h: aspect };
  let index = 0;
  while (index < areas.length) {
    const short = Math.min(free.w, free.h);
    const row: number[] = [];
    let rowArea = 0;
    let worst = Infinity;
    while (index + row.length < areas.length) {
      const next = areas[index + row.length];
      const ratio = worstRatio([...row, next], short, rowArea + next);
      if (row.length > 0 && ratio > worst) break;
      row.push(next);
      rowArea += next;
      worst = ratio;
    }

    // The row is laid along the shorter side; its thickness is whatever makes
    // its area come out right, which is what keeps the areas exact.
    const thickness = rowArea / short;
    const alongWidth = free.w <= free.h;
    let offset = 0;
    for (const area of row) {
      const length = area / thickness;
      out[index++] = alongWidth
        ? { x: free.x + offset, y: free.y / aspect, w: length, h: thickness / aspect }
        : { x: free.x, y: (free.y + offset) / aspect, w: thickness, h: length / aspect };
      offset += length;
    }
    free = alongWidth
      ? { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness }
      : { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h };
  }
  return out;
}
