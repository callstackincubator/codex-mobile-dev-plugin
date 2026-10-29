/**
 * How a task divides, computed from the card the analysis already shipped.
 * Ported line-for-line from TraceSift's `src/lib/contribution.ts` so this card and
 * the web card agree on bands, widths and colours. The payload carries boundary
 * frames and culprits, not slices; both ends derive the drawing.
 */

import type {
  TraceSiftBoundaryCulprit, TraceSiftBoundaryFrame, TraceSiftReactCard, TraceSiftTaskCard,
} from "./tracesift.ts";

/** Slices a level carries before folding its tail; also the palette size. */
export const CHART_SLICES = 8;

/** Below this share a slice is narrower than its 2px gap and reads as a seam. */
export const MIN_SLICE_SHARE = 0.005;

/** The server's own floor for a boundary frame, which the tail sentence quotes. */
export const BOUNDARY_MIN_SHARE = 0.02;

/** Only `boundary` and `culprit` are frames that ran; the rest are residuals that make a level sum to its whole. */
export type SliceKind = "boundary" | "culprit" | "tail" | "outside" | "rest";

export interface ContributionSlice {
  /** Stable across renders: a node id, or the residual's kind. */
  key: string;
  kind: SliceKind;
  name: string;
  /** Share of this level's whole, 0-1. The width or area the slice is drawn at. */
  share: number;
  /** Inclusive time at the top level, self time inside a feature. */
  ms: number;
  /** Categorical colour slot from 0, or -1 for a residual. Fixed by ranking position, not by how many slices survive the fold. */
  colorIndex: number;
  boundary?: TraceSiftBoundaryFrame;
  culprit?: TraceSiftBoundaryCulprit;
  /** How many frames the `tail` slice stands for. */
  tailCount?: number;
}

export type ReactSliceKind = "component" | "tail" | "outside";

export interface ReactSlice {
  key: string;
  kind: ReactSliceKind;
  name: string;
  share: number;
  ms: number;
  colorIndex: number;
  culprit?: TraceSiftReactCard["culprits"][number];
  tailCount?: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** A React commit partitioned by component self time and its two residuals. */
export function reactCommitSlices(card: TraceSiftReactCard): ReactSlice[] {
  const duration = card.durationMs;
  if (duration <= 0) return [];

  const slices: ReactSlice[] = [];
  let shownMs = 0;
  for (const [index, culprit] of card.culprits.slice(0, CHART_SLICES).entries()) {
    const share = culprit.selfMs / duration;
    if (share < MIN_SLICE_SHARE) continue;
    shownMs += culprit.selfMs;
    slices.push({
      key: culprit.componentId, kind: "component", name: culprit.component,
      share, ms: culprit.selfMs, colorIndex: index, culprit,
    });
  }

  const culpritMs = card.culprits.reduce((sum, culprit) => sum + culprit.selfMs, 0);
  const tailMs = card.culpritTailMs + Math.max(0, culpritMs - shownMs);
  const tailCount = card.culpritTailCount + (card.culprits.length - slices.length);
  if (tailCount > 0 && tailMs / duration >= MIN_SLICE_SHARE) {
    slices.push({
      key: "tail", kind: "tail",
      name: tailCount === 1 ? "1 smaller component" : `${tailCount} smaller components`,
      share: tailMs / duration, ms: round1(tailMs), colorIndex: -1, tailCount,
    });
  }

  if (card.unattributedMs / duration >= MIN_SLICE_SHARE) {
    slices.push({
      key: "outside", kind: "outside", name: "React itself, no component",
      share: card.unattributedMs / duration, ms: card.unattributedMs, colorIndex: -1,
    });
  }
  return slices;
}

/** A residual, or nothing when it is too thin to draw. */
function residual(
  kind: SliceKind, name: string, ms: number, whole: number, extra: Partial<ContributionSlice> = {},
): ContributionSlice | undefined {
  if (whole <= 0 || ms / whole < MIN_SLICE_SHARE) return undefined;
  return { key: kind, kind, name, share: ms / whole, ms: round1(ms), colorIndex: -1, ...extra };
}

/** The task divided by feature: one slice per boundary frame, then the two residuals (so a bar that stops at 63% is not read as the whole). */
export function taskBreakdownSlices(card: TraceSiftTaskCard): ContributionSlice[] {
  const duration = card.durationMs;
  if (duration <= 0) return [];

  const slices: ContributionSlice[] = [];
  let shownMs = 0;
  // colorIndex counts frames offered a slot, so folding one into the tail doesn't shift later colours.
  for (const [index, boundary] of card.boundaryFrames.slice(0, CHART_SLICES).entries()) {
    const share = boundary.totalMs / duration;
    if (share < MIN_SLICE_SHARE) continue;
    shownMs += boundary.totalMs;
    slices.push({ key: boundary.nodeId, kind: "boundary", name: boundary.name, share, ms: boundary.totalMs, colorIndex: index, boundary });
  }

  // Frames folded by the share floor are already in the server's tail, so derive the tail from what is drawn.
  const drawnBoundaryMs = card.boundaryFrames.reduce((sum, frame) => sum + frame.totalMs, 0);
  const tailMs = card.boundaryTailMs + Math.max(0, drawnBoundaryMs - shownMs);
  const tailCount = card.boundaryTailCount + (card.boundaryFrames.length - slices.length);
  const tail = residual("tail", tailCount === 1 ? "1 smaller entry point" : `${tailCount} smaller entry points`, tailMs, duration, { tailCount });
  if (tail && tailCount > 0) slices.push(tail);

  const outside = residual("outside", "never entered your code", card.outsideBoundariesMs, duration);
  if (outside) slices.push(outside);
  return slices;
}

/** One feature divided by its culprits' self time. The whole is the feature's inclusive time, not the task's. */
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
 * Squarified treemap (Bruls, Huizing, van Wijk): areas proportional to `values`.
 * `aspect` is the container's height over its width; returned rects are
 * normalised to 0-1 on both axes.
 */
export function squarify(values: readonly number[], aspect: number): TreemapRect[] {
  const empty = { x: 0, y: 0, w: 0, h: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || aspect <= 0) return values.map(() => empty);

  // Container is one unit wide and `aspect` tall, so the ratios below are real.
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

    // Laid along the shorter side; thickness keeps the areas exact.
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
