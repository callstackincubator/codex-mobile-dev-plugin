import test from "node:test";
import assert from "node:assert/strict";
import type { ScreenComponent } from "../src/screen-annotations.ts";
import { emitE2eTest, normalizeRole, resolveSelector, selectorSource, stepLabel, testFileSlug } from "../src/test-recording.ts";

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

test("text is used when an element has no role", () => {
  const components = [component({ bounds: TAB, label: "GET STARTED" })];
  const { selector } = resolveSelector(components, { x: 50, y: 820 });
  assert.deepEqual(selector, { kind: "text", text: "GET STARTED" });
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
