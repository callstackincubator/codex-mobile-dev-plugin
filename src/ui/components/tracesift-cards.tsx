import { useSyncExternalStore } from "react";
import type { TraceSiftController } from "../tracesift-controller.ts";
import type { TraceSiftAnalysis } from "../../shared/tracesift.ts";
import { Button } from "./ui/button.tsx";

const ms = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)} ms`;
const percent = (value: number) => `${value.toFixed(1)}%`;

function CpuCard({ analysis, index, controller }: { analysis: Extract<TraceSiftAnalysis, { profileType: "cpu" }>; index: number; controller: TraceSiftController }) {
  const card = analysis.cards[index];
  const state = controller.getSnapshot();
  return <article className="tracesift-card">
    <header><div><span className="tracesift-kicker">Task {card.taskIndex + 1}</span><h2>{card.headline}</h2></div><span className="tracesift-time">{ms(card.durationMs)}</span></header>
    {card.pathline && <p className="tracesift-path">{card.pathline}</p>}
    {card.shapeline && <p>{card.shapeline}</p>}
    <dl className="tracesift-metrics"><div><dt>Recording</dt><dd>{percent(card.percentOfProfile)}</dd></div><div><dt>Starts at</dt><dd>{ms(card.startMs)}</dd></div><div><dt>Outside app boundaries</dt><dd>{ms(card.outsideBoundariesMs)}</dd></div></dl>
    {card.culprits.length > 0 && <section><h3>Measured culprits</h3><ul>{card.culprits.slice(0, 5).map(culprit => <li key={`${culprit.nodeId}:${culprit.name}`}><strong>{culprit.name}</strong><span>{culprit.shapeText}</span>{culprit.location && <code>{culprit.location}</code>}</li>)}</ul></section>}
    <footer><span>Confidence: {card.confidence}</span><Button disabled={!state.canInvestigate || Boolean(state.busyCard)} onClick={() => void controller.investigate(card.id)}>{state.busyCard === card.id ? "Starting…" : "Investigate"}</Button></footer>
  </article>;
}

function ReactCard({ analysis, index, controller }: { analysis: Extract<TraceSiftAnalysis, { profileType: "react" }>; index: number; controller: TraceSiftController }) {
  const card = analysis.cards[index];
  const state = controller.getSnapshot();
  return <article className="tracesift-card" data-severity={card.severity}>
    <header><div><span className="tracesift-kicker">Commit {card.commitIndex + 1} · {card.severity}</span><h2>{card.headline}</h2></div><span className="tracesift-time">{ms(card.durationMs)}</span></header>
    {card.pathline && <p className="tracesift-path">{card.pathline}</p>}
    <p>{card.shapeline}</p><p>{card.causeline}</p>{card.updaterline && <p>{card.updaterline}</p>}{card.effectline && <p>{card.effectline}</p>}
    <dl className="tracesift-metrics"><div><dt>Render time</dt><dd>{percent(card.percentOfRender)}</dd></div><div><dt>Rendered</dt><dd>{card.renderedCount} components</dd></div><div><dt>Starts at</dt><dd>{ms(card.startMs)}</dd></div></dl>
    {card.culprits.length > 0 && <section><h3>Measured culprits</h3><ul>{card.culprits.slice(0, 5).map(culprit => <li key={culprit.componentId}><strong>{culprit.component}</strong><span>{culprit.evidence}</span>{culprit.sourceHint && <code>{culprit.sourceHint}</code>}</li>)}</ul></section>}
    <footer><span>Confidence: {card.confidence}</span><Button disabled={!state.canInvestigate || Boolean(state.busyCard)} onClick={() => void controller.investigate(card.id)}>{state.busyCard === card.id ? "Starting…" : "Investigate"}</Button></footer>
  </article>;
}

export function TraceSiftCards({ controller }: { controller: TraceSiftController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const analysis = state.analysis;
  if (!analysis) return <main className="tracesift-results"><p role="status">Analyzing profile with TraceSift…</p>{state.error && <p role="alert">{state.error}</p>}</main>;
  return <main className="tracesift-results">
    <header className="tracesift-heading"><div><span className="tracesift-kicker">TraceSift · {analysis.profileType === "cpu" ? "CPU profile" : "React profile"}</span><h1>{analysis.title || "Profile analysis"}</h1></div><span>{analysis.cards.length} {analysis.cards.length === 1 ? "finding" : "findings"}</span></header>
    {!state.canInvestigate && <p className="tracesift-error" role="status">This host cannot call the card handoff tool or send a message to the active chat. Ask the agent to investigate a card by name instead.</p>}
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
    {analysis.cards.length === 0 && <p role="status">TraceSift found no carded performance issues.</p>}
    <div className="tracesift-list">{analysis.profileType === "cpu"
      ? analysis.cards.map((_card, index) => <CpuCard key={analysis.cards[index].id} analysis={analysis} index={index} controller={controller} />)
      : analysis.cards.map((_card, index) => <ReactCard key={analysis.cards[index].id} analysis={analysis} index={index} controller={controller} />)}</div>
  </main>;
}
