// A CPU task as a finding. Two levels of one chart, not two stacked charts, which would
// draw two different wholes at the same width.

import { useState } from "react";
import { boundaryDrillSlices, taskBreakdownSlices, type ContributionChartKind, type ContributionSlice } from "../../tracesift/contribution.ts";
import { findingName, formatMs } from "../../tracesift/labels.ts";
import type { TraceSiftTaskCard } from "@mobile-dev/shared/tracesift.ts";
import { FindingView } from "./finding.tsx";

/** Where a finding sits: the path above its own frame, or its shape when it has no path. */
export function findingPath(card: { pathline?: string; shapeline?: string }) {
  const above = card.pathline?.split(" › ").slice(0, -1) ?? [];
  return above.length > 0 ? `in ${above.join(" › ")}` : card.shapeline ?? "";
}

const sentence = (text: string | undefined) => text ? `${text.replace(/[.\s]+$/, "")}. ` : "";
const fileName = (location: string) => location.split(/[\\/]/).pop() || location;
const calls = (count: number) => `${count} ${count === 1 ? "call" : "calls"}`;

/** What a residual stands for, since "everything else" is a dead end on its own. */
function residual(slice: ContributionSlice) {
  if (slice.kind === "tail") return `${slice.tailCount ?? 0} frames of yours, each under 2% of the task`;
  if (slice.kind === "outside") return "Framework and engine only, no frame of yours";
  return "Many functions, each too small to draw";
}

export function TaskFinding({ card, rank, kind, onKind, onFocus }: {
  card: TraceSiftTaskCard;
  rank: number;
  kind: ContributionChartKind;
  onKind: (kind: ContributionChartKind) => void;
  onFocus: (nodeId: string) => void;
}) {
  /** Node id of the open feature, or null for the task itself. */
  const [openId, setOpenId] = useState<string | null>(null);
  const open = card.boundaryFrames.find(frame => frame.nodeId === openId) ?? null;
  const slices = open ? boundaryDrillSlices(open) : taskBreakdownSlices(card);
  let legendRows = taskBreakdownSlices(card).length;
  for (const frame of card.boundaryFrames) legendRows = Math.max(legendRows, boundaryDrillSlices(frame).length);

  // A residual has nothing to open, so it goes to the explorer, which can still name its contents.
  const explore = (slice: ContributionSlice) => onFocus(slice.culprit?.nodeId ?? open?.nodeId ?? "");
  const activate = (slice: ContributionSlice) => {
    if (slice.boundary) setOpenId(slice.boundary.nodeId);
    else explore(slice);
  };
  const meta = (slice: ContributionSlice) => {
    const frame = slice.boundary ?? slice.culprit;
    if (!frame) return residual(slice);
    return <>{frame.location && <><code title={frame.location}>{fileName(frame.location)}</code> · </>}{calls(frame.invocations)}</>;
  };
  const info = open
    ? `Inside ${open.name}, each part is one function's own time. The parts add up to its ${formatMs(open.totalMs)}, because a sample's cost belongs to exactly one frame.`
    : `${sentence(card.headline)}${sentence(card.shapeline)}Each part is a frame of yours with everything it called; the parts add up to the task. Click one to look inside.`;

  return <FindingView
    key={open?.nodeId ?? "task"}
    rank={rank}
    name={findingName(card)}
    duration={formatMs(card.durationMs)}
    info={info}
    path={findingPath(card)}
    inside={open ? { name: open.name, total: formatMs(open.totalMs), onBack: () => setOpenId(null) } : undefined}
    kind={kind}
    onKind={onKind}
    slices={slices}
    format={formatMs}
    legendRows={legendRows}
    meta={meta}
    action={slice => slice.boundary ? { label: "Look inside", run: () => activate(slice) } : { label: "Explore", run: () => explore(slice) }}
    onOpen={activate}
  />;
}
