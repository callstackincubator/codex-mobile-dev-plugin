import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartColumnIcon, ExternalLinkIcon, MessageCircleIcon } from "lucide-react";
import type { RecordingController } from "../recording-controller.ts";
import type { RecordingRange } from "../../shared/recordings.ts";
import { summarizeRecording } from "../../shared/recordings.ts";
import { recordUiTiming } from "../telemetry.ts";
import { createRecordingCpuSeries, createRecordingFpsSeries, findRecordingChangeRanges } from "../recording-series.ts";
import type { RecordingPoint } from "../recording-series.ts";
import { Button } from "./ui/button";
import { RecordingChartShape, recordingChartPoints } from "./recording-chart-shape";
import { useMediaQuery } from "./use-media-query";

const MIB = 1048576;
const REVEAL_DELAY = 550;
function percent(value: number | null) { return value === null ? "—" : `${value.toFixed(1)}%`; }
function memoryChange(value: number | null) {
  if (value === null) return "—";
  const mib = Math.round(value / MIB);
  return `${mib > 0 ? "+" : ""}${mib} MiB`;
}
function seconds(value: number) { return `${value.toFixed(1)}s`; }
function fpsReading(value: number | null) { return value === null ? "—" : value.toFixed(1); }

function RecordingChart({ label, data, duration, range, changes, color, unit, onDrag, onSelect }: {
  label: string; data: RecordingPoint[]; duration: number; range?: RecordingRange; changes: RecordingRange[]; color: string; unit: string;
  onDrag: (range?: RecordingRange) => void; onSelect: (range?: RecordingRange) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | undefined>(undefined);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [reveal, setReveal] = useState<"pending" | "finished" | "settled">(reducedMotion ? "settled" : "pending");
  const revealStartedAt = useRef<number | undefined>(undefined);
  const revealedData = useRef(data);
  useEffect(() => {
    if (revealedData.current === data && reducedMotion === false) return;
    revealedData.current = data;
    setReveal("settled");
    revealStartedAt.current = undefined;
  }, [data, reducedMotion]);
  const startReveal = useCallback(() => {
    revealStartedAt.current = performance.now();
  }, []);
  const finishReveal = useCallback(() => {
    const startedAt = revealStartedAt.current;
    revealStartedAt.current = undefined;
    if (startedAt === undefined) return;
    setReveal("finished");
    // Recharts calls onAnimationStart before its entrance delay.
    const elapsed = performance.now() - startedAt - REVEAL_DELAY;
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
  return <section className="recording-track" aria-label={label} data-reveal={reveal}>
    <div className="recording-track-heading"><h3>{label}</h3>{changes.length > 0 && <span className="recording-change-legend">Most rapid changes</span>}</div>
    <div ref={root} className="recording-chart" onPointerDown={event => {
      if (event.button !== 0) return;
      setReveal("settled");
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
          <Area type="linear" dataKey="value" name={label} stroke={color} fill={color} fillOpacity={0.07} strokeWidth={2} dot={false} shape={RecordingChartShape} animationInterpolateFn={recordingChartPoints} isAnimationActive={reveal === "pending" ? "auto" : false} animationBegin={REVEAL_DELAY} animationDuration={700} animationEasing="ease-out" onAnimationStart={startReveal} onAnimationEnd={finishReveal} connectNulls={false} />
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
    const fps = findRecordingChangeRanges(recording, "fps");
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.recording.change_density", elapsed);
    return { cpu, memory, fps };
  }, [recording]);
  const derived = useMemo(() => {
    if (recording === undefined) return;
    const startedAt = performance.now();
    const total = summarizeRecording(recording);
    const selected = summarizeRecording(recording, range);
    const cpu = createRecordingCpuSeries(recording);
    const fps = createRecordingFpsSeries(recording);
    const memory: RecordingPoint[] = [];
    for (const sample of recording.samples) {
      memory.push({ time: sample.time, value: sample.memoryBytes === null ? null : sample.memoryBytes / MIB });
    }
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.recording.derive", elapsed);
    return { total, selected, cpu, memory, fps };
  }, [recording, range]);
  if (recording === undefined || derived === undefined || changes === undefined) return <article className="recording-card"><p role="status">Loading performance recording…</p>{state.error && <p role="alert">{state.error}</p>}</article>;
  const status = recording.status === "finished" ? "Finished" : recording.status === "failed" ? "Failed" : recording.status === "connecting" ? "Connecting" : recording.status === "finishing" ? "Finishing" : "Recording";
  const time = new Date(recording.completedAt ?? recording.startedAt);
  const savedAt = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const memoryMetric = recording.memoryMetric === "rss" ? "RSS" : "Physical footprint";
  const shownThreads = detailed ? derived.selected.threads : derived.selected.threads.slice(0, 3);
  const hasCpu = derived.total.averageCpuPercent !== null;
  const hasMemory = derived.total.firstMemoryBytes !== null;
  const hasFps = derived.total.averageFps !== null;
  const hasReadings = hasCpu || hasMemory || hasFps;
  return <article className="recording-card" aria-label="Saved performance recording">
    <header className="recording-header">
      <span className="recording-icon"><ChartColumnIcon size={24} /></span>
      <div className="recording-heading"><h2>{recording.title}</h2><p>{recording.deviceName} · {recording.target.bundleId} · {recording.durationSeconds}s · {recording.completedAt ? "Saved" : "Started"} {savedAt}</p></div>
      <span className="recording-status" role="status">{status}</span>
    </header>
    <div className="recording-body">
      {hasReadings === false && <p role="status">No performance readings recorded yet.</p>}
      <dl className="recording-metrics">{hasCpu && <div><dt>Peak CPU</dt><dd>{percent(derived.total.peakCpuPercent)}</dd></div>}{hasMemory && <div><dt>Memory change</dt><dd>{memoryChange(derived.total.memoryChangeBytes)}</dd></div>}{hasFps && <div><dt>Average FPS</dt><dd>{fpsReading(derived.total.averageFps)}</dd></div>}</dl>
      {hasCpu && <RecordingChart key={`${recording.id}:cpu`} label="CPU" data={derived.cpu} duration={recording.durationSeconds} range={range} changes={changes.cpu} color="#2583ff" unit="%" onDrag={setDrag} onSelect={controller.select} />}
      {hasMemory && <RecordingChart key={`${recording.id}:memory`} label={`Memory · ${memoryMetric} · MiB`} data={derived.memory} duration={recording.durationSeconds} range={range} changes={changes.memory} color="#f57b28" unit="MiB" onDrag={setDrag} onSelect={controller.select} />}
      {hasFps && <RecordingChart key={`${recording.id}:fps`} label="Display FPS · device-wide" data={derived.fps} duration={recording.durationSeconds} range={range} changes={changes.fps} color="#36a269" unit="fps" onDrag={setDrag} onSelect={controller.select} />}
      {hasFps && <p className="recording-footnote">Display FPS measures the whole device, including activity outside this app.</p>}
      {recording.status === "finishing" && <p className="recording-footnote" role="status">Finishing the recording…</p>}
      <div className="recording-selection">
        <div className="recording-breakdown"><h3>{range ? `Selected range: ${seconds(range.start)}–${seconds(range.end)}` : "Entire recording"}</h3>{hasFps && <p>Average FPS: {fpsReading(derived.selected.averageFps)} · Minimum FPS: {fpsReading(derived.selected.minimumFps)}</p>}{hasCpu && <p>Busiest recorded threads · average CPU</p>}
          {hasCpu && (shownThreads.length > 0 ? <dl>{shownThreads.map(thread => <div key={thread.id}><dt title={thread.id}>{thread.name || `Thread ${thread.id}`}</dt><dd>{percent(thread.averageCpuPercent)}</dd></div>)}</dl> : <p>No thread CPU measurements in this range.</p>)}
        </div>
        <div className="recording-actions">
          <Button disabled={state.canMessage === false || state.busy || hasReadings === false} onClick={() => { void controller.send("ask"); }}><MessageCircleIcon />{range ? "Ask about this range" : "Ask about this recording"}</Button>
          {detailed === false && <Button variant="outline" disabled={state.canMessage === false || state.busy} onClick={() => { void controller.send("open"); }}><ExternalLinkIcon />Open in Mobile Dev</Button>}
          <p>{state.canMessage ? "Ask sends a new message with this range." : "This host does not support sending chart selections to chat."}</p>
        </div>
      </div>
      {hasReadings && <p className="recording-footnote">Drag across any chart to select a range; click to clear it. {hasCpu && "100% CPU is one core. "}Missing readings remain gaps.</p>}
      {state.error && <p role="alert" className="recording-error">{state.error}</p>}
      {detailed && <p className="recording-footnote">{recording.samples.length} CPU/memory samples · {hasFps && `${recording.fps.samples.length} FPS samples · `}Recording {recording.id} · {time.toLocaleDateString()}</p>}
    </div>
  </article>;
}
