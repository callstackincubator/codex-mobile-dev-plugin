import { preparesChatMessages } from "../chat-message.ts";
import { ChatPreparationNotice } from "./chat-preparation-notice.tsx";
/**
 * TraceSift's findings inline in the chat: the same card the TraceSift tab draws.
 * Only the actions differ — Explore opens here, Investigate asks the model.
 */

import { useSyncExternalStore } from "react";
import { ChartNoAxesCombinedIcon, CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
import type { TraceSiftController } from "../tracesift-controller.ts";
import { formatMs, formatReactMs } from "../../shared/tracesift-labels.ts";
import type { TraceSiftAnalysis, TraceSiftCpuAnalysis, TraceSiftReactCard, TraceSiftTaskCard } from "../../shared/tracesift.ts";
import { Button } from "./ui/button.tsx";
import { reactCommitSlices } from "../../shared/tracesift-contribution.ts";
import type { ContributionChartKind } from "./tracesift/contribution-chart.tsx";
import { ReactContribution, ReactFallbackRows } from "./tracesift/react-contribution.tsx";
import { TaskContribution } from "./tracesift/task-contribution.tsx";
import { TraceSiftExplorer } from "./tracesift-explorer.tsx";

const percent = (value: number) => `${value.toFixed(1)}%`;

/**
 * The header's one line about the whole recording. Nothing but short work is a
 * real answer, so it says so; the uncarded profiler start-up is still counted.
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
 * The actions under a card. Investigate leads: it uses the chat the reader is
 * already in. Explore and Copy follow, in the order the web card puts them.
 */
function CardFooter({ cardId, controller, canExplore }: { cardId: string; controller: TraceSiftController; canExplore: boolean }) {
  const state = controller.getSnapshot();
  const busy = Boolean(state.busyCard) || Boolean(state.handoffCard) || Boolean(state.openingExploreCard);
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
          <MessageCircleIcon />{state.busyCard === cardId ? (preparesChatMessages() ? "Preparing…" : "Starting…") : preparesChatMessages() ? "Prepare investigation" : "Investigate"}
        </Button>
      </div>
      <div className="hotspot-actions">
        {canExplore && <Button size="sm" variant="outline" disabled={busy} onClick={() => void controller.openExplore(cardId)}>
          <ChartNoAxesCombinedIcon />{state.openingExploreCard === cardId ? "Opening…" : "Explore"}
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
 * A React commit in the same chrome. It has no boundary frames to slice, so it
 * keeps its culprit rows and takes only the card's header, figures and footer.
 */
function ReactCard({ card, rank, controller }: { card: TraceSiftReactCard; rank: number; controller: TraceSiftController }) {
  const { chartKind } = controller.getSnapshot();
  const drawable = reactCommitSlices(card).some(slice => slice.kind === "component");
  return <article className="hotspot-card" data-severity={card.severity}>
    <div className="hotspot-head">
      <span className="hotspot-rank">#{rank}</span>
      <div className="hotspot-heading-copy">
        <strong>{card.headline}</strong>
        <span className="hotspot-shape">{card.shapeline}</span>
      </div>
      <span className="hotspot-time">{formatReactMs(card.durationMs)}</span>
    </div>
    {drawable
      ? <ReactContribution card={card} kind={chartKind} onExplore={() => void controller.openExplore(card.id)} />
      : <ReactFallbackRows card={card} />}
    <CardFooter cardId={card.id} controller={controller} canExplore />
  </article>;
}

export function TraceSiftCards({ controller }: { controller: TraceSiftController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const analysis: TraceSiftAnalysis | undefined = state.analysis;

  // One surface shows one thing: the full explorer takes the frame the cards had,
  // which also unmounts every contribution chart while megabytes are on screen.
  if (state.explorer) return <TraceSiftExplorer controller={controller} />;

  if (!analysis) return <main className="tracesift-results">
    <ChatPreparationNotice />
    <p role="status">Analyzing profile with TraceSift…</p>
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
  </main>;

  const cpu = analysis.profileType === "cpu";
  return <main className="tracesift-results">
    <ChatPreparationNotice />
    <div className="results-header">
      <div className="intro">
        <span className="eyebrow">TraceSift · {cpu ? "CPU profile" : "React profile"}</span>
        <h1 className="results-title">{cpu ? "Tasks, longest first" : "Commits, slowest first"}</h1>
        <p>{analysis.profileType === "cpu"
          ? cpuSummaryLine(analysis)
          : `${analysis.cards.length} of ${analysis.summary.commitCount} commits · ${formatMs(analysis.summary.totalCommitRenderDurationMs)} rendering`}</p>
      </div>
      {/* Both card families divide a measured whole into interchangeable drawings. */}
      <div className="result-actions"><ChartSwitch kind={state.chartKind} onChange={controller.setChartKind} /></div>
    </div>

    {!state.canInvestigate && <p className="tracesift-error" role="status">
      This host cannot call the card handoff tool or send a message to the active chat. Ask the agent to investigate a card by name instead.
    </p>}
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
    {state.notice && <p className="tracesift-notice" role="status">{state.notice}</p>}
    {analysis.cards.length === 0 && <p role="status">TraceSift found no carded performance issues.</p>}

    <div className="hotspot-list">{analysis.profileType === "cpu"
      ? analysis.cards.map((card, index) => <CpuCard key={card.id} card={card} rank={index + 1} controller={controller} />)
      : analysis.cards.map((card, index) => <ReactCard key={card.id} card={card} rank={index + 1} controller={controller} />)}</div>
  </main>;
}
