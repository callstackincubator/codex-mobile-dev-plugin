import { ArrowLeftIcon, ExternalLinkIcon, MessageCircleIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { ExploreView, type ExploreLoad, type ReactExploreHandoff, type TaskHandoff } from "@callstack/tracesift-explore";
import { TRACE_SIFT_EXPLORE_CLASS } from "@mobile-dev/shared/tracesift-explore.ts";
import type { TraceSiftController } from "../tracesift-controller.ts";
import { Button } from "./ui/button.tsx";

export function TraceSiftExplorer({ controller }: { controller: TraceSiftController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const explorer = state.explorer;
  if (!explorer) return null;
  const card = state.analysis?.cards.find(entry => entry.id === explorer.cardId);
  // A payload whose card is gone is a stale view, not a reader error.
  if (card === undefined) return <p className="tracesift-error" role="alert">This TraceSift finding is no longer available.</p>;
  const task: ExploreLoad<TaskHandoff> | null = explorer.kind === "task" ? { state: "ready", handoff: explorer.payload as TaskHandoff } : null;
  const react: ExploreLoad<ReactExploreHandoff> | null = explorer.kind === "react" ? { state: "ready", handoff: explorer.payload as ReactExploreHandoff } : null;
  const picks = explorer.kind === "react"
    ? { one: "component", many: "components", where: "the render tree or the components table" }
    : { one: "frame", many: "frames", where: "the timeline, flame graph, call tree or culprits" };
  const count = explorer.selected?.length ?? 0;
  const noun = count === 1 ? picks.one : picks.many;
  return <div className={state.dark ? `${TRACE_SIFT_EXPLORE_CLASS} dark` : TRACE_SIFT_EXPLORE_CLASS} data-kind={explorer.kind}>
    <div className="tracesift-explorer-bar">
      <Button size="sm" variant="outline" onClick={controller.closeExplore}>
        <ArrowLeftIcon />Findings
      </Button>
      <span className="tracesift-explorer-title">{card.headline}</span>
      <div className="tracesift-explorer-pick">
        <Button size="sm" variant="outline" className="tracesift-pick-toggle" aria-pressed={Boolean(explorer.picking)}
          title={explorer.picking
            ? "Stop selecting — this also empties the selection"
            : `Pick the ${picks.many} you want asked about, in ${picks.where}`}
          onClick={() => controller.setPicking(!explorer.picking)}>
          <MousePointerClickIcon />Select {picks.many}
        </Button>
        <Button size="sm" variant="outline" disabled={Boolean(state.busyCard) || count === 0 || !state.canInvestigate || !state.project}
          title={!state.canInvestigate
            ? "This chat cannot receive a message from the card"
            : !state.project
              ? "Choose a project on the findings list first, so the chat knows which code these belong to"
            : count
              ? `Send these ${count} ${noun} and what the profile measured about them to the chat`
              : `Select ${picks.many} first, then send them here`}
          onClick={() => void controller.investigateSelected()}>
          <MessageCircleIcon />
          {state.busyCard === explorer.cardId
            ? "Starting…"
            : count
              ? `Investigate ${count} ${noun}`
              : `Investigate selected ${picks.many}`}
        </Button>
      </div>
      <Button size="sm" variant="outline" disabled={Boolean(state.openingExploreCard)} title="Open this finding in the TraceSift web app instead"
        onClick={() => void controller.openExploreInBrowser(explorer.cardId)}>
        <ExternalLinkIcon />Open in browser
      </Button>
    </div>
    {explorer.picking && <div className="tracesift-pick-bar" role="status">
      <span>
        {count
          // Not "everywhere": a view can hide a picked frame (box too narrow, "Your code only" cut).
          ? <>{count} {noun} selected — numbered in the order you picked, and ringed in every view showing {count === 1 ? "it" : "them"}{explorer.kind === "react" ? ", in every commit you picked in" : ""}.</>
          : `Click a ${picks.one} in ${picks.where} to add it. Click it again to take it out.`}
      </span>
      {Boolean(explorer.selected?.length) && <Button size="sm" variant="ghost" onClick={controller.clearSelectedFrames}>
        <XIcon />Clear
      </Button>}
    </div>}
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
    {/* The web app's `/explore` page, so padding, width and failure copy are its own. No `onClose`: the bar above goes back. */}
    <ExploreView
      task={task}
      react={react}
      {...(explorer.focus ? { focusNodeId: explorer.focus } : {})}
      onFocusChange={nodeId => controller.setExploreFocus(nodeId)}
      {...(explorer.commitKey ? { commitKey: explorer.commitKey } : {})}
      onCommitChange={key => controller.setExploreCommit(key)}
      selection={{ enabled: Boolean(explorer.picking), selectedNodeIds: explorer.selected ?? [], onToggleSelection: controller.toggleSelectedFrame }}
    />
  </div>;
}
