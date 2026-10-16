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
import { ReactExplorer, TaskExplorer, type ReactExploreHandoff, type TaskHandoff } from "@callstack/tracesift-explore";
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
  return <div className={state.dark ? "tracesift-explorer dark" : "tracesift-explorer"} data-kind={explorer.kind}>
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
    {/* The kind decides which renderer sees the payload, so a service newer than
        this bundle still reaches a renderer that ignores fields it does not
        know rather than one that fails on them. */}
    {explorer.kind === "task" && <TaskExplorer
      handoff={explorer.payload as TaskHandoff}
      {...(explorer.focus ? { focusNodeId: explorer.focus } : {})}
      onFocusChange={nodeId => controller.setExploreFocus(nodeId)}
    />}
    {explorer.kind === "react" && <ReactExplorer
      handoff={explorer.payload as ReactExploreHandoff}
      {...(explorer.commitKey ? { commitKey: explorer.commitKey } : {})}
      onCommitChange={key => controller.setExploreCommit(key)}
    />}
  </div>;
}
