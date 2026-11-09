import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenComponent } from "../src/screen-annotations.ts";
import { anchorSelector, emitE2eTest, treeHealth, resolveSelector, selectorSource, stepLabel, testFileSlug } from "../src/test-recording.ts";

/**
 * One element as the recorder reads it: the e2e runner's own projected node, where `role` is the
 * runner's role, `label` its accessible *name*, and `text` the element's own text. Every fixture
 * below was captured from a running simulator through the same path the recorder uses, so a test
 * that passes here is a locator the runner resolves the same way.
 */
function component(fields: Partial<ScreenComponent> & { bounds: ScreenComponent["bounds"] }): ScreenComponent {
  return { name: fields.label ?? "Element", depth: 1, source: "accessibility", nodeId: fields.identifier ?? fields.label ?? "node", ...fields };
}

const TAB = { x: 0, y: 800, width: 100, height: 40 };
const SCREEN = { width: 402, height: 874 };

test("a testID wins over the role and the text", () => {
  const components = [component({ bounds: TAB, identifier: "ExploreTab", role: "button", label: "Explore", text: "Explore" })];
  const { selector, ambiguous } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "testId", testId: "ExploreTab" });
  assert.equal(ambiguous, false);
  assert.equal(selectorSource(selector), 'screen.getByTestId("ExploreTab")');
});

test("without a testID the role and the accessible name are used", () => {
  const components = [component({ bounds: TAB, role: "button", label: "Explore" })];
  const { selector } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "role", role: "button", name: "Explore" });
  assert.equal(selectorSource(selector), 'screen.getByRole("button", "Explore")');
});

test("the runner's role is emitted verbatim, with no table in between", () => {
  // The engine already mapped the platform's element type onto its role vocabulary when it
  // projected the snapshot, and it is the only thing that gets a say: a second mapping here is
  // what made `getByRole("link", …)` and `getByRole("rcttext", …)` reach the file.
  for (const role of ["tab", "textbox", "listitem", "navigation", "progressbar", "switch", "heading"]) {
    const components = [component({ bounds: TAB, role, label: "Thing" })];
    assert.deepEqual(resolveSelector(components, { x: 50, y: 820 }).selector, { kind: "role", role, name: "Thing" });
  }
});

test("a role getByRole does not accept falls through to the text rank, never renamed", () => {
  // The engine keeps an element type it has no role for as the type itself (`other`,
  // `application`), and `getByRole`'s union is closed, so querying one would not compile. The
  // element is named by what it says instead — it is never quietly called something else.
  for (const role of ["other", "text", "application", "web-view"]) {
    const components = [component({ bounds: TAB, role, label: "Thing", text: "Thing" })];
    assert.deepEqual(resolveSelector(components, { x: 50, y: 820 }).selector, { kind: "text", text: "Thing" });
  }
});

test("a selector matching two elements falls through to the next rank", () => {
  // Two buttons named "Open": the role selector would match both, the name is the same, so the
  // step is kept but flagged rather than emitted as a silent coin flip.
  const components = [
    component({ bounds: TAB, role: "button", label: "Open", nodeId: "a" }),
    component({ bounds: { x: 0, y: 900, width: 100, height: 40 }, role: "button", label: "Open", nodeId: "b" }),
  ];
  const { selector, ambiguous } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "role", role: "button", name: "Open" });
  assert.equal(ambiguous, true);
});

test("a tap on nothing records a coordinate", () => {
  const { selector, ambiguous } = resolveSelector([], { x: 12.4, y: 20.6 });
  assert.deepEqual(selector, { kind: "point", point: { x: 12.4, y: 20.6 } });
  assert.equal(ambiguous, false);
  assert.equal(selectorSource(selector), "screen.tapAt({ x: 12, y: 21 })");
});

test("a hidden node is not a match for a role query", () => {
  // The runner skips `visibleToUser: false` for a role query, so counting it here would flag a
  // step the runner resolves uniquely.
  const components = [
    component({ bounds: TAB, role: "button", label: "Open", nodeId: "shown" }),
    component({ bounds: { x: 0, y: 900, width: 100, height: 40 }, role: "button", label: "Open", nodeId: "gone", hidden: true }),
  ];
  const { selector, ambiguous } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "role", role: "button", name: "Open" });
  assert.equal(ambiguous, false);
});

// A search field on the explore-list screen, exactly as the runner reports it: a `TextField`
// projected to `textbox`, carrying its placeholder and **no name at all**.
const SEARCH_FIELD = component({
  bounds: { x: 24, y: 476, width: 354, height: 35 },
  role: "textbox", placeholder: "Search transactions", value: "Search transactions", nodeId: "search",
});

test("a field whose only text is its placeholder is named by the placeholder", () => {
  // Reading iOS accessibility offered the placeholder as the element's name, so the recorder
  // emitted `getByRole("textbox", "Search transactions")` — which matches nothing, because the
  // runner reads the name from the label and this field has none. A role query with no name is
  // not a candidate at all, and the placeholder is.
  const { selector, ambiguous } = resolveSelector([SEARCH_FIELD], { x: 200, y: 490 });
  assert.deepEqual(selector, { kind: "placeholder", placeholder: "Search transactions" });
  assert.equal(ambiguous, false);
  assert.equal(selectorSource(selector), 'screen.getByPlaceholder("Search transactions")');
  assert.equal(stepLabel("tap", selector), 'Tap "Search transactions"');
});

test("a placeholder is only reached for when the element has a name of its own", () => {
  const named = component({ ...SEARCH_FIELD, role: "textbox", label: "Search", placeholder: "Search transactions" });
  assert.deepEqual(resolveSelector([named], { x: 200, y: 490 }).selector, { kind: "role", role: "textbox", name: "Search" });
});

test("text echoed by a parent onto its child is one match, not two", () => {
  // A device tree echoes text upwards: iOS reports a React Native `Text` host view and the
  // `StaticText` inside it with the same label. The runner answers `getByText` with the innermost
  // match only, so a recorder that counts both puts a "matched more than one element" TODO on a
  // line that works.
  const components = [
    component({ bounds: { x: 24, y: 140, width: 354, height: 44 }, role: "text", label: "Explore Cities", text: "Explore Cities", nodeId: "outer" }),
    component({ bounds: { x: 24, y: 140, width: 354, height: 44 }, role: "text", label: "Explore Cities", text: "Explore Cities", nodeId: "inner", parentId: "outer" }),
  ];
  const { selector, ambiguous } = resolveSelector(components, { x: 100, y: 160 });
  assert.deepEqual(selector, { kind: "text", text: "Explore Cities" });
  assert.equal(ambiguous, false);
  assert.equal(selectorSource(selector), 'screen.getByText("Explore Cities")');
});

test("two separate elements with the same text are still ambiguous", () => {
  // Innermost-only drops a match that *contains* another. Siblings contain nothing, so the count
  // stands and the step is flagged, which is the honest answer.
  const components = [
    component({ bounds: TAB, role: "text", label: "Paris", nodeId: "a" }),
    component({ bounds: { x: 0, y: 900, width: 100, height: 40 }, role: "text", label: "Paris", nodeId: "b" }),
  ];
  assert.equal(resolveSelector(components, { x: 50, y: 820 }).ambiguous, true);
});

test("the emitted test is deterministic and imports the e2e API", () => {
  const source = emitE2eTest([
    { id: "1", kind: "tap", selector: { kind: "role", role: "tab", name: "Explore" }, label: "" },
    { id: "2", kind: "assertVisible", selector: { kind: "text", text: "Go To Explore List" }, label: "" },
    { id: "3", kind: "tap", selector: { kind: "placeholder", placeholder: "Search transactions" }, label: "" },
  ], { title: "the explore tab opens" });
  assert.match(source, /import \{ test \} from "@e2e-dev\/mobile";/);
  assert.match(source, /test\("the explore tab opens", async \(\{ app, screen \}\) => \{/);
  assert.match(source, /await screen\.getByRole\("tab", "Explore"\)\.tap\(\);/);
  assert.match(source, /await expect\(screen\.getByText\("Go To Explore List"\)\)\.toBeVisible\(\);/);
  assert.match(source, /await screen\.getByPlaceholder\("Search transactions"\)\.tap\(\);/);
  assert.doesNotMatch(source, /agent\.act/);
});

test("an unreliable step carries a TODO into the file", () => {
  const source = emitE2eTest([
    { id: "1", kind: "tap", selector: { kind: "role", role: "button", name: "Open" }, label: "", ambiguous: true },
    { id: "2", kind: "tap", selector: { kind: "point", point: { x: 4, y: 8 } }, label: "" },
  ], { title: "t" });
  assert.match(source, /TODO: this matched more than one element/);
  assert.match(source, /TODO: nothing resolved here/);
  assert.match(source, /await screen\.tapAt\(\{ x: 4, y: 8 \}\);/);
});

test("an empty recording still emits a runnable test", () => {
  const source = emitE2eTest([], { title: "nothing yet" });
  assert.match(source, /await app\.open\(\);/);
  assert.match(source, /Tap the mirror to record steps/);
});

test("step labels and file names read back to the user", () => {
  assert.equal(stepLabel("tap", { kind: "role", role: "tab", name: "Home" }), 'Tap "Home" (tab)');
  assert.equal(stepLabel("assertVisible", { kind: "testId", testId: "Back" }), "Expect visible #Back");
  assert.equal(testFileSlug("The tab bar works!"), "the-tab-bar-works");
  assert.equal(testFileSlug("***"), "recorded");
});

test("an enclosing element names a tap its own leaf cannot", () => {
  // Tapping inside a row: the leaf carries nothing, the row carries the testID.
  const components = [
    component({ bounds: TAB, role: "other", identifier: "explore-tab", nodeId: "parent" }),
    component({ bounds: { x: 10, y: 810, width: 80, height: 20 }, role: "other", nodeId: "leaf", parentId: "parent" }),
  ];
  const { selector, ambiguous, component: owner } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "testId", testId: "explore-tab" });
  assert.equal(ambiguous, false);
  // The outline follows the element the selector names, not the one under the pointer.
  assert.equal(owner?.nodeId, "parent");
});

test("walking out picks the enclosing element instead of the one under the pointer", () => {
  const components = [
    component({ bounds: { x: 0, y: 100, width: 300, height: 80 }, identifier: "card", role: "button", label: "Open city", nodeId: "card" }),
    component({ bounds: { x: 10, y: 110, width: 100, height: 20 }, role: "text", label: "Paris", nodeId: "label", parentId: "card" }),
  ];
  const inner = resolveSelector(components, { x: 50, y: 120 });
  assert.deepEqual(inner.selector, { kind: "text", text: "Paris" });
  assert.equal(inner.levels, 2);

  const outer = resolveSelector(components, { x: 50, y: 120 }, undefined, 1);
  assert.deepEqual(outer.selector, { kind: "testId", testId: "card" });
  // Past the last level the outermost element is kept rather than falling to a coordinate.
  assert.deepEqual(resolveSelector(components, { x: 50, y: 120 }, undefined, 9).selector, outer.selector);
});

test("a coordinate tap waits for the screen before it fires", () => {
  // A locator action waits for its element; `tapAt` does not, so the first step of a recording
  // used to fire during the splash.
  const components = [component({ bounds: { x: 0, y: 0, width: 200, height: 40 }, role: "text", label: "Welcome" })];
  const anchor = anchorSelector(components, { x: 100, y: 300 });
  assert.deepEqual(anchor, { kind: "text", text: "Welcome" });

  const source = emitE2eTest([
    { id: "1", kind: "tap", selector: { kind: "point", point: { x: 100, y: 300 } }, label: "", anchor },
  ], { title: "t" });
  const gate = source.indexOf('await expect(screen.getByText("Welcome")).toBeVisible();');
  assert.ok(gate > 0, "the gate must be emitted");
  assert.ok(gate < source.indexOf("screen.tapAt"), "the gate must come before the tap it guards");
});

test("an anchor is only offered when it names exactly one element", () => {
  const twice = [
    component({ bounds: { x: 0, y: 0, width: 50, height: 20 }, role: "text", label: "Open", nodeId: "a" }),
    component({ bounds: { x: 0, y: 40, width: 50, height: 20 }, role: "text", label: "Open", nodeId: "b" }),
  ];
  assert.equal(anchorSelector(twice, { x: 500, y: 500 }), undefined);
});

test("an icon-only control is named by the one piece of text inside it", () => {
  // The container carries nothing, the word is in a sibling of the icon, and the tap landed on
  // the icon. Tapping the text lands inside the same control.
  const components = [
    component({ bounds: TAB, role: "other", nodeId: "tab" }),
    component({ bounds: { x: 30, y: 805, width: 24, height: 24 }, role: "image", nodeId: "icon", parentId: "tab" }),
    component({ bounds: { x: 10, y: 830, width: 80, height: 10 }, role: "text", label: "Explore", nodeId: "label", parentId: "tab" }),
  ];
  // The point is on the icon, not on the word.
  const { selector, ambiguous } = resolveSelector(components, { x: 40, y: 810 });
  assert.deepEqual(selector, { kind: "label", label: "Explore" });
  assert.equal(ambiguous, false);
});

test("a control holding two texts is left unnamed rather than guessed at", () => {
  const components = [
    component({ bounds: TAB, role: "other", nodeId: "row" }),
    component({ bounds: { x: 10, y: 805, width: 40, height: 10 }, role: "text", label: "Paris", nodeId: "a", parentId: "row" }),
    component({ bounds: { x: 10, y: 820, width: 40, height: 10 }, role: "text", label: "France", nodeId: "b", parentId: "row" }),
  ];
  assert.equal(resolveSelector(components, { x: 70, y: 810 }).selector.kind, "point");
});

test("an accessible name is matched with the whitespace the runner normalizes away", () => {
  const wrapped = [component({ bounds: TAB, role: "text", label: "This starter app includes example\ncode to help you get started." })];
  assert.deepEqual(resolveSelector(wrapped, { x: 50, y: 820 }).selector, {
    kind: "text", text: "This starter app includes example code to help you get started.",
  });
});

/**
 * The home screen of the Expo app under test, captured from the runner's own snapshot
 * (`capture.snapshot({ interactiveOnly: false })` projected by `@e2e-dev/mobile`).
 *
 * Two things in it are the whole point of reading this tree. The tab bar's items arrive with role
 * `tab` — the engine derives that from the tab bar around them, where iOS accessibility calls
 * them radio buttons and a table here had to guess. And every piece of text is reported twice,
 * parent and child, which the runner resolves innermost-first.
 */
const HOME_SCREEN = [
  component({ bounds: { x: 24, y: 300, width: 354, height: 30 }, role: "text", label: "GET STARTED", text: "GET STARTED", nodeId: "n4" }),
  component({ bounds: { x: 24, y: 300, width: 354, height: 30 }, role: "text", label: "GET STARTED", text: "GET STARTED", nodeId: "n5", parentId: "n4" }),
  component({ bounds: { x: 0, y: 790, width: 402, height: 84 }, role: "tablist", label: "Tab Bar", text: "Tab Bar", nodeId: "n18" }),
  component({ bounds: { x: 20, y: 795, width: 94, height: 54 }, role: "tab", label: "Home", text: "Home", nodeId: "n19", parentId: "n18" }),
  component({ bounds: { x: 154, y: 795, width: 94, height: 54 }, role: "tab", label: "Explore", text: "Explore", nodeId: "n20", parentId: "n18" }),
  component({ bounds: { x: 288, y: 795, width: 94, height: 54 }, role: "tab", label: "Settings", text: "Settings", nodeId: "n21", parentId: "n18" }),
];

test("a tab bar item records as a tab, because that is the role the runner gave it", () => {
  const { selector, ambiguous } = resolveSelector(HOME_SCREEN, { x: 200, y: 820 }, SCREEN);
  assert.deepEqual(selector, { kind: "role", role: "tab", name: "Explore" });
  assert.equal(ambiguous, false);
  assert.equal(selectorSource(selector), 'screen.getByRole("tab", "Explore")');
});

test("text repeated by its own parent resolves without a TODO", () => {
  const { selector, ambiguous } = resolveSelector(HOME_SCREEN, { x: 100, y: 310 }, SCREEN);
  assert.deepEqual(selector, { kind: "text", text: "GET STARTED" });
  assert.equal(ambiguous, false);
});

/**
 * The explore-list screen, captured the same way. This is the flow that failed: the heading, the
 * navigation bar carrying the only testID on screen, and the search field with a placeholder and
 * no name.
 */
const EXPLORE_LIST_SCREEN = [
  component({ bounds: { x: 0, y: 62, width: 402, height: 54 }, role: "navigation", identifier: "explore-list", nodeId: "n2" }),
  component({ bounds: { x: 16, y: 62, width: 98, height: 44 }, role: "button", identifier: "BackButton", label: "(tabs)", text: "(tabs)", nodeId: "n3", parentId: "n2" }),
  component({ bounds: { x: 24, y: 140, width: 354, height: 44 }, role: "text", label: "Explore Cities", text: "Explore Cities", nodeId: "n5" }),
  component({ bounds: { x: 24, y: 200, width: 354, height: 46 }, role: "other", label: "NewYork City", text: "NewYork City", nodeId: "n6" }),
  SEARCH_FIELD,
];

test("the recorded explore-list flow names every element the way the runner resolves it", () => {
  const heading = resolveSelector(EXPLORE_LIST_SCREEN, { x: 100, y: 160 }, SCREEN);
  assert.deepEqual(heading.selector, { kind: "text", text: "Explore Cities" });
  assert.equal(heading.ambiguous, false, "the heading must not carry a TODO");

  const search = resolveSelector(EXPLORE_LIST_SCREEN, { x: 200, y: 490 }, SCREEN);
  assert.deepEqual(search.selector, { kind: "placeholder", placeholder: "Search transactions" });

  const back = resolveSelector(EXPLORE_LIST_SCREEN, { x: 50, y: 80 }, SCREEN);
  assert.deepEqual(back.selector, { kind: "testId", testId: "BackButton" });

  // An element the engine left as `other` has no role `getByRole` accepts, so it is named by what
  // it says rather than by a role that would not compile.
  const city = resolveSelector(EXPLORE_LIST_SCREEN, { x: 100, y: 220 }, SCREEN);
  assert.deepEqual(city.selector, { kind: "text", text: "NewYork City" });
});

test("the emitted explore-list test carries no link role and no TODO", () => {
  const source = emitE2eTest([
    { id: "1", kind: "tap", selector: { kind: "role", role: "tab", name: "Explore" }, label: "" },
    { id: "2", kind: "tap", selector: { kind: "text", text: "Go To Explore List" }, label: "" },
    { id: "3", kind: "assertVisible", selector: { kind: "text", text: "Explore Cities" }, label: "" },
    { id: "4", kind: "tap", selector: { kind: "placeholder", placeholder: "Search transactions" }, label: "" },
  ], { title: "the explore list opens" });
  assert.match(source, /await screen\.getByPlaceholder\("Search transactions"\)\.tap\(\);/);
  assert.match(source, /await expect\(screen\.getByText\("Explore Cities"\)\)\.toBeVisible\(\);/);
  assert.doesNotMatch(source, /getByRole\("link"/);
  assert.doesNotMatch(source, /TODO/);
});

test("an empty tree is reported rather than worked around", () => {
  // The runner's snapshot is rooted at the application, so the simulator's own status bar is not
  // in it and there is no "only the chrome" state left to detect. Nothing at all still is one.
  assert.equal(treeHealth(EXPLORE_LIST_SCREEN), "ok");
  assert.equal(treeHealth([]), "no-accessibility");
});
