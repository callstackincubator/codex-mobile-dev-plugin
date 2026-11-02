// One finding laid out like a recording card's track: heading, where it sits (or Back), chart, part in focus, legend.

import { useState, type ReactNode } from "react";
import { ChevronLeftIcon } from "lucide-react";
import { InfoPopover, SegmentedControl } from "../card-parts.tsx";
import {
  ContributionChart, SliceLegend, SliceSummary, type ChartSlice, type ContributionChartKind, type MsFormat,
} from "./contribution-chart.tsx";

const SEVERITY: Record<string, string | undefined> = { high: "Slow", medium: "Over budget" };
const KINDS = [{ value: "bar", label: "Bar" }, { value: "treemap", label: "Treemap" }] as const;

export interface FindingViewProps<S extends ChartSlice> {
  rank: number;
  name: string;
  duration: string;
  severity?: string;
  info: string;
  /** Where the finding sits, shown until a part is opened. */
  path: string;
  /** The part being looked inside, with the way back out of it. */
  inside?: { name: string; total: string; onBack: () => void };
  kind: ContributionChartKind;
  onKind: (kind: ContributionChartKind) => void;
  slices: S[];
  format: MsFormat;
  legendRows: number;
  meta: (slice: S) => ReactNode;
  action: (slice: S) => { label: string; run: () => void };
  onOpen: (slice: S) => void;
}

/** Key it by level, so the part in focus starts at the heaviest slice of what the chart now divides. */
export function FindingView<S extends ChartSlice>({ rank, name, duration, severity, info, path, inside, kind, onKind, slices, format, legendRows, meta, action, onOpen }: FindingViewProps<S>) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = slices.find(slice => slice.key === activeKey) ?? slices[0];
  const severityLabel = severity ? SEVERITY[severity] : undefined;
  return <section className="tracesift-finding" aria-label={`Finding ${rank}: ${name}`}>
    <div className="recording-track-heading">
      <h3><span className="tracesift-rank">#{rank}</span>{name}</h3>
      <InfoPopover label={name}>{info}</InfoPopover>
      <span className="recording-track-metric"><span aria-hidden="true">·</span><strong>{duration}</strong></span>
      {severityLabel && <span className="tracesift-severity" data-severity={severity}>{severityLabel}</span>}
      <SegmentedControl label="Chart" options={KINDS} value={kind} onChange={onKind} />
    </div>
    {/* Always one line, so opening a part never moves what is below it. */}
    <div className="tracesift-level">
      {inside
        ? <><button type="button" className="tracesift-back" onClick={inside.onBack}><ChevronLeftIcon />Back</button><span className="tracesift-level-text">Inside <strong>{inside.name}</strong> · {inside.total}</span></>
        : <span className="tracesift-level-text" title={path}>{path}</span>}
    </div>
    {active
      ? <>
        <ContributionChart kind={kind} slices={slices} active={active} format={format} onHover={setActiveKey} onOpen={onOpen} />
        <SliceSummary slice={active} format={format} meta={meta(active)} action={action(active)} />
        <SliceLegend slices={slices} active={active} format={format} onHover={setActiveKey} onOpen={onOpen} rows={legendRows} />
      </>
      : <p className="tracesift-empty" role="status">This finding has no measured time to divide.</p>}
  </section>;
}
