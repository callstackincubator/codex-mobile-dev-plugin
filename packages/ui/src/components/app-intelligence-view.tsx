import { ColumnsIcon, FolderOpenIcon, ListFilterIcon, MaximizeIcon, MinusIcon, NetworkIcon, PlusIcon, RefreshCwIcon, RowsIcon, SearchIcon, SquareIcon } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AppIntelligencePanel } from "../app-intelligence-panel.ts";
import type { AppIntelSnapshot, IntelRef } from "@mobile-dev/shared/app-intelligence.ts";
import { fileRef, screenRef } from "@mobile-dev/shared/app-intelligence.ts";
import type { Boundary, FlowOrientation, NodePlatforms } from "../app-intelligence-layout.ts";
import { boundariesIn, boundaryColor, boundaryLabel, boundaryOf, buildFlow, clampName, depthHue, depthTint, ellipsize, flowLink, heat, heatRamp, heatT, labelOf, maxReach, pathOf, placeFlow, platformsFor, reachOf, FLOW_METRICS } from "../app-intelligence-layout.ts";
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

const ZOOM = { min: 0.3, max: 2.5, step: 1.25 } as const;
const clampZoom = (value: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, value));

/**
 * Pan and zoom for the Flow. The board usually fits its pane, so moving scrollLeft did nothing;
 * this transforms the canvas instead, which works whatever its size. A drag that actually moves
 * swallows the click that follows it, so panning never re-roots the graph.
 *
 * The view state lives in a ref and is written straight to the style, so folding a boundary — a
 * React re-render — never moves the board. Only an explicit reset or a new root recentres it.
 */
function usePanZoom(element: HTMLElement | null, resetKey: string) {
  const view = useRef({ x: 0, y: 0, scale: 1 });
  const [zoom, setZoom] = useState(1);
  const apply = useRef<(next: Partial<{ x: number; y: number; scale: number }>) => void>(() => {});
  useEffect(() => {
    if (!element) return;
    const canvas = element.firstElementChild as HTMLElement | null;
    if (!canvas) return;
    canvas.style.transformOrigin = "0 0";
    const draw = () => {
      const { x, y, scale } = view.current;
      canvas.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${scale})`;
    };
    apply.current = next => {
      if (next.scale !== undefined) next.scale = clampZoom(next.scale);
      view.current = { ...view.current, ...next };
      setZoom(view.current.scale);
      draw();
    };
    draw();
    let origin: { x: number; y: number; panX: number; panY: number } | null = null;
    let moved = false;
    const swallow = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      origin = { x: event.clientX, y: event.clientY, panX: view.current.x, panY: view.current.y };
      moved = false;
    };
    const move = (event: PointerEvent) => {
      if (!origin) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      element.dataset.panning = "true";
      view.current.x = origin.panX + dx;
      view.current.y = origin.panY + dy;
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
      // Zoom about the pointer, so the card under the cursor stays under it.
      if (event.ctrlKey || event.metaKey) {
        const box = element.getBoundingClientRect();
        const pointerX = event.clientX - box.left, pointerY = event.clientY - box.top;
        const { x, y, scale } = view.current;
        const next = clampZoom(scale * Math.exp(-event.deltaY / 240));
        const ratio = next / scale;
        apply.current({ scale: next, x: pointerX - (pointerX - x) * ratio, y: pointerY - (pointerY - y) * ratio });
        return;
      }
      view.current.x -= event.deltaX;
      view.current.y -= event.deltaY;
      draw();
    };
    const recenter = () => apply.current({ x: 0, y: 0, scale: 1 });
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
  }, [element]);
  // A new root or reading direction is a new graph, so it starts from the default view.
  useEffect(() => { apply.current({ x: 0, y: 0, scale: 1 }); }, [resetKey]);
  const by = useCallback((factor: number) => {
    const { scale, x, y } = view.current;
    const next = clampZoom(scale * factor);
    const box = element?.getBoundingClientRect();
    const centreX = (box?.width ?? 0) / 2, centreY = (box?.height ?? 0) / 2;
    const ratio = next / scale;
    apply.current({ scale: next, x: centreX - (centreX - x) * ratio, y: centreY - (centreY - y) * ratio });
  }, [element]);
  const reset = useCallback(() => apply.current({ x: 0, y: 0, scale: 1 }), []);
  return { zoom, zoomIn: useCallback(() => by(ZOOM.step), [by]), zoomOut: useCallback(() => by(1 / ZOOM.step), [by]), reset };
}

type Hover = { title: string; detail: string; x: number; y: number } | null;

const NAME_CHARS = 24;
/** Characters the subtitle can take, once the boundary tag beside it has had its share. */
const pathChars = (boundary: string) => Math.max(8, Math.floor((FLOW_METRICS.card.width - 30 - boundary.length * 5.4) / 5.05));

/** The three weights a connector is drawn at: dim by default, warmer on hover, full when lit. */
const LINK = { dim: 0.2, hovered: 0.6, lit: 1 } as const;

function FlowView({ snapshot, start, max, orientation, toggled, expanded, litBoundary, height, onToggleGroup, onLight, onShowAll, onHover }: {
  snapshot: AppIntelSnapshot; start: IntelRef; max: number; orientation: FlowOrientation;
  toggled: ReadonlySet<string>; expanded: ReadonlySet<string>; litBoundary: string | null; height: number;
  onToggleGroup: (key: string, open: boolean) => void; onLight: (key: string) => void;
  onShowAll: (key: string) => void; onHover: (hover: Hover) => void;
}) {
  const [lit, setLit] = useState<IntelRef | null>(null);
  const { graph, placement } = useMemo(() => {
    const startedAt = performance.now();
    const built = buildFlow(snapshot, start, { toggled, expanded });
    const placed = placeFlow(built, orientation);
    recordUiTiming("ui.app_intel.flow_layout", performance.now() - startedAt);
    return { graph: built, placement: placed };
  }, [snapshot, start, orientation, toggled, expanded]);
  useEffect(() => { setUiGauge("ui.app_intel.flow_nodes", placement.cards.length); }, [placement]);

  const path = new Set<IntelRef>();
  for (let cursor = lit; cursor; cursor = graph.parent.get(cursor) ?? null) path.add(cursor);
  // A chip lights its boundary at every hop; a header lights only its own.
  const isLit = (boundary: Boundary, depth: number) => litBoundary === `${depth}:${boundary}` || litBoundary === `*:${boundary}`;
  const weight = (boundary: Boundary, depth: number, hovered: boolean) =>
    isLit(boundary, depth) ? LINK.lit : hovered ? LINK.hovered : LINK.dim;

  return <svg width={placement.width} height={Math.max(placement.height, height)} viewBox={`0 0 ${placement.width} ${placement.height}`}
    role="group" aria-label="Dependency flow" data-flow-orientation={orientation} className="block select-none">
    {placement.cards.map(({ ref, depth, rect }) => {
      const from = graph.parent.get(ref);
      const origin = from && placement.rectOf.get(from);
      if (!origin) return null;
      const opacity = weight(boundaryOf(ref), depth, path.has(ref));
      return <path key={`link:${ref}`} d={flowLink(origin, rect, orientation)} fill="none" data-flow-link={ref}
        stroke={depthHue(depth)} strokeOpacity={opacity} strokeWidth={opacity === LINK.lit ? 2 : 1.2} />;
    })}
    {/* A folded boundary keeps its connectors: they land on the header instead of on its rows,
        so the shape of what is hidden stays on screen rather than vanishing with the cards. */}
    {[...placement.headers.filter(header => header.collapsed).map(header => ({ ...header, target: header.rect, kind: "group" })),
      ...placement.more.map(entry => ({ ...entry, target: entry.rect, kind: "more" }))]
      .flatMap(entry => entry.sources.map(source => {
        const origin = placement.rectOf.get(source);
        if (!origin) return null;
        const opacity = weight(entry.boundary, entry.depth, false);
        return <path key={`folded:${entry.kind}:${entry.key}:${source}`} d={flowLink(origin, entry.target, orientation)} fill="none"
          data-flow-folded-link={entry.key} stroke={depthHue(entry.depth)} strokeOpacity={opacity}
          strokeWidth={opacity === LINK.lit ? 2 : 1.2} strokeDasharray={entry.kind === "more" ? "4 3" : undefined} />;
      }))}
    {placement.headers.map(header => {
      const colour = boundaryColor(header.boundary);
      const summary = header.collapsed ? `${header.count} hidden` : `${header.shown} of ${header.count}`;
      const on = isLit(header.boundary, header.depth);
      const pin = { x: header.rect.x + header.rect.width - 13, y: header.rect.y + header.rect.height / 2 };
      return <g key={`group:${header.key}`} data-flow-group={header.key} data-flow-collapsed={header.collapsed ? "true" : "false"} data-flow-lit={on ? "true" : "false"}>
        <g className="cursor-pointer" data-flow-fold={header.key} role="button" tabIndex={0} aria-expanded={!header.collapsed} aria-label={`${boundaryLabel[header.boundary]}, ${summary}`}
          onClick={() => onToggleGroup(header.key, header.collapsed)}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onToggleGroup(header.key, header.collapsed); } }}>
          <rect x={header.rect.x} y={header.rect.y} width={header.rect.width} height={header.rect.height} rx={5}
            fill={`color-mix(in oklab, ${colour} ${on ? 30 : 16}%, transparent)`} stroke={colour} strokeOpacity={on ? 1 : 0.55} strokeWidth={on ? 1.5 : 1} />
          <path d={header.collapsed ? `M${header.rect.x + 7} ${header.rect.y + 7}l4 4-4 4z` : `M${header.rect.x + 6} ${header.rect.y + 9}l4 4 4-4z`} fill={colour} />
          <text x={header.rect.x + 20} y={header.rect.y + 15} fill={colour} className="font-mono text-[9.5px] font-semibold uppercase tracking-wider">{boundaryLabel[header.boundary]}</text>
          <text x={header.rect.x + header.rect.width - 26} y={header.rect.y + 15} textAnchor="end" className="fill-muted-foreground font-mono text-[9px] tabular-nums">{header.collapsed ? header.count : `${header.shown}/${header.count}`}</text>
        </g>
        {/* The pin only lights this boundary's connectors, so folding stays the header's own job. */}
        <circle className="cursor-pointer" data-flow-light={header.key} role="button" tabIndex={0} aria-pressed={on}
          aria-label={`${on ? "Dim" : "Highlight"} the ${boundaryLabel[header.boundary]} connectors`}
          cx={pin.x} cy={pin.y} r={5} fill={on ? colour : "transparent"} stroke={colour} strokeOpacity={0.8}
          onClick={() => onLight(header.key)}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onLight(header.key); } }} />
      </g>;
    })}
    {placement.more.map(entry => <g key={`more:${entry.key}`} className="cursor-pointer" data-flow-more={entry.key} role="button" tabIndex={0}
      aria-label={`Show ${entry.hidden} more`}
      onClick={() => onShowAll(entry.key)}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onShowAll(entry.key); } }}>
      <rect x={entry.rect.x} y={entry.rect.y} width={entry.rect.width} height={entry.rect.height} rx={6} fill="transparent" stroke={depthHue(entry.depth)} strokeOpacity={0.45} strokeDasharray="3 3" />
      <text x={entry.rect.x + 10} y={entry.rect.y + 15} className="fill-muted-foreground font-mono text-[9px]">+{entry.hidden} more — show all</text>
    </g>)}
    {placement.cards.map(({ ref, depth, rect }) => {
      const reach = reachOf(snapshot, ref);
      const screen = ref.startsWith("screen:") ? snapshot.screens[ref.slice(7)] : null;
      const platforms = screen ? "both" as NodePlatforms : platformsFor(snapshot, ref);
      const boundary = boundaryOf(ref);
      const detail = `${boundaryLabel[boundary]}${screen ? ` · ${screen.route ?? ref.slice(7)}` : ` · reach ${reach}`}${platforms === "both" ? "" : ` · ${platformLabel(platforms)}`}`;
      const barWidth = Math.max(3, 44 * heatT(reach, max));
      const on = path.has(ref);
      return <g key={`card:${ref}`} data-flow-node={ref} data-flow-boundary={boundary} role="img" aria-label={`${labelOf(ref)}, ${detail}`}
        onPointerMove={event => { setLit(ref); onHover({ title: ref.replace(/^(?:file|package|screen):/, ""), detail, x: event.clientX, y: event.clientY }); }}
        onPointerLeave={() => { setLit(null); onHover(null); }}
      >
        <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={7}
          fill={depthTint(depth, on ? 0.3 : 0.16)} stroke={depthHue(depth)} strokeOpacity={on ? 1 : 0.5} strokeWidth={on ? 1.6 : 1} />
        <rect x={rect.x + 1} y={rect.y + 1} width={3.5} height={rect.height - 2} rx={1.75} fill={boundaryColor(boundary)} />
        {platforms !== "both" && <rect x={rect.x + rect.width - 4.5} y={rect.y + 1} width={3.5} height={rect.height - 2} rx={1.75} className={platformFill[platforms]} />}
        <text x={rect.x + 12} y={rect.y + 16} className="fill-foreground font-mono text-[10.5px] font-medium">{clampName(labelOf(ref), NAME_CHARS)}</text>
        <text x={rect.x + 12} y={rect.y + 29} fill={boundaryColor(boundary)} className="font-mono text-[8px] font-semibold uppercase tracking-wider">{boundary}</text>
        <text x={rect.x + 16 + boundary.length * 5.4} y={rect.y + 29} className="fill-muted-foreground font-mono text-[9px]">{ellipsize(screen ? screen.route ?? "" : pathOf(ref), pathChars(boundary))}</text>
        {!screen && <>
          <text x={rect.x + rect.width - 11} y={rect.y + 16} textAnchor="end" className="fill-muted-foreground font-mono text-[9px] tabular-nums">{reach}</text>
          <rect x={rect.x + rect.width - 11 - barWidth} y={rect.y + rect.height - 8} width={barWidth} height={3} rx={1.5} fill={heat(reach, max)} />
        </>}
      </g>;
    })}
  </svg>;
}

/** The Flow's boundary filter: one chip per boundary the app's entry points fall into. */
function BoundaryFilter({ available, selected, lit, onToggle, onLight, onAll }: {
  available: Array<{ boundary: Boundary; count: number }>; selected: ReadonlySet<string>; lit: string | null;
  onToggle: (boundary: Boundary) => void; onLight: (boundary: Boundary) => void; onAll: () => void;
}) {
  if (!available.length) return null;
  const all = available.every(entry => selected.has(entry.boundary));
  return <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5" role="group" aria-label="Filter entry points" data-flow-filter>
    <ListFilterIcon className="size-3 shrink-0 text-muted-foreground" />
    <button type="button" data-boundary="all" aria-pressed={all} onClick={onAll}
      className={`rounded-full border px-2 py-0.5 text-[10.5px] ${all ? "border-primary text-primary" : "text-muted-foreground"}`}>All</button>
    {available.map(({ boundary, count }) => {
      const on = selected.has(boundary);
      const highlighted = lit === `*:${boundary}`;
      return <span key={boundary} className={`flex items-center gap-1 rounded-full border px-1 py-0.5 text-[10.5px] ${on ? "text-foreground" : "text-muted-foreground opacity-55"}`}
        style={{ borderColor: highlighted ? boundaryColor(boundary) : on ? boundaryColor(boundary) : undefined, borderWidth: highlighted ? 1.5 : undefined, background: on ? `color-mix(in oklab, ${boundaryColor(boundary)} ${highlighted ? 28 : 14}%, transparent)` : undefined }}>
        {/* The dot lights this boundary's connectors at every hop; the label still filters. */}
        <button type="button" data-boundary-light={boundary} aria-pressed={highlighted} title={`Highlight the ${boundaryLabel[boundary]} connectors`}
          onClick={() => onLight(boundary)} className="grid size-3 place-items-center rounded-full">
          <span className="size-2 rounded-full" style={{ background: boundaryColor(boundary), outline: highlighted ? `1.5px solid ${boundaryColor(boundary)}` : undefined, outlineOffset: "1px" }} />
        </button>
        <button type="button" data-boundary={boundary} aria-pressed={on} title={boundaryLabel[boundary]} onClick={() => onToggle(boundary)} className="flex items-center gap-1 pr-1">
          {boundaryLabel[boundary]}
          <span className="tabular-nums opacity-70">{count}</span>
        </button>
      </span>;
    })}
  </div>;
}

const ORIENTATIONS = [["columns", "Columns", ColumnsIcon], ["tree", "Top-down", RowsIcon]] as const;

export const AppIntelligenceView = memo(function AppIntelligenceView({ panel }: { panel: AppIntelligencePanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Hover>(null);
  const [flowRef, flowSize, flowBox] = useMeasured();
  const snapshot = state.snapshot;
  const search = query.trim().toLowerCase();

  const max = useMemo(() => snapshot ? maxReach(snapshot) : 1, [snapshot]);
  // The rail is what roots the graph. A card is a place in that screen's tree, not a tree of its
  // own: re-rooting on a click meant any stray click threw away where the reader had got to.
  const selected = state.selectedScreen && snapshot?.screens[state.selectedScreen] ? state.selectedScreen : null;
  const flowStart: IntelRef | null = selected ? screenRef(selected) : null;
  const toggled = useMemo(() => new Set(state.toggled), [state.toggled]);
  const expanded = useMemo(() => new Set(state.expanded), [state.expanded]);

  // An entry point is classified by the file it renders: the ids are routes, which say nothing.
  const entries = useMemo(() => Object.entries(snapshot?.screens ?? {})
    .map(([id, screen]) => ({ id, screen, boundary: screen.source ? boundaryOf(fileRef(screen.source)) : "entry" as Boundary })), [snapshot]);
  const available = useMemo(() => boundariesIn(entries.map(entry => entry.boundary)), [entries]);
  const selectedBoundaries = useMemo(() => new Set<string>(state.boundaries ?? available.map(entry => entry.boundary)), [state.boundaries, available]);
  const toggleBoundary = useCallback((boundary: Boundary) => panel.toggleBoundary(boundary, available.map(entry => entry.boundary)), [panel, available]);
  // Re-centre the canvas whenever the graph it holds changes, so a new trace is never panned away.
  const { zoom, zoomIn, zoomOut, reset } = usePanZoom(flowBox, `${flowStart ?? ""}:${state.orientation}`);
  const screens = useMemo(() => entries.filter(({ id, screen, boundary }) => selectedBoundaries.has(boundary)
    && (!search || `${id} ${screen.title} ${screen.route ?? ""} ${screen.source ?? ""}`.toLowerCase().includes(search))), [entries, selectedBoundaries, search]);

  return <section id="app-intelligence-panel" className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-label="App Intelligence">
    <header className="panel-toolbar flex h-[49px] shrink-0 items-center gap-2 border-b px-2">
      <ProjectPicker projectPath={state.projectPath} recents={state.recents} disabled={!state.available || state.busy !== null}
        onSelect={path => void panel.selectProject(path)} onBrowse={() => void panel.pickProject()} />
      {snapshot && <div role="group" aria-label="Flow direction" className="flex overflow-hidden rounded-md border">
        {ORIENTATIONS.map(([value, label, Icon]) => <button key={value} type="button" aria-pressed={state.orientation === value} data-orientation={value} title={label}
          className={`flex h-7 items-center gap-1 px-2 text-xs ${state.orientation === value ? "bg-muted text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground"}`}
          onClick={() => panel.setOrientation(value)}><Icon className="size-3.5" />{label}</button>)}
      </div>}
      <InputGroup size="sm" className="min-w-28 flex-1"><InputGroupInput type="search" aria-label="Search the graph" placeholder="Search screens…" value={query} onChange={event => setQuery(event.target.value)} /><InputGroupAddon><SearchIcon /></InputGroupAddon></InputGroup>
      {state.busy === "generating" || state.busy === "cancelling" ? <Button variant="outline" size="sm" disabled={state.busy === "cancelling"} onClick={() => void panel.cancel()}><SquareIcon />Cancel</Button> : <Button size="sm" disabled={!state.available || !state.projectPath || state.busy !== null} onClick={() => void panel.generate()}><RefreshCwIcon />{snapshot ? "Regenerate" : "Generate"}</Button>}
    </header>
    {state.error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="text-xs">{state.error}</AlertDescription></Alert>}
    {state.run && <div className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground" role="status">{state.run.message}</div>}
    {!state.projectPath ? <div className="grid flex-1 place-items-center p-8 text-center"><div><NetworkIcon className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-medium">Map a React Native app</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">Choose a project to discover Expo Router and React Navigation screens, then trace their native dependencies.</p></div></div>
      : !snapshot ? <div className="grid flex-1 place-items-center p-8 text-center"><div><h2 className="font-medium">No App Intelligence yet</h2><p className="mt-1 text-sm text-muted-foreground">Generate a static iOS + Android screen and dependency graph.</p></div></div>
      : <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,1fr)_minmax(13rem,15rem)] max-[720px]:grid-cols-1 max-[720px]:grid-rows-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <main className="flex min-h-0 min-w-0 flex-col border-r max-[720px]:border-b max-[720px]:border-r-0">
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
            <span className="truncate font-medium">{snapshot.screens[selected ?? ""]?.title ?? "Choose a screen"}</span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 text-[10.5px] text-muted-foreground"><span>reach</span><span className="h-[7px] w-[70px] rounded" style={{ background: heatRamp() }} /><span className="tabular-nums">{max}</span></div>
            <div className="flex shrink-0 items-center gap-0.5 rounded-md border" role="group" aria-label="Zoom">
              <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out" className="grid size-6 place-items-center text-muted-foreground hover:text-foreground" onClick={zoomOut}><MinusIcon className="size-3" /></button>
              <span data-zoom-level className="w-9 text-center text-[10.5px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in" className="grid size-6 place-items-center text-muted-foreground hover:text-foreground" onClick={zoomIn}><PlusIcon className="size-3" /></button>
              <button type="button" data-zoom="reset" aria-label="Reset the view" title="Reset the view" className="grid size-6 place-items-center text-muted-foreground hover:text-foreground" onClick={reset}><MaximizeIcon className="size-3" /></button>
            </div>
          </div>
          <BoundaryFilter available={available} selected={selectedBoundaries} lit={state.litBoundary} onToggle={toggleBoundary} onLight={boundary => panel.litBoundaryTo(`*:${boundary}`)} onAll={() => panel.setBoundaries(null)} />
          <div ref={flowRef} data-flow-canvas className="min-h-0 flex-1 cursor-grab touch-none overflow-auto [&[data-panning]]:cursor-grabbing">
            <div className="w-max will-change-transform">
              {flowStart ? <FlowView snapshot={snapshot} start={flowStart} max={max} orientation={state.orientation} toggled={toggled} expanded={expanded} litBoundary={state.litBoundary} height={flowSize.height}
                onToggleGroup={(key, open) => panel.toggleGroup(key, open)} onLight={key => panel.litBoundaryTo(key)} onShowAll={key => panel.showAllIn(key)} onHover={setHover} />
                : <div className="grid place-items-center p-6 text-center text-sm text-muted-foreground" style={{ width: flowSize.width, height: flowSize.height }}>Choose an entry point to trace its dependencies.</div>}
            </div>
          </div>
          <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">Each hop groups its imports by boundary and opens the first of them — click another to drill in, or its dot to light up its connectors. Drag or scroll to pan, ⌘/Ctrl-scroll or the buttons to zoom, double-click to reset.</p>
        </main>
        <aside className="flex min-h-0 min-w-0 flex-col">
          <h2 className="shrink-0 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{screens.length} entry points</h2>
          <div className="min-h-0 flex-1 overflow-auto">
            {screens.length === 0 ? <p className="px-3 py-3 text-[11px] text-muted-foreground">No entry point matches the filter.</p>
              : screens.map(({ id, screen, boundary }) => <button key={id} type="button" data-entry={id} data-entry-boundary={boundary} aria-current={selected === id} className={`block w-full border-b px-3 py-2 text-left hover:bg-muted/50 ${selected === id ? "bg-muted shadow-[inset_2px_0_0_var(--primary)]" : ""}`}
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
