/**
 * The full Explore view, inside the card's own frame.
 *
 * TraceSift's web app and this plugin render the same components from
 * `@callstack/tracesift-explore`, so a reader who drills into a card sees the
 * call tree, timeline and commit strip the web app draws rather than a summary
 * of them. The data arrives through MCP because the card's frame is not allowed
 * to reach the TraceSift service itself.
 */

import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
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
      <Button size="sm" variant="outline" disabled={Boolean(state.openingExploreCard)} title="Open this finding in the TraceSift web app instead"
        onClick={() => void controller.openExploreInBrowser(explorer.cardId)}>
        <ExternalLinkIcon />Open in browser
      </Button>
    </div>
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
    />
  </div>;
}
