import { ChevronRightIcon, EraserIcon, FolderOpenIcon, ListFilterIcon, MaximizeIcon, MinusIcon, NetworkIcon, PanelRightCloseIcon, PanelRightOpenIcon, PlusIcon, RefreshCwIcon, SearchIcon, SquareIcon } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AppIntelligencePanel } from "../app-intelligence-panel.ts";
import type { AppIntelSnapshot, IntelRef } from "@mobile-dev/shared/app-intelligence.ts";
import { fileRef, screenRef } from "@mobile-dev/shared/app-intelligence.ts";
import type { Boundary, NodePlatforms } from "../app-intelligence-layout.ts";
import { boundariesIn, boundaryColor, boundaryLabel, boundaryOf, buildFlow, clampName, depthHue, depthTint, ellipsize, flowLink, labelOf, pathOf, placeFlow, platformsFor, reachOf, FLOW_METRICS } from "../app-intelligence-layout.ts";
import { recordUiTiming, setUiGauge } from "../telemetry.ts";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { ConfirmButton } from "./confirm-button.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "./ui/base-select.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

const BROWSE = "\u0000browse";
const folderName = (path: string) => path.split("/").at(-1) || path;

/**
 * The project picker, on the same Select as the workspace's tool and platform menus. It remembers
 * what has been opened, so switching between apps is a menu rather than a trip through the host
 * folder picker; the last entry still opens that picker.
 */
function ProjectPicker({ projectPath, recents, disabled, onSelect, onBrowse }: {
  projectPath: string; recents: readonly string[]; disabled: boolean;
  onSelect: (path: string) => void; onBrowse: () => void;
}) {
  const options = [...new Set([...(projectPath ? [projectPath] : []), ...recents])];
  if (!options.length) return <Button variant="outline" size="sm" data-project-picker disabled={disabled} onClick={onBrowse}><FolderOpenIcon />Choose project</Button>;
  return <Select items={[...options.map(path => ({ value: path, label: folderName(path) })), { value: BROWSE, label: "Choose another project…" }]}
    value={projectPath || null} disabled={disabled}
    onValueChange={value => { if (value === BROWSE) onBrowse(); else if (value) onSelect(value); }}>
    <SelectTrigger id="app-intel-project" data-project-picker size="sm" aria-label="App Intelligence project" className="w-52 min-w-28 shrink">
      <SelectValue>{(value: string | null) => <><FolderOpenIcon /><span className="truncate">{value ? folderName(value) : "Choose project"}</span></>}</SelectValue>
    </SelectTrigger>
    <SelectContent align="start" alignItemWithTrigger={false} className="w-auto max-w-[min(30rem,calc(100vw-16px))] min-w-(--anchor-width)"><SelectGroup>
      {options.map(path => <SelectItem key={path} value={path} className="py-1.5">
        <span className="flex min-w-0 flex-col">
          <span className="truncate leading-5">{folderName(path)}</span>
          <span className="truncate text-xs leading-4 text-muted-foreground">{path}</span>
        </span>
      </SelectItem>)}
      <SelectSeparator />
      <SelectItem value={BROWSE}><FolderOpenIcon />Choose another project…</SelectItem>
    </SelectGroup></SelectContent>
  </Select>;
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

function FlowView({ snapshot, start, toggled, expanded, litBoundary, height, onToggleGroup, onLight, onShowAll, onHover }: {
  snapshot: AppIntelSnapshot; start: IntelRef;
  toggled: ReadonlySet<string>; expanded: ReadonlySet<string>; litBoundary: string | null; height: number;
  onToggleGroup: (key: string, open: boolean) => void; onLight: (key: string) => void;
  onShowAll: (key: string) => void; onHover: (hover: Hover) => void;
}) {
  const [lit, setLit] = useState<IntelRef | null>(null);
  const { graph, placement } = useMemo(() => {
    const startedAt = performance.now();
    const built = buildFlow(snapshot, start, { toggled, expanded });
    const placed = placeFlow(built);
    recordUiTiming("ui.app_intel.flow_layout", performance.now() - startedAt);
    return { graph: built, placement: placed };
  }, [snapshot, start, toggled, expanded]);
  useEffect(() => { setUiGauge("ui.app_intel.flow_nodes", placement.cards.length); }, [placement]);

  const path = new Set<IntelRef>();
  for (let cursor = lit; cursor; cursor = graph.parent.get(cursor) ?? null) path.add(cursor);
  // A chip lights its boundary at every hop; a header lights only its own.
  const isLit = (boundary: Boundary, depth: number) => litBoundary === `${depth}:${boundary}` || litBoundary === `*:${boundary}`;
  const weight = (boundary: Boundary, depth: number, hovered: boolean) =>
    isLit(boundary, depth) ? LINK.lit : hovered ? LINK.hovered : LINK.dim;

  return <svg width={placement.width} height={Math.max(placement.height, height)} viewBox={`0 0 ${placement.width} ${placement.height}`}
    role="group" aria-label="Dependency flow" className="block select-none">
    {placement.cards.map(({ ref, depth, rect }) => {
      const from = graph.parent.get(ref);
      const origin = from && placement.rectOf.get(from);
      if (!origin) return null;
      const opacity = weight(boundaryOf(ref), depth, path.has(ref));
      return <path key={`link:${ref}`} d={flowLink(origin, rect)} fill="none" data-flow-link={ref}
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
        return <path key={`folded:${entry.kind}:${entry.key}:${source}`} d={flowLink(origin, entry.target)} fill="none"
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
        {!screen && <text x={rect.x + rect.width - 11} y={rect.y + 16} textAnchor="end" className="fill-muted-foreground font-mono text-[9px] tabular-nums">{reach}</text>}
      </g>;
    })}
  </svg>;
}

function BoundaryOptions({ available, selected, lit, onToggle, onLight, onAll }: {
  available: Array<{ boundary: Boundary; count: number }>; selected: ReadonlySet<string>; lit: string | null;
  onToggle: (boundary: Boundary) => void; onLight?: (boundary: Boundary) => void; onAll: (checked: boolean) => void;
}) {
  const all = available.length > 0 && available.every(entry => selected.has(entry.boundary));
  return <>
    <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-muted/50">
      <input type="checkbox" data-boundary="all" checked={all} onChange={event => onAll(event.target.checked)} />All
    </label>
    <div className="flex flex-col gap-0.5" role="group" aria-label="Boundaries">
      {available.map(({ boundary, count }) => {
        const on = selected.has(boundary);
        const highlighted = lit === `*:${boundary}`;
        return <div key={boundary} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted/50">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <input type="checkbox" data-boundary={boundary} checked={on} onChange={() => onToggle(boundary)} />
            <span className="size-2 shrink-0 rounded-full" style={{ background: boundaryColor(boundary) }} />
            <span className="truncate">{boundaryLabel[boundary]}</span>
            <span className="ml-auto shrink-0 pl-1 tabular-nums text-muted-foreground">{count}</span>
          </label>
          {onLight && <button type="button" data-boundary-light={boundary} aria-pressed={highlighted} title={`Highlight the ${boundaryLabel[boundary]} connectors`}
            onClick={() => onLight(boundary)} className="grid size-5 shrink-0 place-items-center rounded-full">
            <span className="size-2.5 rounded-full border" style={{ borderColor: boundaryColor(boundary), background: highlighted ? boundaryColor(boundary) : "transparent" }} />
          </button>}
        </div>;
      })}
    </div>
  </>;
}

/**
 * The entry-point filter: a search field plus one checkbox per boundary, in a dropdown so the
 * list beside it keeps the width for names and paths.
 */
function BoundaryFilter({ available, selected, lit, query, onQueryChange, onToggle, onLight, onAll }: {
  available: Array<{ boundary: Boundary; count: number }>; selected: ReadonlySet<string>; lit: string | null;
  query: string; onQueryChange: (value: string) => void;
  onToggle: (boundary: Boundary) => void; onLight: (boundary: Boundary) => void; onAll: (checked: boolean) => void;
}) {
  const all = available.length > 0 && available.every(entry => selected.has(entry.boundary));
  const activeCount = available.filter(entry => selected.has(entry.boundary)).length;
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="shrink-0 gap-1.5 px-2" aria-label="Filter and search entry points" data-flow-filter-trigger>
        <ListFilterIcon className="size-3.5" />
        {!all && available.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{activeCount}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-64 p-2" aria-label="Filter and search entry points" data-flow-filter>
      <InputGroup size="sm"><InputGroupInput type="search" aria-label="Search the graph" placeholder="Search entries…" value={query} onChange={event => onQueryChange(event.target.value)} /><InputGroupAddon><SearchIcon /></InputGroupAddon></InputGroup>
      {available.length > 0 && <div className="mt-2"><BoundaryOptions available={available} selected={selected} lit={lit}
        onToggle={onToggle} onLight={onLight} onAll={onAll} /></div>}
    </PopoverContent>
  </Popover>;
}

/** The generated project's home: its entry-point boundaries arranged around the project. */
function ProjectOverview({ projectName, available, activeBoundary, onSelect }: {
  projectName: string; available: Array<{ boundary: Boundary; count: number }>;
  activeBoundary: string | null; onSelect: (boundary: Boundary) => void;
}) {
  const total = available.reduce((sum, entry) => sum + entry.count, 0);
  const centre = { x: 300, y: 210 };
  const points = available.map((entry, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / Math.max(available.length, 1));
    return { ...entry, x: centre.x + Math.cos(angle) * 220, y: centre.y + Math.sin(angle) * 145 };
  });

  return <div data-project-overview className="relative aspect-[10/7] w-full max-w-[640px] min-w-[300px] cursor-auto" role="group" aria-label={`${projectName} entry-point areas`}>
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 600 420" aria-hidden="true">
      {[88, 105, 122].map((radius, index) => <circle key={radius} data-project-orbit className="app-intel-project-orbit"
        cx={centre.x} cy={centre.y} r={radius} fill="none" stroke="currentColor" strokeDasharray={index === 2 ? "3 7" : undefined}
        style={{ animationDelay: `${index * 0.8}s` }} />)}
      {points.map(({ boundary, x, y }) => <g key={boundary} data-area-connector={boundary}>
        <line x1={centre.x} y1={centre.y} x2={x} y2={y} stroke={boundaryColor(boundary)} strokeOpacity="0.38" strokeWidth="1.5" />
        <circle cx={x} cy={y} r="3" fill={boundaryColor(boundary)} fillOpacity="0.8" />
      </g>)}
    </svg>
    <div data-project-node className="absolute left-1/2 top-1/2 grid size-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background/95 p-4 text-center shadow-[0_10px_35px_rgb(0_0_0/0.12)] backdrop-blur-sm">
      <div className="min-w-0">
        <span className="mx-auto mb-2 grid size-8 place-items-center rounded-full bg-primary/10 text-primary"><NetworkIcon className="size-4" /></span>
        <strong className="block truncate text-sm font-semibold" title={projectName}>{projectName}</strong>
        <span className="mt-1 block text-[10.5px] tabular-nums text-muted-foreground">{total} {total === 1 ? "entry point" : "entry points"}</span>
      </div>
    </div>
    {points.map(({ boundary, count, x, y }, index) => {
      const active = activeBoundary === boundary;
      return <div key={boundary} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x / 6}%`, top: `${y / 4.2}%` }}>
        <button type="button" data-area-node={boundary} aria-pressed={active} onClick={() => onSelect(boundary)}
          className="app-intel-area-node group flex w-28 items-center gap-2 rounded-xl border bg-background/95 px-3 py-2.5 text-left shadow-sm backdrop-blur-sm transition-[background-color,border-color,box-shadow,transform] duration-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ animationDelay: `${2 + index * 0.35}s`, borderColor: active ? boundaryColor(boundary) : undefined, background: active ? `color-mix(in oklab, ${boundaryColor(boundary)} 12%, var(--background))` : undefined }}>
          <span className="size-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_var(--background)]" style={{ background: boundaryColor(boundary) }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium">{boundaryLabel[boundary]}</span>
            <span className="block text-[10px] tabular-nums text-muted-foreground">{count} {count === 1 ? "entry" : "entries"}</span>
          </span>
        </button>
      </div>;
    })}
    {available.length === 0 && <p className="absolute inset-x-0 bottom-8 text-center text-xs text-muted-foreground">No entry points were found in this graph.</p>}
    {available.length > 0 && <p className="absolute inset-x-0 bottom-1 text-center text-[10.5px] text-muted-foreground">Select an area to browse its entry points</p>}
  </div>;
}

export const AppIntelligenceView = memo(function AppIntelligenceView({ panel }: { panel: AppIntelligencePanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [query, setQuery] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [asideOpen, setAsideOpen] = useState(true);
  const [hover, setHover] = useState<Hover>(null);
  const [flowRef, flowSize, flowBox] = useMeasured();
  const snapshot = state.snapshot;
  const search = query.trim().toLowerCase();

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
  const { zoom, zoomIn, zoomOut, reset } = usePanZoom(flowBox, flowStart ?? "");
  const screens = useMemo(() => entries.filter(({ id, screen, boundary }) => selectedBoundaries.has(boundary)
    && (!search || `${id} ${screen.title} ${screen.route ?? ""} ${screen.source ?? ""}`.toLowerCase().includes(search))), [entries, selectedBoundaries, search]);

  return <section id="app-intelligence-panel" className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-label="App Intelligence">
    <header className="panel-toolbar flex h-[49px] shrink-0 items-center gap-2 border-b px-2">
      <ProjectPicker projectPath={state.projectPath} recents={state.recents} disabled={!state.available || state.busy !== null}
        onSelect={path => void panel.selectProject(path)} onBrowse={() => void panel.pickProject()} />
      <div className="flex-1" />
      {state.busy === "generating" || state.busy === "cancelling"
        ? <Button variant="outline" size="sm" disabled={state.busy === "cancelling"} onClick={() => void panel.cancel()}><SquareIcon />Cancel</Button>
        : <>
          <Button size="sm" disabled={!state.available || !state.projectPath || state.busy !== null} onClick={() => void panel.generate()}><RefreshCwIcon />{snapshot ? "Regenerate" : "Generate"}</Button>
          {snapshot && <ConfirmButton id="app-intel-clear" variant="outline" size="sm" title="Clear the graph"
            description={`Deletes the saved graph for ${state.projectPath.split("/").at(-1)}. The project stays selected, so it can be analyzed again.`}
            action="Clear" disabled={state.busy !== null} onConfirm={() => void panel.clear()}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"><EraserIcon />Clear</ConfirmButton>}
        </>}
    </header>
    {state.error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="text-xs">{state.error}</AlertDescription></Alert>}
    {state.run && <div className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground" role="status">{state.run.message}</div>}
    {/* A reopened panel starts blank and reloads what it remembered: showing the empty states
        while that load is in flight would flash the wrong screen before the real one lands. */}
    {state.busy === "loading" && !snapshot ? <div className="grid flex-1 place-items-center p-8 text-center"><p className="text-sm text-muted-foreground">Loading App Intelligence…</p></div>
      : !state.projectPath ? <div className="grid flex-1 place-items-center p-8 text-center"><div><NetworkIcon className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-medium">Map a React Native app</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">Choose a project to discover Expo Router and React Navigation entries, then trace their native dependencies.</p></div></div>
      : !snapshot ? <div className="grid flex-1 place-items-center p-8 text-center"><div><h2 className="font-medium">No App Intelligence yet</h2><p className="mt-1 text-sm text-muted-foreground">Generate a static iOS + Android entry-point and dependency graph.</p></div></div>
      : <div className={`grid min-h-0 flex-1 ${asideOpen ? "grid-cols-[minmax(20rem,1fr)_minmax(13rem,15rem)]" : "grid-cols-[1fr]"} max-[720px]:grid-cols-1 max-[720px]:grid-rows-[minmax(0,1.6fr)_minmax(0,1fr)]`}>
        <main className="flex min-h-0 min-w-0 flex-col border-r max-[720px]:border-b max-[720px]:border-r-0">
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
            <span className="truncate font-medium">{snapshot.screens[selected ?? ""]?.title ?? "Project overview"}</span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="flex shrink-0 items-center gap-0.5 rounded-md border" role="group" aria-label="Zoom">
                <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out" className="grid size-6 place-items-center text-muted-foreground hover:text-foreground" onClick={zoomOut}><MinusIcon className="size-3" /></button>
                <span data-zoom-level className="w-9 text-center text-[10.5px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in" className="grid size-6 place-items-center text-muted-foreground hover:text-foreground" onClick={zoomIn}><PlusIcon className="size-3" /></button>
                <button type="button" data-zoom="reset" aria-label="Reset the view" title="Reset the view" className="grid size-6 place-items-center text-muted-foreground hover:text-foreground" onClick={reset}><MaximizeIcon className="size-3" /></button>
              </div>
              <button type="button" data-aside-toggle aria-pressed={asideOpen} title={asideOpen ? "Hide entry points panel" : "Show entry points panel"}
                onClick={() => setAsideOpen(open => !open)} className="grid size-6 shrink-0 place-items-center rounded-md border text-muted-foreground hover:text-foreground">
                {asideOpen ? <PanelRightCloseIcon className="size-3.5" /> : <PanelRightOpenIcon className="size-3.5" />}
              </button>
            </div>
          </div>
          <div ref={flowRef} data-flow-canvas className="min-h-0 flex-1 cursor-grab touch-none overflow-auto [&[data-panning]]:cursor-grabbing">
            {flowStart ? <div className="w-max will-change-transform"><FlowView snapshot={snapshot} start={flowStart} toggled={toggled} expanded={expanded} litBoundary={state.litBoundary} height={flowSize.height}
              onToggleGroup={(key, open) => panel.toggleGroup(key, open)} onLight={key => panel.litBoundaryTo(key)} onShowAll={key => panel.showAllIn(key)} onHover={setHover} /></div>
              : <div data-flow-empty className="grid size-full place-items-center p-6">
                <ProjectOverview projectName={folderName(state.projectPath)} available={available}
                  activeBoundary={state.boundaries?.length === 1 ? state.boundaries[0] : null}
                  onSelect={boundary => { setQuery(""); panel.setBoundaries([boundary]); setAsideOpen(true); setRailOpen(true); }} />
              </div>}
          </div>
          <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">{flowStart
            ? "Each hop groups its imports by boundary and opens the first of them — click another to drill in, or its dot to light up its connectors. Drag or scroll to pan, ⌘/Ctrl-scroll or the buttons to zoom, double-click to reset."
            : "Areas group the app's entry points by their source boundary. Choose one to filter and open the matching list."}</p>
        </main>
        {asideOpen && <aside className="flex min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
            <button type="button" aria-expanded={railOpen} aria-controls="app-intel-entries" title={railOpen ? "Hide entry points" : "Show entry points"}
              onClick={() => setRailOpen(open => !open)} className="flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 text-left hover:bg-muted/50">
              <ChevronRightIcon className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${railOpen ? "rotate-90" : ""}`} />
              <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{screens.length} entry points</h2>
            </button>
            <BoundaryFilter available={available} selected={selectedBoundaries} lit={state.litBoundary} query={query} onQueryChange={setQuery}
              onToggle={toggleBoundary} onLight={boundary => panel.litBoundaryTo(`*:${boundary}`)} onAll={checked => panel.setBoundaries(checked ? null : [])} />
          </div>
          {railOpen && <div id="app-intel-entries" className="min-h-0 flex-1 overflow-auto">
            {screens.length === 0 ? <p className="px-3 py-3 text-[11px] text-muted-foreground">No entry point matches the filter.</p>
              : screens.map(({ id, screen, boundary }) => <button key={id} type="button" data-entry={id} data-entry-boundary={boundary} aria-current={selected === id} className={`block w-full border-b px-3 py-2 text-left hover:bg-muted/50 ${selected === id ? "bg-muted shadow-[inset_2px_0_0_var(--primary)]" : ""}`}
                onClick={() => panel.selectScreen(id)}>
                <span className="flex items-center gap-1.5"><span className="size-1.5 shrink-0 rounded-full" style={{ background: boundaryColor(boundary) }} /><span className="truncate text-xs font-medium">{screen.title}</span></span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{screen.route ?? id}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{screen.source ?? "Source unresolved"}</span>
              </button>)}
          </div>}
        </aside>}
      </div>}
    {hover && <div role="presentation" className="pointer-events-none fixed z-50 max-w-[330px] rounded-md border bg-popover px-2 py-1.5 shadow-lg"
      style={{ left: Math.min(hover.x + 12, (typeof window === "undefined" ? 0 : window.innerWidth) - 340), top: Math.max(6, hover.y - 64) }}>
      <div className="break-all font-mono text-[11px] text-foreground">{hover.title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hover.detail}</div>
    </div>}
  </section>;
});
