import { useSyncExternalStore } from "react";
import { ChartNoAxesCombinedIcon, CheckIcon, CopyIcon, MessageCircleIcon, UploadIcon } from "lucide-react";
import type { TraceSiftController } from "../tracesift-controller.ts";
import { findingName, formatMs, formatReactMs } from "@mobile-dev/shared/tracesift-labels.ts";
import type { TraceSiftAnalysis, TraceSiftCpuAnalysis } from "@mobile-dev/shared/tracesift.ts";
import { Button } from "./ui/button.tsx";
import { InfoPopover } from "./card-parts.tsx";
import { ReactFinding } from "./tracesift/react-contribution.tsx";
import { TaskFinding } from "./tracesift/task-contribution.tsx";
import { TraceSiftExplorer } from "./tracesift-explorer.tsx";

function cpuSummaryLine(analysis: TraceSiftCpuAnalysis): string {
  const { summary } = analysis;
  const count = analysis.cards.length;
  const tasks = count === 1 ? "task" : "tasks";
  if (summary.noLongTasks) {
    return `No long tasks; the busiest work was ${count} ${tasks} of ${formatMs(analysis.cards[0]?.durationMs ?? 0)} and under · ${formatMs(summary.totalMs)} total`;
  }
  // `taskCount` is absent from older TraceSift versions; the clause then drops out.
  const of = summary.taskCount === undefined ? "" : ` of ${summary.taskCount}`;
  return `${count} long ${tasks}${of} · ${formatMs(summary.totalMs)} total`;
}

function Reading({ analysis, controller, onReset }: { analysis: TraceSiftAnalysis; controller: TraceSiftController; onReset?: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const cpu = analysis.profileType === "cpu";
  const noun = cpu ? "task" : "commit";
  const format = cpu ? formatMs : formatReactMs;
  const cards = analysis.cards;
  const index = Math.max(0, cards.findIndex(entry => entry.id === state.selectedCard));
  const card = cards[index];
  const choose = (next: number) => controller.selectCard(cards[next].id);
  const summary = cpu
    ? cpuSummaryLine(analysis)
    : `${cards.length} slowest of ${analysis.summary.commitCount} commits · ${formatMs(analysis.summary.totalCommitRenderDurationMs)} rendering`;
  // Nothing records the profile's full length, so the timeline ends at the last finding (CPU: at least the measured total).
  let extent = cpu ? analysis.summary.totalMs : 0;
  for (const entry of cards) extent = Math.max(extent, entry.startMs + entry.durationMs);
  const position = (time: number) => extent > 0 ? Math.max(0, Math.min(100, time / extent * 100)) : 0;
  const overhead = cpu && analysis.summary.profilerOverheadMs ? ` ${formatMs(analysis.summary.profilerOverheadMs)} spent starting the profiler is not shown.` : "";
  const busy = Boolean(state.busyCard) || Boolean(state.handoffCard) || Boolean(state.openingExploreCard);
  const copied = card !== undefined && state.copiedCard === card.id;

  return <article className="recording-card tracesift-results" aria-label="TraceSift findings">
    <header className="recording-header">
      <div className="recording-heading"><h2>{analysis.title}</h2><p>TraceSift · {summary}</p></div>
      <span className="recording-status">{cpu ? "CPU profile" : "React profile"}</span>
      {onReset && <Button size="sm" variant="outline" onClick={onReset}><UploadIcon />New profile</Button>}
    </header>
    <div className="recording-body">
      <div className="recording-charts tracesift-column">
        {card === undefined
          ? <p role="status">TraceSift found no carded performance issues.</p>
          : analysis.profileType === "cpu"
            ? <TaskFinding key={card.id} card={analysis.cards[index]} rank={index + 1} kind={state.chartKind} onKind={controller.setChartKind} onFocus={nodeId => void controller.openExplore(card.id, nodeId)} />
            : <ReactFinding key={card.id} card={analysis.cards[index]} rank={index + 1} kind={state.chartKind} onKind={controller.setChartKind} onExplore={() => void controller.openExplore(card.id)} />}
      </div>
      <aside className="recording-sidebar" aria-label="Findings and actions">
        {cards.length > 0 && <section className="recording-overview" aria-label="Profile timeline">
          <div className="recording-section-heading"><h3>Profile</h3>
            <InfoPopover label="profile timeline">{cpu ? "Each mark is a long task, placed where it ran in the profile." : "Each mark is a slow commit, placed where it happened in the recording."} Click one to open it.{overhead}</InfoPopover>
          </div>
          <div className="recording-overview-bar">
            {cards.map((entry, at) => <button key={entry.id} type="button" className="tracesift-mark" aria-current={at === index}
              aria-label={`${noun} ${at + 1}, ${format(entry.durationMs)} at ${formatMs(entry.startMs)}`}
              style={{ left: `${position(entry.startMs)}%`, width: `${position(entry.startMs + entry.durationMs) - position(entry.startMs)}%` }}
              onClick={() => choose(at)} />)}
          </div>
          <div className="recording-overview-labels"><span>0 s</span><span>{formatMs(extent)}</span></div>
        </section>}
        {cards.length > 0 && <section className="tracesift-list" aria-label={cpu ? "Long tasks" : "Slow commits"}>
          <div className="recording-section-heading"><h3>{cpu ? "Long tasks" : "Slow commits"}</h3>
            <InfoPopover label={cpu ? "long tasks" : "slow commits"}>{cpu ? "The tasks that held the JavaScript thread longest, longest first." : "The commits that took longest to render, slowest first. The dot marks a commit over its frame budget."}</InfoPopover>
          </div>
          {cards.map((entry, at) => <button key={entry.id} type="button" className="tracesift-list-row" aria-current={at === index} title={entry.pathline ?? entry.headline} onClick={() => choose(at)}>
            <span className="tracesift-list-rank">{at + 1}</span>
            <span className="tracesift-list-name">{findingName(entry)}</span>
            {"severity" in entry && (entry.severity === "high" || entry.severity === "medium") && <span className="tracesift-severity-dot" data-severity={entry.severity} title={entry.severity === "high" ? "Slow" : "Over budget"} />}
            <span className="tracesift-list-ms">{format(entry.durationMs)}</span>
          </button>)}
        </section>}
        {/* Every action reads from the server; hosts that do not let cards call it get the findings only. */}
        {card !== undefined && !state.canCallTools && <p className="recording-footnote" role="status">
          This app shows TraceSift's findings, but does not let the card investigate or explore them. Ask the agent to investigate one, for example “investigate {noun} #{index + 1}”.
        </p>}
        {card !== undefined && state.canCallTools && <div className="recording-actions">
          <Button disabled={!state.canInvestigate || busy} onClick={() => void controller.investigate(card.id)}
            title={state.canInvestigate ? `Hand this ${noun} to the chat to investigate` : "This chat cannot receive a message from the card"}>
            <MessageCircleIcon />{state.busyCard === card.id ? "Starting…" : `Investigate ${noun} ${index + 1}`}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void controller.openExplore(card.id)}>
            <ChartNoAxesCombinedIcon />{state.openingExploreCard === card.id ? "Opening…" : "Explore"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void controller.copyHandoff(card.id)}>
            {copied ? <CheckIcon /> : <CopyIcon />}{state.handoffCard === card.id ? "Copying…" : copied ? "Copied" : "Copy handoff"}
          </Button>
          {!state.canInvestigate && <p role="status">This host cannot send a message to the chat from here. Ask the agent to investigate a finding by name instead.</p>}
        </div>}
        {state.error && <p className="recording-error" role="alert">{state.error}</p>}
        {state.notice && <p className="recording-footnote" role="status">{state.notice}</p>}
      </aside>
    </div>
  </article>;
}

export function TraceSiftCards({ controller, onReset }: { controller: TraceSiftController; onReset?: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  // The explorer replaces the card, which also unmounts the chart while the large payload is on screen.
  if (state.explorer) return <TraceSiftExplorer controller={controller} />;

  if (!state.analysis) return <article className="recording-card tracesift-results tracesift-pending">
    <p role="status">Analyzing profile with TraceSift…</p>
    {state.error && <p className="recording-error" role="alert">{state.error}</p>}
  </article>;

  return <Reading analysis={state.analysis} controller={controller} onReset={onReset} />;
}
