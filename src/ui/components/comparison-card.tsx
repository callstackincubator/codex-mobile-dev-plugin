import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartNoAxesCombinedIcon, MessageCircleIcon } from "lucide-react";
import { comparisonDuration, summarizeComparison } from "../../shared/performance-comparison.ts";
import type { PerformanceRecording, RecordingRange } from "../../shared/recordings.ts";
import type { ComparisonController } from "../comparison-controller.ts";
import { COMPARISON_COLORS, createComparisonSeries } from "../comparison-series.ts";
import type { ComparisonMetric, ComparisonPoint } from "../comparison-series.ts";
import { recordUiTiming, setUiGauge } from "../telemetry.ts";
import { Button } from "./ui/button";

function seconds(value: number) { return `${value.toFixed(1)}s`; }
function reading(value: number | null | undefined, unit: string, digits = 1) {
  return value === null || value === undefined ? "—" : `${value.toFixed(digits)}${unit}`;
}

function ComparisonChart({ label, metric, data, recordings, hiddenIds, duration, range, onDrag, onSelect }: {
  label: string; metric: ComparisonMetric; data: ComparisonPoint[]; recordings: PerformanceRecording[];
  hiddenIds: ReadonlySet<string>; duration: number; range?: RecordingRange;
  onDrag: (range?: RecordingRange) => void; onSelect: (range?: RecordingRange) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | undefined>(undefined);
  const unit = metric === "cpu" ? "%" : metric === "fps" ? " fps" : " MiB";
  function timeAt(event: PointerEvent<HTMLDivElement>) {
    const bounds = root.current!.getBoundingClientRect();
    const width = Math.max(1, bounds.width - 64);
    const fraction = (event.clientX - bounds.left - 52) / width;
    const maximum = Math.min(1, fraction);
    const clamped = Math.max(0, maximum);
    const time = clamped * duration;
    const rounded = Math.round(time * 10) / 10;
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
    <h3>{label}</h3>
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
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis dataKey="time" type="number" domain={[0, duration]} allowDataOverflow tickFormatter={seconds} tick={{ fontSize: 11 }} />
          <YAxis width={52} domain={[0, "auto"]} tick={{ fontSize: 11 }} />
          <Tooltip filterNull formatter={value => {
            const numeric = typeof value === "number" ? value : undefined;
            return reading(numeric, unit);
          }} labelFormatter={value => { const numeric = Number(value); return seconds(numeric); }}
            contentStyle={{ background: "var(--popover)", borderColor: "var(--border)", borderRadius: 8 }} />
          {recordings.map((recording, index) => <Line key={recording.id} type="linear" dataKey={`run${index}`}
            name={`${index + 1}. ${recording.title}`} stroke={COMPARISON_COLORS[index]} strokeWidth={2}
            strokeDasharray={index > 2 ? "6 3" : undefined} hide={hiddenIds.has(recording.id)}
            dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />)}
          {range && <ReferenceArea className="recording-range-highlight" x1={range.start} x2={range.end} fill="#2583ff" fillOpacity={0.12} stroke="#2583ff" strokeOpacity={0.5} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </section>;
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
    let points = 0;
    for (const track of tracks) points += track.data.length;
    setUiGauge("ui.comparison.points", points);
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.comparison.derive", elapsed);
    return { tracks, total, duration };
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
  if (comparison === undefined || derived === undefined || selected === undefined) {
    return <article className="recording-card"><p role="status">Loading performance comparison…</p>{state.error && <p role="alert">{state.error}</p>}</article>;
  }
  const labels: Record<ComparisonMetric, string> = { cpu: "CPU · %", rss: "Memory · RSS · MiB", "physical-footprint": "Memory · Physical footprint · MiB", fps: "Display FPS · device-wide" };
  const tracks = derived.tracks.filter(track => track.available);
  const mixedMemory = comparison.recordings.some(recording => recording.memoryMetric !== comparison.recordings[0].memoryMetric);
  const hasDisplayData = derived.total.some(run => run.summary !== null && (run.summary.averageFps !== null || run.summary.frameStats !== null));
  const differentDurations = comparison.recordings.some(recording => recording.durationSeconds !== derived.duration);
  return <article className="recording-card comparison-card" aria-label="Performance comparison">
    <header className="recording-header">
      <span className="recording-icon"><ChartNoAxesCombinedIcon size={24} /></span>
      <div className="recording-heading"><h2>{comparison.title}</h2><p>{comparison.recordings.length} runs · Aligned at recording start · {derived.duration}s timeline</p></div>
    </header>
    <div className="recording-body">
      <div className="comparison-legend" aria-label="Runs">
        {comparison.recordings.map((recording, index) => <button key={recording.id} type="button" aria-pressed={state.hiddenIds.has(recording.id) === false}
          onClick={() => controller.toggle(recording.id)} className="comparison-run" style={{ borderColor: COMPARISON_COLORS[index] }}>
          <span className="comparison-swatch" style={{ background: COMPARISON_COLORS[index] }} />
          <span><strong>{index + 1}. {recording.title}</strong><small>{recording.deviceName} · {recording.target.bundleId} · {recording.durationSeconds}s{recording.status === "failed" ? " · Failed (partial run)" : ""}</small></span>
        </button>)}
      </div>
      {tracks.map(track => <ComparisonChart key={track.metric} label={labels[track.metric]} metric={track.metric} data={track.data}
        recordings={comparison.recordings} hiddenIds={state.hiddenIds} duration={derived.duration} range={range} onDrag={setDrag} onSelect={controller.select} />)}
      {tracks.length === 0 && <p role="status">No performance readings in these runs.</p>}
      <div className="comparison-summary-heading"><h3>{range ? `Selected range: ${seconds(range.start)}–${seconds(range.end)}` : "Entire runs"}</h3>
        {state.range && <Button variant="ghost" size="sm" onClick={() => controller.select()}>Clear selection</Button>}
      </div>
      <div className="comparison-table-scroll"><table className="comparison-table">
        <thead><tr><th scope="col">Run</th><th scope="col">Range</th><th scope="col">Avg CPU</th><th scope="col">Peak CPU</th><th scope="col">Memory change</th><th scope="col">Avg FPS</th><th scope="col">Jank rate</th><th scope="col">P95 frame interval</th></tr></thead>
        <tbody>{selected.map((run, index) => {
          const recording = comparison.recordings[index];
          const summary = run.summary;
          const memoryChange = summary?.memoryChangeBytes;
          const memoryMib = memoryChange === null || memoryChange === undefined ? null : memoryChange / 1048576;
          return <tr key={recording.id}><th scope="row"><span className="comparison-swatch" style={{ background: COMPARISON_COLORS[index] }} />{index + 1}. {recording.title}</th>
            <td>{run.range ? `${seconds(run.range.start)}–${seconds(run.range.end)}` : "Outside run"}</td>
            <td>{reading(summary?.averageCpuPercent, "%")}</td><td>{reading(summary?.peakCpuPercent, "%")}</td><td>{reading(memoryMib, " MiB")}</td>
            <td>{reading(summary?.averageFps, "")}</td><td>{reading(summary?.frameStats?.jankRatePercent, "%")}</td><td>{reading(summary?.frameStats?.p95FrameIntervalMs, " ms", 2)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="recording-footnote">Drag across any chart to select the same range for all runs; click to clear it. Toggle a run above to hide its curves. Missing readings remain gaps. 100% CPU is one core.</p>
      {differentDurations && <p className="recording-footnote">Runs keep their original duration. Summaries cover only the portion of the selection within each run; entire-run averages may cover different durations.</p>}
      {mixedMemory && <p className="recording-footnote">RSS and physical footprint measure different memory definitions and use separate tracks.</p>}
      {hasDisplayData && <p className="recording-footnote">Display FPS and frame statistics measure the whole device. Jank rate uses classified presented frames; — means unavailable.</p>}
      {comparison.recordings.map(recording => recording.error && <p key={recording.id} className="recording-error">{recording.title}: {recording.error}</p>)}
      <div className="comparison-actions"><Button disabled={state.canMessage === false || state.busy} onClick={() => { void controller.ask(); }}><MessageCircleIcon />{range ? "Ask about this range" : "Ask about this comparison"}</Button></div>
      {state.canMessage === false && <p className="recording-footnote">This host does not support sending chart selections to chat.</p>}
      {state.error && <p role="alert" className="recording-error">{state.error}</p>}
    </div>
  </article>;
}
