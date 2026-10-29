// Port of TraceSift's `src/app/task-contribution.tsx`. Two levels of one chart, not two
// stacked charts: a second chart below would draw two different wholes at the same width.

import { useState } from "react";
import {
  BOUNDARY_MIN_SHARE, boundaryDrillSlices, taskBreakdownSlices, type ContributionSlice,
} from "@mobile-dev/shared/tracesift-contribution.ts";
import { formatMs, shortLocationLabel, taskCardLocations } from "@mobile-dev/shared/tracesift-labels.ts";
import type { TraceSiftBoundaryFrame, TraceSiftTaskCard } from "@mobile-dev/shared/tracesift.ts";
import {
  ContributionChart, ContributionDetailStack, SliceLegend, sliceColor, type ContributionChartKind,
} from "./contribution-chart.tsx";

export function TaskContribution({ card, kind, onFocus }: {
  card: TraceSiftTaskCard;
  kind: ContributionChartKind;
  onFocus: (nodeId: string) => void;
}) {
  /** Node id of the open feature, or null for the task itself. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const open = card.boundaryFrames.find(frame => frame.nodeId === openId) ?? null;
  const slices = open ? boundaryDrillSlices(open) : taskBreakdownSlices(card);
  // Defaults to the heaviest slice so the strip reads as a finding before any hover.
  const active = slices.find(slice => slice.key === activeKey) ?? slices[0];

  if (slices.length === 0) return null;

  const openFrame = (frame: TraceSiftBoundaryFrame) => { setOpenId(frame.nodeId); setActiveKey(null); };
  const surface = () => { setOpenId(null); setActiveKey(null); };

  // A residual has nothing to open, so it goes to the explorer, which can still name its contents.
  const activate = (slice: ContributionSlice) => {
    if (slice.boundary) return openFrame(slice.boundary);
    if (slice.culprit) return onFocus(slice.culprit.nodeId);
    return onFocus(open?.nodeId ?? "");
  };

  const chart = { slices, active, format: formatMs, onHover: setActiveKey, onOpen: activate };
  const part = kind === "bar" ? "band" : "tile";

  return <div className="contribution" data-kind={kind} data-level={open ? "frame" : "task"}>
    {open && <div className="contribution-crumbs">
      <button type="button" className="contribution-crumb" onClick={surface}>← the whole {formatMs(card.durationMs)}</button>
      <span className="contribution-crumb-current">inside {open.name}</span>
    </div>}

    <p className="contribution-lede">{open
      ? <>How {open.name}&apos;s {formatMs(open.totalMs)} divides. Each {part} is one function&apos;s own time — these add up, because a sample&apos;s cost belongs to exactly one frame.</>
      : <>How the {formatMs(card.durationMs)} divides between the features it entered. Each {part} is a frame of your own and everything it called — these add up, because no two of them overlap. Open one to see what burned its time.</>}</p>

    {/* Self time cannot name a frame that delegated its work, so the frames it called go here, not in the slice detail below. */}
    {open?.inside?.length ? <NestedRows boundary={open} onExplore={onFocus} /> : null}

    <ContributionChart kind={kind} {...chart} />
    <ContributionDetailStack slices={slices} active={active} render={slice =>
      <SliceDetail card={card} open={open} slice={slice} onOpen={() => activate(slice)} onExplore={onFocus} />
    } />
    <SliceLegend {...chart} />
  </div>;
}

// What a residual stands for. "Everything else, 2.27 s" is a dead end; two of these kinds are reasons to stop looking.
function residualText(open: TraceSiftBoundaryFrame | null, slice: ContributionSlice): string {
  if (slice.kind === "tail") {
    const count = slice.tailCount ?? 0;
    const frames = count === 1 ? "one more frame" : `${count} more frames`;
    return `${frames} of your own were entered in this task, each under ${Math.round(BOUNDARY_MIN_SHARE * 100)}% of it — ${formatMs(slice.ms)} between them. Explore lists them all.`;
  }
  if (slice.kind === "outside") {
    return "No frame of your own was on the stack here: framework and engine the whole way down, between and underneath your features.";
  }
  return `${formatMs(slice.ms)} inside ${open?.name ?? "this frame"} ran in functions each too small to draw a slice for — the cost here is spread rather than concentrated.`;
}

// Rows past this are a list rather than an answer.
const MAX_DETAIL_NESTED = 3;

// Below this the residual is rounding noise; at or above it the rows are a minority of the frame and must say so.
const MIN_NESTED_RESIDUAL = 0.1;

/**
 * The frames the feature called, by inclusive time, with wrappers folded into the path.
 * The self-time chart cannot name a frame that delegates; these rows cover that half.
 */
function NestedRows({ boundary, onExplore }: { boundary: TraceSiftBoundaryFrame; onExplore: (nodeId: string) => void }) {
  const frames = boundary.inside ?? [];
  const shown = frames.slice(0, MAX_DETAIL_NESTED);
  const rest = frames.length - shown.length;
  // Time the rows leave out is shown, so a list covering 22% of a frame does not read as the whole answer.
  const claimed = frames.reduce((sum, frame) => sum + frame.totalMs, 0);
  const residualMs = Math.max(0, boundary.totalMs - claimed);
  const residual = boundary.totalMs > 0 && residualMs / boundary.totalMs >= MIN_NESTED_RESIDUAL ? residualMs : 0;
  return <div className="contribution-nested">
    <p className="contribution-nested-label">what it called</p>
    <ul className="contribution-nested-list">
      {shown.map(frame => <li key={frame.nodeId}>
        <button type="button" className="contribution-nested-row" onClick={() => onExplore(frame.nodeId)} title={`${frame.name} — ${frame.shapeText}`}>
          <span className="contribution-nested-name">{frame.name}</span>
          <span className="contribution-nested-ms">{formatMs(frame.totalMs)}</span>
        </button>
      </li>)}
    </ul>
    {rest > 0 || residual > 0 ? <p className="contribution-nested-rest">
      {rest > 0 ? `${rest === 1 ? "1 more frame" : `${rest} more frames`} below it. ` : null}
      {residual > 0 ? `${formatMs(residual)} of ${boundary.name} is not in this list — its own body, and branches that reached nothing worth naming.` : null}
    </p> : null}
  </div>;
}

// Fixed footprint whichever slice is showing, so hovering across a bar does not move the card.
function SliceDetail({ card, open, slice, onOpen, onExplore }: {
  card: TraceSiftTaskCard;
  open: TraceSiftBoundaryFrame | null;
  slice: ContributionSlice;
  onOpen: () => void;
  onExplore: (nodeId: string) => void;
}) {
  const locations = taskCardLocations(card);
  const frame = slice.boundary ?? slice.culprit;
  const location = frame ? locations.shown(slice.name, frame.location) : undefined;

  // A boundary frame's own body is usually empty (it delegates), so the second figure differs from the first.
  const secondary = slice.boundary
    ? slice.boundary.selfMs >= 1 ? `${formatMs(slice.boundary.selfMs)} in its own body` : "none of it in its own body"
    : slice.culprit && slice.culprit.totalMs - slice.culprit.selfMs >= 1 ? `${formatMs(slice.culprit.totalMs)} with callees` : undefined;

  return <div className="contribution-detail">
    <div className="contribution-detail-head">
      <span className="contribution-swatch" style={{ background: sliceColor(slice) }} aria-hidden="true" />
      <span className="contribution-detail-name">{slice.name}</span>
      <span className="contribution-detail-share">{Math.round(slice.share * 100)}% of {open ? open.name : "task"}</span>
    </div>

    <div className="contribution-detail-figures">
      <span className="contribution-detail-ms">{formatMs(slice.ms)}</span>
      {secondary && <span className="contribution-detail-secondary">{secondary}</span>}
    </div>

    {frame ? <>
      {slice.culprit && slice.culprit.callers.length > 0 && <p className="contribution-detail-line">
        <span className="contribution-detail-label">via</span>{slice.culprit.callers.join(" › ")}
      </p>}
      {location && <p className="contribution-detail-line">
        <span className="contribution-detail-label">file</span><code title={location}>{shortLocationLabel(location)}</code>
      </p>}
      <p className="contribution-detail-shape">{frame.shapeText}</p>
    </> : <p className="contribution-detail-shape">{residualText(open, slice)}</p>}

    {slice.boundary?.inside?.length ? <NestedRows boundary={slice.boundary} onExplore={onExplore} /> : null}

    <div className="contribution-detail-actions">
      <button type="button" className="contribution-detail-open" onClick={onOpen}>
        {slice.boundary ? "Show what ran inside →" : "Open in Explore →"}
      </button>
      {slice.boundary && <button type="button" className="contribution-detail-aside" onClick={() => onExplore(slice.boundary!.nodeId)}>
        Open in Explore
      </button>}
    </div>
  </div>;
}
