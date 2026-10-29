// A React commit divided by each component's own render time; every part leads to Explore.

import { reactCommitSlices, type ReactSlice } from "@mobile-dev/shared/tracesift-contribution.ts";
import { findingName, formatReactMs } from "@mobile-dev/shared/tracesift-labels.ts";
import type { TraceSiftReactCard } from "@mobile-dev/shared/tracesift.ts";
import type { ContributionChartKind } from "./contribution-chart.tsx";
import { FindingView } from "./finding.tsx";
import { findingPath } from "./task-contribution.tsx";

const hookLabel = (hook: string) => /^\d+$/.test(hook) ? `#${hook}` : hook;
const sentence = (text: string | undefined) => text ? `${text.replace(/[.\s]+$/, "")}. ` : "";
const fileName = (location: string) => location.split(/[\\/]/).pop() || location;

/** Why a component rendered, as briefly as the summary line allows. */
export function renderReason(culprit: TraceSiftReactCard["culprits"][number]): string {
  if (culprit.cause === "unknown") return "render reason not recorded";
  if (culprit.cause === "nothing-changed") return "nothing changed";
  if (culprit.cause === "first-mount") return "first mount";
  if (culprit.changedProps.length > 0) return `props changed: ${culprit.changedProps.slice(0, 3).join(", ")}`;
  if (culprit.changedHooks.length > 0) return `hooks changed: ${culprit.changedHooks.slice(0, 3).map(hookLabel).join(", ")}`;
  return `${culprit.cause} changed`;
}

export function ReactFinding({ card, rank, kind, onKind, onExplore }: {
  card: TraceSiftReactCard;
  rank: number;
  kind: ContributionChartKind;
  onKind: (kind: ContributionChartKind) => void;
  onExplore: () => void;
}) {
  const slices = reactCommitSlices(card);
  const wasted = card.wasted?.count ? ` · ${card.wasted.count} ${card.wasted.count === 1 ? "render" : "renders"} changed nothing` : "";
  const meta = (slice: ReactSlice) => {
    const culprit = slice.culprit;
    if (culprit) return <>{culprit.sourceHint && <><code title={culprit.sourceHint}>{fileName(culprit.sourceHint)}</code> · </>}{renderReason(culprit)}</>;
    if (slice.kind === "tail") return `${slice.tailCount ?? 0} components, each too small to draw`;
    return "React walking and committing the tree";
  };
  return <FindingView
    rank={rank}
    name={findingName(card)}
    duration={formatReactMs(card.durationMs)}
    severity={card.severity}
    info={`${sentence(card.headline)}${sentence(card.causeline)}Each part is one component's own render time; React's own work is shown separately.`}
    path={`${findingPath(card)}${wasted}`}
    kind={kind}
    onKind={onKind}
    slices={slices}
    format={formatReactMs}
    legendRows={slices.length}
    meta={meta}
    action={() => ({ label: "Explore", run: onExplore })}
    onOpen={onExplore}
  />;
}
