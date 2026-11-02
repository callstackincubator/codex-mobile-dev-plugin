import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { EyeIcon, EyeOffIcon, MessageCircleIcon } from "lucide-react";
import { comparisonDuration, summarizeComparison } from "@mobile-dev/shared/performance-comparison.ts";
import type { PerformanceRecording, RecordingRange, RecordingSummary } from "@mobile-dev/shared/recordings.ts";
import type { ComparisonController } from "../comparison-controller.ts";
import { COMPARISON_COLORS, createComparisonSeries, findSharpChanges } from "../comparison-series.ts";
import type { ComparisonMetric, ComparisonPoint, SharpChange } from "../comparison-series.ts";
import { countUiEvent, recordUiTiming, setUiGauge } from "../telemetry.ts";
import { Button } from "./ui/button";
import { InfoPopover, SegmentedControl } from "./card-parts";

const MIB = 1048576;
type MemoryScale = "absolute" | "change";
type RunSummary = RecordingSummary | null;

function seconds(value: number) { return `${value.toFixed(1)}s`; }
/** A sign that follows the rounded figure, so −0.4 reads 0 rather than −0. */
function signed(value: number, digits = 0) {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(digits)}`;
}
function clock(iso: string | undefined) {
  if (iso === undefined) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The run's number in its colour: the one key that ties every chart, bar and lane to the run list. */
function RunMarker({ index }: { index: number }) {
  return <span className="comparison-marker" style={{ background: COMPARISON_COLORS[index] }} aria-hidden="true">{index + 1}</span>;
}

/** Each run's figure beside a chart's name, as the recording card prints one. */
function TrackMetric({ label, values, hiddenIds, recordings }: {
  label: string; values: Array<{ index: number; text: string }>; hiddenIds: ReadonlySet<string>; recordings: PerformanceRecording[];
}) {
  return <span className="recording-track-metric comparison-track-metric">
    <span aria-hidden="true">·</span><span>{label}</span>
    {values.map(({ index, text }) => <span key={index} className="comparison-run-value" data-hidden={hiddenIds.has(recordings[index].id) || undefined}>
      <span className="comparison-dot" style={{ background: COMPARISON_COLORS[index] }} aria-hidden="true" />
      <strong>{text}</strong>
    </span>)}
  </span>;
}

function ComparisonTooltip({ active, label, payload, format }: TooltipContentProps<number, string> & { format: (value: number) => string }) {
  if (!active || !payload?.length) return null;
  return <div className="comparison-tooltip">
    <b>{seconds(Number(label))}</b>
    {payload.map(entry => {
      const index = Number(String(entry.dataKey).slice(3));
      if (typeof entry.value !== "number") return null;
      return <div key={index}><RunMarker index={index} /><span>{format(entry.value)}</span></div>;
    })}
  </div>;
}

function ComparisonChart({ label, info, metric, toolbar, data, recordings, hiddenIds, duration, range, format, axis, onDrag, onSelect }: {
  label: string; info: ReactNode; metric: ReactNode; toolbar?: ReactNode; data: ComparisonPoint[]; recordings: PerformanceRecording[];
  hiddenIds: ReadonlySet<string>; duration: number; range?: RecordingRange; format: (value: number) => string;
  axis: { domain: [number | "auto" | ((max: number) => number), number | "auto" | ((max: number) => number)]; tick: (value: number) => string };
  onDrag: (range?: RecordingRange) => void; onSelect: (range?: RecordingRange) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | undefined>(undefined);
  function timeAt(event: PointerEvent<HTMLDivElement>) {
    const bounds = root.current!.getBoundingClientRect();
    const width = Math.max(1, bounds.width - 64);
    const fraction = (event.clientX - bounds.left - 52) / width;
    const clamped = Math.max(0, Math.min(1, fraction));
    const rounded = Math.round(clamped * duration * 10) / 10;
    return Math.min(duration, rounded);
  }
  function selection(event: PointerEvent<HTMLDivElement>) {
    if (anchor.current === undefined) return;
    const time = timeAt(event);
    const start = Math.min(anchor.current, time);
    const end = Math.max(anchor.current, time);
    if (end > start) return { start, end };
  }
  return <section className="recording-track" aria-label={label}>
    <div className="recording-track-heading"><h3>{label}</h3><InfoPopover label={label}>{info}</InfoPopover>{metric}{toolbar}</div>
    <div ref={root} className="recording-chart" onPointerDown={event => {
      if (event.button !== 0) return;
      anchor.current = timeAt(event);
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => { if (anchor.current !== undefined) onDrag(selection(event)); }} onPointerUp={event => {
      if (anchor.current === undefined) return;
      const next = selection(event);
      anchor.current = undefined;
      onDrag(undefined);
      onSelect(next);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { anchor.current = undefined; onDrag(undefined); }}>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis dataKey="time" type="number" domain={[0, duration]} allowDataOverflow tickFormatter={seconds} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis width={52} domain={axis.domain} tickFormatter={axis.tick} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip filterNull isAnimationActive={false} content={props => <ComparisonTooltip {...props as TooltipContentProps<number, string>} format={format} />} />
          {recordings.map((recording, index) => <Line key={recording.id} type="linear" dataKey={`run${index}`}
            name={`${index + 1}`} stroke={COMPARISON_COLORS[index]} strokeWidth={2}
            strokeDasharray={index > 2 ? "6 3" : undefined} hide={hiddenIds.has(recording.id)}
            dot={false} activeDot={{ r: 3.5, strokeWidth: 1.5, stroke: "var(--background)" }} connectNulls={false} isAnimationActive={false} />)}
          {range && <ReferenceArea className="recording-range-highlight" x1={range.start} x2={range.end} fill="#2583ff" fillOpacity={0.12} stroke="#2583ff" strokeOpacity={0.5} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </section>;
}

/** How a sharp change reads in words: a step names both ends, a spike or dip its turning point. */
function describeChange(change: SharpChange) {
  const { values } = change;
  const from = values[0];
  const to = values[values.length - 1];
  if (change.metric === "memory") return `Memory ${signed(to - from)} MiB`;
  const name = change.metric === "cpu" ? "CPU" : "FPS";
  const unit = change.metric === "cpu" ? "%" : "";
  const high = Math.max(...values);
  const low = Math.min(...values);
  const swing = high - low;
  if (high > Math.max(from, to) + swing * 0.3) return `${name} spike to ${high.toFixed(0)}${unit}`;
  if (low < Math.min(from, to) - swing * 0.3) return `${name} dip to ${low.toFixed(0)}${unit}`;
  return `${name} ${from.toFixed(0)}${unit} → ${to.toFixed(0)}${unit}`;
}

/** A change as a range the controller accepts: tenths of a second, inside the timeline. */
function changeRange(change: SharpChange, duration: number): RecordingRange {
  const start = Math.max(0, Math.floor(change.start * 10) / 10);
  const end = Math.min(duration, Math.ceil(change.end * 10) / 10);
  return { start, end: Math.max(end, Math.min(duration, start + 0.1)) };
}

/** Each run's lane on the shared timeline, lit where it changed sharply, plus the same changes in words. */
function SharpChanges({ recordings, changes, duration, range, hiddenIds, selected, onSelect, onClear }: {
  recordings: PerformanceRecording[]; changes: SharpChange[][]; duration: number; range?: RecordingRange;
  hiddenIds: ReadonlySet<string>; selected?: RecordingRange; onSelect: (change: SharpChange) => void; onClear: () => void;
}) {
  const position = (time: number) => Math.max(0, Math.min(100, time / duration * 100));
  const all = changes.flat().sort((left, right) => left.start - right.start);
  const isCurrent = (change: SharpChange) => {
    if (selected === undefined) return false;
    const target = changeRange(change, duration);
    return selected.start === target.start && selected.end === target.end;
  };
  return <section className="recording-overview comparison-changes" aria-label="Sharp changes">
    <div className="recording-section-heading"><h3>Sharp changes</h3>
      <InfoPopover label="sharp changes">Each lane is one run on the shared timeline. Marks show where CPU moved 10 points, memory 50 MiB or display FPS 15 between readings a second apart. A steady run stays empty. Click a change to select it, or drag across any chart to select a range in every run.</InfoPopover>
      {selected && <button type="button" className="recording-clear-range" onClick={onClear}>Clear</button>}
    </div>
    <div className="comparison-lanes">
      <div className="comparison-lane-markers">{recordings.map((recording, index) => <span key={recording.id} data-hidden={hiddenIds.has(recording.id) || undefined}><RunMarker index={index} /></span>)}</div>
      <div className="comparison-lane-stack">
        {recordings.map((recording, index) => <div key={recording.id} className="comparison-lane" data-hidden={hiddenIds.has(recording.id) || undefined}
          style={{ "--lane": COMPARISON_COLORS[index], "--lane-width": `${position(recording.durationSeconds)}%` } as CSSProperties}>
          {changes[index].map(change => <span key={`${change.metric}-${change.start}`} className="comparison-lane-change" data-current={isCurrent(change) || undefined}
            title={`Run ${index + 1}: ${describeChange(change).replaceAll("\u00a0", " ")}, ${seconds(change.start)}–${seconds(change.end)}`}
            style={{ left: `${position(change.start)}%`, width: `${position(change.end) - position(change.start)}%` }} onClick={() => onSelect(change)} />)}
        </div>)}
        {range && <span className="comparison-lane-range" style={{ left: `${position(range.start)}%`, width: `${position(range.end) - position(range.start)}%` }} />}
      </div>
    </div>
    <div className="recording-overview-labels comparison-lane-labels"><span>0.0s</span><span>{seconds(duration)}</span></div>
    {all.length > 0
      ? <ul className="comparison-change-list">{all.map(change => <li key={`${change.run}-${change.metric}-${change.start}`}>
        <button type="button" className="comparison-change" aria-pressed={isCurrent(change)} onClick={() => onSelect(change)}>
          <RunMarker index={change.run} />
          <span className="comparison-change-copy"><span>{describeChange(change)}</span><small>{seconds(change.start)}–{seconds(change.end)}</small></span>
        </button>
      </li>)}</ul>
      : <p className="comparison-changes-empty">No sharp changes in any run.</p>}
  </section>;
}

type Measure = { key: string; label: string; digits: number; pick: (summary: RunSummary) => number | null | undefined; format: (value: number) => string };
const MEASURES: Measure[] = [
  { key: "cpu-average", label: "Average CPU", digits: 1, pick: summary => summary?.averageCpuPercent, format: value => `${value.toFixed(1)}%` },
  { key: "cpu-peak", label: "Peak CPU", digits: 1, pick: summary => summary?.peakCpuPercent, format: value => `${value.toFixed(1)}%` },
  { key: "memory", label: "Memory Δ (MiB)", digits: 0, pick: summary => summary?.memoryChangeBytes == null ? null : summary.memoryChangeBytes / MIB, format: value => signed(value) },
  { key: "fps", label: "Average FPS", digits: 1, pick: summary => summary?.averageFps, format: value => value.toFixed(1) },
  { key: "jank", label: "Jank rate", digits: 1, pick: summary => summary?.frameStats?.jankRatePercent, format: value => `${value.toFixed(1)}%` },
  { key: "p95", label: "P95 frame interval", digits: 2, pick: summary => summary?.frameStats?.p95FrameIntervalMs, format: value => `${value.toFixed(2)} ms` },
];

/** One small bar chart per measure: the runs side by side on a shared scale. */
function SummaryMeasure({ measure, summaries, recordings, hiddenIds }: {
  measure: Measure; summaries: RunSummary[]; recordings: PerformanceRecording[]; hiddenIds: ReadonlySet<string>;
}) {
  const values = summaries.map(summary => measure.pick(summary) ?? null);
  let largest = 0;
  for (const value of values) if (value !== null) largest = Math.max(largest, Math.abs(value));
  return <dl className="comparison-measure">
    <dt>{measure.label}</dt>
    <dd>{values.map((value, index) => {
      const baseline = values[0];
      const difference = index > 0 && value !== null && baseline !== null ? ` · ${signed(value - baseline, measure.digits)} vs run 1` : "";
      return <div key={recordings[index].id} className="comparison-bar-row" data-hidden={hiddenIds.has(recordings[index].id) || undefined} title={`${recordings[index].title}${difference}`}>
        <RunMarker index={index} />
        <span className="comparison-bar-track"><span style={{ width: value === null || largest === 0 ? 0 : `${Math.abs(value) / largest * 100}%`, background: COMPARISON_COLORS[index] }} /></span>
        <span className="comparison-bar-value">{value === null ? "—" : measure.format(value)}</span>
      </div>;
    })}</dd>
  </dl>;
}

function runMeta(recording: PerformanceRecording, showDevice: boolean) {
  const parts = [`${recording.durationSeconds}s`];
  if (showDevice) parts.unshift(recording.deviceName);
  const saved = clock(recording.completedAt);
  if (saved) parts.push(`saved ${saved}`);
  if (recording.status === "failed") parts.push("failed, partial run");
  return parts.join(" · ");
}

export function ComparisonCard({ controller }: { controller: ComparisonController }) {
  const renderStartedAt = performance.now();
  useLayoutEffect(() => {
    const elapsed = performance.now() - renderStartedAt;
    recordUiTiming("ui.comparison.commit", elapsed);
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const comparison = state.comparison;
  const [drag, setDrag] = useState<RecordingRange>();
  const [memoryScale, setMemoryScale] = useState<MemoryScale>("absolute");
  const range = drag ?? state.range;
  const derived = useMemo(() => {
    if (comparison === undefined) return;
    const startedAt = performance.now();
    const metrics: ComparisonMetric[] = ["cpu", "rss", "physical-footprint", "fps"];
    const tracks = metrics.map(metric => {
      const data = createComparisonSeries(comparison.recordings, metric);
      let available = false;
      for (const row of data) {
        for (let index = 0; index < comparison.recordings.length; index++) {
          if (row[`run${index}`] !== null) available = true;
        }
        if (available) break;
      }
      return { metric, data, available };
    });
    const total = summarizeComparison(comparison.recordings);
    const duration = comparisonDuration(comparison.recordings);
    const changes = findSharpChanges(comparison.recordings);
    let points = 0;
    for (const track of tracks) points += track.data.length;
    setUiGauge("ui.comparison.points", points);
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.comparison.derive", elapsed);
    return { tracks, total, duration, changes };
  }, [comparison]);
  const selected = useMemo(() => {
    if (comparison === undefined || derived === undefined) return;
    if (range === undefined) return derived.total;
    const startedAt = performance.now();
    const summaries = summarizeComparison(comparison.recordings, range);
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.comparison.summary", elapsed);
    return summaries;
  }, [comparison, derived, range]);
  // Change plots each run against its first reading, so runs of different sizes share a scale.
  const memoryData = useMemo(() => {
    if (derived === undefined || memoryScale === "absolute") return;
    const shifted = new Map<ComparisonMetric, ComparisonPoint[]>();
    for (const track of derived.tracks) {
      if (track.metric !== "rss" && track.metric !== "physical-footprint") continue;
      const first: Record<string, number> = {};
      shifted.set(track.metric, track.data.map(row => {
        const next: ComparisonPoint = { time: row.time };
        for (const key of Object.keys(row)) {
          if (key === "time") continue;
          const value = row[key];
          if (value !== null && first[key] === undefined) first[key] = value;
          next[key] = value === null ? null : value - first[key];
        }
        return next;
      }));
    }
    return shifted;
  }, [derived, memoryScale]);
  if (comparison === undefined || derived === undefined || selected === undefined) {
    return <article className="recording-card"><p role="status">Loading performance comparison…</p>{state.error && <p role="alert">{state.error}</p>}</article>;
  }
  const recordings = comparison.recordings;
  const summaries = selected.map(run => run.summary);
  const tracks = derived.tracks.filter(track => track.available);
  const memoryTracks = tracks.filter(track => track.metric === "rss" || track.metric === "physical-footprint");
  const mixedMemory = memoryTracks.length > 1;
  const differentDurations = recordings.some(recording => recording.durationSeconds !== derived.duration);
  const devices = new Set(recordings.map(recording => recording.deviceName));
  const hasRun = (recording: PerformanceRecording, metric: ComparisonMetric) =>
    metric === "cpu" ? true : metric === "fps" ? recording.fps.samples.length > 0 : recording.memoryMetric === metric;
  const values = (metric: ComparisonMetric, pick: (summary: RunSummary) => number | null | undefined, format: (value: number) => string) =>
    recordings.flatMap((recording, index) => {
      if (!hasRun(recording, metric)) return [];
      const value = pick(summaries[index]);
      return [{ index, text: value == null ? "—" : format(value) }];
    });
  const scaleSwitch = <SegmentedControl label="Memory scale" value={memoryScale} options={[{ value: "absolute", label: "Absolute" }, { value: "change", label: "Change" }]}
    onChange={scale => { setMemoryScale(scale); countUiEvent("ui.comparison.memory_scale_changed"); }} />;
  function chart(metric: ComparisonMetric, data: ComparisonPoint[]) {
    const common = { data, recordings, hiddenIds: state.hiddenIds, duration: derived!.duration, range, onDrag: setDrag, onSelect: controller.select };
    if (metric === "cpu") {
      return <ComparisonChart key={metric} {...common} label="CPU" info="100% CPU is one core. Peak is each run's highest CPU reading in the selection, or in the whole run."
        metric={<TrackMetric label="Peak" values={values("cpu", summary => summary?.peakCpuPercent, value => `${value.toFixed(1)}%`)} hiddenIds={state.hiddenIds} recordings={recordings} />}
        format={value => `${value.toFixed(1)}%`} axis={{ domain: [0, max => Math.max(100, Math.ceil(max / 25) * 25)], tick: value => `${value}%` }} />;
    }
    if (metric === "fps") {
      return <ComparisonChart key={metric} {...common} label="Display FPS" info="Display FPS measures the whole device, including activity outside the app. Average is each run's mean in the selection, or in the whole run."
        metric={<TrackMetric label="Average" values={values("fps", summary => summary?.averageFps, value => value.toFixed(1))} hiddenIds={state.hiddenIds} recordings={recordings} />}
        format={value => `${value.toFixed(1)} fps`} axis={{ domain: [0, "auto"], tick: value => `${value}` }} />;
    }
    const definition = metric === "rss" ? "RSS" : "Physical footprint";
    const change = memoryScale === "change";
    return <ComparisonChart key={metric} {...common} data={memoryData?.get(metric) ?? data} label={mixedMemory ? `Memory · ${definition} (MiB)` : "Memory (MiB)"}
      info={`${definition} in mebibytes. Δ compares each run's first and last reading.${mixedMemory ? " RSS and physical footprint measure different things, so each has its own chart." : ""} Change plots every run against its own first reading, so runs that start at different sizes stay comparable.`}
      metric={<TrackMetric label="Δ" values={values(metric, summary => summary?.memoryChangeBytes == null ? null : summary.memoryChangeBytes / MIB, value => signed(value))} hiddenIds={state.hiddenIds} recordings={recordings} />}
      toolbar={scaleSwitch} format={value => change ? `${signed(value)} MiB` : `${value.toFixed(0)} MiB`}
      axis={{ domain: ["auto", "auto"], tick: value => change && value > 0 ? `+${value}` : `${value}` }} />;
  }
  const measures = MEASURES.filter(measure => derived.total.some(run => measure.pick(run.summary) != null));
  const coverage = range === undefined ? [] : selected.flatMap((run, index) => {
    if (run.range === null) return [`Run ${index + 1} is outside the selection.`];
    if (run.range.start !== range.start || run.range.end !== range.end) return [`Run ${index + 1} covers ${seconds(run.range.start)}–${seconds(run.range.end)}.`];
    return [];
  });
  const selectChange = (change: SharpChange) => {
    controller.select(changeRange(change, derived.duration));
    countUiEvent("ui.comparison.change_selected");
  };
  return <article className="recording-card comparison-card" aria-label="Performance comparison">
    <header className="recording-header">
      <div className="recording-heading"><h2>{comparison.title}</h2><p>{devices.size === 1 ? recordings[0].deviceName : `${devices.size} devices`} · {derived.duration}s timeline · aligned at recording start</p></div>
      <span className="recording-status">{recordings.length} runs</span>
    </header>
    <div className="recording-body">
      <div className="recording-charts">
        {tracks.map(track => chart(track.metric, track.data))}
        {tracks.length === 0 && <p role="status">No performance readings in these runs.</p>}
        {measures.length > 0 && <section className="comparison-summary" aria-label="Summary">
          <div className="recording-track-heading"><h3>Summary</h3>
            <InfoPopover label="summary">Each figure covers the selection, or each whole run when nothing is selected. Bars share a scale within each measure; hover a run for its difference from run 1.{differentDurations ? " Runs keep their own lengths, so whole-run figures can cover different durations." : ""}</InfoPopover>
            <span className="recording-track-metric"><span aria-hidden="true">·</span><span>{range ? `${seconds(range.start)}–${seconds(range.end)}` : "entire runs"}</span></span>
          </div>
          <div className="comparison-measures">{measures.map(measure => <SummaryMeasure key={measure.key} measure={measure} summaries={summaries} recordings={recordings} hiddenIds={state.hiddenIds} />)}</div>
          {coverage.length > 0 && <p className="recording-footnote">{coverage.join(" ")}</p>}
        </section>}
        {state.preview === "only" && <p className="recording-footnote">This app shows CPU, memory and FPS without frame detail, so jank and frame intervals are blank.{state.workspace && " Compare the recordings in Mobile Dev for all of it."}</p>}
      </div>
      <aside className="recording-sidebar" aria-label="Comparison changes, runs and actions">
        <SharpChanges recordings={recordings} changes={derived.changes} duration={derived.duration} range={range} hiddenIds={state.hiddenIds}
          selected={state.range} onSelect={selectChange} onClear={() => { setDrag(undefined); controller.select(undefined); }} />
        <section className="comparison-runs" aria-label="Runs">
          <div className="recording-section-heading"><h3>Runs</h3><InfoPopover label="runs">Click a run to hide or show its lines. Hidden runs stay in the summary, dimmed.</InfoPopover></div>
          {recordings.map((recording, index) => {
            const shown = state.hiddenIds.has(recording.id) === false;
            return <button key={recording.id} type="button" className="comparison-run" aria-pressed={shown} title={shown ? "Hide this run's lines" : "Show this run's lines"} onClick={() => controller.toggle(recording.id)}>
              <RunMarker index={index} />
              <span className="comparison-run-copy"><strong>{recording.title}</strong><small>{runMeta(recording, devices.size > 1)}</small></span>
              {shown ? <EyeIcon className="comparison-run-eye" /> : <EyeOffIcon className="comparison-run-eye" />}
            </button>;
          })}
          {recordings.map(recording => recording.error && <p key={recording.id} className="recording-error">{recording.title}: {recording.error}</p>)}
        </section>
        <div className="recording-actions comparison-actions">
          <Button disabled={state.canMessage === false || state.busy} onClick={() => { void controller.ask(); }}><MessageCircleIcon />{range ? "Ask about this range" : "Ask about comparison"}</Button>
          {state.canMessage === false && <p>This host does not support sending chart selections to chat.</p>}
          {state.error && <p role="alert" className="recording-error">{state.error}</p>}
        </div>
      </aside>
    </div>
  </article>;
}
