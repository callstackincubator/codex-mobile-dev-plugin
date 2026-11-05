import { FolderOpenIcon, ListFilterIcon, NetworkIcon, RefreshCwIcon, SearchIcon, SquareIcon } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { AppIntelligencePanel } from "../app-intelligence-panel.ts";
import type { AppIntelSnapshot, IntelRef } from "@mobile-dev/shared/app-intelligence.ts";
import { fileRef, screenRef } from "@mobile-dev/shared/app-intelligence.ts";
import type { Boundary, NodePlatforms, Rect, TrieNode } from "../app-intelligence-layout.ts";
import { boundariesIn, boundaryColor, boundaryLabel, boundaryOf, buildFlow, buildTrie, clampName, depthHue, depthTint, ellipsize, findNode, heat, heatInk, heatRamp, heatT, labelOf, leavesOf, ancestorsOf, maxReach, ownerScreen, pathOf, platformsFor, reachOf, squarify } from "../app-intelligence-layout.ts";
import { recordUiTiming, setUiGauge } from "../telemetry.ts";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";

const BROWSE = "\u0000browse";

/**
 * The project picker. It remembers what has been opened, so switching between apps is a dropdown
 * rather than a trip through the host folder picker; the last entry still opens that picker.
 */
function ProjectPicker({ projectPath, recents, disabled, onSelect, onBrowse }: {
  projectPath: string; recents: readonly string[]; disabled: boolean;
  onSelect: (path: string) => void; onBrowse: () => void;
}) {
  const options = [...new Set([...(projectPath ? [projectPath] : []), ...recents])];
  if (!options.length) return <Button variant="outline" size="sm" data-project-picker disabled={disabled} onClick={onBrowse}><FolderOpenIcon />Choose project</Button>;
  return <div className="flex min-w-0 shrink-0 items-center gap-1">
    <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
    <NativeSelect size="sm" className="max-w-52" data-project-picker aria-label="App Intelligence project" disabled={disabled}
      value={projectPath} onChange={event => event.target.value === BROWSE ? onBrowse() : onSelect(event.target.value)}>
      {options.map(path => <NativeSelectOption key={path} value={path} title={path}>{path.split("/").at(-1) || path}</NativeSelectOption>)}
      <NativeSelectOption value={BROWSE}>Choose another project…</NativeSelectOption>
    </NativeSelect>
  </div>;
}

const platformEdge: Record<NodePlatforms, string> = { ios: "bg-sky-500", android: "bg-lime-500", both: "bg-transparent" };
const platformFill: Record<NodePlatforms, string> = { ios: "fill-sky-500", android: "fill-lime-500", both: "fill-transparent" };
const platformLabel = (platforms: NodePlatforms) => platforms === "both" ? "iOS + Android" : platforms === "ios" ? "iOS only" : "Android only";

/** Measures a box through a callback ref, so it also measures one that mounts later. */
function useMeasured() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const read = () => setSize(previous => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      return next.width === previous.width && next.height === previous.height ? previous : next;
    });
    read();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size, element] as const;
}

/**
 * Drag-to-pan and wheel-pan for the Flow. The board usually fits its pane, so moving scrollLeft
 * did nothing; this translates the canvas instead, which pans whatever its size. A drag that
 * actually moves swallows the click that follows it, so panning never re-roots the graph.
 */
function usePanCanvas(element: HTMLElement | null, resetKey: string) {
  useEffect(() => {
    if (!element) return;
    const canvas = element.firstElementChild as HTMLElement | null;
    if (!canvas) return;
    let x = 0, y = 0;
    const draw = () => { canvas.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; };
    draw();
    let origin: { x: number; y: number; panX: number; panY: number } | null = null;
    let moved = false;
    const swallow = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      origin = { x: event.clientX, y: event.clientY, panX: x, panY: y };
      moved = false;
    };
    const move = (event: PointerEvent) => {
      if (!origin) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      element.dataset.panning = "true";
      x = origin.panX + dx;
      y = origin.panY + dy;
      draw();
    };
    const up = () => {
      if (moved) element.addEventListener("click", swallow, { capture: true, once: true });
      origin = null;
      moved = false;
      delete element.dataset.panning;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      x -= event.deltaX;
      y -= event.deltaY;
      draw();
    };
    const recenter = () => { x = 0; y = 0; draw(); };
    element.addEventListener("pointerdown", down);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("dblclick", recenter);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("dblclick", recenter);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [element, resetKey]);
}

type Hover = { title: string; detail: string; x: number; y: number } | null;

function AtlasCell({ node, rect, max, dim, onZoom, onTrace, onHover }: {
  node: TrieNode; rect: Rect; max: number; dim: boolean;
  onZoom: (path: string) => void; onTrace: (node: TrieNode) => void; onHover: (hover: Hover) => void;
}) {
  const leaf = node.leaf;
  const fill = heat(node.reach, max);
  const detail = `${leaf ? "" : `${node.value} files · `}reach ${Math.round(node.reach)}${leaf && leaf.platforms !== "both" ? ` · ${platformLabel(leaf.platforms)}` : ""}`;
  return <button
    type="button" data-atlas-cell={node.path} title={`${node.path}\n${detail}`}
    aria-label={`${node.path}, ${detail}`}
    className={`absolute overflow-hidden rounded-[2px] text-left transition-opacity hover:z-10 hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-foreground ${dim ? "opacity-20" : ""}`}
    style={{ left: rect.x, top: rect.y, width: Math.max(0, rect.width - 1), height: Math.max(0, rect.height - 1), background: fill }}
    onClick={() => leaf ? onTrace(node) : onZoom(node.path)}
    onPointerMove={event => onHover({ title: node.path, detail, x: event.clientX, y: event.clientY })}
    onPointerLeave={() => onHover(null)}
  >
    {rect.width > 58 && rect.height > 15 && <span className="pointer-events-none absolute left-1 right-1 top-0.5 truncate font-mono text-[10.5px]" style={{ color: heatInk(node.reach, max) }}>{node.name}</span>}
    {leaf && leaf.platforms !== "both" && <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-[3px] ${platformEdge[leaf.platforms]}`} />}
  </button>;
}

function atlasCells(node: TrieNode, rect: Rect, depth: number, context: {
  max: number; matches: (path: string) => boolean; onZoom: (path: string) => void; onTrace: (node: TrieNode) => void; onHover: (hover: Hover) => void;
}, out: ReactNode[]) {
  for (const { node: kid, rect: box } of squarify(node.kids, rect)) {
    if (box.width < 1.5 || box.height < 1.5) continue;
    const expandable = kid.kids.length > 0 && depth < 2 && box.width > 46 && box.height > 34;
    if (!expandable) {
      out.push(<AtlasCell key={kid.path} node={kid} rect={box} max={context.max} dim={!context.matches(kid.path)} onZoom={context.onZoom} onTrace={context.onTrace} onHover={context.onHover} />);
      continue;
    }
    const pad = box.height > 56 && box.width > 70 ? 15 : 3;
    const groupDetail = `${kid.value} files · reach ${Math.round(kid.reach)}`;
    out.push(<button key={`group:${kid.path}`} type="button" data-atlas-group={kid.path} title={`${kid.path}\n${groupDetail}`}
      aria-label={`${kid.path}, ${groupDetail}`}
      className="absolute rounded-[2px] border border-border bg-muted/40 text-left hover:border-foreground/60 hover:bg-muted/70"
      style={{ left: box.x, top: box.y, width: Math.max(0, box.width - 1), height: Math.max(0, box.height - 1) }}
      onClick={() => context.onZoom(kid.path)}
      onPointerMove={event => context.onHover({ title: kid.path, detail: groupDetail, x: event.clientX, y: event.clientY })}
      onPointerLeave={() => context.onHover(null)}>
      {pad > 3 && <span className="pointer-events-none absolute left-1 right-1 top-0.5 truncate font-mono text-[10.5px] font-medium">{kid.name}/</span>}
    </button>);
    atlasCells(kid, { x: box.x + 2, y: box.y + pad, width: Math.max(1, box.width - 5), height: Math.max(1, box.height - pad - 3) }, depth + 1, context, out);
  }
}

const CARD = { width: 226, height: 40, column: 278, padX: 16, padY: 14, gap: 8 };
const NAME_CHARS = 24;
/** Characters the subtitle can take, once the boundary tag beside it has had its share. */
const pathChars = (boundary: string) => Math.max(8, Math.floor((CARD.width - 30 - boundary.length * 5.4) / 5.05));

function FlowView({ snapshot, start, max, height, onRoot, onHover }: {
  snapshot: AppIntelSnapshot; start: IntelRef; max: number; height: number;
  onRoot: (ref: IntelRef) => void; onHover: (hover: Hover) => void;
}) {
  const [lit, setLit] = useState<IntelRef | null>(null);
  const graph = useMemo(() => {
    const startedAt = performance.now();
    const built = buildFlow(snapshot, start);
    recordUiTiming("ui.app_intel.flow_layout", performance.now() - startedAt);
    return built;
  }, [snapshot, start]);
  const counts = graph.levels.map((level, depth) => level.length + (graph.hidden[depth] ? 1 : 0));
  const rows = Math.max(1, ...counts);
  const innerHeight = Math.max(height - CARD.padY - 16, rows * (CARD.height + CARD.gap) - CARD.gap);
  const board = { width: CARD.padX * 2 + CARD.column * 3 + CARD.width, height: CARD.padY + innerHeight + 16 };
  useEffect(() => { setUiGauge("ui.app_intel.flow_nodes", graph.levels.reduce((sum, level) => sum + level.length, 0)); }, [graph]);

  const spots = new Map<IntelRef, { x: number; y: number; depth: number }>();
  const overflow: Array<{ x: number; y: number; depth: number; hidden: number }> = [];
  graph.levels.forEach((level, depth) => {
    const total = counts[depth] * (CARD.height + CARD.gap) - CARD.gap;
    const top = CARD.padY + Math.max(0, (innerHeight - total) / 2);
    const x = CARD.padX + depth * CARD.column;
    level.forEach((ref, index) => spots.set(ref, { x, y: top + index * (CARD.height + CARD.gap), depth }));
    if (graph.hidden[depth]) overflow.push({ x, y: top + level.length * (CARD.height + CARD.gap), depth, hidden: graph.hidden[depth] });
  });
  const path = new Set<IntelRef>();
  for (let cursor = lit; cursor; cursor = graph.parent.get(cursor) ?? null) path.add(cursor);

  return <svg width={board.width} height={Math.max(board.height, height)} viewBox={`0 0 ${board.width} ${board.height}`} role="group" aria-label="Dependency flow" className="block select-none">
    {[...spots].map(([ref, spot]) => {
      const from = graph.parent.get(ref);
      const origin = from && spots.get(from);
      if (!origin) return null;
      const x1 = origin.x + CARD.width, y1 = origin.y + CARD.height / 2, x2 = spot.x, y2 = spot.y + CARD.height / 2;
      const bend = Math.max(8, (x2 - x1) * 0.45);
      const on = path.has(ref);
      return <path key={`link:${ref}`} d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`} fill="none"
        stroke={depthHue(spot.depth)} strokeOpacity={on ? 0.95 : 0.35} strokeWidth={on ? 2 : 1.2} />;
    })}
    {overflow.map(spot => <g key={`more:${spot.depth}`}>
      <rect x={spot.x} y={spot.y} width={CARD.width} height={CARD.height} rx={7} fill="none" stroke={depthHue(spot.depth)} strokeOpacity={0.45} strokeDasharray="3 3" />
      <text x={spot.x + 11} y={spot.y + 24} className="fill-muted-foreground font-mono text-[9px]">+{spot.hidden} more</text>
    </g>)}
    {[...spots].map(([ref, spot]) => {
      const reach = reachOf(snapshot, ref);
      const screen = ref.startsWith("screen:") ? snapshot.screens[ref.slice(7)] : null;
      const platforms = screen ? "both" as NodePlatforms : platformsFor(snapshot, ref);
      const boundary = boundaryOf(ref);
      const detail = `${boundaryLabel[boundary]}${screen ? ` · ${screen.route ?? ref.slice(7)}` : ` · reach ${reach}`}${platforms === "both" ? "" : ` · ${platformLabel(platforms)}`}`;
      const barWidth = Math.max(3, 44 * heatT(reach, max));
      const on = path.has(ref);
      return <g key={`card:${ref}`} className="cursor-pointer" data-flow-node={ref} data-flow-boundary={boundary} role="button" tabIndex={0}
        aria-label={`${labelOf(ref)}, ${detail}`}
        onPointerMove={event => { setLit(ref); onHover({ title: ref.replace(/^(?:file|package|screen):/, ""), detail, x: event.clientX, y: event.clientY }); }}
        onPointerLeave={() => { setLit(null); onHover(null); }}
        onClick={() => onRoot(ref)}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRoot(ref); } }}
      >
        <rect x={spot.x} y={spot.y} width={CARD.width} height={CARD.height} rx={7}
          fill={depthTint(spot.depth, on ? 0.3 : 0.16)} stroke={depthHue(spot.depth)} strokeOpacity={on ? 1 : 0.5} strokeWidth={on ? 1.6 : 1} />
        <rect x={spot.x + 1} y={spot.y + 1} width={3.5} height={CARD.height - 2} rx={1.75} fill={boundaryColor(boundary)} />
        {platforms !== "both" && <rect x={spot.x + CARD.width - 4.5} y={spot.y + 1} width={3.5} height={CARD.height - 2} rx={1.75} className={platformFill[platforms]} />}
        <text x={spot.x + 12} y={spot.y + 16} className="fill-foreground font-mono text-[10.5px] font-medium">{clampName(labelOf(ref), NAME_CHARS)}</text>
        <text x={spot.x + 12} y={spot.y + 29} fill={boundaryColor(boundary)} className="font-mono text-[8px] font-semibold uppercase tracking-wider">{boundary}</text>
        <text x={spot.x + 16 + boundary.length * 5.4} y={spot.y + 29} className="fill-muted-foreground font-mono text-[9px]">{ellipsize(screen ? screen.route ?? "" : pathOf(ref), pathChars(boundary))}</text>
        {!screen && <>
          <text x={spot.x + CARD.width - 11} y={spot.y + 16} textAnchor="end" className="fill-muted-foreground font-mono text-[9px] tabular-nums">{reach}</text>
          <rect x={spot.x + CARD.width - 11 - barWidth} y={spot.y + CARD.height - 8} width={barWidth} height={3} rx={1.5} fill={heat(reach, max)} />
        </>}
      </g>;
    })}
  </svg>;
}

/** The Flow's boundary filter: one chip per boundary the app's entry points fall into. */
function BoundaryFilter({ available, selected, onToggle, onAll }: {
  available: Array<{ boundary: Boundary; count: number }>; selected: ReadonlySet<string>;
  onToggle: (boundary: Boundary) => void; onAll: () => void;
}) {
  if (!available.length) return null;
  const all = available.every(entry => selected.has(entry.boundary));
  return <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5" role="group" aria-label="Filter entry points" data-flow-filter>
    <ListFilterIcon className="size-3 shrink-0 text-muted-foreground" />
    <button type="button" data-boundary="all" aria-pressed={all} onClick={onAll}
      className={`rounded-full border px-2 py-0.5 text-[10.5px] ${all ? "border-primary text-primary" : "text-muted-foreground"}`}>All</button>
    {available.map(({ boundary, count }) => {
      const on = selected.has(boundary);
      return <button key={boundary} type="button" data-boundary={boundary} aria-pressed={on} title={boundaryLabel[boundary]}
        onClick={() => onToggle(boundary)}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${on ? "text-foreground" : "text-muted-foreground opacity-55"}`}
        style={{ borderColor: on ? boundaryColor(boundary) : undefined, background: on ? `color-mix(in oklab, ${boundaryColor(boundary)} 14%, transparent)` : undefined }}>
        <span className="size-1.5 rounded-full" style={{ background: boundaryColor(boundary) }} />
        {boundaryLabel[boundary]}
        <span className="tabular-nums opacity-70">{count}</span>
      </button>;
    })}
  </div>;
}

export const AppIntelligenceView = memo(function AppIntelligenceView({ panel }: { panel: AppIntelligencePanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Hover>(null);
  const [atlasRef, atlasSize] = useMeasured();
  const [flowRef, flowSize, flowBox] = useMeasured();
  const snapshot = state.snapshot;
  const search = query.trim().toLowerCase();

  const tries = useMemo(() => {
    if (!snapshot) return null;
    const startedAt = performance.now();
    const built = { on: buildTrie(snapshot, { withPackages: true }), off: buildTrie(snapshot, { withPackages: false }) };
    recordUiTiming("ui.app_intel.atlas_layout", performance.now() - startedAt);
    return built;
  }, [snapshot]);
  const max = useMemo(() => snapshot ? maxReach(snapshot) : 1, [snapshot]);
  const root = tries ? (state.showPackages ? tries.on : tries.off) : null;
  const zoomed = root ? findNode(root, state.atlasPath) ?? root : null;

  const cells = useMemo(() => {
    if (!zoomed || atlasSize.width < 20 || atlasSize.height < 20) return [];
    const out: ReactNode[] = [];
    atlasCells(zoomed, { x: 0, y: 0, width: atlasSize.width, height: atlasSize.height }, 0, {
      max, matches: path => !search || path.toLowerCase().includes(search),
      onZoom: path => panel.zoomTo(path),
      onTrace: node => { if (node.leaf?.kind !== "package") traceFile(node.path); },
      onHover: setHover,
    }, out);
    return out;
  }, [zoomed, atlasSize.width, atlasSize.height, max, search, state.showPackages]);
  useEffect(() => { setUiGauge("ui.app_intel.atlas_cells", cells.length); }, [cells.length]);

  // A click in the Atlas should land on a screen that actually reaches the file, not an arbitrary one.
  function traceFile(path: string) {
    if (!snapshot) return;
    const direct = Object.entries(snapshot.screens).find(([, screen]) => screen.source === path);
    if (direct) { panel.selectScreen(direct[0]); return; }
    const owner = ownerScreen(snapshot, fileRef(path));
    if (owner) panel.selectScreen(owner);
    panel.setFlowRoot(path);
    panel.setView("flow");
  }

  const selected = state.selectedScreen && snapshot?.screens[state.selectedScreen] ? state.selectedScreen : null;
  const flowStart: IntelRef | null = state.flowRoot ? fileRef(state.flowRoot) : selected ? screenRef(selected) : null;
  // An entry point is classified by the file it renders: the ids are routes, which say nothing.
  const entries = useMemo(() => Object.entries(snapshot?.screens ?? {})
    .map(([id, screen]) => ({ id, screen, boundary: screen.source ? boundaryOf(fileRef(screen.source)) : "entry" as Boundary })), [snapshot]);
  const available = useMemo(() => boundariesIn(entries.map(entry => entry.boundary)), [entries]);
  const selectedBoundaries = useMemo(() => new Set<string>(state.boundaries ?? available.map(entry => entry.boundary)), [state.boundaries, available]);
  const toggleBoundary = useCallback((boundary: Boundary) => panel.toggleBoundary(boundary, available.map(entry => entry.boundary)), [panel, available]);
  // Re-centre the canvas whenever the graph it holds changes, so a new trace is never panned away.
  usePanCanvas(flowBox, flowStart ?? "");
  const screens = useMemo(() => entries.filter(({ id, screen, boundary }) => selectedBoundaries.has(boundary)
    && (!search || `${id} ${screen.title} ${screen.route ?? ""} ${screen.source ?? ""}`.toLowerCase().includes(search))), [entries, selectedBoundaries, search]);
  const hottest = useMemo(() => zoomed ? leavesOf(zoomed).filter(node => !search || node.path.toLowerCase().includes(search)).sort((a, b) => b.reach - a.reach).slice(0, 60) : [], [zoomed, search]);

  return <section id="app-intelligence-panel" className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-label="App Intelligence"
    onKeyDown={event => {
      if (event.key !== "Escape") return;
      const node = root && state.atlasPath ? findNode(root, state.atlasPath) : null;
      if (state.view === "atlas" && node) panel.zoomTo(node.parent?.path ?? "");
      if (state.view === "flow" && state.flowRoot) panel.setFlowRoot(null);
    }}>
    <header className="panel-toolbar flex h-[49px] shrink-0 items-center gap-2 border-b px-2">
      <ProjectPicker projectPath={state.projectPath} recents={state.recents} disabled={!state.available || state.busy !== null}
        onSelect={path => void panel.selectProject(path)} onBrowse={() => void panel.pickProject()} />
      {snapshot && <div role="tablist" aria-label="App Intelligence view" className="flex overflow-hidden rounded-md border">
        {(["atlas", "flow"] as const).map(view => <button key={view} type="button" role="tab" aria-selected={state.view === view} data-view={view}
          className={`h-7 px-3 text-xs capitalize ${state.view === view ? "bg-muted text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground"}`}
          onClick={() => panel.setView(view)}>{view}</button>)}
      </div>}
      <InputGroup size="sm" className="min-w-28 flex-1"><InputGroupInput type="search" aria-label="Search the map" placeholder="Search files, packages and screens…" value={query} onChange={event => setQuery(event.target.value)} /><InputGroupAddon><SearchIcon /></InputGroupAddon></InputGroup>
      {state.busy === "generating" || state.busy === "cancelling" ? <Button variant="outline" size="sm" disabled={state.busy === "cancelling"} onClick={() => void panel.cancel()}><SquareIcon />Cancel</Button> : <Button size="sm" disabled={!state.available || !state.projectPath || state.busy !== null} onClick={() => void panel.generate()}><RefreshCwIcon />{snapshot ? "Regenerate" : "Generate"}</Button>}
    </header>
    {state.error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="text-xs">{state.error}</AlertDescription></Alert>}
    {state.run && <div className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground" role="status">{state.run.message}</div>}
    {!state.projectPath ? <div className="grid flex-1 place-items-center p-8 text-center"><div><NetworkIcon className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-medium">Map a React Native app</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">Choose a project to discover Expo Router and React Navigation screens, then trace their native dependencies.</p></div></div>
      : !snapshot || !root || !zoomed ? <div className="grid flex-1 place-items-center p-8 text-center"><div><h2 className="font-medium">No App Intelligence yet</h2><p className="mt-1 text-sm text-muted-foreground">Generate a static iOS + Android screen and dependency graph.</p></div></div>
      : <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,1fr)_minmax(13rem,15rem)] max-[720px]:grid-cols-1 max-[720px]:grid-rows-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <main className="flex min-h-0 min-w-0 flex-col border-r max-[720px]:border-b max-[720px]:border-r-0">
          {state.view === "atlas" ? <>
            <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
              <nav aria-label="Atlas path" className="flex min-w-0 flex-wrap gap-1 font-mono text-[11.5px] text-muted-foreground">
                <button type="button" className="text-primary" onClick={() => panel.zoomTo("")}>{state.projectPath.split("/").at(-1) || "project"}</button>
                {ancestorsOf(zoomed).concat(zoomed.path ? [zoomed] : []).map((node, index, all) => <span key={node.path} className="flex gap-1">/
                  {index === all.length - 1 ? <span className="text-foreground">{node.name}</span> : <button type="button" className="text-primary" onClick={() => panel.zoomTo(node.path)}>{node.name}</button>}
                </span>)}
              </nav>
              <button type="button" id="app-intel-packages" aria-pressed={state.showPackages} onClick={() => panel.setPackages(!state.showPackages)}
                className={`ml-auto shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px] ${state.showPackages ? "border-primary text-primary" : "text-muted-foreground line-through opacity-70"}`}>node_modules</button>
              <div className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-muted-foreground"><span>reach</span><span className="h-[7px] w-[70px] rounded" style={{ background: heatRamp() }} /><span className="tabular-nums">{max}</span></div>
            </div>
            <div ref={atlasRef} className="relative min-h-0 flex-1">{cells}</div>
            <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">Area is files, colour is reach — how many entry points pull it in. Click a directory to zoom in, Esc to go back, click a file to trace it.</p>
          </> : <>
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
              <span className="truncate font-medium">{state.flowRoot ? `Re-rooted on ${labelOf(fileRef(state.flowRoot))}` : snapshot.screens[selected ?? ""]?.title ?? "Choose a screen"}</span>
              {state.flowRoot && <button type="button" className="ml-auto text-primary" onClick={() => panel.setFlowRoot(null)}>Back to screen</button>}
            </div>
            <BoundaryFilter available={available} selected={selectedBoundaries} onToggle={toggleBoundary} onAll={() => panel.setBoundaries(null)} />
            <div ref={flowRef} data-flow-canvas className="min-h-0 flex-1 cursor-grab touch-none overflow-auto [&[data-panning]]:cursor-grabbing">
              <div className="w-max will-change-transform">
                {flowStart ? <FlowView snapshot={snapshot} start={flowStart} max={max} height={flowSize.height} onRoot={ref => { if (ref.startsWith("file:")) panel.setFlowRoot(ref.slice(5)); }} onHover={setHover} />
                  : <div className="grid place-items-center p-6 text-center text-sm text-muted-foreground" style={{ width: flowSize.width, height: flowSize.height }}>Choose an entry point to trace its dependencies.</div>}
              </div>
            </div>
            <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">Each column goes one import deeper, tinted by depth. Drag or scroll to pan, double-click to recentre, click a card to re-root, Esc returns.</p>
          </>}
        </main>
        <aside className="flex min-h-0 min-w-0 flex-col">
          <h2 className="shrink-0 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{state.view === "atlas" ? "Most-reached here" : `${screens.length} entry points`}</h2>
          <div className="min-h-0 flex-1 overflow-auto">
            {state.view === "atlas" ? hottest.map(node => <button key={node.path} type="button" className="block w-full border-b px-3 py-2 text-left hover:bg-muted/50"
              onClick={() => node.leaf?.kind !== "package" && traceFile(node.path)}>
              <span className="block truncate text-xs font-medium">{node.name}</span>
              <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{node.path}</span>
              <span className="mt-1 flex items-center gap-1.5"><span className="h-1 rounded" style={{ width: `${Math.max(4, 90 * heatT(node.reach, max))}px`, background: heat(node.reach, max) }} /><span className="text-[10px] tabular-nums text-muted-foreground">{node.reach}</span></span>
            </button>)
              : screens.length === 0 ? <p className="px-3 py-3 text-[11px] text-muted-foreground">No entry point matches the filter.</p>
                : screens.map(({ id, screen, boundary }) => <button key={id} type="button" data-entry={id} data-entry-boundary={boundary} aria-current={selected === id && !state.flowRoot} className={`block w-full border-b px-3 py-2 text-left hover:bg-muted/50 ${selected === id && !state.flowRoot ? "bg-muted shadow-[inset_2px_0_0_var(--primary)]" : ""}`}
                  onClick={() => panel.selectScreen(id)}>
                  <span className="flex items-center gap-1.5"><span className="size-1.5 shrink-0 rounded-full" style={{ background: boundaryColor(boundary) }} /><span className="truncate text-xs font-medium">{screen.title}</span></span>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{screen.route ?? id}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{screen.source ?? "Source unresolved"}</span>
                </button>)}
          </div>
        </aside>
      </div>}
    {hover && <div role="presentation" className="pointer-events-none fixed z-50 max-w-[330px] rounded-md border bg-popover px-2 py-1.5 shadow-lg"
      style={{ left: Math.min(hover.x + 12, (typeof window === "undefined" ? 0 : window.innerWidth) - 340), top: Math.max(6, hover.y - 64) }}>
      <div className="break-all font-mono text-[11px] text-foreground">{hover.title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hover.detail}</div>
    </div>}
  </section>;
});
