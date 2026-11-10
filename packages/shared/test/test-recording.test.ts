import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenComponent } from "../src/screen-annotations.ts";
import { agentActSuggestion, agentStepLabel, allStepOffers, ancestorChain, anchorSelector, emitE2eTest, emitE2eTestLines, treeHealth, resolveComponentSelector, resolveSelector, selectorSource, stepLabel, stepOffers, swipeDirection, swipePath, testFileSlug } from "../src/test-recording.ts";
import type { RecordedSelector, RecordedStep, VisionMode } from "../src/test-recording.ts";

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

test("a selector matching two elements is narrowed to the one that was pointed at", () => {
  // Two buttons named "Open": the role selector matches both, and so does every other candidate.
  // A bare selector here is a step that fails with LOCATOR_AMBIGUOUS, so it is narrowed by
  // position instead — the first one, because that is the one under the pointer.
  const components = [
    component({ bounds: TAB, role: "button", label: "Open", nodeId: "a" }),
    component({ bounds: { x: 0, y: 900, width: 100, height: 40 }, role: "button", label: "Open", nodeId: "b" }),
  ];
  const { selector, ambiguous, matches } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "nth", inner: { kind: "role", role: "button", name: "Open" }, index: 0, matches: 2 });
  assert.equal(ambiguous, true, "positional is still less durable than a name, and the panel says so");
  assert.equal(matches, 2);
  assert.equal(selectorSource(selector), 'screen.getByRole("button", "Open").nth(0)');
});

test("the index is the pointed-at element's own, not the first match", () => {
  // The element under the pointer is the *second* match. Assuming the first would record a step
  // that runs and does the wrong thing, which is worse than one that fails.
  const components = [
    component({ bounds: TAB, role: "button", label: "Open", nodeId: "a" }),
    component({ bounds: { x: 0, y: 900, width: 100, height: 40 }, role: "button", label: "Open", nodeId: "b" }),
  ];
  const { selector } = resolveSelector(components, { x: 50, y: 920 });
  assert.deepEqual(selector, { kind: "nth", inner: { kind: "role", role: "button", name: "Open" }, index: 1, matches: 2 });
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

test("two separate elements with the same text are narrowed, not left ambiguous", () => {
  // Innermost-only drops a match that *contains* another. Siblings contain nothing, so both stand
  // and the step is narrowed to the one that was pointed at.
  const components = [
    component({ bounds: TAB, role: "text", label: "Paris", nodeId: "a" }),
    component({ bounds: { x: 0, y: 900, width: 100, height: 40 }, role: "text", label: "Paris", nodeId: "b" }),
  ];
  const resolved = resolveSelector(components, { x: 50, y: 820 });
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolved.matches, 2);
  assert.equal(selectorSource(resolved.selector), 'screen.getByText("Paris").nth(0)');
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

test("the emitter says which lines each step produced, comments and gates included", () => {
  const { source, spans } = emitE2eTestLines([
    { id: "1", kind: "tap", selector: { kind: "role", role: "tab", name: "Explore" }, label: "" },
    { id: "2", kind: "tap", selector: { kind: "text", text: "Open" }, label: "", ambiguous: true },
    { id: "3", kind: "tap", selector: { kind: "point", point: { x: 40, y: 90 } }, label: "", anchor: { kind: "text", text: "Explore Cities" } },
  ], { title: "spans" });
  const lines = source.split("\n");
  // 1-based, as a file's own line numbers are, which is what the runner's report uses.
  for (const span of spans) for (const line of span.calls) assert.match(lines[line - 1], /^  await /);
  assert.deepEqual(spans.map(span => [span.from, span.to]), [[8, 8], [9, 10], [11, 13]]);
  // An ambiguous step is a TODO plus a call; a coordinate tap is a TODO, a wait and a call.
  assert.deepEqual(spans.map(span => span.calls), [[8], [10], [12, 13]]);
  assert.equal(source, emitE2eTest([
    { id: "1", kind: "tap", selector: { kind: "role", role: "tab", name: "Explore" }, label: "" },
    { id: "2", kind: "tap", selector: { kind: "text", text: "Open" }, label: "", ambiguous: true },
    { id: "3", kind: "tap", selector: { kind: "point", point: { x: 40, y: 90 } }, label: "", anchor: { kind: "text", text: "Explore Cities" } },
  ], { title: "spans" }), "one emitter, so the preview and the spans can never describe different files");
});

test("the emitter writes every new step kind as the runner's own API", () => {
  const source = emitE2eTest([
    { id: "1", kind: "longPress", selector: { kind: "text", text: "Paris" }, label: "" },
    { id: "2", kind: "fill", selector: { kind: "placeholder", placeholder: "Search transactions" }, label: "", value: "Paris" },
    { id: "3", kind: "assertText", selector: { kind: "testId", testId: "total" }, label: "", value: "42" },
    { id: "4", kind: "scrollUntilVisible", selector: { kind: "text", text: "Images" }, label: "" },
  ], { title: "every kind" });
  assert.match(source, /await screen\.getByText\("Paris"\)\.longPress\(\);/);
  assert.match(source, /await screen\.getByPlaceholder\("Search transactions"\)\.fill\("Paris"\);/);
  assert.match(source, /await expect\(screen\.getByTestId\("total"\)\)\.toHaveText\("42"\);/);
  assert.match(source, /await screen\.scrollUntilVisible\(screen\.getByText\("Images"\)\);/);
});

test("the element menu offers only what the runner can do with that element", () => {
  const button = component({ bounds: TAB, role: "button", label: "Go To Explore List", text: "Go To Explore List" });
  const rows = stepOffers({ kind: "text", text: "Go To Explore List" }, button);
  // One row per kind of thing to do. Enumerating `longPress` beside `tap`, and `toHaveText` beside
  // `toBeVisible`, made the menu a list of near-duplicates of one selector.
  assert.deepEqual(rows.map(row => row.source), [
    'screen.getByText("Go To Explore List").tap()',
    'expect(screen.getByText("Go To Explore List")).toBeVisible()',
    'screen.scrollUntilVisible(screen.getByText("Go To Explore List"))',
  ]);
  // A button takes no typed text, so there is no `fill` row to get wrong.
  assert.equal(rows.some(row => row.kind === "fill"), false);
  assert.deepEqual(rows.filter(row => row.needsValue).map(row => row.kind), []);
});

test("a text field is offered typing, and a coordinate is offered nothing but the tap", () => {
  const field = component({ bounds: TAB, role: "textbox", placeholder: "Search transactions", value: "Paris" });
  const rows = stepOffers({ kind: "placeholder", placeholder: "Search transactions" }, field);
  const fill = rows.find(row => row.kind === "fill");
  assert.equal(fill?.source, 'screen.getByPlaceholder("Search transactions").fill("Paris")');
  assert.equal(fill?.needsValue, true, "the panel asks for the text rather than typing a guess");
  assert.equal(fill?.suggestedValue, "Paris");
  // A coordinate has no element to be visible, to hold text or to be scrolled to.
  assert.deepEqual(stepOffers({ kind: "point", point: { x: 10, y: 20 } }).map(row => row.kind), ["tap"]);
});

test("the full command list is the rest of the runner's surface, gated on what the element carries", () => {
  const button = component({ bounds: TAB, role: "button", label: "Go To Explore List", text: "Go To Explore List" });
  const rows = allStepOffers({ kind: "text", text: "Go To Explore List" }, button);
  // The short list stays short; this is where a step the runner has but the four rows do not — an
  // element that should be gone, a disabled button — is reachable without leaving the panel.
  // The four swipes are one command offered four ways; the menu gathers them into a single row.
  assert.deepEqual(rows.map(row => row.kind), [
    "tap", "doubleTap", "longPress", "swipe", "swipe", "swipe", "swipe", "scrollUntilVisible",
    "assertVisible", "assertNotVisible", "assertText", "assertContainsText",
    "assertEnabled", "assertDisabled", "assertSelected",
  ]);
  assert.equal(rows.find(row => row.kind === "assertNotVisible")?.source,
    'expect(screen.getByText("Go To Explore List")).not.toBeVisible()');
  assert.equal(rows.find(row => row.kind === "doubleTap")?.source, 'screen.getByText("Go To Explore List").doubleTap()');
  assert.equal(rows.find(row => row.kind === "assertText")?.suggestedValue, "Go To Explore List",
    "a text comparison starts from the text the element actually has");
  // A button has no value to fill or to compare against, and the checked matchers are left out
  // because whether a device reports a `checked` state at all depends on the platform.
  assert.equal(rows.some(row => row.kind === "fill" || row.kind === "assertValue"), false);
  assert.equal(rows.some(row => String(row.kind).includes("Checked")), false);

  const field = component({ bounds: TAB, role: "textbox", placeholder: "Search transactions", value: "Paris" });
  const fieldRows = allStepOffers({ kind: "placeholder", placeholder: "Search transactions" }, field);
  assert.equal(fieldRows.find(row => row.kind === "assertValue")?.source,
    'expect(screen.getByPlaceholder("Search transactions")).toHaveValue("Paris")');
  assert.equal(fieldRows.find(row => row.kind === "assertValue")?.needsValue, true);
  // A coordinate names no element, so nothing that is about one is offered for it — but it does
  // have a viewport, and `screen.swipe` is about the viewport rather than about anything in it.
  assert.deepEqual(allStepOffers({ kind: "point", point: { x: 10, y: 20 } }).map(row => row.kind),
    ["tap", "swipe", "swipe", "swipe", "swipe"]);
});

test("new step kinds read back to the user with the value they carry", () => {
  assert.equal(stepLabel("fill", { kind: "placeholder", placeholder: "Search" }, "Paris"), 'Type into "Search" → "Paris"');
  assert.equal(stepLabel("longPress", { kind: "text", text: "Paris" }), 'Long press "Paris"');
  assert.equal(stepLabel("scrollUntilVisible", { kind: "text", text: "Images" }), 'Scroll to "Images"');
});

test("a unique candidate beats an ambiguous preferred one, for this element or an enclosing one", () => {
  // The tab bar's Settings tab, as the runner reports it: a `tab` role with a name, inside a
  // tablist, beside a heading that carries the same text. Captured from the live screen.
  const heading = component({ bounds: { x: 140, y: 188, width: 121, height: 44 }, role: "text", label: "Settings", text: "Settings", nodeId: "n3" });
  const echoed = { ...heading, nodeId: "n4", parentId: "n3" };
  const tab = component({ bounds: { x: 240, y: 795, width: 94, height: 54 }, role: "tab", label: "Settings", text: "Settings", nodeId: "n13", parentId: "n10" });
  const components = [heading, echoed, tab];

  // On the tab, `getByText("Settings")` matches two and `getByRole("tab", "Settings")` matches one.
  // Role is the earlier rank *and* the unique one, so the ambiguity never reaches the file.
  const onTab = resolveSelector(components, { x: 287, y: 820 }, SCREEN);
  assert.deepEqual(onTab.selector, { kind: "role", role: "tab", name: "Settings" });
  assert.equal(onTab.ambiguous, false);
  assert.equal(onTab.matches, 1);
});

test("an element the runner cannot name uniquely is flagged with the count, not a verdict", () => {
  // The same screen's heading. Its role is `text`, which `getByRole` does not accept, and the only
  // thing left — its text — is shared with the tab. The tree gives the two no distinguishing
  // ancestor either, so there is no scoped selector to fall back to: a testID is the way out.
  const heading = component({ bounds: { x: 140, y: 188, width: 121, height: 44 }, role: "text", label: "Settings", text: "Settings", nodeId: "n3", parentId: "n2" });
  const echoed = { ...heading, nodeId: "n4", parentId: "n3" };
  const tab = component({ bounds: { x: 240, y: 795, width: 94, height: 54 }, role: "tab", label: "Settings", text: "Settings", nodeId: "n13", parentId: "n10" });

  const resolved = resolveSelector([heading, echoed, tab], { x: 200, y: 210 }, SCREEN);

  // `getByText("Settings")` matches the heading and the tab, in that order, and the heading is the
  // one that was pointed at. `.nth(0)` runs on the device where the bare selector fails with
  // LOCATOR_AMBIGUOUS, which is the difference between a recorded test and a recorded chore.
  assert.deepEqual(resolved.selector, { kind: "nth", inner: { kind: "text", text: "Settings" }, index: 0, matches: 2 });
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolved.matches, 2, "the count is what a user can act on");
  assert.equal(selectorSource(resolved.selector), 'screen.getByText("Settings").nth(0)');

  // The tab, the second match, records the second index — from the resolved node, not an assumption.
  const onTab = resolveSelector([heading, echoed, tab], { x: 287, y: 820 }, SCREEN);
  assert.deepEqual(onTab.selector, { kind: "role", role: "tab", name: "Settings" }, "the tab has a unique name of its own");
});

test("a narrowed step emits a note that it runs, and names the durable fix", () => {
  const source = emitE2eTest([
    { id: "1", kind: "assertVisible", label: "", ambiguous: true,
      selector: { kind: "nth", inner: { kind: "text", text: "Settings" }, index: 0, matches: 2 } },
  ], { title: "narrowed" });
  assert.match(source, /await expect\(screen\.getByText\("Settings"\)\.nth\(0\)\)\.toBeVisible\(\);/);
  // A note, not a TODO: nothing has to be edited for the test to work.
  assert.match(source, /\/\/ 2 elements match this selector; this is the one that was recorded\. A testID would pin it by name\./);
  assert.doesNotMatch(source, /TODO/);
});

test("a narrowed selector still reads back, and still supports every step", () => {
  const selector = { kind: "nth" as const, inner: { kind: "text" as const, text: "Settings" }, index: 1, matches: 2 };
  assert.equal(stepLabel("tap", selector), 'Tap "Settings" (2 of 2)');
  // The narrowing is on the locator, so every action and matcher chains after it.
  assert.deepEqual(stepOffers(selector, component({ bounds: TAB, role: "text", label: "Settings", text: "Settings" })).map(row => row.source), [
    'screen.getByText("Settings").nth(1).tap()',
    'expect(screen.getByText("Settings").nth(1)).toBeVisible()',
    'screen.scrollUntilVisible(screen.getByText("Settings").nth(1))',
  ]);
});

test("an agentic step emits the agent call and nothing about a locator", () => {
  const source = emitE2eTest([
    { id: "1", kind: "agentAct", instruction: 'tap the "Explore" tab', label: "" },
    { id: "2", kind: "agentAssert", instruction: "the city list is showing", label: "" },
  ], { title: "the agent explores" });
  assert.match(source, /await agent\.act\("tap the \\"Explore\\" tab"\);/);
  // `vision` defaults to false, so an assert that wants the default writes no options object.
  assert.match(source, /await agent\.assert\("the city list is showing"\);/);
  // There is no locator to be ambiguous, to narrow by position or to gate behind an anchor.
  assert.doesNotMatch(source, /TODO/);
  assert.doesNotMatch(source, /screen\./);
});

test("an agentic assertion emits the vision mode only when it is not the default", () => {
  const emit = (vision?: VisionMode) => emitE2eTest(
    [{ id: "1", kind: "agentAssert", instruction: "the badge is red", label: "", ...(vision === undefined ? {} : { vision }) }],
    { title: "vision" });
  assert.match(emit(), /agent\.assert\("the badge is red"\);/);
  assert.match(emit(false), /agent\.assert\("the badge is red"\);/);
  assert.match(emit(true), /agent\.assert\("the badge is red", \{ vision: true \}\);/);
  assert.match(emit("only"), /agent\.assert\("the badge is red", \{ vision: "only" \}\);/);
});

test("the agent fixture and the header comment follow the steps", () => {
  const pinned: RecordedStep[] = [{ id: "1", kind: "tap", selector: { kind: "text", text: "Explore" }, label: "" }];
  const mixed: RecordedStep[] = [...pinned, { id: "2", kind: "agentAct", instruction: "scroll to the bottom", label: "" }];
  // A recording with no agentic step emits byte for byte what it always did.
  const before = emitE2eTest(pinned, { title: "t" });
  assert.match(before, /test\("t", async \(\{ app, screen \}\) => \{/);
  assert.match(before, /Every step is a pinned locator, driven by no agent\./);
  const after = emitE2eTest(mixed, { title: "t" });
  assert.match(after, /test\("t", async \(\{ agent, app, screen \}\) => \{/);
  assert.match(after, /Pinned locators where an element was named, and agent steps where it was described\./);
  assert.doesNotMatch(after, /driven by no agent/);
});

test("an agent step reads as its instruction and the element only drafts one", () => {
  assert.equal(agentStepLabel("agentAct", "tap the cart"), 'Agent "tap the cart"');
  assert.equal(agentStepLabel("agentAssert", "the cart is empty"), 'Agent check "the cart is empty"');
  // The suggestion is a typing shortcut written out of what the element carried; it is never the
  // step, and an element with nothing to call it hands the user a blank field rather than a guess.
  assert.equal(agentActSuggestion({ label: "Explore", role: "tab" }), 'tap the "Explore" tab');
  assert.equal(agentActSuggestion({ text: "Submit" }), 'tap "Submit"');
  // `other` is not a role `getByRole` accepts, so it is not a word to call the element by either.
  assert.equal(agentActSuggestion({ label: "Submit", role: "other" }), 'tap "Submit"');
  assert.equal(agentActSuggestion({ role: "button" }), "");
  assert.equal(agentActSuggestion(), "");
});

test("act params are emitted as literals, and as nothing at all when there are none", () => {
  const act = (params?: Record<string, string>) => emitE2eTest(
    [{ id: "1", kind: "agentAct", instruction: "sign in", label: "", ...(params ? { params } : {}) }],
    { title: "params" });
  // The whole options object is omitted when there is nothing to put in it, so the line a
  // recording without params emits is the line it emitted before params existed.
  assert.match(act(), /await agent\.act\("sign in"\);/);
  assert.match(act({}), /await agent\.act\("sign in"\);/);
  // A row the user started and never named is not a param.
  assert.match(act({ "  ": "orphan" }), /await agent\.act\("sign in"\);/);

  // The text is the type: what parses as a number or a keyword is written as one.
  assert.match(act({ email: "a@b.com", attempts: "3", retry: "false", note: "null" }),
    /agent\.act\("sign in", \{ params: \{ email: "a@b\.com", attempts: 3, retry: false, note: null \} \}\);/);
  assert.match(act({ n: "-2.5e3" }), /params: \{ n: -2\.5e3 \}/);
  // Surrounding whitespace is not part of a number, and is kept where it is part of a string.
  assert.match(act({ n: "  7  " }), /params: \{ n: 7 \}/);
  assert.match(act({ s: " hi " }), /params: \{ s: " hi " \}/);
  // Everything `Number()` would take and JSON would not stays a string, so the file says what the
  // user typed rather than a different number or an identifier.
  for (const value of ["0x10", "1_000", "Infinity", "NaN", "+1", "01", ""]) {
    assert.match(act({ v: value }), new RegExp(`params: \\{ v: ${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\}`),
      `${JSON.stringify(value)} is not a JSON number`);
  }
  // A key an object literal cannot take bare is quoted rather than mangled.
  assert.match(act({ "user-id": "7" }), /params: \{ "user-id": 7 \}/);
});

test("only act carries params, and only assert carries vision", () => {
  const source = emitE2eTest([
    { id: "1", kind: "agentAct", instruction: "sign in", label: "", params: { email: "a@b.com" } },
    { id: "2", kind: "agentAssert", instruction: "the dashboard is showing", label: "", vision: true },
  ], { title: "both" });
  assert.match(source, /agent\.act\("sign in", \{ params: \{ email: "a@b\.com" \} \}\);/);
  assert.match(source, /agent\.assert\("the dashboard is showing", \{ vision: true \}\);/);
  assert.doesNotMatch(source, /act\([^)]*vision/);
  assert.doesNotMatch(source, /assert\([^)]*params/);
});

test("waitFor judges like assert and takes the same vision", () => {
  const emit = (vision?: VisionMode) => emitE2eTest(
    [{ id: "1", kind: "agentWaitFor", instruction: "the spinner is gone", label: "", ...(vision === undefined ? {} : { vision }) }],
    { title: "wait" });
  assert.match(emit(), /await agent\.waitFor\("the spinner is gone"\);/);
  assert.match(emit(false), /await agent\.waitFor\("the spinner is gone"\);/);
  assert.match(emit(true), /await agent\.waitFor\("the spinner is gone", \{ vision: true \}\);/);
  assert.match(emit("only"), /await agent\.waitFor\("the spinner is gone", \{ vision: "only" \}\);/);
  // `interval` and `maxModelCalls` are budgets the panel never writes, so neither reaches the file.
  assert.doesNotMatch(emit(true), /interval|maxModelCalls|timeout/);
  // It is an agent step like the others, so it flips the fixtures and the header comment.
  assert.match(emit(), /test\("wait", async \(\{ agent, app, screen \}\) => \{/);
  assert.match(emit(), /Pinned locators where an element was named/);
  assert.doesNotMatch(emit(), /TODO|screen\.getBy/);
});

test("a swipe is scoped to the element it names, or to the viewport when nothing is named", () => {
  const swipe = (selector: RecordedSelector, direction?: "up" | "down" | "left" | "right") => emitE2eTest(
    [{ id: "1", kind: "swipe", selector, label: "", ...(direction ? { direction } : {}) }], { title: "s" });
  for (const direction of ["up", "down", "left", "right"] as const) {
    assert.match(swipe({ kind: "testId", testId: "carousel" }, direction),
      new RegExp(`await screen\\.getByTestId\\("carousel"\\)\\.swipe\\(\\{ direction: "${direction}" \\}\\);`));
    assert.match(swipe({ kind: "point", point: { x: 4, y: 8 } }, direction),
      new RegExp(`await screen\\.swipe\\(\\{ direction: "${direction}" \\}\\);`));
  }
  // `momentum` defaults to `none` and how hard a flick was thrown is not something the panel can
  // observe, so `direction` is the whole of the options object.
  assert.doesNotMatch(swipe({ kind: "text", text: "Cards" }, "left"), /momentum/);
  // A viewport swipe needs no element, so it is emitted rather than skipped. It keeps the wait
  // every point step carries — it is as actionable as a tap and would fire into a splash screen —
  // but not the TODO, which is about a coordinate breaking on a layout change and names no
  // coordinate here.
  const viewport = emitE2eTest([{
    id: "1", kind: "swipe", selector: { kind: "point", point: { x: 4, y: 8 } }, label: "",
    direction: "down", anchor: { kind: "text", text: "Explore" },
  }], { title: "s" });
  assert.doesNotMatch(viewport, /TODO/);
  assert.match(viewport, /await expect\(screen\.getByText\("Explore"\)\)\.toBeVisible\(\);\n\s+await screen\.swipe\(\{ direction: "down" \}\);/);
  assert.doesNotMatch(viewport, /Skipped a step on a point/);
});

test("the swipe rows are one command offered four ways, on an element and on a bare point", () => {
  const named = allStepOffers({ kind: "testId", testId: "carousel" }).filter(offer => offer.kind === "swipe");
  assert.deepEqual(named.map(offer => offer.suggestedValue), ["up", "down", "left", "right"]);
  assert.equal(named[0].source, 'screen.getByTestId("carousel").swipe({ direction: "up" })');
  // Choosing a direction records the step at once; it is a choice from four, not text to supply.
  assert.ok(named.every(offer => offer.needsValue === undefined));
  const point = allStepOffers({ kind: "point", point: { x: 4, y: 8 } });
  assert.deepEqual(point.map(offer => offer.kind), ["tap", "swipe", "swipe", "swipe", "swipe"]);
  assert.equal(point[1].source, 'screen.swipe({ direction: "up" })');
});

test("a swipe step says which way it went", () => {
  assert.equal(stepLabel("swipe", { kind: "role", role: "list", name: "Cards" }, "left"), 'Swipe left on "Cards" (list)');
  assert.equal(stepLabel("swipe", { kind: "point", point: { x: 4, y: 8 } }, "down"), "Swipe down (viewport)");
  assert.equal(stepLabel("swipe", { kind: "testId", testId: "c" }), "Swipe up on #c", "the direction the menu lists first");
});

test("an element names itself the same way a tap on it would", () => {
  // The two entry points are one ranking. A point reaches the chain by hit-testing, an agent
  // reaches it by walking `parentId` up, and both then run `resolveChain` — which is what keeps an
  // agent-recorded step and a hand-recorded step the same step.
  const components = [
    component({ bounds: TAB, role: "tablist", label: "Tab Bar", nodeId: "bar" }),
    component({ bounds: { x: 0, y: 800, width: 50, height: 40 }, role: "tab", label: "Explore", nodeId: "tab", parentId: "bar" }),
  ];
  const byPoint = resolveSelector(components, { x: 20, y: 820 }, SCREEN);
  const byElement = resolveComponentSelector(components, components[1]);
  assert.deepEqual(byPoint.selector, { kind: "role", role: "tab", name: "Explore" });
  assert.deepEqual(byElement?.selector, byPoint.selector);
  assert.equal(byElement?.component, components[1]);
});

test("an element whose own node carries nothing is named by what encloses it", () => {
  // The same depth-first rule the ladder follows: the innermost element that can be named at all
  // wins, and a bare container falls through to its parent rather than to nothing.
  const components = [
    component({ bounds: TAB, identifier: "SubmitButton", nodeId: "button" }),
    component({ bounds: TAB, role: "other", nodeId: "icon", parentId: "button" }),
  ];
  assert.deepEqual(resolveComponentSelector(components, components[1])?.selector, { kind: "testId", testId: "SubmitButton" });
});

test("an element nothing can name resolves to nothing rather than to a coordinate", () => {
  // The one place the two entry points differ, and deliberately: a tap has a coordinate to fall
  // back on, while a `ref` does not — recording `screen.tapAt` from an element an agent named
  // would be a worse step than the `agent.act` sentence it writes instead.
  const components = [component({ bounds: TAB, role: "other", nodeId: "blank" })];
  assert.equal(resolveComponentSelector(components, components[0]), undefined);
  assert.deepEqual(resolveSelector(components, { x: 50, y: 820 }).selector, { kind: "point", point: { x: 50, y: 820 } });
});

test("the ancestor chain is innermost first and survives a broken parent link", () => {
  const components = [
    component({ bounds: TAB, label: "Card", nodeId: "card" }),
    component({ bounds: TAB, label: "Row", nodeId: "row", parentId: "card" }),
    component({ bounds: TAB, label: "Orphan", nodeId: "orphan", parentId: "gone" }),
  ];
  assert.deepEqual(ancestorChain(components, components[1]).map(item => item.nodeId), ["row", "card"]);
  assert.deepEqual(ancestorChain(components, components[2]).map(item => item.nodeId), ["orphan"]);
});

test("a swipe is drawn well inside the box, so the OS does not read it as an edge gesture", () => {
  // Both drivers take a recorded swipe — the panel through the mirror's stream, the server through
  // agent-device — so the arithmetic is shared rather than written twice.
  const path = swipePath({ x: 0, y: 0, width: 400, height: 800 }, "up");
  assert.deepEqual(path, { from: { x: 200, y: 680 }, to: { x: 200, y: 120 } });
  assert.deepEqual(swipePath({ x: 0, y: 0, width: 400, height: 800 }, "right"),
    { from: { x: 60, y: 400 }, to: { x: 340, y: 400 } });
  assert.equal(swipeDirection("sideways"), "up", "an unknown direction is the one the menu lists first");
  assert.equal(swipeDirection("left"), "left");
});

test("the screen's own root is never what names an element", () => {
  // The point path never reaches it, because the hit ladder drops anything spanning the screen.
  // Without the same rule on the element path, every unnameable element on an app whose root
  // carries a title resolved to that title — `screen.getByText("expoapp57")` for a scroll bar,
  // reported as unique.
  const components = [
    component({ bounds: { x: 0, y: 0, ...SCREEN }, label: "expoapp57", role: "application", nodeId: "root" }),
    component({ bounds: TAB, role: "other", nodeId: "scrollbar", parentId: "root", label: "" }),
  ];
  assert.equal(resolveComponentSelector(components, components[1], SCREEN), undefined);
  assert.equal(resolveComponentSelector(components, components[0], SCREEN), undefined);
  // Without a screen size there is nothing to compare against, so the rule cannot apply.
  assert.deepEqual(resolveComponentSelector(components, components[1])?.selector, { kind: "text", text: "expoapp57" });
});

test("a viewport swipe carries no coordinate, so it carries no coordinate TODO", () => {
  // `screen.swipe({ direction })` names no point: there is nothing to break on a layout change
  // and nothing to wait for. The TODO and the anchor gate are about a coordinate *tap*.
  const step: RecordedStep = {
    id: "s", kind: "swipe", label: "Swipe up (viewport)", direction: "up",
    selector: { kind: "point", point: { x: 0, y: 0 } },
  };
  const { source } = emitE2eTestLines([step], { title: "t" });
  assert.match(source, /await screen\.swipe\(\{ direction: "up" \}\);/);
  assert.doesNotMatch(source, /TODO/);
  // A coordinate *tap* still says what it is.
  const tap: RecordedStep = { id: "s", kind: "tap", label: "Tap at 0, 0", selector: { kind: "point", point: { x: 0, y: 0 } } };
  assert.match(emitE2eTest([tap], { title: "t" }), /TODO: nothing resolved here/);
});

test("the screen's own root is never the thing a coordinate step waits for", () => {
  // It is the nearest element to any point and it names nothing:
  // `expect(screen.getByText("<the app>")).toBeVisible()` waits for the application to exist,
  // which it did before the test started.
  const components = [
    component({ bounds: { x: 0, y: 0, ...SCREEN }, label: "expoapp57", role: "application", nodeId: "root" }),
    component({ bounds: { x: 100, y: 400, width: 80, height: 40 }, label: "Paris", role: "text", nodeId: "paris" }),
  ];
  assert.deepEqual(anchorSelector(components, { x: 201, y: 437 }, SCREEN), { kind: "text", text: "Paris" });
});
