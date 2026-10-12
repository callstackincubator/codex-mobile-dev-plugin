/**
 * TraceSift's findings, inline in the chat.
 *
 * The same card the TraceSift tab draws: the task's duration divided between
 * the features it entered, as a bar or a treemap, with the drill-down and the
 * detail panel a reader gets there. The analysis response carries the boundary
 * frames whole and the slice arithmetic is ported alongside it, so the two
 * cards are the same drawing of the same numbers rather than two readings that
 * can drift.
 *
 * What differs is where the actions go. On the web a reader opens Explore in a
 * second tab and asks a model to read the task; here Explore is a screen inside
 * this view, and the model that would read the task is the one already in the
 * chat — so Investigate hands it the card and lets it answer in the transcript.
 */

import { useSyncExternalStore } from "react";
import { ChartNoAxesCombinedIcon, CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
import type { TraceSiftController } from "../tracesift-controller.ts";
import { formatMs } from "../../shared/tracesift-labels.ts";
import type { TraceSiftAnalysis, TraceSiftCpuAnalysis, TraceSiftReactCard, TraceSiftTaskCard } from "../../shared/tracesift.ts";
import { Button } from "./ui/button.tsx";
import type { ContributionChartKind } from "./tracesift/contribution-chart.tsx";
import { TaskContribution } from "./tracesift/task-contribution.tsx";
import { TaskExplore } from "./tracesift/explore.tsx";

const percent = (value: number) => `${value.toFixed(1)}%`;

/**
 * The header's one line about the whole recording.
 *
 * A recording of nothing but short work is a real answer, not an empty one, so
 * it says so and the busiest tasks are shown anyway. The profiler's own
 * start-up pause is not carded — there is nothing in it to act on — but it is
 * part of the recording the reader is looking at, so the total is told where it
 * went.
 */
function cpuSummaryLine(analysis: TraceSiftCpuAnalysis): string {
  const { summary } = analysis;
  const count = analysis.cards.length;
  const tasks = count === 1 ? "task" : "tasks";
  const overhead = summary.profilerOverheadMs && summary.profilerOverheadMs > 0
    ? ` · ${formatMs(summary.profilerOverheadMs)} spent starting the profiler, not shown` : "";
  if (summary.noLongTasks) {
    return `No long tasks in this recording; the busiest work was ${count} ${tasks} of ${formatMs(analysis.cards[0]?.durationMs ?? 0)} and under · ${formatMs(summary.totalMs)} total${overhead}`;
  }
  // `taskCount` is how many tasks the recording held in all. A TraceSift older
  // than the field answers without it, and the clause simply drops out.
  const of = summary.taskCount === undefined ? "" : ` of ${summary.taskCount}`;
  return `${count} long ${tasks}${of} · ${formatMs(summary.totalMs)} total${overhead}`;
}

function ChartSwitch({ kind, onChange }: { kind: ContributionChartKind; onChange: (kind: ContributionChartKind) => void }) {
  return <div className="chart-switch">
    {(["bar", "treemap"] as const).map(option => <button
      key={option}
      type="button"
      className={kind === option ? "timeline-zoom is-current" : "timeline-zoom"}
      aria-pressed={kind === option}
      onClick={() => onChange(option)}
    >{option}</button>)}
  </div>;
}

/**
 * The actions under a card.
 *
 * Investigate leads, because it is the one that uses the thing the reader is
 * already in: it puts the card's hand-off in the chat and the model answers
 * there. Explore and Copy sit to the right as the second and third things
 * anyone wants, in the order the web card puts them.
 */
function CardFooter({ cardId, controller, canExplore }: { cardId: string; controller: TraceSiftController; canExplore: boolean }) {
  const state = controller.getSnapshot();
  const busy = Boolean(state.busyCard) || Boolean(state.handoffCard);
  const copied = state.copiedCard === cardId;
  return <div className="hotspot-footer">
    <div className="hotspot-footer-bar">
      <div className="hotspot-footer-lead">
        <Button
          size="sm"
          variant="outline"
          disabled={!state.canInvestigate || busy}
          title={state.canInvestigate ? "Hand this card to the chat and have it read the task." : undefined}
          onClick={() => void controller.investigate(cardId)}
        >
          <MessageCircleIcon />{state.busyCard === cardId ? "Starting…" : "Investigate"}
        </Button>
      </div>
      <div className="hotspot-actions">
        {canExplore && <Button size="sm" variant="outline" disabled={busy} onClick={() => void controller.openExplore(cardId)}>
          <ChartNoAxesCombinedIcon />Explore
        </Button>}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void controller.copyHandoff(cardId)}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {state.handoffCard === cardId ? "Copying…" : copied ? "Copied!" : "Copy handoff"}
        </Button>
      </div>
    </div>
  </div>;
}

/** The measured figures a card falls back to when the task entered no frame of its own. */
function TaskFigures({ card }: { card: TraceSiftTaskCard }) {
  return <dl className="tracesift-metrics">
    <div><dt>Recording</dt><dd>{percent(card.percentOfProfile)}</dd></div>
    <div><dt>Starts at</dt><dd>{formatMs(card.startMs)}</dd></div>
    <div><dt>Outside app boundaries</dt><dd>{formatMs(card.outsideBoundariesMs)}</dd></div>
  </dl>;
}

function CpuCard({ card, rank, controller }: { card: TraceSiftTaskCard; rank: number; controller: TraceSiftController }) {
  const { chartKind } = controller.getSnapshot();
  return <article className="hotspot-card">
    <div className="hotspot-head">
      <span className="hotspot-rank">#{rank}</span>
      <div className="hotspot-heading-copy">
        <strong>{card.pathline ?? card.headline}</strong>
        {card.shapeline && <span className="hotspot-shape">{card.shapeline}</span>}
      </div>
      <span className="hotspot-time">{formatMs(card.durationMs)}</span>
    </div>
    {/* No frame of their own means nothing to divide the task into, and the
        figures row is then all the card can honestly say. */}
    {card.boundaryFrames.length > 0
      ? <TaskContribution card={card} kind={chartKind} onFocus={nodeId => void controller.openExplore(card.id, nodeId)} />
      : <TaskFigures card={card} />}
    <CardFooter cardId={card.id} controller={controller} canExplore />
  </article>;
}

/**
 * A React commit, in the same chrome.
 *
 * A commit does not divide into features the way a task does — there are no
 * boundary frames to make slices out of — so it keeps its measured culprit
 * rows and takes the card's header, figures and footer, which is everything
 * the two families really share.
 */
function ReactCard({ card, rank, controller }: { card: TraceSiftReactCard; rank: number; controller: TraceSiftController }) {
  return <article className="hotspot-card" data-severity={card.severity}>
    <div className="hotspot-head">
      <span className="hotspot-rank">#{rank}</span>
      <div className="hotspot-heading-copy">
        <strong>{card.pathline ?? card.headline}</strong>
        <span className="hotspot-shape">{card.shapeline}</span>
        <span className="hotspot-subtitle">{card.causeline}</span>
      </div>
      <span className="hotspot-time">{formatMs(card.durationMs)}</span>
    </div>
    <div className="contribution">
      <dl className="tracesift-metrics">
        <div><dt>Render time</dt><dd>{percent(card.percentOfRender)}</dd></div>
        <div><dt>Rendered</dt><dd>{card.renderedCount} components</dd></div>
        <div><dt>Starts at</dt><dd>{formatMs(card.startMs)}</dd></div>
      </dl>
      {card.culprits.length > 0 && <div className="contribution-nested">
        <p className="contribution-nested-label">measured culprits</p>
        <ul className="contribution-nested-list">
          {card.culprits.slice(0, 5).map(culprit => <li key={culprit.componentId}>
            <span className="contribution-nested-row" title={culprit.evidence}>
              <span className="contribution-nested-name">{culprit.component}</span>
              <span className="contribution-nested-ms">{formatMs(culprit.selfMs)}</span>
            </span>
          </li>)}
        </ul>
      </div>}
    </div>
    <CardFooter cardId={card.id} controller={controller} canExplore={false} />
  </article>;
}

/**
 * Explore over the cards, or the cards.
 *
 * It replaces the list rather than sitting under it: the drill-down is a whole
 * screen's worth of chart and the card it came from would be scrolled out of
 * sight anyway, so a breadcrumb is a better way back than a scroll.
 */
function ExploreScreen({ controller }: { controller: TraceSiftController }) {
  const { explore } = controller.getSnapshot();
  if (!explore) return null;
  if (explore.state === "loading") return <p role="status">Opening this task…</p>;
  if (explore.state === "failed") return <>
    <p className="tracesift-error" role="alert">{explore.reason}</p>
    <p><Button size="sm" variant="outline" onClick={controller.closeExplore}>← Back to the findings</Button></p>
  </>;
  return <TaskExplore
    card={explore.task.card}
    totalMs={explore.task.totalMs}
    title={explore.task.title}
    initialFocus={explore.focus}
    onBack={controller.closeExplore}
  />;
}

export function TraceSiftCards({ controller }: { controller: TraceSiftController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const analysis: TraceSiftAnalysis | undefined = state.analysis;

  if (!analysis) return <main className="tracesift-results">
    <p role="status">Analyzing profile with TraceSift…</p>
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
  </main>;

  if (state.explore) return <main className="tracesift-results"><ExploreScreen controller={controller} /></main>;

  const cpu = analysis.profileType === "cpu";
  return <main className="tracesift-results">
    <div className="results-header">
      <div className="intro">
        <span className="eyebrow">TraceSift · {cpu ? "CPU profile" : "React profile"}</span>
        <h1 className="results-title">{cpu ? "Tasks, longest first" : "Commits, slowest first"}</h1>
        <p>{analysis.profileType === "cpu"
          ? cpuSummaryLine(analysis)
          : `${analysis.cards.length} of ${analysis.summary.commitCount} commits · ${formatMs(analysis.summary.totalCommitRenderDurationMs)} rendering`}</p>
      </div>
      {/* Only the task cards divide into slices, so only they have a drawing to switch. */}
      {cpu && <div className="result-actions"><ChartSwitch kind={state.chartKind} onChange={controller.setChartKind} /></div>}
    </div>

    {!state.canInvestigate && <p className="tracesift-error" role="status">
      This host cannot call the card handoff tool or send a message to the active chat. Ask the agent to investigate a card by name instead.
    </p>}
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
    {analysis.cards.length === 0 && <p role="status">TraceSift found no carded performance issues.</p>}

    <div className="hotspot-list">{analysis.profileType === "cpu"
      ? analysis.cards.map((card, index) => <CpuCard key={card.id} card={card} rank={index + 1} controller={controller} />)
      : analysis.cards.map((card, index) => <ReactCard key={card.id} card={card} rank={index + 1} controller={controller} />)}</div>
  </main>;
}
