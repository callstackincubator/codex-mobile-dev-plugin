import "@openai/mcp-extensions/app/styles.css";
import "../../src/ui/theme.css";
import "../../src/ui/style.css";
import { createRoot } from "react-dom/client";
import { ExploreView } from "@callstack/tracesift-explore";
import { TRACE_SIFT_EXPLORE_CLASS } from "../../src/shared/tracesift-explore.ts";
import { taskHandoff } from "./fixture.ts";

/**
 * The embedded explorer as the plugin renders it, in whichever theme the page was
 * opened with: `?theme=light` or `?theme=dark`.
 *
 * The two themes reach the view by the two routes the real panel uses — the
 * document's `data-theme` for the plugin's own rules, and the `.dark` class the
 * package's components read their tokens from. `before` is not reproduced here;
 * the shipped frame's own screenshots are the record of it.
 */
const dark = new URLSearchParams(window.location.search).get("theme") !== "light";
document.documentElement.dataset.view = "tracesift";
document.documentElement.dataset.theme = dark ? "dark" : "light";

const handoff = taskHandoff();

createRoot(document.getElementById("root")!).render(
  <div className={dark ? `${TRACE_SIFT_EXPLORE_CLASS} dark` : TRACE_SIFT_EXPLORE_CLASS} data-kind="task">
    <div className="tracesift-explorer-bar">
      <button type="button">&larr; Findings</button>
      <span className="tracesift-explorer-title">{handoff.card.headline}</span>
      <button type="button">Open in browser</button>
    </div>
    <ExploreView task={{ state: "ready", handoff }} />
  </div>,
);
