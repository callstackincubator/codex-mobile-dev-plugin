import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GitForkIcon, PlayIcon, SquareIcon, RefreshCwIcon, ZoomInIcon, ZoomOutIcon, ExpandIcon, SparklesIcon } from "lucide-react";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { flowRunning, layoutFlow } from "../../shared/app-flow.ts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { recordUiTiming } from "../telemetry.ts";

export function AppFlowView({ panel }: { panel: AppFlowPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const devices = useSyncExternalStore(panel.devices.subscribe, panel.devices.getSnapshot);
  const { project, metro, target, useAi } = panel.settings;
  const [scale, setScale] = useState(0.75);
  const [configOpen, setConfigOpen] = useState(!state.run);
  const [selected, setSelected] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const run = state.run, running = flowRunning(run);
  useEffect(() => { if (run) setConfigOpen(false); }, [run?.id]);
  useEffect(() => { if (!running) return; const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, [running]);
  const graph = useMemo(() => {
    const started = performance.now();
    const result = layoutFlow(run ?? { nodes: [], edges: [] });
    recordUiTiming("ui.app_flow.layout", performance.now() - started);
    return result;
  }, [run?.id, run?.nodes.length, run?.edges.length]);
  const screens = run?.nodes.filter(node => node.kind === "screen") ?? [];
  const captured = screens.filter(node => node.status === "captured").length;
  const unique = new Set(screens.filter(node => node.image).map(node => node.image)).size;
  const missing = screens.filter(node => node.status === "needs-data").length;
  const current = run?.nodes.find(node => node.id === selected);
  const elapsed = run ? Math.max(0, ((run.finishedAt ?? now) - run.startedAt) / 1000) : 0;
  const fit = () => { if (viewport.current) { setScale(Math.min(1, Math.max(.15, (viewport.current.clientWidth - 24) / graph.width))); viewport.current.scrollTo(0, 0); } };
  const status = run?.phase === "scanning" ? "Finding routes…" : run?.phase === "connecting" ? "Connecting to app…" : run?.phase === "finishing" ? "Finishing…" : running ? "Capturing screens…" : run?.phase === "failed" ? "Capture failed" : run?.phase === "stopped" ? "Stopped" : run ? "Map ready" : "Map your app";
  return <section className="app-flow" aria-label="App Flow">
    <header className="app-flow-header"><div><GitForkIcon size={17} /><strong>App Flow</strong><span>{devices.device?.name ?? "Select a device"}</span></div>
      <div><Button variant="ghost" size="sm" aria-expanded={configOpen} onClick={() => setConfigOpen(value => !value)}>Setup</Button><Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => setScale(value => Math.max(.15, value - .15))}><ZoomOutIcon /></Button><span>{Math.round(scale * 100)}%</span><Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => setScale(value => Math.min(1.5, value + .15))}><ZoomInIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Fit map width" onClick={fit}><ExpandIcon /></Button></div>
    </header>
    {configOpen && <form className="app-flow-setup" onSubmit={event => { event.preventDefault(); void panel.start(project.trim(), metro.trim(), target, useAi); }}>
      <label>App source folder<Input aria-label="App source folder" placeholder="/path/to/your/app" value={project} onChange={event => panel.setSetting("project", event.target.value)} disabled={running} required /></label>
      <div className="app-flow-connection"><label>Metro URL<Input aria-label="Metro URL" placeholder="Detected from your project" list="app-flow-metro-servers" value={metro} onChange={event => panel.setSetting("metro", event.target.value)} disabled={running} /></label><Button type="button" variant="outline" size="sm" disabled={running || state.busy} onClick={() => { void panel.discover(); }}><RefreshCwIcon />{state.busy ? "Finding apps…" : "Find apps"}</Button></div>
      <datalist id="app-flow-metro-servers">{state.servers.map(server => <option key={server.url} value={server.url}>{server.projectRoot ?? "Metro"}</option>)}</datalist>
      <div className="app-flow-connection"><label>Running app<NativeSelect aria-label="Running app" value={target} onChange={event => panel.setSetting("target", event.target.value)} disabled={running}><NativeSelectOption value="">Choose a Metro app</NativeSelectOption>{state.targets.map(item => <NativeSelectOption key={item.id} value={item.id} disabled={!item.supportsMultipleDebuggers}>{item.appId ?? item.title} · {item.deviceName ?? "Unknown device"}</NativeSelectOption>)}</NativeSelect></label>
        {running ? <Button type="button" variant="outline" size="sm" onClick={() => { void panel.stop(); }}><SquareIcon />Stop</Button> : <Button type="submit" size="sm" disabled={state.busy || !project.trim() || !target || !devices.device}><PlayIcon />{run ? "Map again" : "Map app"}</Button>}
      </div>
      <div className="app-flow-hint"><span>Open your development build and log in if needed. Mapping continues until all queued screens have been attempted. Stop any time.</span><label><input type="checkbox" checked={useAi} disabled={running} onChange={event => panel.setSetting("useAi", event.target.checked)} />Use AI for missing params</label></div>
    </form>}
    {state.message && <p className="app-flow-hint" role="status">{state.message}</p>}
    {(state.error || run?.error) && <p className="app-flow-error" role="alert">{state.error || run?.error}</p>}
    <div className="app-flow-progress" role="status"><span className={running ? "app-flow-live" : ""}>{status}</span><span>{run ? `${captured}/${screens.length} previews · ${unique} screenshots · ${elapsed.toFixed(1)}s${missing ? ` · ${missing} need data` : ""}` : "React Navigation and Expo Router"}</span>
      {!configOpen && (running ? <Button variant="ghost" size="sm" onClick={() => { void panel.stop(); }}><SquareIcon />Stop</Button> : <Button variant="ghost" size="sm" disabled={state.busy || !project || !target || !devices.device} onClick={() => { void panel.start(project.trim(), metro.trim(), target, useAi); }}><PlayIcon />Map again</Button>)}
      {missing > 0 && run?.ai !== "resolving" && <Button variant="ghost" size="sm" disabled={state.resolving} onClick={() => { void panel.resolveWithAi(); }}><SparklesIcon />Resolve with AI</Button>}{run?.ai === "resolving" && <span>Resolving params…</span>}
    </div>
    <div ref={viewport} className="app-flow-viewport" onPointerDown={event => {
      if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
      const element = event.currentTarget; drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }; element.setPointerCapture(event.pointerId);
    }} onPointerMove={event => { if (drag.current) { event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX; event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY; } }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
      {!run?.nodes.length ? <div className="app-flow-empty"><GitForkIcon size={36} /><h3>Your app, screen by screen</h3><p>Find routes from source, then fill the map with screenshots from your running app.</p><p>Missing data and blocked screens stay visible.</p></div> : <div style={{ width: graph.width * scale, height: graph.height * scale }}><div className="app-flow-canvas" style={{ width: graph.width, height: graph.height, transform: `scale(${scale})` }}>
        <svg width={graph.width} height={graph.height} className="app-flow-edges" aria-hidden="true">{run.edges.map((edge, index) => { const a = graph.positions.get(edge.from), b = graph.positions.get(edge.to); if (!a || !b) return null; const x = a.x + 202, y = a.y + 28, endY = b.y + 28; return <path key={index} d={`M${x},${y} C${x + 22},${y} ${b.x - 22},${endY} ${b.x},${endY}`} data-kind={edge.kind} />; })}</svg>
        {run.nodes.map(node => { const position = graph.positions.get(node.id); if (!position) return null; const image = node.image && state.images[node.image]; return <button key={node.id} type="button" className="app-flow-node" data-kind={node.kind} data-status={node.status} data-selected={selected === node.id} style={{ left: position.x, top: position.y }} onClick={() => setSelected(node.id)} title={node.path.join(" → ") || node.name}>
          <span className="app-flow-node-title">{node.kind === "navigator" && <GitForkIcon size={13} />}{node.name}</span>
          {node.kind === "screen" && <><span className="app-flow-thumbnail">{image ? <img src={image} alt={`${node.name} screen`} loading="lazy" draggable={false} /> : <span>{node.status === "capturing" ? "Capturing…" : node.status === "needs-data" ? "Needs real data" : node.status === "blocked" ? "Blocked" : node.status === "timed-out" ? "Not captured" : node.status === "captured" ? "Loading screenshot…" : "Waiting"}</span>}</span><span className="app-flow-node-status">{node.status === "captured" ? node.sharedFrom ? "Shared preview" : "Captured" : node.status.replaceAll("-", " ")}</span></>}
        </button>; })}
      </div></div>}
    </div>
    {current && <aside className="app-flow-detail"><strong>{current.name}</strong><span>{current.path.join(" → ")}</span>{current.file && <code>{current.file}:{current.line ?? 1}</code>}{current.required.length > 0 && <span>Required: {current.required.join(", ")}</span>}{current.reason && <span>{current.reason}</span>}</aside>}
    {!!run?.warnings.length && <details className="app-flow-warnings"><summary>{run.warnings.length} discovery notes</summary>{run.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
  </section>;
}
