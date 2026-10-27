import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRACE_SIFT_EXPLORE_CLASS } from "../packages/shared/src/tracesift-explore.ts";

/** The class the explorer renders, from the same constant the component uses. */
const SCOPE = `.${TRACE_SIFT_EXPLORE_CLASS}`;

/**
 * The package's precompiled Explore stylesheet, folded in after the plugin's own.
 * Its `:root`/`.dark` tokens are rescoped so they cannot recolor the cards.
 */
export async function exploreUILayerCSS() {
  let url;
  try { url = import.meta.resolve("@callstack/tracesift-explore/package.json"); }
  catch { throw new Error("@callstack/tracesift-explore is not installed. Run npm install before building the UI."); }
  const file = fileURLToPath(url);
  const sheet = await readFile(resolve(dirname(file), JSON.parse(await readFile(file, "utf8")).exports["./styles.css"]), "utf8");
  // A rule that sets a custom property is a token block; any other `:root` or
  // `.dark` rule stays where the package put it. The lookbehind leaves the
  // preceding delimiter unconsumed so adjacent blocks both match.
  const tokenBlock = /((?<=^)|(?<=[,{}]))((?::root|\.dark)(?:,(?::root|\.dark))*)\{([^{}]*)\}/g;
  const scoped = sheet.replace(tokenBlock, (whole, _lead, selectors, body) => {
    if (!body.includes("--")) return whole;
    const renamed = selectors.split(",").map(scopeFor).join(",");
    return `${renamed}{${body}}`;
  });
  tokenBlock.lastIndex = 0;
  for (const [, selectors, body] of scoped.matchAll(tokenBlock)) {
    if (body.includes("--")) throw new Error(`The Explore stylesheet scopes tokens to "${selectors}" in a shape this fold does not rewrite; check it against the package.`);
  }
  return scoped;
}

function scopeFor(selector) {
  return selector === ":root" ? SCOPE : `${SCOPE}.dark`;
}
