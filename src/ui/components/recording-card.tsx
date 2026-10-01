import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartColumnIcon, ExternalLinkIcon, MessageCircleIcon } from "lucide-react";
import type { RecordingController } from "../recording-controller.ts";
import type { RecordingRange } from "../../shared/recordings.ts";
import { summarizeRecording } from "../../shared/recordings.ts";
import { recordUiTiming } from "../telemetry.ts";
import { createRecordingCpuSeries, findRecordingChangeRanges } from "../recording-series.ts";
import type { RecordingPoint } from "../recording-series.ts";
import { Button } from "./ui/button";

const MIB = 1048576;
function percent(value: number | null) { return value === null ? "—" : `${value.toFixed(1)}%`; }
function memoryChange(value: number | null) {
  if (value === null) return "—";
  const mib = Math.round(value / MIB);
  return `${mib > 0 ? "+" : ""}${mib} MiB`;
}
function seconds(value: number) { return `${value.toFixed(1)}s`; }

function RecordingChart({ label, data, duration, range, changes, color, unit, onDrag, onSelect }: {
  label: string; data: RecordingPoint[]; duration: number; range?: RecordingRange; changes: RecordingRange[]; color: string; unit: string;
  onDrag: (range?: RecordingRange) => void; onSelect: (range?: RecordingRange) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | undefined>(undefined);
  const [revealPending, setRevealPending] = useState(true);
  const revealStartedAt = useRef<number | undefined>(undefined);
  const startReveal = useCallback(() => {
    revealStartedAt.current = performance.now();
  }, []);
  const finishReveal = useCallback(() => {
    setRevealPending(false);
    const startedAt = revealStartedAt.current;
    revealStartedAt.current = undefined;
    if (startedAt === undefined) return;
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.recording.reveal", elapsed);
  }, []);
  function timeAt(event: PointerEvent<HTMLDivElement>) {
    const bounds = root.current!.getBoundingClientRect();
    const fraction = (event.clientX - bounds.left - 52) / Math.max(1, bounds.width - 64);
    const clamped = Math.max(0, Math.min(1, fraction));
    const time = clamped * duration;
    return Math.round(time * 10) / 10;
  }
  function selection(event: PointerEvent<HTMLDivElement>) {
    if (anchor.current === undefined) return;
    const time = timeAt(event);
    const start = Math.min(anchor.current, time);
    const end = Math.max(anchor.current, time);
    if (end > start) return { start, end };
  }
  const values = data.flatMap(point => point.value === null ? [] : [point.value]);
  const minimum = values.length > 0 ? Math.min(...values) : 0;
  const maximum = values.length > 0 ? Math.max(...values) : 1;
  const padding = Math.max((maximum - minimum) * 0.15, unit === "%" ? 5 : 0.5);
  const paddedMinimum = Math.floor(minimum - padding);
  const paddedMaximum = Math.ceil(maximum + padding);
  const low = unit === "%" ? 0 : Math.max(0, paddedMinimum);
  const high = unit === "%" ? Math.max(100, maximum + padding) : paddedMaximum;
  function formatReading(value: unknown) {
    if (value === undefined || value === null) return "—";
    const number = Number(value);
    const formatted = number.toFixed(unit === "%" ? 1 : 0);
    return `${formatted} ${unit}`;
  }
  return <section className="recording-track" aria-label={label}>
    <div className="recording-track-heading"><h3>{label}</h3>{changes.length > 0 && <span className="recording-change-legend">Most rapid changes</span>}</div>
    <div ref={root} className="recording-chart" onPointerDown={event => {
      if (event.button !== 0) return;
      setRevealPending(false);
      revealStartedAt.current = undefined;
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
        <AreaChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis dataKey="time" type="number" domain={[0, duration]} tickFormatter={seconds} tick={{ fontSize: 11 }} />
          <YAxis width={52} domain={[low, high]} allowDecimals={unit === "%"} tick={{ fontSize: 11 }} tickFormatter={value => unit === "%" ? `${value}%` : value.toFixed(0)} />
          <Tooltip formatter={formatReading} labelFormatter={value => `${value}s`} contentStyle={{ background: "var(--popover)", borderColor: "var(--border)", borderRadius: 8 }} />
          {changes.map(change => <ReferenceArea key={change.start} className="recording-change-highlight" x1={change.start} x2={change.end} fill="#9873e6" fillOpacity={0.16} strokeOpacity={0} />)}
          <Area type="linear" dataKey="value" name={label} stroke={color} fill={color} fillOpacity={0.07} strokeWidth={2} dot={false} isAnimationActive={revealPending ? "auto" : false} animationDuration={700} animationEasing="ease-out" onAnimationStart={startReveal} onAnimationEnd={finishReveal} connectNulls={false} />
          {range && <ReferenceArea className="recording-range-highlight" x1={range.start} x2={range.end} fill="#2583ff" fillOpacity={0.12} stroke="#2583ff" strokeOpacity={0.5} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </section>;
}

export function RecordingCard({ controller, detailed = false }: { controller: RecordingController; detailed?: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { controller.setVisible(true); return () => { controller.setVisible(false); }; }, [controller]);
  const recording = state.recording;
  const [drag, setDrag] = useState<RecordingRange>();
  const range = drag ?? state.range;
  const changes = useMemo(() => {
    if (recording === undefined) return;
    const startedAt = performance.now();
    const cpu = findRecordingChangeRanges(recording, "cpuPercent");
    const memory = findRecordingChangeRanges(recording, "memoryBytes");
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.recording.change_density", elapsed);
    return { cpu, memory };
  }, [recording]);
  const derived = useMemo(() => {
    if (recording === undefined) return;
    const startedAt = performance.now();
    const total = summarizeRecording(recording);
    const selected = summarizeRecording(recording, range);
    const cpu = createRecordingCpuSeries(recording);
    const memory: RecordingPoint[] = [];
    for (const sample of recording.samples) {
      memory.push({ time: sample.time, value: sample.memoryBytes === null ? null : sample.memoryBytes / MIB });
    }
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.recording.derive", elapsed);
    return { total, selected, cpu, memory };
  }, [recording, range]);
  if (recording === undefined || derived === undefined || changes === undefined) return <article className="recording-card"><p role="status">Loading performance recording…</p>{state.error && <p role="alert">{state.error}</p>}</article>;
  const status = recording.status === "finished" ? "Finished" : recording.status === "failed" ? "Failed" : recording.status === "connecting" ? "Connecting" : "Recording";
  const time = new Date(recording.completedAt ?? recording.startedAt);
  const savedAt = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const memoryMetric = recording.memoryMetric === "rss" ? "RSS" : "Physical footprint";
  const shownThreads = detailed ? derived.selected.threads : derived.selected.threads.slice(0, 3);
  return <article className="recording-card" aria-label="Saved performance recording">
    <header className="recording-header">
      <span className="recording-icon"><ChartColumnIcon size={24} /></span>
      <div className="recording-heading"><h2>{recording.title}</h2><p>{recording.deviceName} · {recording.target.bundleId} · {recording.durationSeconds}s · {recording.completedAt ? "Saved" : "Started"} {savedAt}</p></div>
      <span className="recording-status" role="status">{status}</span>
    </header>
    <div className="recording-body">
      <dl className="recording-metrics"><div><dt>Peak CPU</dt><dd>{percent(derived.total.peakCpuPercent)}</dd></div><div><dt>Memory change</dt><dd>{memoryChange(derived.total.memoryChangeBytes)}</dd></div></dl>
      <RecordingChart key={`${recording.id}:cpu`} label="CPU" data={derived.cpu} duration={recording.durationSeconds} range={range} changes={changes.cpu} color="#2583ff" unit="%" onDrag={setDrag} onSelect={controller.select} />
      <RecordingChart key={`${recording.id}:memory`} label={`Memory · ${memoryMetric} · MiB`} data={derived.memory} duration={recording.durationSeconds} range={range} changes={changes.memory} color="#f57b28" unit="MiB" onDrag={setDrag} onSelect={controller.select} />
      <div className="recording-selection">
        <div className="recording-breakdown"><h3>{range ? `Selected range: ${seconds(range.start)}–${seconds(range.end)}` : "Entire recording"}</h3><p>Busiest recorded threads · average CPU</p>
          {shownThreads.length > 0 ? <dl>{shownThreads.map(thread => <div key={thread.id}><dt title={thread.id}>{thread.name || `Thread ${thread.id}`}</dt><dd>{percent(thread.averageCpuPercent)}</dd></div>)}</dl> : <p>No thread CPU measurements in this range.</p>}
        </div>
        <div className="recording-actions">
          <Button disabled={state.canMessage === false || state.busy || recording.samples.length === 0} onClick={() => { void controller.send("ask"); }}><MessageCircleIcon />{range ? "Ask about this range" : "Ask about this recording"}</Button>
          {detailed === false && <Button variant="outline" disabled={state.canMessage === false || state.busy} onClick={() => { void controller.send("open"); }}><ExternalLinkIcon />Open in Mobile Dev</Button>}
          <p>{state.canMessage ? "Ask sends a new message with this range." : "This host does not support sending chart selections to chat."}</p>
        </div>
      </div>
      <p className="recording-footnote">Drag across either chart to select a range; click to clear it. CPU values cover their measured intervals; 100% is one core. Missing readings remain gaps.</p>
      {state.error && <p role="alert" className="recording-error">{state.error}</p>}
      {detailed && <p className="recording-footnote">{recording.samples.length} original samples · Recording {recording.id} · {time.toLocaleDateString()}</p>}
    </div>
  </article>;
}
