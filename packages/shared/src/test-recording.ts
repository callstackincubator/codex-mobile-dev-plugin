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
  | { kind: "point"; point: ScreenPoint }
  /**
   * A named selector narrowed to one of its matches by position.
   *
   * The last resort before a coordinate, and far better than one: when nothing on the screen names
   * the element uniquely — the same text on a heading and on a tab, with no distinguishing ancestor
   * to scope under and nothing to `filter({ hasText })` on — a bare selector matching two is a step
   * that fails with `LOCATOR_AMBIGUOUS`, while the same selector at `.nth(i)` is a step that runs.
   * `index` is the position of the element the user actually pointed at, so it is recorded, not
   * guessed. It is still positional, so the emitter says so and names the durable fix.
   */
  | { kind: "nth"; inner: NamedSelector; index: number; matches: number };

/** Every selector that names something, as opposed to a coordinate or a position among names. */
export type NamedSelector = Exclude<RecordedSelector, { kind: "point" } | { kind: "nth" }>;

/**
 * What a recorded step does to the element it named.
 *
 * Every one of these is an action or matcher the `e2e` runner actually has, which is the whole
 * constraint: the element menu offers rows from this list, so a row the runner cannot express is
 * a row that does not exist. `secondaryTap`, `selectOption`, `setInputFiles` and `scrollIntoView`
 * are deliberately absent — the runner declares them, and a device refuses them with
 * `UNSUPPORTED_CAPABILITY`. So are `check`/`uncheck` and `toBeChecked`: the runner has them, and
 * whether a device reports a `checked` state at all depends on the platform and the component, so
 * a row for them would emit a step that cannot be relied on to run.
 *
 * The menu shows the common few up front and the rest behind "All commands"; see `stepOffers` and
 * `allStepOffers`.
 */
export type RecordedStepKind =
  | "tap"
  | "doubleTap"
  | "longPress"
  | "fill"
  | "scrollUntilVisible"
  | "assertVisible"
  | "assertNotVisible"
  | "assertText"
  | "assertContainsText"
  | "assertValue"
  | "assertEnabled"
  | "assertDisabled"
  | "assertSelected";

export type RecordedStep = {
  id: string;
  kind: RecordedStepKind;
  selector: RecordedSelector;
  /** What the step reads as in the panel's list, e.g. `Tap "Explore" (tab)`. */
  label: string;
  /** The text a `fill` types. Only a `fill` has one. */
  value?: string;
  /** Set when every rank matched more than one element, so the panel can flag the step. */
  ambiguous?: boolean;
  /**
   * For a coordinate tap only: something on the same screen the test can wait for first. A
   * coordinate is always actionable, so without this the tap fires before the screen exists.
   */
  anchor?: RecordedSelector;
  /**
   * What the element carried when the step was recorded, so the step list can offer the same
   * commands the mirror's menu did without the tree it resolved from. The screen the step was
   * recorded on is long gone by the time a user re-opens that list, and re-reading the device
   * would answer about a different screen; the fields a command row is gated on are few and they
   * belong to the step, so they are kept with it.
   */
  target?: StepTarget;
};

/**
 * The part of an element a command row is gated on: only a text field can be filled or have a
 * value, and only an element with text of its own can be compared against text. It is a subset of
 * `ScreenComponent` so a live component can be passed straight through.
 */
export type StepTarget = Pick<ScreenComponent, "role" | "placeholder" | "label" | "text" | "value">;

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

/**
 * The elements a selector matches, in the order the runner enumerates them.
 *
 * Ordered, not counted, because `.nth(i)` needs the position of one particular element among them —
 * the one the user pointed at. The order is the snapshot's own: the projection flattens the tree
 * depth first, and the panel passes it through untouched, so the panel's index and the runner's
 * index are the same index.
 */
function matchesTestId(components: ScreenComponent[], testId: string): ScreenComponent[] {
  return components.filter(item => normalize(item.identifier) === normalize(testId));
}

/** A role query compares the role exactly and skips a hidden node, as the runner does. */
function matchesRole(components: ScreenComponent[], role: string, name: string): ScreenComponent[] {
  return components.filter(item => (item.role ?? "") === role && accessibleName(item) === name && item.hidden !== true);
}

function matchesPlaceholder(components: ScreenComponent[], placeholder: string): ScreenComponent[] {
  return components.filter(item => normalize(item.placeholder) === placeholder);
}

function matchesText(components: ScreenComponent[], text: string): ScreenComponent[] {
  return innermostOnly(components, components.filter(item => accessibleName(item) === text || elementText(item) === text));
}

function matchesLabel(components: ScreenComponent[], label: string): ScreenComponent[] {
  return innermostOnly(components, components.filter(item => accessibleName(item) === label));
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
  /**
   * How many elements the chosen selector matches: 1 when it is pinned, more when every candidate
   * was ambiguous and the best one was kept and flagged. "Ambiguous" on its own is a verdict; the
   * count is the thing a user can act on, and it is what the panel shows them.
   */
  matches: number;
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
  if (!component) return { selector: { kind: "point", point }, ambiguous: false, levels, matches: 1 };

  // Only the named ranks; the point fallback is not a candidate, it is what is left when these fail.
  // Depth first, rank within a depth: the innermost element that can be named at all wins, because
  // that is the thing the user pointed at. An enclosing element is reached by pointing at it, or
  // by walking out — not by quietly outranking what is under the pointer.
  type Candidate = { selector: NamedSelector; owner: ScreenComponent };
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

  // The first candidate that resolves to exactly one element wins, whatever its rank: an ambiguous
  // preferred candidate never beats a unique later one, for this element or an enclosing one.
  for (const { selector, owner } of candidates) {
    if (selectorMatches(components, selector).length === 1) {
      return { selector, ambiguous: false, component: owner, levels, matches: 1 };
    }
  }
  // Nothing was unique, so the element is narrowed by position instead. A bare selector matching
  // two is a step that fails with `LOCATOR_AMBIGUOUS`; the same selector at `.nth(i)` is a step
  // that runs, and `i` is where the element the user pointed at actually sits among the matches.
  for (const { selector, owner } of candidates) {
    const found = selectorMatches(components, selector);
    const index = found.indexOf(owner);
    if (index < 0 || found.length < 2) continue;
    return {
      selector: { kind: "nth", inner: selector, index, matches: found.length },
      ambiguous: true, component: owner, levels, matches: found.length,
    };
  }
  // The element matched a candidate the runner would not count it among — a container the
  // innermost-only rule drops, say. The selector still describes it better than a coordinate, so
  // it is kept and flagged; with no candidate at all, the point is all there is.
  const fallback = candidates[0];
  return fallback
    ? { selector: fallback.selector, ambiguous: true, component: fallback.owner, levels, matches: selectorMatches(components, fallback.selector).length }
    : { selector: { kind: "point", point }, ambiguous: false, component, levels, matches: 1 };
}

/** The elements one selector matches, in the runner's own order. See the `matches*` helpers. */
function selectorMatches(components: ScreenComponent[], selector: RecordedSelector): ScreenComponent[] {
  switch (selector.kind) {
    case "testId": return matchesTestId(components, selector.testId);
    case "role": return matchesRole(components, selector.role, selector.name);
    case "placeholder": return matchesPlaceholder(components, selector.placeholder);
    case "label": return matchesLabel(components, selector.label);
    case "text": return matchesText(components, selector.text);
    // A point names no element, and an `nth` has already been narrowed to one.
    default: return [];
  }
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
    if (item.identifier && matchesTestId(components, item.identifier).length === 1) return { kind: "testId", testId: item.identifier };
    const placeholder = normalize(item.placeholder);
    if (placeholder && matchesPlaceholder(components, placeholder).length === 1) return { kind: "placeholder", placeholder };
    const text = accessibleName(item) || elementText(item);
    if (!text) continue;
    if (matchesText(components, text).length === 1) return { kind: "text", text };
    if (matchesLabel(components, text).length === 1) return { kind: "label", label: text };
  }
  return undefined;
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
    // Chained on the locator, as the runner's own narrowing is.
    case "nth": return `${selectorSource(selector.inner)}.nth(${selector.index})`;
  }
}

/**
 * The expression a step emits, without the `await` or the semicolon the file needs.
 *
 * The element menu keeps this on each action as a tooltip, while its compact row uses the action's
 * plain-language label. The emitter wraps it; nothing else formats steps.
 */
export function stepExpression(step: { kind: RecordedStepKind; selector: RecordedSelector; value?: string }): string {
  const locator = selectorSource(step.selector);
  switch (step.kind) {
    // A point is already a whole action — `screen.tapAt(...)` — so there is nothing to call on it.
    case "tap": return step.selector.kind === "point" ? locator : `${locator}.tap()`;
    case "doubleTap": return `${locator}.doubleTap()`;
    case "longPress": return `${locator}.longPress()`;
    case "fill": return `${locator}.fill(${quote(step.value ?? "")})`;
    case "scrollUntilVisible": return `screen.scrollUntilVisible(${locator})`;
    case "assertVisible": return `expect(${locator}).toBeVisible()`;
    // The runner's own negation, which waits for the element to stay gone rather than catching it
    // mid-transition. `toBeHidden` is the other spelling and means something else on a device:
    // an element that has gone is absent from the tree, not hidden in it.
    case "assertNotVisible": return `expect(${locator}).not.toBeVisible()`;
    case "assertText": return `expect(${locator}).toHaveText(${quote(step.value ?? "")})`;
    case "assertContainsText": return `expect(${locator}).toContainText(${quote(step.value ?? "")})`;
    case "assertValue": return `expect(${locator}).toHaveValue(${quote(step.value ?? "")})`;
    case "assertEnabled": return `expect(${locator}).toBeEnabled()`;
    case "assertDisabled": return `expect(${locator}).toBeDisabled()`;
    case "assertSelected": return `expect(${locator}).toBeSelected()`;
  }
}

/** The verb each kind reads as in the panel's step list. */
const STEP_VERB: Record<RecordedStepKind, string> = {
  tap: "Tap",
  doubleTap: "Double tap",
  longPress: "Long press",
  fill: "Type into",
  scrollUntilVisible: "Scroll to",
  assertVisible: "Expect visible",
  assertNotVisible: "Expect not visible",
  assertText: "Expect text of",
  assertContainsText: "Expect text in",
  assertValue: "Expect value of",
  assertEnabled: "Expect enabled",
  assertDisabled: "Expect disabled",
  assertSelected: "Expect selected",
};

/** Whether the step carries text the user has to supply: one types it, the rest compare with it. */
export function stepNeedsValue(kind: RecordedStepKind): boolean {
  return kind === "fill" || kind === "assertText" || kind === "assertContainsText" || kind === "assertValue";
}

/** How a step reads in the panel's step list. */
export function stepLabel(kind: RecordedStepKind, selector: RecordedSelector, value?: string): string {
  const verb = STEP_VERB[kind];
  const suffix = stepNeedsValue(kind) ? ` → ${JSON.stringify(value ?? "")}` : "";
  switch (selector.kind) {
    case "testId": return `${verb} #${selector.testId}${suffix}`;
    case "role": return `${verb} "${selector.name}" (${selector.role})${suffix}`;
    case "placeholder": return `${verb} "${selector.placeholder}"${suffix}`;
    case "text": return `${verb} "${selector.text}"${suffix}`;
    case "label": return `${verb} "${selector.label}"${suffix}`;
    case "point": return `${verb} at ${Math.round(selector.point.x)}, ${Math.round(selector.point.y)}`;
    // The position is the whole point of the step, so the list says which of the matches it is.
    case "nth": return `${stepLabel(kind, selector.inner, value)} (${selector.index + 1} of ${selector.matches})`;
  }
}

/**
 * One row of the element menu: a step the element supports and the code it would add.
 *
 * `needsValue` rows carry text the user has to supply — `fill` types it, `toHaveText` compares it —
 * so the menu asks before the step is recorded rather than emitting an empty string literal.
 */
export type StepOffer = {
  kind: RecordedStepKind;
  /** The code the row exposes as a tooltip, e.g. `screen.getByText("Explore").tap()`. */
  source: string;
  needsValue?: boolean;
  /** What a `needsValue` row starts from: the field's current value, or the element's own text. */
  suggestedValue?: string;
};

/** The roles whose elements take typed text, as `e2e`'s `Role` union names them. */
const TEXT_INPUT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/**
 * What the panel does to the device when a row is chosen.
 *
 * The menu is how a step is recorded, and a step that is recorded but never taken leaves the flow
 * on the wrong screen — the next row would be resolved against a screen the test will not be on.
 * So a row that acts, acts. `none` is for the rows that genuinely change nothing: an assertion
 * reads the screen, and `scrollUntilVisible` is only ever offered for an element the user just
 * pointed at, which is on screen already, so its search loop has nothing to do here.
 */
export type StepEffect = "tap" | "doubleTap" | "type" | "none";

export function stepEffect(kind: RecordedStepKind): StepEffect {
  switch (kind) {
    case "tap": return "tap";
    // Two taps, which is the closest the panel's one-shot tap can come to the gesture the step
    // emits. It is what keeps the app on the screen the next step is resolved against; whether
    // the device coalesces them into a real double tap is the app's business, not the step's.
    case "doubleTap": return "doubleTap";
    case "fill": return "type";
    // `longPress` has no equivalent in the panel's input path, so the step is recorded and the app
    // stays where it is — the same as every assertion, which reads the screen and changes nothing.
    default: return "none";
  }
}

/**
 * What the runner can do with this element, as menu rows.
 *
 * Derived from the element's role and what it carries, never from the app: a role in
 * `TEXT_INPUT_ROLES`, or a placeholder — which only a text field has — is what makes a row a
 * `fill`, and an element with its own text is what makes `toHaveText` a comparison with something
 * rather than with nothing.
 *
 * A coordinate gets the tap alone. There is no element behind it to be visible, to hold text or to
 * be scrolled to, which is the same refusal the recorder makes for a point assertion.
 */
export function stepOffers(selector: RecordedSelector, component?: StepTarget): StepOffer[] {
  // A narrowed selector supports whatever its inner one does: the narrowing is on the locator, and
  // every action and matcher chains after it.
  const offer = (kind: RecordedStepKind, value?: string, needsValue?: boolean): StepOffer => ({
    kind,
    source: stepExpression({ kind, selector, ...(value === undefined ? {} : { value }) }),
    ...(needsValue ? { needsValue: true } : {}),
    ...(value === undefined ? {} : { suggestedValue: value }),
  });
  if (selector.kind === "point") return [offer("tap")];
  const role = component?.role ?? "";
  const placeholder = normalize(component?.placeholder);
  const typeable = TEXT_INPUT_ROLES.has(role) || placeholder !== "";
  // One row per kind, not one per variant. Enumerating `longPress` beside `tap` and `toHaveText`
  // beside `toBeVisible` made the menu a list of near-duplicates of the same selector, which is
  // harder to read than the three choices it is actually offering.
  return [
    offer("tap"),
    ...(typeable ? [offer("fill", normalize(component?.value), true)] : []),
    offer("assertVisible"),
    offer("scrollUntilVisible"),
  ];
}

/**
 * Every step the runner can express for this element, for the menu's "all commands" list.
 *
 * `stepOffers` is the short list — the four things most steps are — and it stays short on purpose.
 * This is the rest of what the runner has, which is the difference between a recorder that can
 * assert an element is *gone* and one whose user has to leave the panel and write that line by
 * hand. Each row is still gated on what the element carries: only a text field can be filled or
 * have a value, and only an element with text of its own can be compared against text.
 *
 * A coordinate still gets the tap alone: there is no element behind it to be visible, to hold
 * text, to be enabled or to be scrolled to.
 */
export function allStepOffers(selector: RecordedSelector, component?: StepTarget): StepOffer[] {
  const offer = (kind: RecordedStepKind, value?: string): StepOffer => ({
    kind,
    source: stepExpression({ kind, selector, ...(value === undefined ? {} : { value }) }),
    ...(stepNeedsValue(kind) ? { needsValue: true } : {}),
    ...(value === undefined ? {} : { suggestedValue: value }),
  });
  if (selector.kind === "point") return [offer("tap")];
  const role = component?.role ?? "";
  const placeholder = normalize(component?.placeholder);
  const typeable = TEXT_INPUT_ROLES.has(role) || placeholder !== "";
  const text = normalize(component?.label) || normalize(component?.text);
  return [
    offer("tap"),
    offer("doubleTap"),
    offer("longPress"),
    ...(typeable ? [offer("fill", normalize(component?.value))] : []),
    offer("scrollUntilVisible"),
    offer("assertVisible"),
    offer("assertNotVisible"),
    ...(text ? [offer("assertText", text), offer("assertContainsText", text)] : []),
    ...(typeable ? [offer("assertValue", normalize(component?.value))] : []),
    offer("assertEnabled"),
    offer("assertDisabled"),
    offer("assertSelected"),
  ];
}

/** Whether a command acts on the app or only reads it, for the menu's two groups. */
export function stepIsAssertion(kind: RecordedStepKind): boolean {
  return kind.startsWith("assert");
}

/** A test title turned into a file name, e.g. `the tab bar works` → `the-tab-bar-works`. */
export function testFileSlug(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "recorded";
}

/** One emitted line, and whether the runner will report a step for it. */
type EmittedLine = { text: string; call?: true };

function stepSource(step: RecordedStep): EmittedLine[] {
  const lines: EmittedLine[] = [];
  // A positional step runs, which a bare ambiguous one does not, so this is a note and not a TODO:
  // nothing has to be edited for the test to work, and the durable fix is still named.
  if (step.selector.kind === "nth") {
    lines.push({ text: `  // ${step.selector.matches} elements match this selector; this is the one that was recorded. A testID would pin it by name.` });
  } else if (step.ambiguous) {
    lines.push({ text: `  // TODO: this matched more than one element. Add a testID to pin it.` });
  }
  if (step.selector.kind === "point") {
    lines.push({ text: `  // TODO: nothing resolved here. A coordinate tap breaks on any layout change.` });
    // A locator action waits for its element; a coordinate does not, so it would fire into a
    // splash screen. The anchor is the wait the tap itself cannot express — and the runner reports
    // it as a step of its own, which is why it counts as a call.
    if (step.anchor && step.anchor.kind !== "point") {
      lines.push({ text: `  await expect(${selectorSource(step.anchor)}).toBeVisible();`, call: true });
    }
    if (step.kind === "tap") { lines.push({ text: `  await ${stepExpression(step)};`, call: true }); return lines; }
    // There is nothing to assert about, type into, or scroll to a bare coordinate.
    lines.push({ text: `  // Skipped a step on a point with no element.` });
    return lines;
  }
  lines.push({ text: `  await ${stepExpression(step)};`, call: true });
  return lines;
}

/**
 * Where one step's lines sit in the emitted file, as 1-based line numbers.
 *
 * `calls` are the lines the runner will report a step for; the rest are the TODO comments a step
 * carries with it. A run marks the calls and leaves the comments alone.
 */
export type EmittedStepSpan = { stepId: string; from: number; to: number; calls: number[] };
export type EmittedTest = {
  source: string;
  spans: EmittedStepSpan[];
  /**
   * Every awaited line in file order, `await app.open()` first.
   *
   * This is what maps the runner's live progress to a line. A `step` event carries
   * `identity.stepIndex` and no source position — only the finished report has one — and the runner
   * reports one step per awaited call, in order, so the index *is* the position in this list.
   * The report reconciles it at the end, so a mismatch corrects itself rather than persisting.
   */
  calls: number[];
};

/**
 * Emits the whole test from the steps, and says which lines each step produced.
 *
 * It is a full re-emit every time, so deleting a step or renaming the test just re-renders —
 * nothing is ever patched in place, and the preview and the saved file are always the same text.
 *
 * The spans are what lets a run report land on the right line. A step is not one line: an
 * ambiguous one carries a TODO above its call, and a coordinate tap carries a TODO and an anchor
 * gate as well. Recovering that by diffing emitted sources, as the preview's new-line animation
 * does, is good enough to flash a line and far too weak to attribute a pass or a failure, so the
 * emitter reports it instead of the reader guessing.
 *
 * `agent.act` is never emitted: a recorded test exists to be deterministic.
 */
export function emitE2eTestLines(steps: readonly RecordedStep[], options: { title: string }): EmittedTest {
  const lines: EmittedLine[] = [
    { text: `import { test } from "@e2e-dev/mobile";` },
    { text: `import { expect } from "e2e";` },
    { text: `` },
    { text: `// Recorded from the Testing panel. Every step is a pinned locator, driven by no agent.` },
    { text: `test(${quote(options.title)}, async ({ app, screen }) => {` },
    // The runner reports `app.open` as a step like any other, so it counts as a call.
    { text: `  await app.open();`, call: true },
    { text: `` },
  ];
  const spans: EmittedStepSpan[] = [];
  if (steps.length === 0) lines.push({ text: "  // Tap the mirror to record steps." });
  for (const step of steps) {
    const from = lines.length + 1;
    const emitted = stepSource(step);
    lines.push(...emitted);
    spans.push({
      stepId: step.id, from, to: lines.length,
      calls: emitted.flatMap((line, index) => line.call ? [from + index] : []),
    });
  }
  lines.push({ text: `});` }, { text: `` });
  return {
    source: lines.map(line => line.text).join("\n"),
    spans,
    calls: lines.flatMap((line, index) => line.call ? [index + 1] : []),
  };
}

export function emitE2eTest(steps: readonly RecordedStep[], options: { title: string }): string {
  return emitE2eTestLines(steps, options).source;
}
