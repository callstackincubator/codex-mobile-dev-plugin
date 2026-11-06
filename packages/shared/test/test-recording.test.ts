import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenComponent } from "../src/screen-annotations.ts";
import { anchorSelector, emitE2eTest, treeHealth, normalizeRole, resolveSelector, selectorSource, stepLabel, testFileSlug } from "../src/test-recording.ts";

function component(fields: Partial<ScreenComponent> & { bounds: ScreenComponent["bounds"] }): ScreenComponent {
  return { name: fields.label ?? "Element", depth: 1, source: "accessibility", nodeId: fields.identifier ?? fields.label ?? "node", ...fields };
}

const TAB = { x: 0, y: 800, width: 100, height: 40 };

test("a testID wins over the role and the text", () => {
  const components = [component({ bounds: TAB, identifier: "ExploreTab", role: "AXButton", label: "Explore" })];
  const { selector, ambiguous } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "testId", testId: "ExploreTab" });
  assert.equal(ambiguous, false);
  assert.equal(selectorSource(selector), 'screen.getByTestId("ExploreTab")');
});

test("without a testID the role and the accessible name are used", () => {
  const components = [component({ bounds: TAB, role: "AXButton", label: "Explore" })];
  const { selector } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "role", role: "button", name: "Explore" });
  assert.equal(selectorSource(selector), 'screen.getByRole("button", "Explore")');
});

test("a selector matching two elements falls through to the next rank", () => {
  // Two buttons labelled "Open": the role selector would match both, the text is the same, so the
  // step is kept but flagged rather than emitted as a silent coin flip.
  const components = [
    component({ bounds: TAB, role: "AXButton", label: "Open", nodeId: "a" }),
    component({ bounds: { x: 0, y: 900, width: 100, height: 40 }, role: "AXButton", label: "Open", nodeId: "b" }),
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

test("getByText names a text element and getByLabel names everything else", () => {
  // `getByText` searches text nodes. A control whose accessible name merely contains words — a
  // row, an icon button, a collapsible header — is reached by that name instead.
  const control = [component({ bounds: TAB, label: "GET STARTED" })];
  assert.deepEqual(resolveSelector(control, { x: 50, y: 820 }).selector, { kind: "label", label: "GET STARTED" });

  const text = [component({ bounds: TAB, role: "AXStaticText", label: "GET STARTED" })];
  assert.deepEqual(resolveSelector(text, { x: 50, y: 820 }).selector, { kind: "text", text: "GET STARTED" });
});

test("roles are normalized across the platforms' spellings", () => {
  assert.equal(normalizeRole("AXButton"), "button");
  assert.equal(normalizeRole("XCUIElementTypeButton"), "button");
  assert.equal(normalizeRole("android.widget.Button"), "button");
  assert.equal(normalizeRole(undefined), "");
});

test("the emitted test is deterministic and imports the e2e API", () => {
  const source = emitE2eTest([
    { id: "1", kind: "tap", selector: { kind: "role", role: "tab", name: "Explore" }, label: "" },
    { id: "2", kind: "assertVisible", selector: { kind: "text", text: "Go To Explore List" }, label: "" },
  ], { title: "the explore tab opens" });
  assert.match(source, /import \{ test \} from "@e2e-dev\/mobile";/);
  assert.match(source, /test\("the explore tab opens", async \(\{ app, screen \}\) => \{/);
  assert.match(source, /await screen\.getByRole\("tab", "Explore"\)\.tap\(\);/);
  assert.match(source, /await expect\(screen\.getByText\("Go To Explore List"\)\)\.toBeVisible\(\);/);
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

test("a platform role the runner does not have resolves to no role at all", () => {
  // The runner's role union is closed, so `getByRole("rcttext", …)` is a type error in the file
  // rather than a query that merely misses. React Native reports the component name as the role.
  assert.equal(normalizeRole("RCTText"), "");
  assert.equal(normalizeRole("AXStaticText"), "");
  assert.equal(normalizeRole("RCTImageView"), "image");
  assert.equal(normalizeRole("RCTSinglelineTextInputView"), "textbox");
  // iOS accessibility reports a tab bar item as a radio button.
  assert.equal(normalizeRole("AXRadioButton"), "tab");
});

test("a text element is named by its text rather than by an invented role", () => {
  const components = [component({ bounds: TAB, source: "react-native", role: "RCTText", label: "File-based routing" })];
  const { selector } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "text", text: "File-based routing" });
  assert.equal(selectorSource(selector), 'screen.getByText("File-based routing")');
});

test("a React Native label that is only the component name is not text to pin to", () => {
  // The inspector falls back to the component name when an element has no label, which produced
  // `getByRole("rcttext", "RCTText")` — a name that is nowhere on screen.
  const components = [component({ bounds: TAB, source: "react-native", role: "RCTText", label: "RCTText" })];
  const { selector } = resolveSelector(components, { x: 50, y: 820 });
  assert.equal(selector.kind, "point");
});

test("an enclosing element names a tap its own leaf cannot", () => {
  // Tapping the label inside a Pressable: the leaf carries nothing, the parent carries the testID.
  const components = [
    component({ bounds: TAB, source: "react-native", role: "Pressable", identifier: "explore-tab", nodeId: "parent" }),
    component({ bounds: { x: 10, y: 810, width: 80, height: 20 }, source: "react-native", role: "RCTView", nodeId: "leaf", parentId: "parent" }),
  ];
  const { selector, ambiguous, component: owner } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "testId", testId: "explore-tab" });
  assert.equal(ambiguous, false);
  // The outline follows the element the selector names, not the one under the pointer.
  assert.equal(owner?.nodeId, "parent");
});

// The inspection merges two unrelated trees over the same pixels: React Native fibers, where a
// tab bar item is an unaddressable `Pressable`, and iOS accessibility, where the same pixels are
// an `AXRadioButton` labelled "Explore".
const TAB_BAR_ITEM = [
  component({ bounds: TAB, source: "react-native", role: "Pressable", label: "Pressable", nodeId: "rn-tab" }),
  component({ bounds: { x: 10, y: 805, width: 80, height: 30 }, source: "react-native", role: "RCTView", label: "RCTView", nodeId: "rn-inner", parentId: "rn-tab" }),
  component({ bounds: TAB, source: "accessibility", role: "AXRadioButton", label: "Explore", nodeId: "ax-tab" }),
];

test("an element is named from either tree over the point, not just the one branch", () => {
  const { selector, ambiguous } = resolveSelector(TAB_BAR_ITEM, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "role", role: "tab", name: "Explore" });
  assert.equal(ambiguous, false);
});

test("walking out picks the enclosing element instead of the one under the pointer", () => {
  const components = [
    component({ bounds: { x: 0, y: 100, width: 300, height: 80 }, identifier: "card", role: "AXButton", label: "Open city", nodeId: "card" }),
    component({ bounds: { x: 10, y: 110, width: 100, height: 20 }, role: "AXStaticText", label: "Paris", nodeId: "label", parentId: "card" }),
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
  const components = [component({ bounds: { x: 0, y: 0, width: 200, height: 40 }, role: "AXStaticText", label: "Welcome" })];
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
    component({ bounds: { x: 0, y: 0, width: 50, height: 20 }, role: "AXStaticText", label: "Open", nodeId: "a" }),
    component({ bounds: { x: 0, y: 40, width: 50, height: 20 }, role: "AXStaticText", label: "Open", nodeId: "b" }),
  ];
  assert.equal(anchorSelector(twice, { x: 500, y: 500 }), undefined);
});

test("an icon-only control is named by the one piece of text inside it", () => {
  // A tab bar item: the Pressable carries nothing, the word is in a sibling of the icon, and the
  // tap landed on the icon. iOS accessibility does not cover React Native views, so there is no
  // second tree to fall back on.
  const components = [
    component({ bounds: TAB, role: "AXGroup", nodeId: "tab" }),
    component({ bounds: { x: 30, y: 805, width: 24, height: 24 }, role: "AXImage", nodeId: "icon", parentId: "tab" }),
    component({ bounds: { x: 10, y: 830, width: 80, height: 10 }, role: "AXStaticText", label: "Explore", nodeId: "label", parentId: "tab" }),
  ];
  // The point is on the icon, not on the word.
  const { selector, ambiguous } = resolveSelector(components, { x: 40, y: 810 });
  assert.deepEqual(selector, { kind: "label", label: "Explore" });
  assert.equal(ambiguous, false);
});

test("a control holding two texts is left unnamed rather than guessed at", () => {
  const components = [
    component({ bounds: TAB, role: "AXGroup", nodeId: "row" }),
    component({ bounds: { x: 10, y: 805, width: 40, height: 10 }, role: "AXStaticText", label: "Paris", nodeId: "a", parentId: "row" }),
    component({ bounds: { x: 10, y: 820, width: 40, height: 10 }, role: "AXStaticText", label: "France", nodeId: "b", parentId: "row" }),
  ];
  assert.equal(resolveSelector(components, { x: 70, y: 810 }).selector.kind, "point");
});

// The Explore screen of a stock Expo app, as the device's accessibility tree reports it beside
// the React Native fibers over the same pixels. The two disagree, and only the first is what the
// runner queries: `screen.getByText("File-based routing")` finds nothing on this screen.
const EXPLORE_SCREEN = [
  // The collapsible header: one element whose name folds in the chevron's.
  component({ bounds: { x: 16, y: 600, width: 370, height: 30 }, role: "AXGenericElement", label: "Forward, File-based routing", nodeId: "ax-row" }),
  component({ bounds: { x: 16, y: 600, width: 370, height: 30 }, source: "react-native", role: "Pressable", label: "Pressable", nodeId: "rn-row" }),
  component({ bounds: { x: 44, y: 606, width: 200, height: 18 }, source: "react-native", role: "RCTText", label: "File-based routing", nodeId: "rn-text", parentId: "rn-row" }),
  // The tab bar.
  component({ bounds: { x: 150, y: 800, width: 100, height: 50 }, role: "AXRadioButton", label: "Explore", nodeId: "ax-tab" }),
  component({ bounds: { x: 150, y: 800, width: 100, height: 50 }, source: "react-native", role: "Pressable", label: "Pressable", nodeId: "rn-tab" }),
];

test("a selector names what the runner can see, not what the fibers show", () => {
  // Tapping the words "File-based routing": the fibers offer that exact string, and a test built
  // on it fails with LOCATOR_NOT_FOUND because accessibility folds the row into one element.
  const { selector, ambiguous } = resolveSelector(EXPLORE_SCREEN, { x: 100, y: 612 });
  assert.deepEqual(selector, { kind: "label", label: "Forward, File-based routing" });
  assert.equal(ambiguous, false);
  assert.equal(selectorSource(selector), 'screen.getByLabel("Forward, File-based routing")');
});

test("a tab bar item is a tab, and the fibers over it are not offered instead", () => {
  const { selector } = resolveSelector(EXPLORE_SCREEN, { x: 197, y: 816 });
  assert.deepEqual(selector, { kind: "role", role: "tab", name: "Explore" });
});

test("the fibers still answer where accessibility has nothing at the point", () => {
  // An Android snapshot, or a runtime-only tree: a fiber-named selector beats a coordinate.
  const fibersOnly = [component({ bounds: TAB, source: "react-native", role: "RCTText", label: "Paris", nodeId: "rn" })];
  assert.deepEqual(resolveSelector(fibersOnly, { x: 50, y: 820 }).selector, { kind: "text", text: "Paris" });
});

test("an accessible name is matched with the whitespace the runner normalizes away", () => {
  const wrapped = [component({ bounds: TAB, role: "AXStaticText", label: "This starter app includes example\ncode to help you get started." })];
  assert.deepEqual(resolveSelector(wrapped, { x: 50, y: 820 }).selector, {
    kind: "text", text: "This starter app includes example code to help you get started.",
  });
});

// The simulator's own status bar, which the device reports alongside the app's tree. Frames are
// the real ones from a booted iPhone 17 Pro.
const STATUS_BAR = [
  component({ bounds: { x: 55.3, y: 22.3, width: 37.3, height: 20.3 }, role: "AXStaticText", label: "6:02 PM", nodeId: "clock" }),
  component({ bounds: { x: 138.3, y: 14, width: 125.3, height: 36.7 }, role: "AXGenericElement", label: "Dynamic Island, Empty", nodeId: "island" }),
  component({ bounds: { x: 339.3, y: 26, width: 27.3, height: 13 }, role: "AXGenericElement", label: "100% battery power", nodeId: "battery" }),
];
const SCREEN = { width: 402, height: 874 };

test("the simulator's status bar is never what a step names", () => {
  // The runner queries the app, not the screen, so "Dynamic Island, Empty" is not a step and not
  // a wait either — it was being chosen as both.
  const components = [...STATUS_BAR, component({ bounds: { x: 154, y: 795, width: 94, height: 54 }, role: "AXRadioButton", label: "Explore", nodeId: "tab" })];
  assert.equal(resolveSelector(components, { x: 200, y: 30 }, SCREEN).selector.kind, "point");
  assert.deepEqual(anchorSelector(components, { x: 200, y: 30 }, SCREEN), { kind: "label", label: "Explore" });
});

test("a tree holding only the status bar is reported rather than worked around", () => {
  // It comes back this way sometimes. The fibers still describe the screen, so resolution would
  // quietly fall back to them and emit selectors the runner cannot resolve.
  const fibers = [component({ bounds: { x: 24, y: 484, width: 354, height: 24 }, source: "react-native", role: "RCTText", label: "File-based routing", nodeId: "rn" })];
  assert.equal(treeHealth([...STATUS_BAR, ...fibers], SCREEN), "chrome-only");
  assert.equal(treeHealth([...STATUS_BAR, component({ bounds: { x: 154, y: 795, width: 94, height: 54 }, role: "AXRadioButton", label: "Explore" })], SCREEN), "ok");
  // Android and runtime-only trees have no accessibility nodes at all; the fibers are all there is.
  assert.equal(treeHealth(fibers, SCREEN), "no-accessibility");
});
