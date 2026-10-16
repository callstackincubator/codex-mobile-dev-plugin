import assert from "node:assert/strict";
import { test } from "node:test";
import { exploreUILayerCSS } from "../scripts/explore-css.mjs";
import { TRACE_SIFT_EXPLORE_CLASS } from "../src/shared/tracesift-explore.ts";

/**
 * The contract between the folded Explore stylesheet and the plugin's renderer.
 *
 * The package's theme tokens reach the explorer only because the build rewrites
 * their `:root` and `.dark` blocks onto the explorer's class. When the two
 * disagreed, every TraceSift rule reading `var(--primary)` or `var(--success)`
 * fell back to the plugin's card theme, the graphs drew in grey, and no build
 * step noticed. These are the checks that were missing.
 */
test("the Explore stylesheet's tokens are scoped to the class the explorer renders", async () => {
  const sheet = await exploreUILayerCSS();
  const scoped = `.${TRACE_SIFT_EXPLORE_CLASS}`;
  // Real token values rather than any block at all: a fold that scoped the wrong
  // declarations to the right class has to fail here too.
  assert.match(sheet, new RegExp(`\\${scoped}\\{[^}]*--primary:#8232ff`), "the light theme tokens");
  assert.match(sheet, new RegExp(`\\${scoped}\\.dark\\{[^}]*--background:#201f24`), "the dark theme tokens");
  // Nothing of the sort may be left behind: an unscoped block would repaint the
  // plugin's own cards with the web page's theme.
  for (const left of sheet.match(/(?:^|[,{])(?::root|\.dark)\s*(?:,\s*(?::root|\.dark)\s*)*\{/g) ?? []) {
    assert.fail(`the folded sheet still carries an unscoped token block: ${left}`);
  }
});

test("the Explore stylesheet carries the page wrapper the explorer renders", async () => {
  const sheet = await exploreUILayerCSS();
  // The panel adds no padding of its own: it comes from `.explore-page`, the same
  // element the web app's `/explore` route paints, so the two cannot drift apart.
  const page = /\.explore-page\{([^}]*)\}/.exec(sheet)?.[1];
  assert.ok(page, "the folded sheet defines the Explore page");
  assert.match(page, /padding:/, "and that page carries its own padding");
});
