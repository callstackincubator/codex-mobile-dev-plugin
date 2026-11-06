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
  const text = (component.label ?? component.value ?? "").trim();
  return text && text !== (component.role ?? "").trim() ? text : "";
}

function matchesTestId(components: ScreenComponent[], testId: string): number {
  return components.filter(item => item.identifier === testId).length;
}

function matchesRole(components: ScreenComponent[], role: string, name: string): number {
  return components.filter(item => normalizeRole(item.role) === role && elementText(item) === name).length;
}

function matchesText(components: ScreenComponent[], text: string): number {
  return components.filter(item => elementText(item) === text).length;
}

export type ResolvedSelector = { selector: RecordedSelector; ambiguous: boolean; component?: ScreenComponent };

/**
 * Turns a point on the screen into the selector a test should use.
 *
 * The hit test is the same one the annotation overlay uses, so what the recorder names is what the
 * user sees highlighted. Uniqueness is checked against the whole tree: a selector that would match
 * two elements is not pinned, it is a flake, so the next rank is tried. If every rank is ambiguous
 * the best one is kept and flagged rather than silently emitting a selector that may hit the wrong
 * element.
 */
export function resolveSelector(components: ScreenComponent[], point: ScreenPoint, screen?: ScreenSize): ResolvedSelector {
  // The hit chain is the element under the point and the elements enclosing it, innermost first.
  // A React Native leaf often carries nothing addressable — an unlabelled `RCTText`, a bare
  // `View` — while the Pressable around it holds the testID. Walking outwards names the thing the
  // user meant rather than giving up on a coordinate.
  const chain = componentsAt(components, point, screen);
  const component = chain[0];
  if (!component) return { selector: { kind: "point", point }, ambiguous: false };

  // Only the named ranks; the point fallback is not a candidate, it is what is left when these fail.
  // Rank by kind first and only then by depth: a testID is put there on purpose and survives a
  // copy change, so an enclosing element's testID beats the tapped element's own text.
  type Candidate = { selector: Exclude<RecordedSelector, { kind: "point" }>; owner: ScreenComponent };
  const testIds: Candidate[] = [], roles: Candidate[] = [], texts: Candidate[] = [];
  for (const owner of chain.slice(0, 6)) {
    const role = normalizeRole(owner.role);
    const text = elementText(owner);
    if (owner.identifier) testIds.push({ owner, selector: { kind: "testId", testId: owner.identifier } });
    if (role && text) roles.push({ owner, selector: { kind: "role", role, name: text } });
    if (text) texts.push({ owner, selector: { kind: "text", text } });
  }
  const candidates = [...testIds, ...roles, ...texts];

  for (const { selector, owner } of candidates) {
    const matches = selector.kind === "testId" ? matchesTestId(components, selector.testId)
      : selector.kind === "role" ? matchesRole(components, selector.role, selector.name)
        : matchesText(components, selector.text);
    if (matches === 1) return { selector, ambiguous: false, component: owner };
  }
  // Nothing was unique. The best-ranked candidate still describes the element better than a
  // coordinate does, so it is kept and flagged; with no candidate at all, the point is all there is.
  const fallback = candidates[0];
  return fallback
    ? { selector: fallback.selector, ambiguous: true, component: fallback.owner }
    : { selector: { kind: "point", point }, ambiguous: false, component };
}

const quote = (value: string) => JSON.stringify(value);

/** The locator expression a step emits, e.g. `screen.getByRole("tab", "Explore")`. */
export function selectorSource(selector: RecordedSelector): string {
  switch (selector.kind) {
    case "testId": return `screen.getByTestId(${quote(selector.testId)})`;
    case "role": return `screen.getByRole(${quote(selector.role)}, ${quote(selector.name)})`;
    case "text": return `screen.getByText(${quote(selector.text)})`;
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
