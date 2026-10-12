/**
 * One CPU task, opened on one frame inside it.
 *
 * A port of the task half of TraceSift's `src/app/explore/page.tsx`. The web
 * app opens this in a browser tab of its own; here it is a screen inside the
 * panel, so the two affordances the tab provided — the address bar and the
 * window — are gone: focus is component state, and `onBack` stands in for
 * closing the tab.
 *
 * The view holds the whole task and shows a slice of it. Rooting it at the top
 * of the task makes a terrible first screen — a wall of `Function call`,
 * `(anonymous)`, `performWorkOnRoot`, `beginWork` and ten more React frames
 * before any product code appears — so it opens on the focused frame, with one
 * way back out to the whole task.
 *
 * The flame graph is drawn here rather than taken from a library, because this
 * plugin has none and may not gain one. It is the same construction as the
 * timeline beside it: absolutely positioned boxes whose `left` and `width` are
 * shares of one root's duration, which is also what makes both of them zoom by
 * nothing more than a width on their scrolling canvas.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatMs, shortLocationLabel, taskCardLocations, type FrameLocations } from "../../../shared/tracesift-labels.ts";
import type { TraceSiftExploreCard, TraceSiftTimeline, TraceSiftTimelineBox, TraceSiftTreeNode } from "../../../shared/tracesift.ts";
import { Button } from "../ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/base-tabs.tsx";
import {
  DRAWN_CLASSES, flameLayout, focusedTree, isShownFrame, pathTo, tickStepMs, type FlameBox,
} from "./explore-tree.ts";
import { useStretchZoom, ZoomControls } from "./explore-zoom.tsx";

/** One row of the timeline, and one row of the flame graph. */
const ROW_HEIGHT = 22;
const FLAME_ROW_HEIGHT = 20;

/**
 * The floors the hand-built graph draws by, as percentages of the canvas: a box
 * narrower than the first is not drawn at all, and one narrower than the second
 * is drawn without its name. Both are divided by the zoom, because the canvas
 * is `zoom` times wider than what the reader sees — at 64× a box filling the
 * window outright is 1.6% of the canvas, and the unscaled floor would leave it
 * blank with its name only in the tooltip.
 */
const MIN_FRAME_WIDTH = 0.08;
const MIN_LABEL_WIDTH = 3;

/** The gesture every zooming chart here shares, worded once. */
const ZOOM_HINT = "⌘/Ctrl + scroll to zoom about the pointer";

/** Why that zoom looks unlike the one a reader expects, worded once. */
const STRETCH_ZOOM_NOTE =
  "Zoom stretches the chart and scrolls it sideways, so a thin box widens where it sits rather than being re-drawn on its own.";

/** The two cuts of the same subtree, shared by the flame graph, the tree and the table. */
type TreeMode = "full" | "focused";

/** A view with nothing in it still has to say why, in the plugin's own chrome. */
function ExploreEmpty({ title, description }: { title: string; description: string }) {
  return <Empty className="explore-empty">
    <EmptyHeader>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>;
}

/**
 * The notes under a chart, split by the job each one does.
 *
 * Every view had grown the same paragraph: how to drive the chart, how to read
 * it, and what it does not measure, all in one italic run. The three are read
 * at different moments — the reading key once, on arrival; the controls when a
 * reader wants to move; the caveats only when a figure looks wrong — so
 * stacking them in one block means the reader who wants any one of them reads
 * past the other two.
 */
function ChartNotes({ reading, controls, caveats }: { reading?: ReactNode; controls?: ReactNode; caveats?: ReactNode[] }) {
  // A conditional bullet is passed as `null` rather than spliced out by the
  // caller, so the list is filtered here instead of at every call site.
  const shown = (caveats ?? []).filter(Boolean);

  return <div className="chart-notes">
    {reading && <p className="chart-notes-reading">{reading}</p>}
    {controls && <p className="chart-notes-controls">{controls}</p>}
    {shown.length > 0 && <details className="chart-notes-caveats">
      <summary>What this doesn&rsquo;t show</summary>
      <ul>{shown.map((caveat, index) => <li key={index}>{caveat}</li>)}</ul>
    </details>}
  </div>;
}

/**
 * How long the call took, and where it sat.
 *
 * Only the outermost box names its start. An offset is read against the start
 * of the task, and on a nested box that invites the reader to subtract it from
 * the parent's — which is wrong, because the two are measured from the same
 * origin rather than from each other, so `278 ms from 550 ms` under `678 ms
 * from 394 ms` reads as a call that began 550 ms into its parent. The duration
 * is the figure a nested box is there to give.
 */
function timingLine(box: TraceSiftTimelineBox): string {
  const own = `${formatMs(box.selfMs)} of its own`;
  if (box.depth > 0) return `${formatMs(box.durationMs)}, ${own}`;
  return `${formatMs(box.durationMs)} from ${formatMs(box.startMs)}, ${own}`;
}

function TimelineBoxView({ box, percent, selected, onFocus }: {
  box: TraceSiftTimelineBox;
  percent: (value: number) => string;
  selected: boolean;
  onFocus: (nodeId: string) => void;
}) {
  return <button
    type="button"
    className={selected ? "timeline-box is-selected" : "timeline-box"}
    // A built-in the product called is drawn like any other box and must not
    // read like code the reader wrote: the fill is what says `engine`.
    data-class={box.frameClass}
    style={{ left: percent(box.startMs), width: percent(box.durationMs), top: `${box.depth * ROW_HEIGHT}px` }}
    title={`${box.name}\n${timingLine(box)}${box.location ? `\n${box.location}` : ""}`}
    onClick={() => onFocus(box.nodeId)}
  ><span>{box.name}</span></button>;
}

/**
 * The task against the clock, which is the view a reader arrives with after
 * seeing the block in Chrome's Performance panel.
 *
 * Positions are percentages of the task's duration, so the chart fits its
 * container at zoom 1 with nothing measured, and zooming is one width on the
 * scrolling element. The framework and the engine have been collapsed away
 * upstream, so a frame that really sat twelve deep under the reconciler is
 * drawn on the first row — and the stretches where nothing but framework or
 * engine code was on the stack are left as gaps rather than filled in, because
 * they were not idle and the chart must not imply they were.
 */
function TaskTimelineChart({ timeline, focusId, onFocus }: {
  timeline: TraceSiftTimeline;
  focusId: string;
  onFocus: (nodeId: string) => void;
}) {
  const { zoom, viewport, canvas, readout, jumpTo } = useStretchZoom();
  const { durationMs } = timeline;

  const ticks = useMemo(() => {
    const step = tickStepMs(durationMs / zoom);
    const out: number[] = [];
    for (let at = 0; at <= durationMs; at += step) out.push(at);
    return out;
  }, [durationMs, zoom]);

  if (timeline.boxes.length === 0 || durationMs <= 0) {
    return <ExploreEmpty
      title="Nothing to draw in this task"
      description="Every frame the profiler recorded in this block was React or engine code, so there is nothing left once they are collapsed. The call tree still holds all of it."
    />;
  }

  const uncoveredMs = Math.max(0, durationMs - timeline.coveredMs);
  const percent = (value: number) => `${(value / durationMs) * 100}%`;

  return <div className="timeline">
    <div className="timeline-controls">
      <ZoomControls zoom={zoom} jumpTo={jumpTo} readout={readout} />
      <span className="timeline-legend">
        {formatMs(timeline.coveredMs)} of {formatMs(durationMs)} under your code, a dependency or a built-in it called
        {uncoveredMs > 0.5 ? ` · ${formatMs(uncoveredMs)} in React or unnamed engine code` : ""}
        {timeline.omittedBoxCount > 0 ? ` · ${timeline.omittedBoxCount} calls too short to draw` : ""}
      </span>
    </div>

    <div className="timeline-scroll" ref={viewport}>
      <div className="timeline-canvas" ref={canvas} style={{ width: `${zoom * 100}%` }}>
        <div className="timeline-ruler">
          {ticks.map(at => <span key={at} className="timeline-tick" style={{ left: percent(at) }}>{formatMs(at)}</span>)}
        </div>
        <div className="timeline-rows" style={{ height: `${timeline.rows * ROW_HEIGHT}px` }}>
          {timeline.boxes.map((box, index) => <TimelineBoxView
            key={`${box.nodeId}-${index}`}
            box={box}
            percent={percent}
            selected={box.nodeId === focusId}
            onFocus={onFocus}
          />)}
        </div>
      </div>
    </div>

    <ChartNotes
      reading={<>One box is one call, drawn where it ran. Width is how long it took.</>}
      controls={ZOOM_HINT}
      caveats={[
        STRETCH_ZOOM_NOTE,
        <><strong>Rows are not stack depth.</strong> React frames, and engine frames that name nothing, are collapsed away, so a box&rsquo;s row is its depth on this chart.</>,
        <>A built-in the code called by name &mdash; a date formatter, a locale comparison, a sort &mdash; is kept and drawn in a paler fill: it is engine code, and still a cost the code above it controls.</>,
        <><strong>Drawn at sample resolution.</strong> Two calls closer together than one sample merge, and one shorter than a sample may not appear.</>,
        <><strong>Spans are wall clock.</strong> A box covers the framework work its call delegated to and any collection pause that fell inside it. The card&rsquo;s longest-call figure counts neither, which is why a box can read slightly wider.</>,
      ]}
    />
  </div>;
}

/**
 * The buckets the graph colours frames by, and what the share is of.
 *
 * A percentage without saying of what is the one thing that cannot be left
 * unsaid here: a frame's bucket is its own time as a share of the *hottest
 * frame's* own time in this one graph, not of the profile and not of its
 * parent. That is why a field of green around a single red box is the usual
 * shape, and reading it as "almost nothing is hot" is reading it right.
 */
const FLAME_BUCKETS = [
  ["heaviest", "> 70%"],
  ["heavy", "40–70%"],
  ["moderate", "20–40%"],
  ["light", "< 20%"],
  ["none", "none"],
] as const;

/** `what` names the figure the colour is of, in the surface's own words. */
function FlameLegend({ what }: { what: string }) {
  return <div className="flame-legend">
    <span className="flame-legend-lead">Colour is {what}, as a share of the hottest frame&rsquo;s:</span>
    {FLAME_BUCKETS.map(([bucket, label]) => <span key={bucket} className="flame-legend-item">
      <span className="flame-legend-swatch" data-bucket={bucket} />
      {label}
    </span>)}
  </div>;
}

/**
 * The two cuts of the same subtree, as a pair of buttons. Shared by the flame
 * graph, the call tree and the culprit table so the one toggle reads the same
 * wherever it appears.
 */
function TreeModeToggle({ label, mode, onChange }: { label: string; mode: TreeMode; onChange: (mode: TreeMode) => void }) {
  return <div className="timeline-controls">
    <span className="explore-path-label">{label}</span>
    {([["full", "Everything"], ["focused", "Your code only"]] as const).map(([value, text]) => <button
      key={value}
      type="button"
      className={value === mode ? "timeline-zoom is-current" : "timeline-zoom"}
      aria-pressed={value === mode}
      onClick={() => onChange(value)}
    >{text}</button>)}
  </div>;
}

function FlameBoxView({ box, totalMs, labelled, onDrill }: {
  box: FlameBox;
  totalMs: number;
  labelled: boolean;
  onDrill: (id: string) => void;
}) {
  const share = box.totalMs / totalMs;
  return <button
    type="button"
    className="flame-box"
    data-bucket={box.bucket}
    style={{ left: `${(box.startMs / totalMs) * 100}%`, width: `${share * 100}%`, top: `${box.depth * FLAME_ROW_HEIGHT}px` }}
    // The class is in the tooltip because the fill is already carrying the
    // heat and cannot carry it too. It matters most for an engine built-in:
    // Hermes writes `[Native] intlDateTimeFormatFormat`, V8 writes
    // `toLocaleString`, and the second gives a reader nothing to say the cost
    // is in the engine.
    title={`${box.name}${box.frameClass === "app" ? "" : ` [${box.frameClass}]`} — ${formatMs(box.totalMs)} total, ${formatMs(box.selfMs)} self`}
    onClick={() => onDrill(box.id)}
  >{labelled && <span>{box.name}</span>}</button>;
}

/**
 * The focused subtree as a flame graph, with the framework and the engine
 * either drawn or collapsed away.
 *
 * Collapsed is the default here, unlike the call tree. A flame graph is read by
 * eye rather than row by row, and on a React profile the recorded stack spends
 * its first dozen rows on `performWorkOnRoot`, `beginWork` and
 * `commitPassiveMountOnFiber` — boxes that carry the full width of the task and
 * name nothing a reader can change. Collapsing them puts the product frames at
 * the top of the graph where the eye lands. `Everything` is one click away for
 * the times the reconciler is the thing being read.
 */
function TaskFlameGraph({ focus }: { focus: TraceSiftTreeNode }) {
  const [mode, setMode] = useState<TreeMode>("focused");
  const tree = useMemo(() => (mode === "focused" ? focusedTree(focus) : focus), [mode, focus]);
  const [drillId, setDrillId] = useState("");
  const { zoom, viewport, canvas, readout, jumpTo, scrollToStart } = useStretchZoom();

  // Both the mode toggle and a new focus change which frames exist, so an id
  // taken from the old graph names nothing in the new one and would silently
  // drop the view back to the root. Reset during render rather than in an
  // effect: a frame of the new graph drilled into a stale id would flash.
  const graphKey = `${mode}:${focus.id}`;
  const [drawnKey, setDrawnKey] = useState(graphKey);
  if (drawnKey !== graphKey) {
    setDrawnKey(graphKey);
    setDrillId("");
  }

  const root = useMemo(() => {
    if (!drillId) return tree;
    const path = pathTo(tree, drillId);
    return path[path.length - 1];
  }, [tree, drillId]);
  const layout = useMemo(() => flameLayout(root), [root]);
  // Narrow boxes are dropped rather than drawn at a pixel: a hairline carries
  // no name, cannot be hit, and a thousand of them is what makes a graph of a
  // deep stack stall. The floor divides by the zoom, so zooming in is what
  // brings them back — which is the whole reason to zoom in.
  const drawn = useMemo(
    () => layout.boxes.filter(box => (box.totalMs / layout.totalMs) * 100 * zoom >= MIN_FRAME_WIDTH),
    [layout, zoom],
  );

  if (layout.totalMs <= 0) {
    return <ExploreEmpty title="Nothing to draw here" description="This frame has no measured time underneath it. The call tree still lists what it called." />;
  }

  return <>
    <div className="flame-controls">
      <TreeModeToggle label="frames" mode={mode} onChange={setMode} />
      <div className="timeline-controls">
        <ZoomControls zoom={zoom} jumpTo={jumpTo} readout={readout} />
      </div>
    </div>

    <FlameLegend what="a frame's own time" />

    {drillId && <p className="explore-path">
      <span className="explore-path-label">zoomed into</span>
      <span className="explore-path-frame">{root.name}</span>
      <button type="button" className="explore-tree-focus" onClick={() => { setDrillId(""); scrollToStart(); }}>Show the whole subtree</button>
    </p>}

    {/* Escape rather than a second button: the way back out is already on the
        line above, and a reader who has clicked three frames deep wants it
        under the hand that did the clicking. */}
    <div
      className="flame-viewport"
      ref={viewport}
      onKeyDown={event => { if (event.key === "Escape" && drillId) { setDrillId(""); scrollToStart(); } }}
    >
      <div className="flame-scale" ref={canvas} style={{ width: `${zoom * 100}%` }}>
        <div className="flame-rows" style={{ height: `${layout.rows * FLAME_ROW_HEIGHT}px` }}>
          {drawn.map(box => <FlameBoxView
            key={box.key}
            box={box}
            totalMs={layout.totalMs}
            labelled={(box.totalMs / layout.totalMs) * 100 * zoom >= MIN_LABEL_WIDTH}
            onDrill={id => {
              setDrillId(id);
              // The subtree clicked into is re-laid out across the whole
              // canvas, so wherever the view was scrolled to names nothing any
              // more. Its start is the one place worth being.
              scrollToStart();
            }}
          />)}
        </div>
      </div>
    </div>

    <ChartNotes
      controls={`Click a frame to zoom into its subtree · Esc to go back · ${ZOOM_HINT}`}
      caveats={[
        STRETCH_ZOOM_NOTE,
        mode === "focused"
          ? <><strong>Rows are not stack depth.</strong> React and engine frames are collapsed away, the same cut the Timeline draws by, so a box&rsquo;s row is its depth here.</>
          : null,
        mode === "focused"
          ? "The time a dropped frame burned in its own body is charged to the nearest frame above it that was kept."
          : null,
        layout.omitted > 0 ? `${layout.omitted} frames past the drawing ceiling are left out of this graph. The call tree still holds them.` : null,
      ]}
    />
  </>;
}

/**
 * The task tree's own row. Clicking a name refocuses the view on that frame.
 *
 * A closed row renders no children at all. A collapsed `<details>` still mounts
 * everything inside it, and a real stack runs hundreds of frames deep, so
 * mounting the whole tree at once nests the DOM deeply enough to overflow the
 * JS stack in React's commit traversal before a single row appears.
 */
function TaskTreeRow({ node, taskMs, depth, onFocus, locations }: {
  node: TraceSiftTreeNode;
  taskMs: number;
  depth: number;
  onFocus: (id: string) => void;
  locations: FrameLocations;
}) {
  const [open, setOpen] = useState(depth < 2);
  const where = locations.shown(node.name, node.location);
  const share = taskMs > 0 ? (node.totalMs / taskMs) * 100 : 0;
  const row = <div className="explore-tree-row">
    <span className="explore-tree-name">
      <button type="button" className="explore-tree-focus" onClick={() => onFocus(node.id)}>{node.name}</button>
      {node.frameClass !== "app" && <span className="explore-tag">{node.frameClass}</span>}
    </span>
    <span className="explore-tree-figures">
      <span className="row-figure">{formatMs(node.totalMs)}</span>
      <span className="row-secondary">{formatMs(node.selfMs)} self</span>
      {node.invocations > 1 && <span className="row-share">{node.invocations} calls</span>}
    </span>
    <span className="row-bar-track" aria-hidden="true"><span className="row-bar-fill" style={{ width: `${share}%` }} /></span>
    {where && <code className="explore-tree-location" title={where}>{shortLocationLabel(where)}</code>}
  </div>;

  if (node.children.length === 0) return <li className="explore-tree-leaf" style={{ "--depth": depth } as CSSProperties}>{row}</li>;
  return <li style={{ "--depth": depth } as CSSProperties}>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{row}</summary>
      {open && <ul className="explore-tree">
        {node.children.map(child => <TaskTreeRow key={child.id} node={child} taskMs={taskMs} depth={depth + 1} onFocus={onFocus} locations={locations} />)}
      </ul>}
    </details>
  </li>;
}

/**
 * The focused subtree, either as it was recorded or with the framework and the
 * engine collapsed away.
 *
 * Both are worth having. The full tree is the only view that can answer how a
 * frame was reached when the answer runs through the reconciler, and it is the
 * one to hold against a debugger. It is also, on a React profile, mostly rows
 * nobody can act on. The focused tree is the timeline's cut applied to the rows
 * — same frames kept, same frames dropped — so the two views line up.
 *
 * Full stays the default: this tab is the one view that still holds everything
 * the profiler recorded, and a reader who wanted the collapsed picture has had
 * it on the Timeline tab since arriving.
 */
function TaskCallTree({ focus, taskMs, onFocus, locations }: {
  focus: TraceSiftTreeNode;
  taskMs: number;
  onFocus: (id: string) => void;
  locations: FrameLocations;
}) {
  const [mode, setMode] = useState<TreeMode>("full");
  const tree = useMemo(() => (mode === "focused" ? focusedTree(focus) : focus), [mode, focus]);

  return <>
    <TreeModeToggle label="tree" mode={mode} onChange={setMode} />
    <ul className="explore-tree">
      {/* Keyed by mode so the two trees do not share open/closed state: a row
          open at depth 4 in one is a different frame at that depth in the other. */}
      <TaskTreeRow key={mode} node={tree} taskMs={taskMs} depth={0} onFocus={onFocus} locations={locations} />
    </ul>
    {mode === "focused" && <ChartNotes caveats={[
      <><strong>Indent is not stack depth.</strong> React and engine frames are collapsed away, the same cut the Timeline draws by, so a row&rsquo;s indent is its depth here.</>,
      <>The time a dropped frame burned in its own body is charged to the nearest frame above it that was kept, which is why a row can read more self time here than on the full tree.</>,
    ]} />}
  </>;
}

/**
 * A frame's position in a table cell, drawn only when it locates the frame.
 * A chunk offset in a `file` column is worse than nothing: it labels a build
 * artefact as a file and invites a reader to go looking for it.
 */
function RowLocation({ name, location, locations }: { name: string; location: string | undefined; locations: FrameLocations }) {
  const where = locations.shown(name, location);
  return where ? <code title={where}>{shortLocationLabel(where)}</code> : null;
}

/**
 * Every frame that burned time in this task, with the framework and the engine
 * either listed or cut away.
 *
 * The same toggle as the flame graph and the call tree, and the same cut behind
 * it, so a frame that is gone from one focused view is gone from all three. It
 * earns its place here for a different reason, though. The tree's problem is
 * depth. A ranked table has no depth to scroll past, so the framework arrives
 * interleaved instead: on a React profile `batchedUpdatesImpl` and
 * `dispatchEvent` each hold the task's whole inclusive time at 0 ms of their
 * own, in the middle of the rows that name something to go and change.
 *
 * Nothing is recomputed under the filter, which is the part that differs from
 * the focused tree. A culprit's self time is measured over the whole task and
 * does not depend on which other rows are listed, so hiding a row leaves every
 * remaining figure exactly as it was.
 *
 * `Everything` is the default: this table is the measured partition of the task
 * — self time over every row sums to its duration — and a reader who opened the
 * Culprits tab asked what the task did, not what of it is theirs.
 */
function TaskCulpritTable({ culprits, onFocus, locations }: {
  culprits: TraceSiftExploreCard["culprits"];
  onFocus: (id: string) => void;
  locations: FrameLocations;
}) {
  const [mode, setMode] = useState<TreeMode>("full");
  const rows = useMemo(
    () => (mode === "focused" ? culprits.filter(culprit => isShownFrame(culprit.name, culprit.frameClass, DRAWN_CLASSES)) : culprits),
    [mode, culprits],
  );
  const hidden = culprits.length - rows.length;

  if (culprits.length === 0) {
    return <ExploreEmpty title="No culprit stands out" description="This task's time is spread too thinly for any single frame to account for it." />;
  }

  return <>
    <TreeModeToggle label="rows" mode={mode} onChange={setMode} />
    {rows.length > 0 ? <div className="explore-table-scroll">
      <table className="explore-table">
        <thead>
          <tr>
            <th scope="col">Function</th>
            <th scope="col">Self</th>
            <th scope="col">Total</th>
            <th scope="col">Calls</th>
            <th scope="col">Longest call</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(culprit => <tr key={culprit.nodeId}>
            <th scope="row">
              <button type="button" className="explore-tree-focus" onClick={() => onFocus(culprit.nodeId)}>{culprit.name}</button>
              <RowLocation name={culprit.name} location={culprit.location} locations={locations} />
            </th>
            <td>{formatMs(culprit.selfMs)}</td>
            <td>{formatMs(culprit.totalMs)}</td>
            <td>{culprit.invocations}</td>
            <td>{formatMs(culprit.longestCallMs)}</td>
          </tr>)}
        </tbody>
      </table>
    </div> : <ExploreEmpty
      title="None of these frames are yours"
      description="Every frame that burned time in this task is React's or the engine's. Switch to Everything to see them."
    />}
    {mode === "focused" && hidden > 0 && <p className="explore-caveat">
      {hidden === 1 ? "One React or engine frame is" : `${hidden} React and engine frames are`} hidden, the same cut the
      Timeline draws by. Every figure above is unchanged: a culprit&rsquo;s self time is measured over the whole task,
      so hiding a row neither moves time onto another row nor takes it off this one.
    </p>}
  </>;
}

export function TaskExplore({ card, totalMs, title, initialFocus, onBack }: {
  card: TraceSiftExploreCard;
  totalMs: number;
  title: string;
  /** Node id to open on, or "" for the whole task. */
  initialFocus: string;
  onBack: () => void;
}) {
  const [focusId, setFocusId] = useState(initialFocus || card.tree.id);
  const path = useMemo(() => pathTo(card.tree, focusId), [card.tree, focusId]);
  // Judged over the whole card, so a frame reads the same in the tree, the
  // culprit table and the card the reader came from.
  const locations = useMemo(() => taskCardLocations(card), [card]);
  const focus = path[path.length - 1];

  return <section className="explore" aria-label={`Explore: ${title}`}>
    <header className="explore-header">
      <div className="explore-header-bar">
        <h1>{card.pathline ?? card.headline}</h1>
        <Button variant="outline" size="sm" onClick={onBack}>Back to the analysis</Button>
      </div>
      {card.shapeline && <p className="explore-shape">{card.shapeline}</p>}
      {/* No `into the recording`: where the task sat on the profile's clock
          tells a reader nothing they act on, and the timeline tab below is
          already measured from this task's own start. */}
      <p className="explore-figures">
        <strong>{formatMs(card.durationMs)}</strong> of uninterrupted work
        <span>·</span>
        {card.percentOfProfile}% of a {formatMs(totalMs)} profile
        <span>·</span>
        {card.subtreeFunctionCount} functions inside it
      </p>
      {card.boundaries === "inferred" && <p className="explore-caveat">
        The profiler recorded no boundary around this block, so its edges were reconstructed from the gaps between
        sample runs. Its start and duration are approximate — the work inside it is not.
      </p>}
    </header>

    {path.length > 1 && <nav className="explore-breadcrumb" aria-label="Leave the focused frame">
      <Button size="sm" variant="outline" onClick={() => setFocusId(card.tree.id)}>Show the whole task</Button>
    </nav>}

    <Tabs className="explore-tabs" defaultValue="timeline">
      <TabsList aria-label="Views of this task">
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="flame">Flame graph</TabsTrigger>
        <TabsTrigger value="tree">Call tree</TabsTrigger>
        <TabsTrigger value="culprits">Culprits</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline" className="explore-panel">
        <TaskTimelineChart timeline={card.timeline} focusId={focusId} onFocus={setFocusId} />
      </TabsContent>
      <TabsContent value="flame" className="explore-panel">
        <TaskFlameGraph focus={focus} />
      </TabsContent>
      <TabsContent value="tree" className="explore-panel">
        <TaskCallTree focus={focus} taskMs={card.durationMs} onFocus={setFocusId} locations={locations} />
      </TabsContent>
      <TabsContent value="culprits" className="explore-panel">
        <TaskCulpritTable culprits={card.culprits} onFocus={setFocusId} locations={locations} />
      </TabsContent>
    </Tabs>
  </section>;
}
