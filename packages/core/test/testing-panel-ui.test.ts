import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderEnvironment } from "./jsdom-env.ts";

const SCREEN = { width: 402, height: 874 };
const VIEWPORT = { x: 10, y: 20, width: 300, height: 650, stageWidth: 320, stageHeight: 700 };
// `useSyncExternalStore` compares snapshots by identity, so these are values, not fresh objects.
const ANNOTATIONS_SNAPSHOT = { viewport: VIEWPORT };
const DEVICE_SNAPSHOT = { device: { udid: "udid", name: "iPhone 17 Pro", state: "Booted", platform: "ios", kind: "simulator" } };

/** One element as the e2e runner reports it: its own role, its accessible name in `label`. */
const button = {
  name: "Go To Explore List", label: "Go To Explore List", text: "Go To Explore List",
  role: "button", depth: 1, source: "accessibility" as const, nodeId: "cta",
  bounds: { x: 100, y: 400, width: 200, height: 44 },
};

test("the element menu renders the runner's own steps over the mirror and records the one chosen", async t => {
  const { module: { TestRecorderOverlay, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestRecorderOverlay } from "./packages/ui/src/components/test-recorder-overlay.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "recorder-overlay",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const listeners = new Set<() => void>();
  const annotations = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => ANNOTATIONS_SNAPSHOT,
  };
  testRecorder.attach("udid", "ios", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid", "ios");

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestRecorderOverlay, { store: annotations })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const menu = () => dom.window.document.querySelector("[data-element=recorder-menu]");
  const rows = () => [...dom.window.document.querySelectorAll("[data-recorder-offer]")] as HTMLButtonElement[];

  await act(async () => { await testRecorder.openMenu({ x: 150, y: 420 }); });
  assert.ok(menu(), "the right-click opens the menu over the outline");
  // The selector is named once and rows stay compact; exact code is still available as a tooltip.
  assert.match(menu()?.textContent ?? "", /Selected element"Go To Explore List" \(button\)/);
  assert.deepEqual(rows().map(row => row.textContent), [
    "Tap",
    "Check visibility",
    "Scroll into view",
  ]);
  assert.equal(rows().some(row => row.querySelector(".lucide-chevron-right")), false,
    "an action row records a step, so it does not imply a submenu");
  // The rows that lead somewhere are the ones carrying a chevron: the rest of the runner's
  // surface, and the branch that describes a step instead of pinning one.
  assert.deepEqual([...menu()!.querySelectorAll("[data-recorder-panel]")].map(row => (row as HTMLElement).dataset.recorderPanel),
    ["commands", "agentic"]);
  assert.ok(rows().every(row => row.className.includes("hover:bg-accent")), "every action has a visible hover state");
  assert.ok(menu()?.className.includes("cursor-pointer"), "popover buttons use a pointer cursor");
  assert.equal(rows()[0].title, 'screen.getByRole("button", "Go To Explore List").tap()');
  // The menu is placed against the window, not inside the stage: the stage clips what it holds,
  // and a menu cut off at the bottom of a short panel is worse than one lying over the mirror.
  const box = menu() as HTMLElement;
  assert.equal(box.parentElement, dom.window.document.body, "it is a portal, so nothing can clip it");
  assert.ok(box.className.includes("fixed"), "it is placed against the window, not inside the stage");
  const width = Math.max(180, Math.min(280, dom.window.innerWidth - 16));
  assert.equal(box.style.width, `${width}px`);
  // The element's own left edge in window coordinates, pushed in from the window's edge if needed.
  const left = 10 + 100 / 402 * 300;
  assert.equal(box.style.left, `${Math.max(8, Math.min(left, dom.window.innerWidth - width - 8))}px`);
  // Below the element, since this window has room for it there.
  const bottom = 20 + (400 + 44) / 874 * 650;
  assert.equal(box.style.top, `${bottom + 6}px`);
  assert.equal(box.style.visibility, "visible", "it is shown only once it has been measured");

  await act(async () => { rows().find(row => row.dataset.recorderOffer === "assertVisible")!.click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(menu(), null, "choosing a row closes the menu");
  assert.deepEqual(testRecorder.getSnapshot().steps.map((step: any) => step.kind), ["assertVisible"]);
  assert.match(testRecorder.source, /await expect\(screen\.getByRole\("button", "Go To Explore List"\)\)\.toBeVisible\(\);/);

  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

test("a row that needs a value asks for it instead of emitting an empty string", async t => {
  const { module: { TestRecorderOverlay, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestRecorderOverlay } from "./packages/ui/src/components/test-recorder-overlay.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "recorder-fill-row",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const field = {
    name: "Search transactions", placeholder: "Search transactions", value: "Paris", role: "textbox",
    depth: 1, source: "accessibility" as const, nodeId: "field", bounds: { x: 100, y: 400, width: 200, height: 44 },
  };
  const annotations = { subscribe: () => () => undefined, getSnapshot: () => ANNOTATIONS_SNAPSHOT };
  const done: unknown[] = [];
  testRecorder.attach("udid", "ios", {
    readComponents: async () => [field], screen: () => SCREEN, release: () => undefined,
    perform: (action: unknown) => { done.push(action); },
  });
  testRecorder.start("udid", "ios");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestRecorderOverlay, { store: annotations })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const rows = () => [...dom.window.document.querySelectorAll("[data-recorder-offer]")] as HTMLButtonElement[];

  await act(async () => { await testRecorder.openMenu({ x: 150, y: 420 }); });
  // A field is the one element that gains a fourth row, because it is the one that takes text.
  assert.deepEqual(rows().map(row => row.dataset.recorderOffer), ["tap", "fill", "assertVisible", "scrollUntilVisible"]);
  await act(async () => { rows().find(row => row.dataset.recorderOffer === "fill")!.click(); });
  const input = dom.window.document.querySelector('[aria-label="Text to enter"]') as HTMLInputElement;
  assert.equal(input.value, "Paris", "it starts from the field's own value");
  assert.equal(rows().length, 0, "the rows give way to the question");
  await act(async () => { input.value = "Berlin"; });
  await act(async () => { (dom.window.document.querySelector("[data-element=recorder-menu] form") as HTMLFormElement).requestSubmit(); });
  await act(async () => { await Promise.resolve(); });
  assert.match(testRecorder.source, /await screen\.getByPlaceholder\("Search transactions"\)\.fill\("Berlin"\);/);
  // Typing is taken as well as recorded: the field is tapped to focus it, then the text is sent.
  assert.deepEqual(done, [{ kind: "tap", point: { x: 200, y: 422 } }, { kind: "type", text: "Berlin" }]);

  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

test("a run marks the preview line by line, and marks nothing it was not told about", async t => {
  const { module: { TestingView, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestingView } from "./packages/ui/src/components/testing-view.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "testing-view",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const panelListeners = new Set<() => void>();
  let panelState: Record<string, unknown> = {
    open: true, available: true, projectPath: "/app", projects: [], targets: [{ name: "ios", platform: "ios", bundleId: "com.app" }],
    targetName: "ios", configPath: "/app/e2e.config.ts", loadingProject: false, pickingProject: false, launching: false,
    appLaunched: true, fileName: "flow", saving: false, overwritePath: "", savedRevision: -1, savedPath: "", running: false,
    pendingRun: false, drafts: [], draftId: "", loadingDraft: false, tests: [], deletingTest: "", error: null,
  };
  /** What Run was asked for, so Play until here can be told apart from the Run test button. */
  const runs: unknown[] = [];
  const panel = {
    subscribe: (listener: () => void) => { panelListeners.add(listener); return () => { panelListeners.delete(listener); }; },
    getSnapshot: () => panelState,
    canLaunch: true, canRun: true, dirty: true,
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {},
    launchApp: async () => {}, saveTest: async () => {}, runTest: async (options?: unknown) => { runs.push(options); }, selectTarget: () => {},
    setFileName: () => {}, cancelOverwrite: () => {}, dismissError: () => {},
    refreshDrafts: async () => {}, openDraft: async () => {}, deleteDraft: async () => {}, newRecording: async () => {},
    refreshTests: async () => {}, deleteTest: async () => {},
  };
  const deviceApps = {
    subscribe: () => () => undefined,
    getSnapshot: () => DEVICE_SNAPSHOT,
  };

  testRecorder.attach("udid", "ios", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid", "ios");
  await testRecorder.openMenu({ x: 150, y: 420 });
  await testRecorder.chooseOffer("tap");

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestingView, { panel, deviceApps })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const marks = () => [...dom.window.document.querySelectorAll("[data-testing-preview] .testing-run-mark")]
    .map(mark => mark.className.replace("testing-run-mark", "").trim());
  const preview = () => (dom.window.document.querySelector("[data-testing-preview]") as HTMLElement).innerText
    ?? dom.window.document.querySelector("[data-testing-preview]")!.textContent!;

  assert.equal(dom.window.document.querySelector("[aria-label=Testing] dl"), null,
    "project, config, target, bundle and device metadata no longer duplicate the controls");
  const testing = dom.window.document.querySelector("[aria-label=Testing]");
  assert.ok(testing?.className.includes("cursor-pointer"), "testing panel buttons use a pointer cursor");
  // The title and file name fields are folded into Test Description: they are touched once per
  // recording, at the end, while the step list beside them is touched on every tap.
  assert.equal(dom.window.document.querySelector("[data-testing-title]"), null,
    "the naming fields start folded away");
  const description = dom.window.document.querySelector("[data-testing-description-toggle]") as HTMLButtonElement;
  assert.equal(description.getAttribute("aria-expanded"), "false");
  assert.match(description.textContent ?? "", /Test Description/);
  await act(async () => { description.click(); });
  assert.ok(dom.window.document.querySelector("[data-testing-title]"), "opening it shows the title field");
  assert.ok(dom.window.document.querySelector("[data-testing-filename]"), "and the file name field");
  assert.ok(dom.window.document.querySelector("[data-testing-description]")?.contains(
    dom.window.document.querySelector("[data-testing-save]")), "Save moves inside the section with them");
  // Closed, the row reads as the name the flow will be saved under, clipped at a width of its own
  // so it degrades the same way wherever the pane ends. The file name is not beside it: at the
  // width this pane gets, a name and a path together were two truncated strings reading as neither,
  // and the path is in the File name field a click below.
  const readout = dom.window.document.querySelector("[data-testing-description-title]") as HTMLElement;
  assert.ok(readout, "the name is the header's readout");
  assert.ok(readout.className.includes("max-w-[24ch]"), "it has a text width of its own");
  assert.ok(readout.className.includes("truncate"), "and clips rather than wrapping");
  assert.equal(readout.title, "a recorded flow", "with the whole value as a tooltip");
  assert.equal(dom.window.document.querySelector("[data-testing-description-file]"), null,
    "the file name is not duplicated in the header");
  assert.doesNotMatch(description.textContent ?? "", /tests\//, "nor is the path, under any other name");
  assert.ok(!dom.window.document.querySelector("[data-testing-title]")?.closest(".grid")?.className.includes("bg-card"),
    "title and file fields have no card fill");
  assert.ok([...dom.window.document.querySelectorAll("[data-testing-step]")]
    .every(step => !step.className.includes("bg-card")), "step rows have no card fill");
  // The preview and the steps are dragged apart rather than fixed at 3fr/2fr, so the group is a
  // resizable one with a handle between its two panes.
  const workspace = dom.window.document.querySelector("[data-testing-recorder-workspace]")!;
  const panes = [...workspace.children].filter(child => child.getAttribute("data-slot") === "resizable-panel");
  assert.deepEqual(panes.map(pane => pane.id), ["testing-preview-resizable", "testing-steps-resizable"],
    "the preview stays to the left of the test editor");
  assert.ok(panes[0].querySelector("[data-testing-preview-pane]"));
  assert.ok(panes[1].querySelector("[data-testing-editor-pane]"));
  assert.ok(workspace.querySelector("[data-slot=resizable-handle]"), "and they can be dragged apart");
  assert.match(workspace.textContent ?? "", /Preview.*Test Description.*Steps/s,
    "the recorder is organized around preview, naming and steps");
  await act(async () => { description.click(); });
  const header = dom.window.document.querySelector("[aria-label=Testing] > header")!;
  assert.ok(header.contains(dom.window.document.querySelector("[data-testing-controls]")),
    "record and run controls share the project and launch bar");

  // One step, one call line: line 8 of the emitted file, which is where the report will point.
  const spans = testRecorder.emitted.spans;
  assert.deepEqual(spans.map((span: any) => span.calls), [[8]]);
  const lines = testRecorder.source.split("\n");
  assert.match(lines[7], /await screen\.getByRole\("button", "Go To Explore List"\)\.tap\(\);/);

  const step = dom.window.document.querySelector("[data-testing-step]")!;
  await act(async () => { step.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
  assert.ok(dom.window.document.querySelector('[data-testing-preview-line="8"]')?.classList.contains("is-step-highlighted"),
    "hovering a step highlights the line it emits");
  await act(async () => { step.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })); });
  assert.equal(dom.window.document.querySelector(".testing-preview-line.is-step-highlighted"), null,
    "the emitted line returns to normal when the step is no longer hovered");

  // The gutter is a column of its own, not a character at the front of the line: that is what keeps
  // the code still when a run starts and keeps a mark level with a line that wraps. The line number
  // is a third column in front of it, for the same reason and read the same way.
  const line = dom.window.document.querySelector("[data-testing-preview] .testing-preview-line")!;
  assert.deepEqual([...line.children].map(child => child.className.split(" ")[0]),
    ["testing-preview-number", "testing-run-mark", "testing-preview-code"],
    "the number, the mark and the code are siblings, in that order");
  assert.deepEqual([...dom.window.document.querySelectorAll("[data-testing-preview] .testing-preview-number")]
    .slice(0, 3).map(number => number.textContent), ["1", "2", "3"], "numbered from the file's own first line");

  // Play until here: the gutter's other occupant, on the lines a step emitted and nowhere else.
  const plays = () => [...dom.window.document.querySelectorAll("[data-testing-preview] .testing-play-until")]
    .map(play => play.getAttribute("data-testing-play-until"));
  assert.deepEqual(plays(), ["6", "8"],
    "the step's own line offers to run the flow up to it, and so does the app.open above it");
  // A play beside a comment would promise a line the runner never executes, and the gutter marks
  // only the awaited calls, so the two have to be the same set of lines.
  assert.deepEqual(plays().map(at => lines[Number(at) - 1].trim().startsWith("//")), [false, false],
    "a comment is not somewhere a run can stop");
  assert.deepEqual(plays(), testRecorder.emitted.calls.map(String),
    "exactly the lines the runner reports a step for");
  const play = dom.window.document.querySelector('[data-testing-preview-line="8"] .testing-play-until') as HTMLButtonElement;
  assert.ok(line.querySelector(".testing-play-until") === null, "and it is not on the import at the top of the file");
  // The app opening is where a flow most often breaks, and it is the one call the header holds.
  const opening = dom.window.document.querySelector('[data-testing-preview-line="6"] .testing-play-until') as HTMLButtonElement;
  assert.match(opening.getAttribute("aria-label") ?? "", /^Run the test up to the app opening, line 6$/);
  await act(async () => { opening.click(); });
  assert.deepEqual(runs, [{ untilStepId: "app:open" }], "that run opens the app and does nothing else");
  runs.length = 0;
  assert.match(play.getAttribute("aria-label") ?? "", /^Run the test up to .*, line 8$/,
    "the gutter's mark is decoration, but this is a control and says what it does");
  await act(async () => { play.click(); });
  assert.deepEqual(runs, [{ untilStepId: testRecorder.getSnapshot().steps[0].id }],
    "clicking it runs the flow as far as that step, not the whole file");

  await act(async () => { testRecorder.beginRun(); });
  assert.deepEqual(plays(), [], "the gutter is the run's own while it is in flight, so no play hides a spinner");
  assert.deepEqual(marks().filter(mark => mark !== ""), [], "nothing is marked until the runner says where it is");
  await act(async () => { testRecorder.applyRunProgress([{ stepIndex: 1, phase: "start" }]); });
  assert.equal(marks().filter(mark => mark === "is-running").length, 1, "one line spins: the one the runner is on");
  assert.equal(marks()[7], "is-running", "and it is the line the step emitted");

  await act(async () => { testRecorder.finishRun({ status: "passed", steps: [{ line: 8, status: "passed" }] }); });
  assert.equal(marks()[7], "is-passed");
  assert.match(dom.window.document.body.textContent ?? "", /Passed/);

  await act(async () => { testRecorder.finishRun({ status: "failed", steps: [{ line: 8, status: "failed", error: "Timed out waiting for the element" }] }); });
  assert.equal(marks()[7], "is-failed", "a failure stays on the line the report blames");
  assert.match(dom.window.document.body.textContent ?? "", /Timed out waiting for the element/);

  // A run that produced no report has no line to mark, so the runner's own words stand in.
  await act(async () => { testRecorder.finishRun({ status: "failed", steps: [], output: "No tests matched" }); });
  assert.deepEqual(marks().filter(mark => mark !== ""), [], "no invented marks");
  assert.match(dom.window.document.body.textContent ?? "", /No tests matched/);

  testRecorder.clearRun();
  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

test("the element menu survives a tree invalidation that takes the hover outline away", async t => {
  const { module: { TestRecorderOverlay, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestRecorderOverlay } from "./packages/ui/src/components/test-recorder-overlay.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "recorder-menu-anchor",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const annotations = { subscribe: () => () => undefined, getSnapshot: () => ANNOTATIONS_SNAPSHOT };
  testRecorder.attach("udid", "ios", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid", "ios");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestRecorderOverlay, { store: annotations })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });

  await act(async () => { await testRecorder.openMenu({ x: 150, y: 420 }); });
  assert.ok(dom.window.document.querySelector("[data-element=recorder-menu]"));
  // The hover outline is the first thing an input, a frame or a slow read drops. The menu was asked
  // for explicitly and carries its own rectangle, so it is still on the element it is about.
  await act(async () => { (testRecorder as any).update({ hover: undefined }); });
  const menu = dom.window.document.querySelector("[data-element=recorder-menu]") as HTMLElement;
  assert.ok(menu, "the menu does not go with the outline");
  const stays = Math.max(180, Math.min(280, dom.window.innerWidth - 16));
  assert.equal(menu.style.left, `${Math.max(8, Math.min(10 + 100 / 402 * 300, dom.window.innerWidth - stays - 8))}px`);

  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

test("a coordinate gets the tap row and is told why that is all", async t => {
  const { module: { TestRecorderOverlay, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestRecorderOverlay } from "./packages/ui/src/components/test-recorder-overlay.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "recorder-point-menu",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const annotations = { subscribe: () => () => undefined, getSnapshot: () => ANNOTATIONS_SNAPSHOT };
  testRecorder.attach("udid", "ios", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid", "ios");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestRecorderOverlay, { store: annotations })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });

  // Nowhere near the one element in the tree, so nothing can be named.
  await act(async () => { await testRecorder.openMenu({ x: 10, y: 20 }); });
  const rows = [...dom.window.document.querySelectorAll("[data-recorder-offer]")] as HTMLElement[];
  assert.deepEqual(rows.map(row => row.dataset.recorderOffer), ["tap"]);
  assert.equal(rows[0].textContent, "Tap");
  assert.match(rows[0].title, /screen\.tapAt\(\{ x: 10, y: 20 \}\)/);
  // Three missing rows with no explanation read as a broken menu — and the note has to name what
  // is still possible here, since two commands now are.
  assert.match(dom.window.document.querySelector("[data-element=recorder-menu]")?.textContent ?? "",
    /The coordinate can still be tapped or swiped/);

  // `screen.swipe` is about the viewport, not about anything in it, so it survives the refusal
  // every other non-tap command meets on a point.
  await act(async () => { dom.window.document.querySelector<HTMLElement>("[data-recorder-panel=commands]")!.click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  const swipeRow = dom.window.document.querySelector<HTMLElement>("[data-recorder-panel=swipe]")!;
  assert.ok(swipeRow, "the viewport swipe is offered where nothing can be named");
  await act(async () => { swipeRow.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  assert.deepEqual([...dom.window.document.querySelectorAll("[data-recorder-swipe]")].map(row => row.textContent),
    ["Up", "Down", "Left", "Right"]);
  await act(async () => { dom.window.document.querySelector<HTMLElement>("[data-recorder-swipe=down]")!.click(); });
  await act(async () => { await Promise.resolve(); });
  assert.deepEqual(testRecorder.getSnapshot().steps.map((step: any) => [step.kind, step.direction]), [["swipe", "down"]]);
  assert.match(testRecorder.source, /await screen\.swipe\(\{ direction: "down" \}\);/);

  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

test("the command list is a submenu of its own, opened by pointing at its row", async t => {
  const { module: { TestRecorderOverlay, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestRecorderOverlay } from "./packages/ui/src/components/test-recorder-overlay.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "recorder-submenu",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const annotations = { subscribe: () => () => undefined, getSnapshot: () => ANNOTATIONS_SNAPSHOT };
  testRecorder.attach("udid", "ios", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid", "ios");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestRecorderOverlay, { store: annotations })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const menu = () => dom.window.document.querySelector("[data-element=recorder-menu]") as HTMLElement;
  const submenu = () => dom.window.document.querySelector("[data-element=recorder-commands]") as HTMLElement;
  const rows = () => [...dom.window.document.querySelectorAll("[data-recorder-offer]")] as HTMLButtonElement[];
  const opener = () => dom.window.document.querySelector("[data-recorder-panel=commands]") as HTMLButtonElement;

  await act(async () => { await testRecorder.openMenu({ x: 150, y: 420 }); });
  // The short list is what is in front of the user, and the submenu is not open until it is asked for.
  assert.deepEqual(rows().map(row => row.textContent), ["Tap", "Check visibility", "Scroll into view"]);
  assert.equal(submenu(), null);

  // Pointing at the row is enough; no click is needed to see what it leads to.
  await act(async () => { opener().dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
  assert.ok(submenu(), "hovering the row opens the submenu");
  // A panel of its own, beside the menu rather than replacing what was in it, and a portal too:
  // the menu scrolls once it is taller than the window, and a scrolling box clips what hangs out.
  assert.equal(submenu().parentElement, dom.window.document.body);
  assert.ok(submenu().className.includes("fixed"));
  // Where it lands is `popover-placement`'s arithmetic, checked there against real layouts; what
  // matters here is that it is narrower than the menu, so a tight window keeps part of the menu
  // behind it visible.
  assert.ok(Number.parseFloat(submenu().style.width) < Number.parseFloat(menu().style.width));
  assert.ok(submenu().className.includes("bg-popover") && submenu().className.includes("shadow-lg"));
  assert.deepEqual(rows().slice(0, 3).map(row => row.textContent), ["Tap", "Check visibility", "Scroll into view"],
    "the menu behind it keeps its own rows");
  const commands = rows().slice(3).map(row => row.dataset.recorderOffer);
  assert.ok(commands.includes("assertNotVisible") && commands.includes("doubleTap") && commands.includes("longPress"));
  assert.match(submenu().textContent ?? "", /ActionsTap.*AssertionsCheck visibility/);

  // Leaving the row and its panel closes it, but only after a moment: they have a gap between
  // them, and crossing it must not be a way out.
  await act(async () => { opener().parentElement!.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: false })); });
  assert.ok(submenu(), "it is not taken away the instant the pointer leaves the row");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  assert.equal(submenu(), null);

  await act(async () => { opener().dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
  await act(async () => { rows().find(row => row.dataset.recorderOffer === "assertNotVisible")!.click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(dom.window.document.querySelector("[data-element=recorder-menu]"), null, "choosing a command closes the menu");
  assert.match(testRecorder.source, /await expect\(screen\.getByRole\("button", "Go To Explore List"\)\)\.not\.toBeVisible\(\);/);

  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

test("the agentic branches cascade to the side, and record a sentence with its params", async t => {
  const { module: { TestRecorderOverlay, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestRecorderOverlay } from "./packages/ui/src/components/test-recorder-overlay.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "recorder-agentic",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const annotations = { subscribe: () => () => undefined, getSnapshot: () => ANNOTATIONS_SNAPSHOT };
  const done: unknown[] = [];
  testRecorder.attach("udid", "ios", {
    readComponents: async () => [button], screen: () => SCREEN, release: () => undefined,
    perform: (action: unknown) => { done.push(action); },
  });
  testRecorder.start("udid", "ios");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestRecorderOverlay, { store: annotations })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const doc = dom.window.document;
  const panel = (name: string) => doc.querySelector(`[data-element=${name}]`) as HTMLElement | null;
  const find = (selector: string) => doc.querySelector(selector) as HTMLElement | null;
  const type = async (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(field, value);
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  // Hover intent: a branch opens by being pointed at, after a beat, so a row brushed past on the
  // way somewhere else does not open one.
  const hover = async (node: HTMLElement) => {
    await act(async () => { node.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  };

  await act(async () => { await testRecorder.openMenu({ x: 150, y: 420 }); });
  const agenticRow = find("[data-recorder-panel=agentic]")!;
  assert.equal(panel("recorder-agentic"), null, "a branch is not open before it is pointed at");
  await hover(agenticRow);
  assert.ok(panel("recorder-agentic"), "hovering opens it; no click needed");
  // The menu it came from is still there: a branch opens beside its parent, it does not replace it.
  assert.ok(panel("recorder-menu"), "the element menu stays on screen behind the branch");
  assert.ok(find("[data-recorder-panel=agentic]"), "including the row the branch hangs off");
  assert.deepEqual([...panel("recorder-agentic")!.querySelectorAll("[data-recorder-agentic]")].map(row => row.textContent),
    ["Act", "Assert", "Wait for"]);

  await hover(find("[data-recorder-agentic=agentAct]")!);
  const actPanel = panel("recorder-agentic-act")!;
  assert.ok(actPanel, "the form cascades off Act rather than replacing the list");
  assert.ok(panel("recorder-agentic"), "which is still behind it");
  const instruction = find("[data-recorder-agentic-input=agentAct]") as HTMLInputElement;
  // The element the user right-clicked writes the first draft; it is editable and nothing else.
  assert.equal(instruction.value, 'tap the "Go To Explore List" button');
  await type(instruction, "sign in as the test user");

  // Params: key and text rows, added and removed, with blank keys dropped on the way out.
  await act(async () => { find("[data-recorder-param-add]")!.click(); });
  await act(async () => { find("[data-recorder-param-add]")!.click(); });
  await act(async () => { find("[data-recorder-param-add]")!.click(); });
  await type(find("[data-recorder-param-key='0']") as HTMLInputElement, "email");
  await type(find("[data-recorder-param-value='0']") as HTMLInputElement, "a@b.com");
  await type(find("[data-recorder-param-key='1']") as HTMLInputElement, "attempts");
  await type(find("[data-recorder-param-value='1']") as HTMLInputElement, "3");
  // The third row is never named, so it is not a param.
  await type(find("[data-recorder-param-value='2']") as HTMLInputElement, "ignored");
  await act(async () => { find("[data-recorder-param-remove='2']")!.click(); });
  assert.equal(doc.querySelectorAll("[data-recorder-param]").length, 2, "a row can be taken back out");

  await act(async () => { panel("recorder-agentic-act")!.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  assert.deepEqual(testRecorder.getSnapshot().steps.map((step: any) => [step.kind, step.instruction, step.params]),
    [["agentAct", "sign in as the test user", { email: "a@b.com", attempts: "3" }]]);
  assert.match(testRecorder.source, /await agent\.act\("sign in as the test user", \{ params: \{ email: "a@b\.com", attempts: 3 \} \}\);/);
  assert.deepEqual(done, [], "an agent step is not taken on the device while recording");

  // Assert cascades the same way, and its vision choice is a branch of its own.
  testRecorder.clearSteps();
  await act(async () => { await testRecorder.openMenu({ x: 150, y: 420 }); });
  await hover(find("[data-recorder-panel=agentic]")!);
  await hover(find("[data-recorder-agentic=agentAssert]")!);
  assert.ok(panel("recorder-agentic-assert"));
  await type(find("[data-recorder-agentic-input=agentAssert]") as HTMLInputElement, "the city list is showing");
  const visionRow = find("[data-recorder-panel=vision]")!;
  assert.match(visionRow.textContent ?? "", /Vision: Off/, "the runner's own default, named on the row");
  await hover(visionRow);
  assert.deepEqual([...panel("recorder-vision")!.querySelectorAll("[data-recorder-vision]")].map(row => row.textContent),
    ["Off", "On", "Screenshot only"]);
  await act(async () => { find("[data-recorder-vision=only]")!.click(); });
  assert.match(find("[data-recorder-panel=vision]")!.textContent ?? "", /Vision: Screenshot only/);
  await act(async () => { panel("recorder-agentic-assert")!.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });

  assert.equal(panel("recorder-menu"), null, "recording the step closes the whole menu");
  assert.deepEqual(testRecorder.getSnapshot().steps.map((step: any) => [step.kind, step.vision]), [["agentAssert", "only"]]);
  assert.match(testRecorder.source, /await agent\.assert\("the city list is showing", \{ vision: "only" \}\);/);

  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

/** A `TestingPanel` stub for the view: enough snapshot for the controls, no server behind it. */
function panelStub(overrides: Record<string, unknown> = {}) {
  const listeners = new Set<() => void>();
  const state: Record<string, unknown> = {
    open: true, available: true, projectPath: "/app", projects: [], targets: [{ name: "ios", platform: "ios", bundleId: "com.app" }],
    targetName: "ios", configPath: "/app/e2e.config.ts", loadingProject: false, pickingProject: false, launching: false,
    appLaunched: true, fileName: "flow", saving: false, overwritePath: "", savedRevision: -1, savedPath: "", running: false,
    pendingRun: false, agent: null, drafts: [], draftId: "", loadingDraft: false, tests: [], deletingTest: "", error: null,
    ...overrides,
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    canLaunch: true, canRun: true, dirty: true,
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {},
    launchApp: async () => {}, saveTest: async () => {}, runTest: async () => {}, selectTarget: () => {},
    setFileName: () => {}, cancelOverwrite: () => {}, dismissError: () => {},
    refreshDrafts: async () => {}, openDraft: async () => {}, deleteDraft: async () => {}, newRecording: async () => {},
    refreshTests: async () => {}, deleteTest: async () => {},
  };
}

test("a step's commands open beside it, and Clear asks before it throws the flow away", async t => {
  const { module: { TestingView, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestingView } from "./packages/ui/src/components/testing-view.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "testing-step-menu",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const panel = panelStub();
  const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => DEVICE_SNAPSHOT };
  testRecorder.attach("udid", "ios", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid", "ios");
  await testRecorder.openMenu({ x: 150, y: 420 });
  await testRecorder.chooseOffer("tap");

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestingView, { panel, deviceApps })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const query = (selector: string) => dom.window.document.querySelector(selector) as HTMLElement | null;

  // The step's own menu, revealed by pointing at the row it belongs to.
  const trigger = query("[data-testing-step-menu]")!;
  await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
  const commandsRow = query("[data-testing-step-commands]");
  assert.ok(commandsRow, "the menu offers the step another command");
  assert.ok(query("[data-testing-step-duplicate]"), "beside Duplicate");
  assert.equal(query("[data-testing-step-commands-back]"), null,
    "the list is a branch now, so there is nothing to go back from");

  // Pointing at that row opens the list beside the menu, not over it.
  await act(async () => { commandsRow!.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  const branch = query("[data-element=testing-step-commands]");
  assert.ok(branch, "hovering the row opens the command list");
  assert.equal(branch!.parentElement, dom.window.document.body, "as a portal, so nothing can clip it");
  assert.ok(query("[data-testing-step-duplicate]"), "and the menu it came from is still on screen");
  assert.ok(branch!.textContent?.includes("Actions"), "the list is the runner's own command vocabulary");
  // That it opens on the *left* is `placeBeside`'s arithmetic, checked in
  // `packages/ui/test/popover-placement.test.ts` against real layouts: every rectangle in JSDOM is
  // zero, so there is no left here to open on.

  // Clear is the icon alone, tinted, and it asks before it acts.
  const clear = query("[data-testing-clear]")!;
  assert.equal(clear.textContent?.trim(), "", "no text label beside the icon");
  assert.equal(clear.getAttribute("aria-label"), "Clear test");
  assert.ok(clear.className.includes("text-destructive"), "and it is tinted as the destructive thing it is");
  await act(async () => { clear.click(); });
  const confirm = query("[data-testing-clear-confirm]");
  assert.ok(confirm, "clicking it asks first");
  assert.equal(testRecorder.getSnapshot().steps.length, 1, "and nothing has been cleared yet");
  await act(async () => { confirm!.click(); });
  assert.equal(testRecorder.getSnapshot().steps.length, 0, "answering it clears the flow");

  testRecorder.detach("udid", "ios");
});

test("Record says the mirror is not ready yet, until selection actually is", async t => {
  const { module: { TestRecorderOverlay, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestRecorderOverlay } from "./packages/ui/src/components/test-recorder-overlay.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "recorder-preparing",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  // The real wait: attaching to the app and projecting its tree takes a second or two, and until
  // it lands nothing on the mirror can be named.
  let release: (components: unknown[]) => void = () => {};
  const tree = new Promise<unknown[]>(resolve => { release = resolve; });
  const annotations = { subscribe: () => () => undefined, getSnapshot: () => ANNOTATIONS_SNAPSHOT };
  testRecorder.attach("udid", "ios", { readComponents: () => tree, screen: () => SCREEN, release: () => undefined });

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestRecorderOverlay, { store: annotations })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const overlay = () => dom.window.document.querySelector("[data-element=recorder-preparing]") as HTMLElement | null;

  assert.equal(overlay(), null, "nothing is over the mirror until Record is pressed");
  await act(async () => { testRecorder.start("udid", "ios"); });
  assert.ok(overlay(), "Record puts it there at once, rather than after the first dead click");
  assert.match(overlay()!.textContent ?? "", /preparing\.\.\./);
  assert.ok(overlay()!.className.includes("pointer-events-none"),
    "the mirror still drives the app while the tree is being read");

  await act(async () => { release([button]); await tree; });
  assert.equal(overlay(), null, "it goes when an element can actually be selected");
  assert.equal(testRecorder.getSnapshot().preparing, false);

  testRecorder.stop();
  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});

test("the list keeps what is not stored above what the project holds, and asks before deleting either", async t => {
  const { module: { TestingView, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestingView } from "./packages/ui/src/components/testing-view.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "testing-list-groups",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const deleted: string[] = [];
  const panel = {
    ...panelStub({
      drafts: [{ id: "draft-1", projectPath: "/app", title: "the explore screen", fileName: "", origin: "user", stepCount: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      tests: [{ relativePath: "tests/flow.e2e.ts", name: "flow.e2e.ts", updatedAt: "2026-01-01T00:00:00.000Z", sizeBytes: 420 }],
    }),
    deleteTest: async (path: string) => { deleted.push(path); },
  };
  const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => DEVICE_SNAPSHOT };

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestingView, { panel, deviceApps })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const query = (selector: string) => dom.window.document.querySelector(selector) as HTMLElement | null;

  await act(async () => { query("[data-testing-drafts]")!.click(); });
  const groups = [...dom.window.document.querySelectorAll("[data-testing-group]")] as HTMLElement[];
  assert.deepEqual(groups.map(group => group.dataset.testingGroup), ["unstored", "stored"],
    "what is being worked on is above the archive");
  assert.match(groups[0].textContent ?? "", /Not stored/);
  // Expanded by default: the unsaved recordings are the ones at risk of being lost.
  assert.equal(groups[0].getAttribute("aria-expanded"), "true");
  assert.ok(query("[data-testing-draft-option=draft-1]"));
  // Collapsed by default: the project's own tests are there to be found, not to be read every time.
  assert.equal(groups[1].getAttribute("aria-expanded"), "false");
  assert.equal(query("[data-testing-test-delete]"), null);

  await act(async () => { groups[1].click(); });
  assert.match(query('[data-testing-test="tests/flow.e2e.ts"]')?.textContent ?? "", /flow\.e2e\.ts/,
    "a saved test is listed here rather than leaving the list");

  // Neither delete happens on one click of a trash icon sitting beside the row the user wanted.
  // The question is a popover beside the icon, so the row it is about stays readable under it.
  await act(async () => { query("[data-testing-test-delete]")!.click(); });
  assert.deepEqual(deleted, [], "nothing is deleted while the question is still up");
  const question = query("[role=alertdialog]");
  assert.match(question?.textContent ?? "",
    /Delete tests\/flow\.e2e\.ts from the project\? The file is removed and cannot be brought back/);
  assert.equal(question?.parentElement?.closest("[role=alertdialog]"), null, "it is a popover, not the row");
  assert.ok(query('[data-testing-test="tests/flow.e2e.ts"]'), "and the row it is about is still listed");
  await act(async () => { query("[data-confirm-delete]")!.click(); });
  assert.deepEqual(deleted, ["tests/flow.e2e.ts"]);
  assert.equal(query("[role=alertdialog]"), null, "answering it closes the question");

  testRecorder.clearSteps();
});

test("moving from one step to the next hands the highlight over without dimming the first", async t => {
  const { module: { TestingView, testRecorder }, dom, onTeardown } = await renderEnvironment<any>(t, {
    exports: 'export { TestingView } from "./packages/ui/src/components/testing-view.tsx";\n'
      + 'export { testRecorder } from "./packages/ui/src/test-recorder.ts";',
    slug: "testing-step-hover",
    extraGlobals: { crypto: { randomUUID: () => `id-${Math.random()}` } },
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const panel = panelStub();
  const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => DEVICE_SNAPSHOT };
  testRecorder.attach("udid", "ios", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid", "ios");
  await testRecorder.openMenu({ x: 150, y: 420 });
  await testRecorder.chooseOffer("tap");
  await testRecorder.openMenu({ x: 150, y: 420 });
  await testRecorder.chooseOffer("assertVisible");

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(TestingView, { panel, deviceApps })); });
  onTeardown(async () => {
    await act(async () => { root.unmount(); });
    await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  });
  const steps = () => [...dom.window.document.querySelectorAll("[data-testing-step]")] as HTMLElement[];
  const highlighted = () => [...dom.window.document.querySelectorAll(".testing-preview-line.is-step-highlighted")]
    .map(line => (line as HTMLElement).dataset.testingPreviewLine);
  const spans = testRecorder.emitted.spans;
  assert.equal(steps().length, 2);

  await act(async () => { steps()[0].dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
  assert.deepEqual(highlighted(), spans[0].calls.map(String), "pointing at a step tints the lines it emits");

  // Leaving the row takes the highlight away at once. What made leaving a step *re-light* its
  // lines was the preview's own arrival animation being cancelled while they were highlighted and
  // restarted when they no longer were — see `.is-step-highlighted` in `style.css`, which paints
  // the highlight as a layer now so there is no animation to restart.
  await act(async () => { steps()[0].dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })); });
  assert.deepEqual(highlighted(), [], "the highlight goes with the pointer");

  // And a row that has already been left cannot take it from the row the pointer is on now: the
  // browser dispatches the leave of one and the enter of the next together.
  await act(async () => {
    steps()[1].dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }));
    steps()[0].dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true }));
  });
  assert.deepEqual(highlighted(), spans[1].calls.map(String), "the second step's lines are the ones tinted");

  // The flash itself was CSS, and JSDOM applies none: the highlight suppressed the arrival
  // animation that `is-new` holds on the lines a step added, so letting it back on mouse-leave
  // restarted it — the lines lit up again and faded over 1400ms. The highlight is a layer now, so
  // there is nothing to cancel and nothing to restart.
  const css = await readFile(new URL("../../ui/src/style.css", import.meta.url), "utf-8");
  const highlightRule = css.slice(css.indexOf(".testing-preview-line.is-step-highlighted"));
  assert.match(highlightRule.slice(0, 64), /is-step-highlighted::before/,
    "the highlight is painted as its own layer");
  assert.doesNotMatch(highlightRule.slice(0, highlightRule.indexOf("}")), /animation/,
    "and it never touches the arrival animation, which is what restarted on mouse-leave");

  testRecorder.clearSteps();
  testRecorder.detach("udid", "ios");
});
