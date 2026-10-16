import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The class the plugin's explorer container carries — see `src/ui/style.css`. */
const SCOPE = ".tracesift-explore";

/**
 * The Explore stylesheet, as the TraceSift package ships it.
 *
 * `@callstack/tracesift-explore` compiles its own Tailwind v4 layer (the
 * `@rozenite/ui` theme tokens plus the explore rules) into one plain stylesheet,
 * so this build never needs Tailwind to understand a dependency's sources: the
 * package's class names are already resolved, and the plugin's own `theme.css`
 * pass stays exactly as it was.
 *
 * The sheet is folded in after the plugin's own, so the whole page would take
 * its order of the cascade — and it opens by writing the `@rozenite/ui` theme
 * tokens to `:root` (and their dark counterparts to `.dark`), which would
 * recolor the plugin's own cards behind the explorer. Both token blocks are
 * therefore scoped to the explorer's container: descendants inherit custom
 * properties, so every rule the package's components rely on still resolves,
 * and the plugin's UI outside keeps its own theme. The package's dark
 * *utilities* already compile to `:where(.dark, .dark *)`, so they follow a
 * `.dark` class on that container rather than the document, which is exactly
 * how the plugin reports the host's theme.
 */
export async function exploreUILayerCSS() {
  let url;
  try { url = import.meta.resolve("@callstack/tracesift-explore/package.json"); }
  catch { throw new Error("@callstack/tracesift-explore is not installed. Run npm install before building the UI."); }
  const file = fileURLToPath(url);
  const sheet = await readFile(resolve(dirname(file), JSON.parse(await readFile(file, "utf8")).exports["./styles.css"]), "utf8");
  // A rule that sets a custom property is a token block; any other `:root` or
  // `.dark` rule (Tailwind's own `:root,:host` scale, a reset, a scrollbar
  // color) stays where the package put it. The lookbehind keeps the preceding
  // delimiter unconsumed, so two token blocks written back to back both match.
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
