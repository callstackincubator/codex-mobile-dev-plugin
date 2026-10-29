import { useState } from "react";
import { reactCommitSlices, type ContributionChartKind, type ReactSlice } from "../../tracesift/contribution.ts";
import { formatReactMs, shortLocationLabel } from "../../tracesift/labels.ts";
import type { TraceSiftReactCard } from "@mobile-dev/shared/tracesift.ts";
import {
  ContributionChart, ContributionDetailStack, SliceLegend, sliceColor,
} from "./contribution-chart.tsx";

const hookLabel = (hook: string) => /^\d+$/.test(hook) ? `#${hook}` : hook;

export function reactCulpritShape(culprit: TraceSiftReactCard["culprits"][number]): string {
  const changed = culprit.changedProps.length > 0
    ? ` · props ${culprit.changedProps.slice(0, 3).join(", ")}`
    : culprit.changedHooks.length > 0
      ? ` · hooks ${culprit.changedHooks.slice(0, 3).map(hookLabel).join(", ")}`
      : "";
  const compiler = culprit.compiledWithForget ? " · React Compiler" : "";
  if (culprit.cause === "unknown") return `render reason not recorded${compiler}`;
  const cause = culprit.cause === "nothing-changed" ? "re-rendered with nothing changed"
    : culprit.cause === "first-mount" ? "first mount"
      : `${culprit.cause} changed`;
  return `${cause}${changed}${compiler}`;
}

function residualText(card: TraceSiftReactCard, slice: ReactSlice): string {
  if (slice.kind === "tail") {
    const count = slice.tailCount ?? 0;
    const components = count === 1 ? "one more component" : `${count} more components`;
    return `${components} rendered in this commit, each too small to draw a slice for — ${formatReactMs(slice.ms)} between them. A cost spread this thin is fixed at the boundary that re-rendered them, not inside any one of them.`;
  }
  return `No component's own body was running here: React walking the tree, comparing it and committing it. ${formatReactMs(slice.ms)} of the ${formatReactMs(card.durationMs)} is the reconciler's own work, which no change to a component removes.`;
}

const CLASS_NOTE: Record<string, string | undefined> = {
  library: "a library component", framework: "React's own wrapper",
  host: "a host view", unnamed: "not named by the recording",
};

function ReactSliceDetail({ card, slice, onExplore }: {
  card: TraceSiftReactCard;
  slice: ReactSlice;
  onExplore: () => void;
}) {
  const culprit = slice.culprit;
  const via = culprit && culprit.path.length > 1 ? culprit.path.slice(0, -1).join(" › ") : undefined;
  const secondary = culprit ? CLASS_NOTE[culprit.componentClass] : undefined;
  return <div className="contribution-detail">
    <div className="contribution-detail-head">
      <span className="contribution-swatch" style={{ background: sliceColor(slice) }} aria-hidden="true" />
      <span className="contribution-detail-name">{slice.name}</span>
      <span className="contribution-detail-share">{Math.round(slice.share * 100)}% of commit</span>
    </div>
    <div className="contribution-detail-figures">
      <span className="contribution-detail-ms">{formatReactMs(slice.ms)}</span>
      {secondary && <span className="contribution-detail-secondary">{secondary}</span>}
    </div>
    {culprit ? <>
      {via && <p className="contribution-detail-line" title={via}>
        <span className="contribution-detail-label">via</span>{via}
      </p>}
      {culprit.sourceHint && <p className="contribution-detail-line">
        <span className="contribution-detail-label">file</span>
        <code title={culprit.sourceHint}>{shortLocationLabel(culprit.sourceHint)}</code>
      </p>}
      <p className="contribution-detail-shape">{reactCulpritShape(culprit)}</p>
    </> : <p className="contribution-detail-shape">{residualText(card, slice)}</p>}
    <div className="contribution-detail-actions">
      <button type="button" className="contribution-detail-open" onClick={onExplore}>
        {culprit ? "Find this render in Explore →" : "Open the commit in Explore →"}
      </button>
    </div>
  </div>;
}

export function ReactFallbackRows({ card }: { card: TraceSiftReactCard }) {
  const worthARow = card.culprits.filter(culprit => culprit.percentOfCommit >= 5);
  const shown = (worthARow.length > 0 ? worthARow : card.culprits.slice(0, 1)).slice(0, 8);
  if (shown.length === 0) return null;
  return <div className="hot-path-rows">
    {shown.map(culprit => {
      const via = culprit.path.length > 1 ? culprit.path.slice(0, -1).join(" › ") : undefined;
      return <div className="hot-path-row" key={culprit.componentId}>
        {culprit.sourceHint && <p className="row-location" title={culprit.sourceHint}>
          <span className="row-location-label">file</span><code>{shortLocationLabel(culprit.sourceHint)}</code>
        </p>}
        <strong className="row-title">{culprit.component}</strong>
        {via && <p className="row-callers" title={via}>
          <span className="row-callers-label">via</span>{via}
        </p>}
        <div className="row-figure-line">
          <span className="row-figure">{formatReactMs(culprit.selfMs)}</span>
          <span className="row-share">{Math.round(culprit.percentOfCommit)}% of commit</span>
        </div>
        <div className="row-bar-track" aria-hidden="true">
          <span className="row-bar-fill" style={{ width: `${culprit.percentOfCommit}%` }} />
        </div>
        <p className="row-shape">{reactCulpritShape(culprit)}</p>
      </div>;
    })}
  </div>;
}

export function ReactContribution({ card, kind, onExplore }: {
  card: TraceSiftReactCard;
  kind: ContributionChartKind;
  onExplore: () => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const slices = reactCommitSlices(card);
  const active = slices.find(slice => slice.key === activeKey) ?? slices[0];
  if (!active) return null;

  const chart = { slices, active, format: formatReactMs, onHover: setActiveKey, onOpen: onExplore };
  return <div className="contribution" data-kind={kind} data-level="commit">
    <p className="contribution-lede">
      How the {formatReactMs(card.durationMs)} divides between the components that rendered. Each {kind === "bar" ? "band" : "tile"} is one component&apos;s own render time — these add up, because React charges a component&apos;s time to it alone and never to its children.
    </p>
    <ContributionChart kind={kind} {...chart} />
    <ContributionDetailStack slices={slices} active={active} render={slice =>
      <ReactSliceDetail card={card} slice={slice} onExplore={onExplore} />
    } />
    <SliceLegend {...chart} />
  </div>;
}
