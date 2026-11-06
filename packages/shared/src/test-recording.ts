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
 * The roles `screen.getByRole` accepts. The union is closed in the runner, so a role outside it is
 * a type error in the emitted file, not a query that simply misses — which is why an unmapped
 * platform role resolves to no role at all and the step falls through to `getByText`.
 */
const E2E_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio",
  "radiogroup", "switch", "slider", "spinbutton", "progressbar", "meter", "image", "heading", "tab",
  "tablist", "tabpanel", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio",
  "toolbar", "tooltip", "tree", "treeitem", "list", "listitem", "table", "grid", "row", "rowgroup",
  "rowheader", "cell", "gridcell", "columnheader", "separator", "group", "article", "figure",
  "form", "status", "alert", "dialog", "alertdialog", "main", "navigation", "banner", "contentinfo",
  "complementary", "region",
]);

/**
 * What the device calls an element, mapped to what the runner calls it.
 *
 * Two sources feed this. iOS accessibility reports `AXButton`-style roles; React Native inspection
 * reports the fiber's component name, so a `<Text>` arrives as `RCTText`. Neither vocabulary is the
 * runner's, and `rcttext` or `radiobutton` in a test file does not compile.
 *
 * A tab bar item is the one judgement call: iOS accessibility reports it as a radio button, and the
 * runner's role for it is `tab`.
 */
const ROLE_ALIASES = new Map(Object.entries({
  radiobutton: "tab", tabbutton: "tab", tabbar: "tablist", segmentedcontrol: "tablist",
  textfield: "textbox", securetextfield: "textbox", textarea: "textbox", searchfield: "searchbox",
  singlelinetextinputview: "textbox", multilinetextinputview: "textbox", textinput: "textbox",
  imageview: "image", progressindicator: "progressbar", valueindicator: "progressbar",
  popupbutton: "button", menubutton: "button", disclosuretriangle: "button", pressable: "button",
  touchableopacity: "button", touchablehighlight: "button", header: "heading",
  // `link` is in the runner's union but is not something accessibility can be read off.
  // iOS derives `AXLink` from the *link trait*, which any view can carry — a `<Text>` inside an
  // `expo-router` `<Link>` reports `AXLink` exactly as a pressable wrapper does. The runner reads
  // the XCTest *element type* instead, so the first is `text` to it and only the second is `link`,
  // and nothing in the accessibility tree tells the two apart. Falling through to the accessible
  // name resolves both.
  link: "",
  // Text is not a role in the runner's union: these fall through to `getByText`.
  statictext: "", text: "", textview: "", view: "", scrollview: "", safeareaview: "",
}));

/**
 * The role a step should use, or "" when the device's role has no equivalent and the step should be
 * named by its text instead. iOS reports `AXButton`, Android `android.widget.Button`, React Native
 * `RCTText`.
 */
export function normalizeRole(role: string | undefined): string {
  if (!role) return "";
  const last = (role.split(".").at(-1) ?? role).replace(/^(AX|XCUIElementType|RCT)/, "").trim().toLowerCase();
  const aliased = ROLE_ALIASES.get(last) ?? last;
  return E2E_ROLES.has(aliased) ? aliased : "";
}

/**
 * The text an element is addressable by: its label, else its value.
 *
 * React Native inspection falls back to the component name when an element has no label, so a
 * `<Text>` with no string child arrives labelled `RCTText`. That is the component, not anything on
 * screen, so it is not text a test can be pinned to.
 */
function elementText(component: ScreenComponent): string {
  // The runner matches text after whitespace normalization, and an accessibility label carries the
  // line breaks of the rendered copy, so both sides have to be normalized the same way.
  const text = (component.label ?? component.value ?? "").replace(/\s+/g, " ").trim();
  return text && text !== (component.role ?? "").trim() ? text : "";
}

/** Whether the runner would see this element as text, i.e. whether `getByText` can find it. */
function textual(component: ScreenComponent): boolean {
  return /statictext|text$/i.test((component.role ?? "").replace(/^(AX|XCUIElementType|RCT)/, ""));
}

/**
 * The elements a count of matches is taken over: the accessibility tree alone, which is what the
 * runner queries, and everything only when there is no accessibility tree to speak of.
 *
 * Without this a fiber lying over the same pixels counts as a second match — a `<Text>` inside a
 * `<Link>` is one element to the runner and two here — and a selector that resolves uniquely on
 * the device is emitted flagged as ambiguous.
 */
function queryable(components: ScreenComponent[]): ScreenComponent[] {
  const accessible = components.filter(item => item.source !== "react-native");
  return accessible.length ? accessible : components;
}

function matchesLabel(components: ScreenComponent[], label: string): number {
  return queryable(components).filter(item => elementText(item) === label).length;
}

function matchesTestId(components: ScreenComponent[], testId: string): number {
  return queryable(components).filter(item => item.identifier === testId).length;
}

function matchesRole(components: ScreenComponent[], role: string, name: string): number {
  return queryable(components).filter(item => normalizeRole(item.role) === role && elementText(item) === name).length;
}

function matchesText(components: ScreenComponent[], text: string): number {
  // Counted over text elements only, the same set `getByText` searches: a row whose accessible
  // name repeats its label is not a second match for the text inside it.
  return queryable(components).filter(item => textual(item) && elementText(item) === text).length;
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
    const text = elementText(item);
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
 * The simulator's own status bar — clock, Dynamic Island, battery — which the device's
 * accessibility tree reports alongside the app's. The runner never sees it: it queries the app,
 * not the screen. Naming it produces a step that cannot run, and `Dynamic Island, Empty` is not
 * what anyone meant to record.
 */
function systemChrome(item: ScreenComponent, screen?: ScreenSize): boolean {
  return Boolean(screen) && !item.identifier && item.bounds.y + item.bounds.height <= screen!.height * 0.07;
}

/**
 * Whether the accessibility tree currently describes the app at all.
 *
 * It can come back holding only the status bar. The React Native fibers are still there and still
 * describe the screen, so resolution silently falls back to them — and every selector it produces
 * names something the runner cannot find. Better to say so than to record a test that cannot run.
 */
export type TreeHealth = "ok" | "chrome-only" | "no-accessibility";
export function treeHealth(components: ScreenComponent[], screen?: ScreenSize): TreeHealth {
  let chrome = false;
  for (const item of components) {
    if (item.source === "react-native") continue;
    if (!systemChrome(item, screen)) return "ok";
    chrome = true;
  }
  return chrome ? "chrome-only" : "no-accessibility";
}
function covers({ bounds }: ScreenComponent, point: ScreenPoint): boolean {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

/**
 * Every element the point sits inside, innermost first.
 *
 * **Accessibility only, when there is any.** The inspection merges two trees over the same pixels:
 * React Native fibers and the device's accessibility tree. Only the second is what the runner
 * queries, and the two do not agree — a collapsible header is a `Pressable` holding a `Text`
 * reading "File-based routing" in the fibers, and a single element whose accessible name is
 * "Forward, File-based routing" (the chevron's name is folded in) in accessibility. Naming it from
 * the fibers emits a locator the runner cannot resolve, however well it describes the screen. The
 * fibers remain the overlay's business; a recorded selector is only ever as good as what the
 * runner can see.
 *
 * `componentsAt` answers with one branch — an element plus its own ancestors — which is too narrow
 * here, since the point may sit inside siblings' bounds too. The ladder is every hit, ordered by
 * area, which is also the order "walk out to the parent" means on screen.
 */
export function hitLadder(components: ScreenComponent[], point: ScreenPoint, screen?: ScreenSize): ScreenComponent[] {
  const visible = components.filter(item => covers(item, point)
    // A root spanning the whole screen names nothing; it is the screen.
    && (!screen || item.bounds.width < screen.width * .95 || item.bounds.height < screen.height * .95));
  // The simulator's own status bar is never a step, whichever tree reports it.
  const app = visible.filter(item => !systemChrome(item, screen));
  const accessible = app.filter(item => item.source !== "react-native");
  // With no accessibility node under the point — an Android snapshot, a runtime-only tree — the
  // fibers are all there is, and a fiber-named selector is better than a coordinate.
  const hits = (accessible.length ? accessible : app).sort((a, b) => area(a) - area(b) || b.depth - a.depth);
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
  // A React Native leaf often carries nothing addressable — an unlabelled `RCTText`, a bare
  // `View` — while the accessibility node or the Pressable over the same pixels holds the label or
  // the testID. Reading the whole ladder names the thing the user meant rather than giving up on a
  // coordinate. `level` is the user walking outwards: it drops that many innermost elements.
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
    const role = normalizeRole(owner.role);
    const name = elementText(owner);
    if (owner.identifier) candidates.push({ owner, selector: { kind: "testId", testId: owner.identifier } });
    if (role && name) candidates.push({ owner, selector: { kind: "role", role, name } });
    // `getByText` reads text nodes. A control whose accessible name merely contains words — a
    // row, a header, an icon button — is reached by that name, which is `getByLabel`.
    if (name && textual(owner)) candidates.push({ owner, selector: { kind: "text", text: name } });
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
export function anchorSelector(components: ScreenComponent[], point: ScreenPoint, screen?: ScreenSize): RecordedSelector | undefined {
  const distance = (item: ScreenComponent) =>
    Math.hypot(item.bounds.x + item.bounds.width / 2 - point.x, item.bounds.y + item.bounds.height / 2 - point.y);
  // The runner only resolves what accessibility exposes, so a gate is built from that too.
  const accessible = components.filter(item => item.source !== "react-native" && !systemChrome(item, screen));
  for (const item of (accessible.length ? accessible : components).sort((a, b) => distance(a) - distance(b)).slice(0, 40)) {
    if (item.identifier && matchesTestId(components, item.identifier) === 1) return { kind: "testId", testId: item.identifier };
    const text = elementText(item);
    if (!text) continue;
    if (textual(item) && matchesText(components, text) === 1) return { kind: "text", text };
    if (matchesLabel(components, text) === 1) return { kind: "label", label: text };
  }
}

const quote = (value: string) => JSON.stringify(value);

/** The locator expression a step emits, e.g. `screen.getByRole("tab", "Explore")`. */
export function selectorSource(selector: RecordedSelector): string {
  switch (selector.kind) {
    case "testId": return `screen.getByTestId(${quote(selector.testId)})`;
    case "role": return `screen.getByRole(${quote(selector.role)}, ${quote(selector.name)})`;
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
