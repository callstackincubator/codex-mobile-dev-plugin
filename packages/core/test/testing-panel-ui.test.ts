import test from "node:test";
import assert from "node:assert/strict";
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
  testRecorder.attach("udid", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid");

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
  // Each row is the code the step would add, not a verb the user has to imagine the shape of.
  assert.deepEqual(rows().map(row => row.textContent), [
    'screen.getByRole("button", "Go To Explore List").tap()',
    'expect(screen.getByRole("button", "Go To Explore List")).toBeVisible()',
    'screen.scrollUntilVisible(screen.getByRole("button", "Go To Explore List"))',
  ]);
  // The menu is anchored to the outline, inside the stage the annotation store measured.
  const box = menu() as HTMLElement;
  // 352 wide where the stage allows it, clamped so the code it shows is not cut off by the edge.
  const width = Math.max(180, Math.min(440, VIEWPORT.stageWidth - 8));
  assert.equal(box.style.width, `${width}px`);
  assert.equal(box.style.left, `${Math.max(4, Math.min(10 + 100 / 402 * 300 + 8, VIEWPORT.stageWidth - width - 4))}px`);

  await act(async () => { rows().find(row => row.dataset.recorderOffer === "assertVisible")!.click(); });
  await act(async () => { await Promise.resolve(); });
  assert.equal(menu(), null, "choosing a row closes the menu");
  assert.deepEqual(testRecorder.getSnapshot().steps.map((step: any) => step.kind), ["assertVisible"]);
  assert.match(testRecorder.source, /await expect\(screen\.getByRole\("button", "Go To Explore List"\)\)\.toBeVisible\(\);/);

  testRecorder.clearSteps();
  testRecorder.detach("udid");
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
  testRecorder.attach("udid", {
    readComponents: async () => [field], screen: () => SCREEN, release: () => undefined,
    perform: (action: unknown) => { done.push(action); },
  });
  testRecorder.start("udid");
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
  const input = dom.window.document.querySelector('[aria-label="Step value"]') as HTMLInputElement;
  assert.equal(input.value, "Paris", "it starts from the field's own value");
  assert.equal(rows().length, 0, "the rows give way to the question");
  await act(async () => { input.value = "Berlin"; });
  await act(async () => { (dom.window.document.querySelector("[data-element=recorder-menu] form") as HTMLFormElement).requestSubmit(); });
  await act(async () => { await Promise.resolve(); });
  assert.match(testRecorder.source, /await screen\.getByPlaceholder\("Search transactions"\)\.fill\("Berlin"\);/);
  // Typing is taken as well as recorded: the field is tapped to focus it, then the text is sent.
  assert.deepEqual(done, [{ kind: "tap", point: { x: 200, y: 422 } }, { kind: "type", text: "Berlin" }]);

  testRecorder.clearSteps();
  testRecorder.detach("udid");
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
    pendingRun: false, error: null,
  };
  const panel = {
    subscribe: (listener: () => void) => { panelListeners.add(listener); return () => { panelListeners.delete(listener); }; },
    getSnapshot: () => panelState,
    canLaunch: true, canRun: true, dirty: true,
    refreshProjects: async () => {}, chooseProject: async () => {}, pickProject: async () => {},
    launchApp: async () => {}, saveTest: async () => {}, runTest: async () => {}, selectTarget: () => {},
    setFileName: () => {}, cancelOverwrite: () => {}, dismissError: () => {},
  };
  const deviceApps = {
    subscribe: () => () => undefined,
    getSnapshot: () => DEVICE_SNAPSHOT,
  };

  testRecorder.attach("udid", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid");
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

  // One step, one call line: line 8 of the emitted file, which is where the report will point.
  const spans = testRecorder.emitted.spans;
  assert.deepEqual(spans.map((span: any) => span.calls), [[8]]);
  const lines = testRecorder.source.split("\n");
  assert.match(lines[7], /await screen\.getByRole\("button", "Go To Explore List"\)\.tap\(\);/);

  // The gutter is a column of its own, not a character at the front of the line: that is what keeps
  // the code still when a run starts and keeps a mark level with a line that wraps.
  const line = dom.window.document.querySelector("[data-testing-preview] .testing-preview-line")!;
  assert.deepEqual([...line.children].map(child => child.className.split(" ")[0]),
    ["testing-run-mark", "testing-preview-code"], "the mark and the code are siblings, in that order");

  await act(async () => { testRecorder.beginRun(); });
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
  testRecorder.detach("udid");
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
  testRecorder.attach("udid", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid");
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
  const stays = Math.max(180, Math.min(440, VIEWPORT.stageWidth - 8));
  assert.equal(menu.style.left, `${Math.max(4, Math.min(10 + 100 / 402 * 300 + 8, VIEWPORT.stageWidth - stays - 4))}px`);

  testRecorder.clearSteps();
  testRecorder.detach("udid");
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
  testRecorder.attach("udid", { readComponents: async () => [button], screen: () => SCREEN, release: () => undefined });
  testRecorder.start("udid");
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
  assert.match(rows[0].textContent ?? "", /screen\.tapAt\(\{ x: 10, y: 20 \}\)/);
  // Three missing rows with no explanation read as a broken menu.
  assert.match(dom.window.document.querySelector("[data-element=recorder-menu]")?.textContent ?? "",
    /only the coordinate can be acted on/);

  testRecorder.clearSteps();
  testRecorder.detach("udid");
});
