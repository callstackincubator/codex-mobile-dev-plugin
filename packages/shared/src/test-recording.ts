import { componentsAt } from "./screen-annotations.ts";
import type { ScreenComponent, ScreenPoint, ScreenSize } from "./screen-annotations.ts";

/**
 * How a recorded step names the element it acted on. The ranks are tried in order and the first
 * one that resolves to exactly one element on screen wins, so a recorded test is pinned to
 * something stable rather than to a coordinate.
 *
 * `point` is the fallback: it always works and it is always brittle, so the emitter marks it.
 */
export type RecordedSelector =
  | { kind: "testId"; testId: string }
  | { kind: "role"; role: string; name: string }
  | { kind: "placeholder"; placeholder: string }
  | { kind: "text"; text: string }
  | { kind: "label"; label: string }
  | { kind: "point"; point: ScreenPoint };

export type RecordedStepKind = "tap" | "assertVisible";

export type RecordedStep = {
  id: string;
  kind: RecordedStepKind;
  selector: RecordedSelector;
  /** What the step reads as in the panel's list, e.g. `Tap "Explore" (tab)`. */
  label: string;
  /** Set when every rank matched more than one element, so the panel can flag the step. */
  ambiguous?: boolean;
  /**
   * For a coordinate tap only: something on the same screen the test can wait for first. A
   * coordinate is always actionable, so without this the tap fires before the screen exists.
   */
  anchor?: RecordedSelector;
};

/**
 * The roles `screen.getByRole` accepts, as `e2e`'s own `Role` union declares them.
 *
 * This is a *filter*, never a translation. The engine has already decided what each element's role
 * is — it projected the snapshot the recorder reads, and it will project the one the test runs
 * against — so nothing here renames a role; `tab` reaches the file because the engine said `tab`.
 * But the union is closed, so `getByRole("other", …)` or `getByRole("text", …)` is a type error in
 * the emitted file rather than a query that merely misses, and the engine deliberately keeps an
 * unmapped element type as its own role. Those fall through to the text and label ranks, which is
 * how the element gets named instead.
 */
const QUERYABLE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio",
  "radiogroup", "switch", "slider", "spinbutton", "progressbar", "meter", "image", "heading", "tab",
  "tablist", "tabpanel", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio",
  "toolbar", "tooltip", "tree", "treeitem", "list", "listitem", "table", "grid", "row", "rowgroup",
  "rowheader", "cell", "gridcell", "columnheader", "separator", "group", "article", "figure",
  "form", "status", "alert", "dialog", "alertdialog", "main", "navigation", "banner", "contentinfo",
  "complementary", "region",
]);

/**
 * The runner compares text exactly, after collapsing whitespace, so both sides of a count have to
 * be normalised the same way. An accessibility label carries the line breaks of the rendered copy.
 */
const normalize = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/**
 * The element's accessible *name*: what `getByRole(role, name)` and `getByLabel` match.
 *
 * It is the runner's own `name` field, carried through the read path untouched. A search field
 * whose only text is its placeholder has no name at all, which is why `getByRole("textbox",
 * "Search transactions")` used to be emitted and used to match nothing.
 */
function accessibleName(component: ScreenComponent): string {
  return normalize(component.label);
}

/** The element's own text, which `getByText` searches besides the name. */
function elementText(component: ScreenComponent): string {
  return normalize(component.text);
}

/** Parent links by node id, for the containment the runner's innermost-only rule needs. */
function ancestry(components: ScreenComponent[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const item of components) if (item.nodeId && item.parentId) parents.set(item.nodeId, item.parentId);
  return parents;
}

function isWithin(parents: Map<string, string>, entry: ScreenComponent, ancestor: ScreenComponent): boolean {
  if (!entry.nodeId || !ancestor.nodeId) return false;
  for (let id = parents.get(entry.nodeId); id !== undefined; id = parents.get(id)) {
    if (id === ancestor.nodeId) return true;
  }
  return false;
}

/**
 * Drops every match that contains another match, which is how the runner answers `getByText` and
 * `getByLabel`.
 *
 * A device tree echoes text upwards: iOS reports a React Native `Text` host view and the
 * `StaticText` inside it with the same label, so without this rule a screen's every piece of text
 * is "ambiguous" and every step records a TODO. The runner does not see it that way, and a
 * recorder that disagrees with the runner is the bug.
 */
function innermostOnly(components: ScreenComponent[], matches: ScreenComponent[]): ScreenComponent[] {
  if (matches.length < 2) return matches;
  const parents = ancestry(components);
  return matches.filter(entry => !matches.some(other => other !== entry && isWithin(parents, other, entry)));
}

function matchesTestId(components: ScreenComponent[], testId: string): number {
  return components.filter(item => normalize(item.identifier) === normalize(testId)).length;
}

/** A role query compares the role exactly and skips a hidden node, as the runner does. */
function matchesRole(components: ScreenComponent[], role: string, name: string): number {
  return components.filter(item => (item.role ?? "") === role && accessibleName(item) === name && item.hidden !== true).length;
}

function matchesPlaceholder(components: ScreenComponent[], placeholder: string): number {
  return components.filter(item => normalize(item.placeholder) === placeholder).length;
}

function matchesText(components: ScreenComponent[], text: string): number {
  return innermostOnly(components, components.filter(item => accessibleName(item) === text || elementText(item) === text)).length;
}

function matchesLabel(components: ScreenComponent[], label: string): number {
  return innermostOnly(components, components.filter(item => accessibleName(item) === label)).length;
}

/**
 * The single piece of text inside an element, when there is exactly one.
 *
 * More than one and there is nothing to choose between them, so the element stays unnamed and the
 * ladder moves outwards instead of guessing.
 */
function descendantText(components: ScreenComponent[], owner: ScreenComponent): string | undefined {
  if (!owner.nodeId) return;
  const inside = new Set([owner.nodeId]);
  const found = new Set<string>();
  // One ordered pass: a child always follows its parent in a tree flattened depth-first.
  for (const item of components) {
    if (!item.parentId || !inside.has(item.parentId)) continue;
    if (item.nodeId) inside.add(item.nodeId);
    const text = accessibleName(item) || elementText(item);
    if (text) found.add(text);
    if (found.size > 1) return;
  }
  return [...found][0];
}

export type ResolvedSelector = {
  selector: RecordedSelector;
  ambiguous: boolean;
  component?: ScreenComponent;
  /** How many elements the point sits inside, so the panel knows how far out it can still walk. */
  levels: number;
};

const area = ({ bounds }: ScreenComponent) => bounds.width * bounds.height;

/**
 * Whether the tree describes the app at all.
 *
 * The runner's snapshot is rooted at the application, so the simulator's own chrome — clock,
 * Dynamic Island, battery — is simply not in it, and there is no "only the status bar" state left
 * to detect. An empty tree still is one: nothing was attached, or the app has no accessible
 * content, and either way a recorded step would name nothing.
 */
export type TreeHealth = "ok" | "no-accessibility";
export function treeHealth(components: ScreenComponent[]): TreeHealth {
  return components.length > 0 ? "ok" : "no-accessibility";
}

function covers({ bounds }: ScreenComponent, point: ScreenPoint): boolean {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

/**
 * Every element the point sits inside, innermost first.
 *
 * The tree is the runner's own, so every element in it is one the runner can address — there is no
 * second tree of React Native fibers lying over the same pixels to choose between, and no
 * simulator chrome to filter out, because the snapshot is rooted at the application.
 *
 * `componentsAt` answers with one branch — an element plus its own ancestors — which is too narrow
 * here, since the point may sit inside siblings' bounds too. The ladder is every hit, ordered by
 * area, which is also the order "walk out to the parent" means on screen.
 */
export function hitLadder(components: ScreenComponent[], point: ScreenPoint, screen?: ScreenSize): ScreenComponent[] {
  const hits = components.filter(item => covers(item, point)
    // A root spanning the whole screen names nothing; it is the screen.
    && (!screen || item.bounds.width < screen.width * .95 || item.bounds.height < screen.height * .95))
    .sort((a, b) => area(a) - area(b) || b.depth - a.depth);
  // The overlay's own pick leads when it is one of them, so the recorder starts on the element the
  // mirror highlights.
  const picked = componentsAt(components, point, screen)[0];
  return picked && hits.includes(picked) ? [picked, ...hits.filter(item => item !== picked)] : hits;
}

/**
 * Turns a point on the screen into the selector a test should use.
 *
 * The hit test is the same one the annotation overlay uses, so what the recorder names is what the
 * user sees highlighted. Uniqueness is checked against the whole tree: a selector that would match
 * two elements is not pinned, it is a flake, so the next rank is tried. If every rank is ambiguous
 * the best one is kept and flagged rather than silently emitting a selector that may hit the wrong
 * element.
 */
export function resolveSelector(components: ScreenComponent[], point: ScreenPoint, screen?: ScreenSize, level = 0): ResolvedSelector {
  // The innermost element under the point often carries nothing addressable — an unlabelled view,
  // a bare container — while something just outside it holds the name or the testID. Reading the
  // whole ladder names the thing the user meant rather than giving up on a coordinate. `level` is
  // the user walking outwards: it drops that many innermost elements.
  const ladder = hitLadder(components, point, screen);
  const levels = ladder.length;
  const chain = ladder.slice(Math.max(0, Math.min(level, levels - 1)));
  const component = chain[0];
  if (!component) return { selector: { kind: "point", point }, ambiguous: false, levels };

  // Only the named ranks; the point fallback is not a candidate, it is what is left when these fail.
  // Depth first, rank within a depth: the innermost element that can be named at all wins, because
  // that is the thing the user pointed at. An enclosing element is reached by pointing at it, or
  // by walking out — not by quietly outranking what is under the pointer.
  type Candidate = { selector: Exclude<RecordedSelector, { kind: "point" }>; owner: ScreenComponent };
  const candidates: Candidate[] = [];
  for (const owner of chain.slice(0, 8)) {
    // The role is the runner's own, passed through untouched. Translating it here is what this
    // path exists to stop: the engine already decided that a tab bar's button is a `tab`.
    const role = QUERYABLE_ROLES.has(owner.role ?? "") ? owner.role! : "";
    const name = accessibleName(owner);
    const placeholder = normalize(owner.placeholder);
    const text = elementText(owner);
    if (owner.identifier) candidates.push({ owner, selector: { kind: "testId", testId: owner.identifier } });
    // A role query with no name matches every element of that role, so the pair is the candidate
    // or there is none — which is exactly the search field whose only text is its placeholder.
    if (role && name) candidates.push({ owner, selector: { kind: "role", role, name } });
    if (placeholder) candidates.push({ owner, selector: { kind: "placeholder", placeholder } });
    // `getByText` searches the name and the element's own text, innermost match only.
    if (name || text) candidates.push({ owner, selector: { kind: "text", text: name || text } });
    if (name) candidates.push({ owner, selector: { kind: "label", label: name } });
    // An icon-only control carries nothing itself: a tab bar item is an unlabelled container with
    // the word "Explore" in a sibling of the icon, below the point that was tapped. The one text
    // inside it names it, and tapping that text lands inside the same control.
    if (!owner.identifier && !name) {
      const inside = descendantText(components, owner);
      if (inside) candidates.push({ owner, selector: { kind: "label", label: inside } });
    }
  }

  for (const { selector, owner } of candidates) {
    const matches = selector.kind === "testId" ? matchesTestId(components, selector.testId)
      : selector.kind === "role" ? matchesRole(components, selector.role, selector.name)
        : selector.kind === "placeholder" ? matchesPlaceholder(components, selector.placeholder)
          : selector.kind === "label" ? matchesLabel(components, selector.label)
            : matchesText(components, selector.text);
    if (matches === 1) return { selector, ambiguous: false, component: owner, levels };
  }
  // Nothing was unique. The best-ranked candidate still describes the element better than a
  // coordinate does, so it is kept and flagged; with no candidate at all, the point is all there is.
  const fallback = candidates[0];
  return fallback
    ? { selector: fallback.selector, ambiguous: true, component: fallback.owner, levels }
    : { selector: { kind: "point", point }, ambiguous: false, component, levels };
}

/**
 * Something on this screen a test can wait for, nearest the point first.
 *
 * `screen.tapAt` is the one step with nothing to wait on: a locator action waits up to the action
 * timeout for its element, but a coordinate is always "ready", so a recorded coordinate tap fires
 * into a splash screen and misses. This picks a neighbour that does resolve uniquely, which the
 * emitter puts in front of the tap as a gate.
 */
export function anchorSelector(components: ScreenComponent[], point: ScreenPoint): RecordedSelector | undefined {
  const distance = (item: ScreenComponent) =>
    Math.hypot(item.bounds.x + item.bounds.width / 2 - point.x, item.bounds.y + item.bounds.height / 2 - point.y);
  for (const item of [...components].sort((a, b) => distance(a) - distance(b)).slice(0, 40)) {
    if (item.identifier && matchesTestId(components, item.identifier) === 1) return { kind: "testId", testId: item.identifier };
    const placeholder = normalize(item.placeholder);
    if (placeholder && matchesPlaceholder(components, placeholder) === 1) return { kind: "placeholder", placeholder };
    const text = accessibleName(item) || elementText(item);
    if (!text) continue;
    if (matchesText(components, text) === 1) return { kind: "text", text };
    if (matchesLabel(components, text) === 1) return { kind: "label", label: text };
  }
}

const quote = (value: string) => JSON.stringify(value);

/** The locator expression a step emits, e.g. `screen.getByRole("tab", "Explore")`. */
export function selectorSource(selector: RecordedSelector): string {
  switch (selector.kind) {
    case "testId": return `screen.getByTestId(${quote(selector.testId)})`;
    case "role": return `screen.getByRole(${quote(selector.role)}, ${quote(selector.name)})`;
    case "placeholder": return `screen.getByPlaceholder(${quote(selector.placeholder)})`;
    case "text": return `screen.getByText(${quote(selector.text)})`;
    case "label": return `screen.getByLabel(${quote(selector.label)})`;
    case "point": return `screen.tapAt({ x: ${Math.round(selector.point.x)}, y: ${Math.round(selector.point.y)} })`;
  }
}

/** How a step reads in the panel's step list. */
export function stepLabel(kind: RecordedStepKind, selector: RecordedSelector): string {
  const verb = kind === "tap" ? "Tap" : "Expect visible";
  switch (selector.kind) {
    case "testId": return `${verb} #${selector.testId}`;
    case "role": return `${verb} "${selector.name}" (${selector.role})`;
    case "placeholder": return `${verb} "${selector.placeholder}"`;
    case "text": return `${verb} "${selector.text}"`;
    case "label": return `${verb} "${selector.label}"`;
    case "point": return `${verb} at ${Math.round(selector.point.x)}, ${Math.round(selector.point.y)}`;
  }
}

/** A test title turned into a file name, e.g. `the tab bar works` → `the-tab-bar-works`. */
export function testFileSlug(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "recorded";
}

function stepSource(step: RecordedStep): string[] {
  const lines: string[] = [];
  if (step.ambiguous) lines.push(`  // TODO: this matched more than one element. Add a testID to pin it.`);
  if (step.selector.kind === "point") {
    lines.push(`  // TODO: nothing resolved here. A coordinate tap breaks on any layout change.`);
    // A locator action waits for its element; a coordinate does not, so it would fire into a
    // splash screen. The anchor is the wait the tap itself cannot express.
    if (step.anchor && step.anchor.kind !== "point") {
      lines.push(`  await expect(${selectorSource(step.anchor)}).toBeVisible();`);
    }
    if (step.kind === "tap") { lines.push(`  await ${selectorSource(step.selector)};`); return lines; }
    // There is nothing to assert about a bare coordinate.
    lines.push(`  // Skipped an assertion on a point with no element.`);
    return lines;
  }
  lines.push(step.kind === "tap"
    ? `  await ${selectorSource(step.selector)}.tap();`
    : `  await expect(${selectorSource(step.selector)}).toBeVisible();`);
  return lines;
}

/**
 * Emits the whole test from the steps. It is a full re-emit every time, so deleting a step or
 * renaming the test just re-renders — nothing is ever patched in place, and the preview and the
 * saved file are always the same text.
 *
 * `agent.act` is never emitted: a recorded test exists to be deterministic.
 */
export function emitE2eTest(steps: readonly RecordedStep[], options: { title: string }): string {
  const body = steps.length === 0
    ? ["  // Tap the mirror to record steps."]
    : steps.flatMap(stepSource);
  return [
    `import { test } from "@e2e-dev/mobile";`,
    `import { expect } from "e2e";`,
    ``,
    `// Recorded from the Testing panel. Every step is a pinned locator, driven by no agent.`,
    `test(${quote(options.title)}, async ({ app, screen }) => {`,
    `  await app.open();`,
    ``,
    ...body,
    `});`,
    ``,
  ].join("\n");
}
