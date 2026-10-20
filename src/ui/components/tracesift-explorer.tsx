/**
 * The full Explore view, inside the card's own frame.
 *
 * TraceSift's web app and this plugin render the same components from
 * `@callstack/tracesift-explore`, so a reader who drills into a card sees the
 * call tree, timeline and commit strip the web app draws rather than a summary
 * of them. The data arrives through MCP because the card's frame is not allowed
 * to reach the TraceSift service itself.
 */

import { ArrowLeftIcon, ExternalLinkIcon, MessageCircleIcon, MousePointerClickIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { ExploreView, type ExploreLoad, type ReactExploreHandoff, type TaskHandoff } from "@callstack/tracesift-explore";
import { TRACE_SIFT_EXPLORE_CLASS } from "../../shared/tracesift-explore.ts";
import type { TraceSiftController } from "../tracesift-controller.ts";
import { Button } from "./ui/button.tsx";

export function TraceSiftExplorer({ controller }: { controller: TraceSiftController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const explorer = state.explorer;
  if (!explorer) return null;
  const card = state.analysis?.cards.find(entry => entry.id === explorer.cardId);
  // A payload whose card is gone is a stale view rather than a reader error, and
  // drawing half a tree would be worse than saying so.
  if (card === undefined) return <p className="tracesift-error" role="alert">This TraceSift finding is no longer available.</p>;
  // The payload is already in hand before this renders, so the load the web app
  // waits for is always the ready one; the kind decides which of the two is fed.
  const task: ExploreLoad<TaskHandoff> | null = explorer.kind === "task" ? { state: "ready", handoff: explorer.payload as TaskHandoff } : null;
  const react: ExploreLoad<ReactExploreHandoff> | null = explorer.kind === "react" ? { state: "ready", handoff: explorer.payload as ReactExploreHandoff } : null;
  return <div className={state.dark ? `${TRACE_SIFT_EXPLORE_CLASS} dark` : TRACE_SIFT_EXPLORE_CLASS} data-kind={explorer.kind}>
    <div className="tracesift-explorer-bar">
      <Button size="sm" variant="outline" onClick={controller.closeExplore}>
        <ArrowLeftIcon />Findings
      </Button>
      <span className="tracesift-explorer-title">{card.headline}</span>
      {/* Picking is a task-view affordance: a React recording's components are
          addressed some other way, so a reader looking at a commit is shown
          neither the switch nor a button that could never light up. */}
      {explorer.kind === "task" && <div className="tracesift-explorer-pick">
        <Button size="sm" variant="outline" className="tracesift-pick-toggle" aria-pressed={Boolean(explorer.picking)}
          title={explorer.picking
            ? "Stop selecting — this also empties the selection"
            : "Pick the frames you want asked about, in any of the four views"}
          onClick={() => controller.setPicking(!explorer.picking)}>
          <MousePointerClickIcon />Select frames
        </Button>
        <Button size="sm" variant="outline" disabled={Boolean(state.busyCard) || !(explorer.selected?.length) || !state.canInvestigate}
          title={!state.canInvestigate
            ? "This chat cannot receive a message from the card"
            : explorer.selected?.length
              ? `Send these ${explorer.selected.length} frame${explorer.selected.length === 1 ? "" : "s"} and what the profile measured about them to the chat`
              : "Select frames first, then send them here"}
          onClick={() => void controller.investigateSelected()}>
          <MessageCircleIcon />
          {state.busyCard === explorer.cardId
            ? "Starting…"
            : explorer.selected?.length
              ? `Investigate ${explorer.selected.length} frame${explorer.selected.length === 1 ? "" : "s"}`
              : "Investigate selected frames"}
        </Button>
      </div>}
      <Button size="sm" variant="outline" disabled={Boolean(state.openingExploreCard)} title="Open this finding in the TraceSift web app instead"
        onClick={() => void controller.openExploreInBrowser(explorer.cardId)}>
        <ExternalLinkIcon />Open in browser
      </Button>
    </div>
    {explorer.picking && <div className="tracesift-pick-bar" role="status">
      <span>
        {explorer.selected?.length
          // Not "everywhere": a picked frame can still be hidden by a view — a box
          // too narrow to draw, a row the "Your code only" cut drops — and a
          // promise the drawing cannot always keep is one a reader will believe is
          // broken rather than one they will read as approximate.
          ? <>{explorer.selected.length} frame{explorer.selected.length === 1 ? "" : "s"} selected — numbered in the order you picked, and ringed in every view showing it.</>
          : "Click a frame in the timeline, flame graph, call tree or culprits to add it. Click it again to take it out."}
      </span>
      {Boolean(explorer.selected?.length) && <Button size="sm" variant="ghost" onClick={controller.clearSelectedFrames}>
        <XIcon />Clear
      </Button>}
    </div>}
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
    {/* `ExploreView` is the page the web app's `/explore` route mounts, so the
        reader gets the same padding, the same width, and the same copy explaining
        a view that failed to load rather than a plugin-side guess at them. No
        `onClose`: this frame's way back is the bar above, not a Close button. */}
    <ExploreView
      task={task}
      react={react}
      {...(explorer.focus ? { focusNodeId: explorer.focus } : {})}
      onFocusChange={nodeId => controller.setExploreFocus(nodeId)}
      {...(explorer.commitKey ? { commitKey: explorer.commitKey } : {})}
      onCommitChange={key => controller.setExploreCommit(key)}
      {...(explorer.kind === "task"
        ? { selection: { enabled: Boolean(explorer.picking), selectedNodeIds: explorer.selected ?? [], onToggleSelection: controller.toggleSelectedFrame } }
        : {})}
    />
  </div>;
}
