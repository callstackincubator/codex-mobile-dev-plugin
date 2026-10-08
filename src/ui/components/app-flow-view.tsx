import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GitForkIcon, PlayIcon, SquareIcon, RefreshCwIcon, RotateCcwIcon, ZoomInIcon, ZoomOutIcon, ExpandIcon, SparklesIcon } from "lucide-react";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { flowRunning, flowProgress, layoutFlow } from "../../shared/app-flow.ts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { AppFlowCanvas } from "./app-flow-canvas.tsx";
import { clampFlowScale } from "./app-flow-gestures.ts";
import { AppFlowRecording } from "./app-flow-recording.tsx";
import { recordUiTiming } from "../telemetry.ts";

export function AppFlowView({ panel }: { panel: AppFlowPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const devices = useSyncExternalStore(panel.devices.subscribe, panel.devices.getSnapshot);
  const { project, metro, target, useAi } = panel.settings;
  const [scale, setScale] = useState(0.75);
  const [configOpen, setConfigOpen] = useState(!state.run);
  const [selected, setSelected] = useState<string>();
  const [group, setGroup] = useState('all');
  const viewport = useRef<HTMLDivElement>(null);
  const run = state.run, running = flowRunning(run);
  useEffect(() => { setConfigOpen(!run); setGroup('all'); setSelected(undefined); setScale(0.75); viewport.current?.scrollTo(0, 0); }, [run?.id]);
  const shown = useMemo(() => {
    if (!run || group === 'all') return run;
    const nodes = run.nodes.filter(node => group === 'routes' ? !node.groupId : node.groupId === group);
    const ids = new Set(nodes.map(node => node.id));
    return { ...run, nodes, edges: run.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) };
  }, [run, group]);
  const selectGroup = (value: string) => { setGroup(value); setSelected(undefined); viewport.current?.scrollTo(0, 0); };
  const map = () => { selectGroup('all'); return run ? panel.extendMap() : panel.start(project.trim(), metro.trim(), target, useAi); };
  const topology = JSON.stringify([shown?.nodes.map(node => [node.id, node.entry]), shown?.edges.map(edge => [edge.from, edge.to])]);
  const graph = useMemo(() => {
    const started = performance.now();
    const result = layoutFlow(shown ?? { nodes: [], edges: [] });
    recordUiTiming("ui.app_flow.layout", performance.now() - started);
    return result;
  }, [run?.id, topology]);
  const progress = run && flowProgress(run);
  const missing = progress?.needsData ?? 0;
  const current = run?.nodes.find(node => node.id === selected);
  const fit = () => { if (viewport.current) { setScale(Math.min(1, clampFlowScale(Math.min((viewport.current.clientWidth - 24) / graph.width, (viewport.current.clientHeight - 24) / graph.height)))); viewport.current.scrollTo(0, 0); } };
  const status = run?.phase === "scanning" ? "Finding routes…" : run?.phase === "connecting" ? "Connecting to app…" : run?.phase === "reconnecting" ? "Reconnecting to app… Your map is saved." : run?.phase === "finishing" ? "Finishing…" : run?.recording ? "Recording flow…" : running ? run?.captureMode ? "Capturing prepared views…" : run?.retrying ? "Retrying timed-out screens…" : "Discovering and capturing…" : run?.phase === "failed" ? "Capture failed" : run?.phase === "partial" ? "Partial map" : run?.phase === "stopped" ? "Stopped" : run ? "Map ready" : "Map your app";
  return <section className="app-flow" aria-label="App Flow">
    <header className="app-flow-header"><div><GitForkIcon size={17} /><strong>App Flow</strong><span>{devices.device?.name ?? "Select a device"}</span></div>
      <div>{run && <Button variant="ghost" size="sm" disabled={running || state.busy || state.resolving} title={running ? "Stop mapping before resetting" : "Clear this map and start fresh"} onClick={() => panel.reset()}><RotateCcwIcon />Reset</Button>}<Button variant="ghost" size="sm" aria-expanded={configOpen} onClick={() => setConfigOpen(value => !value)}>Setup</Button><Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => setScale(value => clampFlowScale(value - .15))}><ZoomOutIcon /></Button><span>{Math.round(scale * 100)}%</span><Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => setScale(value => clampFlowScale(value + .15))}><ZoomInIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Fit map" onClick={fit}><ExpandIcon /></Button></div>
    </header>
    {configOpen && <form className="app-flow-setup" onSubmit={event => { event.preventDefault(); void map(); }}>
      <label>App source folder<Input aria-label="App source folder" placeholder="/path/to/your/app" value={project} onChange={event => panel.setSetting("project", event.target.value)} disabled={running} required /></label>
      <div className="app-flow-connection"><label>Metro URL<Input aria-label="Metro URL" placeholder="Detected from your project" list="app-flow-metro-servers" value={metro} onChange={event => panel.setSetting("metro", event.target.value)} disabled={running} /></label><Button type="button" variant="outline" size="sm" disabled={running || state.busy} onClick={() => { void panel.discover(); }}><RefreshCwIcon />{state.busy ? "Finding apps…" : "Find apps"}</Button></div>
      <datalist id="app-flow-metro-servers">{state.servers.map(server => <option key={server.url} value={server.url}>{server.projectRoot ?? "Metro"}</option>)}</datalist>
      <div className="app-flow-connection"><label>Running app<NativeSelect aria-label="Running app" value={target} onChange={event => panel.setSetting("target", event.target.value)} disabled={running}><NativeSelectOption value="">Choose a Metro app</NativeSelectOption>{state.targets.map(item => <NativeSelectOption key={item.id} value={item.id} disabled={!item.supportsMultipleDebuggers}>{item.appId ?? item.title} · {item.deviceName ?? "Unknown device"}</NativeSelectOption>)}</NativeSelect></label>
        {running ? <Button type="button" variant="outline" size="sm" onClick={() => { void panel.stop(); }}><SquareIcon />Stop</Button> : <Button type="submit" size="sm" disabled={state.busy || !project.trim() || !target || !devices.device}><PlayIcon />{run ? "Map more screens" : "Map app"}</Button>}
      </div>
      <div className="app-flow-hint"><span>Open your development build in the state you want to map. Mapping also includes local forms and sheets. Record a flow for steps that need real input. Stop any time.</span><label><input type="checkbox" checked={useAi} disabled={running} onChange={event => panel.setSetting("useAi", event.target.checked)} />Use AI for missing params</label></div>
    </form>}
    {state.message && <p className="app-flow-hint" role="status">{state.message}</p>}
    {(state.error || run?.error) && <p className="app-flow-error" role="alert">{state.error || run?.error}</p>}
    {!!run?.discoveryFailures?.length && <p className="app-flow-error" role="alert">{run.discoveryFailures[0].message} {run.discoveryFailures.length} screens still need presentation discovery.</p>}
    <div className="app-flow-progress" role="status"><span className={running ? "app-flow-live" : ""}>{run && progress ? <>{status} · {progress.captured} captured · {progress.queued} queued · {run.manifestTotal ?? progress.discovered} {run.captureMode ? 'planned' : `discovered${running ? ' so far' : ''}`}</> : status}</span><span>{run && progress ? <><Elapsed startedAt={run.captureStartedAt ?? run.startedAt} finishedAt={run.finishedAt} elapsedMs={run.elapsedMs} />{missing ? ` · ${missing} need data` : ""}{progress.unsuccessful ? ` · ${progress.unsuccessful} not captured` : ''}</> : "React Navigation and Expo Router"}</span>
      {!configOpen && !run?.recording && (running ? <Button variant="ghost" size="sm" onClick={() => { void panel.stop(); }}><SquareIcon />Stop</Button> : <Button variant="ghost" size="sm" disabled={state.busy || !project || !target || !devices.device} onClick={() => { void map(); }}><PlayIcon />{run ? 'Map more screens' : 'Map app'}</Button>)}
      {missing > 0 && run?.ai !== "resolving" && <Button variant="ghost" size="sm" disabled={state.resolving || !!run?.recording} onClick={() => { void panel.resolveWithAi(); }}><SparklesIcon />Resolve with AI</Button>}{run?.ai === "resolving" && <span>Resolving params…</span>}
      {!running && run?.nodes.some(node => node.status === 'timed-out') && <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => { void panel.retryTimedOut(); }}><RefreshCwIcon />Retry timed out</Button>}
    </div>
    <AppFlowRecording panel={panel} run={run} ready={!!project.trim() && !!target && !!devices.device} busy={state.busy} group={group} selectGroup={selectGroup} />
    <AppFlowCanvas panel={panel} run={shown} graph={graph} images={state.images} scale={scale} onScaleChange={setScale} selected={selected} select={setSelected} viewport={viewport} />
    {current && <aside className="app-flow-detail"><strong>{current.name}</strong><span>{current.path.join(" → ")}</span>{current.file && <code>{current.file}:{current.line ?? 1}</code>}{current.required.length > 0 && <span>Required: {current.required.join(", ")}</span>}{current.reason && <span>{current.reason}</span>}{current.kind === 'screen' && current.status !== 'captured' && !running && <Button variant="ghost" size="sm" disabled={state.busy} title="Add any app data this screen needs, then capture it again" onClick={() => { void panel.retryTimedOut([current.id]); }}><RefreshCwIcon />Retry screen</Button>}</aside>}
    {!!run?.warnings.length && <details className="app-flow-warnings"><summary>{run.warnings.length} discovery notes</summary>{run.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
  </section>;
}

function Elapsed({ startedAt, finishedAt, elapsedMs }: { startedAt: number; finishedAt?: number; elapsedMs?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (finishedAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [startedAt, finishedAt]);
  const duration = finishedAt ? elapsedMs ?? finishedAt - startedAt : (elapsedMs ?? 0) + Math.max(0, now - startedAt);
  return <>{Math.max(0, duration / 1000).toFixed(1)}s</>;
}
