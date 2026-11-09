import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { AppIntelSnapshot, IntelEdge } from "@mobile-dev/shared/app-intelligence.ts";
import { AppIntelligencePanel } from "../src/app-intelligence-panel.ts";

function fixture(): AppIntelSnapshot {
  const edges: IntelEdge[] = [
    { from: "screen:home", to: "file:app/index.tsx", kind: "source", platforms: ["ios", "android"] },
    { from: "screen:profile", to: "file:app/profile.tsx", kind: "source", platforms: ["ios", "android"] },
    { from: "file:app/index.tsx", to: "file:src/shared.ts", kind: "import", platforms: ["ios", "android"] },
    { from: "file:app/profile.tsx", to: "file:src/shared.ts", kind: "import", platforms: ["ios", "android"] },
    { from: "file:app/profile.tsx", to: "file:src/only.ios.ts", kind: "import", platforms: ["ios"] },
    { from: "file:app/profile.tsx", to: "file:src/components/Button.tsx", kind: "import", platforms: ["ios", "android"] },
    { from: "file:app/profile.tsx", to: "file:src/components/Card.tsx", kind: "import", platforms: ["ios", "android"] },
    { from: "file:app/profile.tsx", to: "file:src/hooks/useThing.ts", kind: "import", platforms: ["ios", "android"] },
    { from: "file:src/components/Button.tsx", to: "file:src/util/text.ts", kind: "import", platforms: ["ios", "android"] },
    { from: "file:src/shared.ts", to: "package:left-pad", kind: "import", platforms: ["ios", "android"] },
  ];
  const indexes: AppIntelSnapshot["indexes"] = { screens: Object.create(null), incoming: Object.create(null), outgoing: Object.create(null) };
  edges.forEach((edge, index) => { (indexes.outgoing[edge.from] ??= []).push(index); if (edge.to) (indexes.incoming[edge.to] ??= []).push(index); });
  indexes.screens.home = ["home"];
  indexes.screens.profile = ["profile"];
  const file = (reach: number) => ({ fingerprint: "x", kind: "source" as const, reach });
  return {
    formatVersion: 1,
    meta: { projectId: "p", generation: "g", analyzedAt: "2026-11-04T00:00:00Z", analyzerVersion: "t", sourceFingerprint: "f" },
    files: { "app/index.tsx": file(1), "app/profile.tsx": file(1), "src/shared.ts": file(2), "src/only.ios.ts": file(1), "src/components/Button.tsx": file(1), "src/components/Card.tsx": file(1), "src/hooks/useThing.ts": file(1), "src/util/text.ts": file(1) },
    packages: { "left-pad": { name: "left-pad", reach: 2, entry: "node_modules/left-pad/index.js" } },
    screens: {
      home: { title: "Home", route: "/", source: "app/index.tsx", layouts: [] },
      profile: { title: "Profile", route: "/profile", source: "app/profile.tsx", layouts: [] },
    },
    edges, diagnostics: [], indexes,
  };
}

/** Boots a JSDOM environment and the real AppIntelligenceView bundle, with `app` as its host. */
async function mount(t: TestContext, app: Pick<App, "callServerTool">) {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Element: dom.window.Element, Event: dom.window.Event,
    // The confirmation popover is a Radix layer: it walks the tree and dispatches its own events,
    // and every constructor it touches has to be this window's, not Node's.
    ...Object.fromEntries(["CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DocumentFragment",
      "NodeFilter", "DOMRect", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "SVGElement",
    ].map(name => [name, (dom.window as unknown as Record<string, unknown>)[name]])),
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  // The panel measures its own box; JSDOM has no layout, so supply one size for every element.
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 640, configurable: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { get: () => 360, configurable: true });

  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-app-intel-view-"));
  let unmount = async () => {};
  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await rm(directory, { recursive: true, force: true });
  });

  const output = resolve(directory, "view.mjs");
  await build({
    stdin: { contents: 'export { AppIntelligenceView } from "./packages/ui/src/components/app-intelligence-view.tsx";', resolveDir: process.cwd(), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*"],
  });
  const { AppIntelligenceView } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const panel = new AppIntelligencePanel(app as unknown as App);
  const root = createRoot(dom.window.document.getElementById("root")!);
  unmount = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => { root.render(createElement(AppIntelligenceView, { panel })); });
  return { dom, act, panel };
}

test("the project overview filters the right rail from its connected area nodes", async t => {
  const snapshot = fixture();
  const source = "src/components/Settings.tsx";
  snapshot.screens.settings = { title: "Settings", route: "/settings", source, layouts: [] };
  snapshot.files[source] = { fingerprint: "x", kind: "source", reach: 1 };
  const edge = snapshot.edges.push({ from: "screen:settings", to: `file:${source}`, kind: "source", platforms: ["ios", "android"] }) - 1;
  snapshot.indexes.screens.settings = ["settings"];
  snapshot.indexes.outgoing["screen:settings"] = [edge];
  snapshot.indexes.incoming[`file:${source}`] = [edge];
  const app = { async callServerTool({ name }: { name: string }) {
    if (name === "mobile_app_intel_snapshot") return { content: [], structuredContent: { projectPath: "/tmp/social-app", snapshot } };
    return { content: [], structuredContent: {} };
  } };
  const { dom, act, panel } = await mount(t, app);
  await act(async () => { panel.setAvailable(true); panel.show(); });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });

  const overview = dom.window.document.querySelector("[data-project-overview]") as HTMLElement;
  assert.ok(overview, "the generated graph starts with the project overview");
  assert.match((overview.querySelector("[data-project-node]") as HTMLElement).textContent ?? "", /social-app/);
  assert.match((overview.querySelector("[data-project-node]") as HTMLElement).textContent ?? "", /3 entry points/);
  const areas = [...overview.querySelectorAll<HTMLButtonElement>("[data-area-node]")];
  assert.deepEqual(areas.map(area => area.dataset.areaNode), ["component", "other"]);
  assert.match(areas[0].textContent ?? "", /1 entry/);
  assert.match(areas[1].textContent ?? "", /2 entries/);
  assert.doesNotMatch(overview.textContent ?? "", /screens?/i, "the overview consistently calls them entries");
  assert.equal(areas[0].style.animationDelay, "2s", "the first click prompt waits two seconds");
  assert.equal(areas[1].style.animationDelay, "2.35s", "the prompts are staggered around the project");
  assert.equal(overview.querySelectorAll("[data-area-connector]").length, 2, "each area is connected to the project");
  const orbits = [...overview.querySelectorAll<SVGCircleElement>("[data-project-orbit]")];
  assert.equal(orbits.length, 3, "concentric pulses surround the project node");
  assert.deepEqual(orbits.map(orbit => orbit.style.animationDelay), ["0s", "0.8s", "1.6s"], "the rings expand from the centre in sequence");

  await act(async () => { areas[0].click(); });
  assert.deepEqual(panel.getSnapshot().boundaries, ["component"], "clicking an area applies it as the sole filter");
  assert.equal(panel.getSnapshot().selectedScreen, null, "filtering leaves screen selection to the right-hand list");
  assert.equal(dom.window.document.querySelector('[data-area-node="component"]')?.getAttribute("aria-pressed"), "true");
  const railToggle = dom.window.document.querySelector('aside button[aria-controls="app-intel-entries"]') as HTMLButtonElement;
  assert.equal(railToggle.getAttribute("aria-expanded"), "true", "the matching list opens automatically");
  const entries = [...dom.window.document.querySelectorAll<HTMLElement>("aside [data-entry]")];
  assert.deepEqual(entries.map(entry => entry.dataset.entry), ["settings"]);

  const trigger = dom.window.document.querySelector("[data-flow-filter-trigger]") as HTMLButtonElement;
  assert.match(trigger.textContent ?? "", /1/, "the applied choice remains visible as an active filter");
  await act(async () => { trigger.click(); });
  assert.equal((dom.window.document.querySelector('[data-flow-filter] [data-boundary="component"]') as HTMLInputElement).checked, true);
  assert.equal((dom.window.document.querySelector('[data-flow-filter] [data-boundary="other"]') as HTMLInputElement).checked, false);
  await act(async () => { trigger.click(); await new Promise(done => setTimeout(done, 0)); });
});

test("App Intelligence traces a screen, groups each hop by boundary and folds a group away", async t => {
  const snapshot = fixture();
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const recents = ["/tmp/social-app", "/tmp/other-app"];
  const app = { async callServerTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
    calls.push({ name, arguments: args });
    if (name === "mobile_app_intel_snapshot") return { content: [], structuredContent: { projectPath: "/tmp/social-app", snapshot, recents } };
    if (name === "mobile_select_app_intel_project") return { content: [], structuredContent: { projectPath: args?.projectPath, snapshot, recents } };
    if (name === "mobile_clear_app_intel") return { content: [], structuredContent: { projectPath: args?.projectPath, snapshot: null, recents } };
    return { content: [], structuredContent: {} };
  } };
  const { dom, act, panel } = await mount(t, app);
  await act(async () => { panel.setAvailable(true); panel.show(); });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });

  const query = (selector: string) => dom.window.document.querySelectorAll(selector);
  const refs = () => [...query("[data-flow-node]")].map(node => node.getAttribute("data-flow-node"));
  const railEntries = () => [...query("aside [data-entry]")].map(entry => entry.getAttribute("data-entry"));
  const groups = () => [...query("[data-flow-group]")].map(node => node.getAttribute("data-flow-group"));
  assert.ok(dom.window.document.getElementById("app-intelligence-panel"), "the panel keeps the id the package smoke test asserts");
  const emptyFlow = dom.window.document.querySelector("[data-flow-empty]") as HTMLElement;
  assert.ok(emptyFlow, "the canvas starts with an empty prompt before an entry point is chosen");
  assert.equal(emptyFlow.style.width, "", "the empty prompt does not feed a measured width back into its scroll container");
  assert.equal(emptyFlow.style.height, "", "the empty prompt does not feed a measured height back into its scroll container");

  // The picker is the workspace's own Select, showing the project by folder name. Its menu is a
  // popup the panel opens, so the switch itself is driven through the panel the trigger calls.
  const picker = () => dom.window.document.querySelector("[data-project-picker]") as HTMLElement;
  assert.equal(picker().getAttribute("data-slot"), "select-trigger");
  assert.match(picker().textContent ?? "", /social-app/);
  await act(async () => { await panel.selectProject("/tmp/other-app"); });
  assert.deepEqual(calls.at(-1), { name: "mobile_select_app_intel_project", arguments: { projectPath: "/tmp/other-app" } });
  assert.equal(panel.getSnapshot().projectPath, "/tmp/other-app");
  assert.match(picker().textContent ?? "", /other-app/, "and the trigger follows the choice");

  // The rail lists entry points, but starts collapsed so the Flow gets the width.
  assert.equal(refs().length, 0, "no screen is selected yet");
  assert.equal(dom.window.document.getElementById("app-intel-entries"), null, "the rail is collapsed by default");
  const railToggle = dom.window.document.querySelector('aside button[aria-controls="app-intel-entries"]') as HTMLButtonElement;
  assert.equal(railToggle.getAttribute("aria-expanded"), "false");
  await act(async () => { railToggle.click(); });
  assert.equal(railToggle.getAttribute("aria-expanded"), "true");
  const rail = dom.window.document.querySelector("#app-intel-entries") as HTMLElement;
  assert.ok(query("[data-flow-filter-trigger]").length === 1, "the entry-point filter is there before anything is traced");
  // The checkboxes live in the filter's dropdown, closed by default; open it once for the rest.
  await act(async () => { (dom.window.document.querySelector("[data-flow-filter-trigger]") as HTMLButtonElement).click(); });
  assert.ok(query("[data-flow-filter]").length === 1, "opening the trigger mounts the dropdown");
  const screenButton = [...rail.querySelectorAll("button")].find(button => button.textContent?.includes("Profile"));
  assert.ok(screenButton, "the rail lists screens");
  await act(async () => { screenButton.click(); });
  assert.deepEqual(refs(), ["screen:profile", "file:app/profile.tsx", "file:src/hooks/useThing.ts"], "the screen, its source and the first boundary under it");

  // Each hop is split into boundary headers, and only the first opens by itself.
  assert.deepEqual(groups(), ["1:other", "2:hook", "2:component", "2:other"], "every boundary is named, open or not");
  const group = (key: string) => dom.window.document.querySelector(`[data-flow-fold="${key}"]`) as Element;
  assert.equal(group("2:component").getAttribute("aria-expanded"), "false");
  await act(async () => { group("2:component").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.deepEqual(panel.getSnapshot().toggled, ["2:component"]);
  assert.equal(group("2:component").getAttribute("aria-expanded"), "true");
  assert.ok(refs().includes("file:src/components/Button.tsx"), "opening the boundary draws its rows");
  assert.deepEqual(groups().filter(key => key?.startsWith("3:")), ["3:util"], "and the hop under them, still folded");
  await act(async () => { group("2:component").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.deepEqual(panel.getSnapshot().toggled, [], "clicking it again folds it back to the default");
  assert.ok(!refs().includes("file:src/components/Button.tsx"));

  // Folding hides cards, never the shape: the connector moves onto the header instead.
  const links = () => [...query("[data-flow-link]")].map(link => link.getAttribute("stroke-opacity"));
  const foldedLinks = () => [...query("[data-flow-folded-link]")].map(link => link.getAttribute("data-flow-folded-link"));
  assert.ok(foldedLinks().includes("2:component"), "a folded boundary keeps a connector into its header");
  assert.deepEqual([...new Set([...links(), ...[...query("[data-flow-folded-link]")].map(link => link.getAttribute("stroke-opacity"))])], ["0.2"], "everything is dim until something is lit");

  // The pin on a header lights that one hop's boundary; the dot on a chip lights it at every hop.
  const litOpacity = (key: string) => [...query(`[data-flow-folded-link="${key}"]`)].map(link => link.getAttribute("stroke-opacity"));
  await act(async () => { (dom.window.document.querySelector('[data-flow-light="2:component"]') as Element).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(panel.getSnapshot().litBoundary, "2:component");
  assert.deepEqual(litOpacity("2:component"), ["1"]);
  assert.deepEqual(litOpacity("2:other"), ["0.2"], "the other folded boundaries stay dim");
  await act(async () => { (dom.window.document.querySelector('[data-flow-light="2:component"]') as Element).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(panel.getSnapshot().litBoundary, null, "clicking the pin again dims it again");
  assert.deepEqual(litOpacity("2:component"), ["0.2"]);
  const chipDot = dom.window.document.querySelector('[data-boundary-light="other"]') as HTMLButtonElement;
  assert.ok(chipDot, "the highlight dot lives in the open dropdown");
  await act(async () => { chipDot.click(); });
  assert.equal(panel.getSnapshot().litBoundary, "*:other");
  assert.equal(chipDot.getAttribute("aria-pressed"), "true");
  assert.deepEqual(litOpacity("2:other"), ["1"], "a chip lights its boundary wherever it appears");
  assert.deepEqual(railEntries().sort(), ["home", "profile"], "and lighting it does not filter the rail");
  await act(async () => { chipDot.click(); });

  // An overflow is a control, not a label: clicking it opens the rest of that boundary.
  await act(async () => { panel.showAllIn("2:component"); });
  assert.deepEqual(panel.getSnapshot().expanded, ["2:component"]);

  // The filter is the entry-point rail's filter: unticking a boundary takes those entries out of
  // the rail without touching the traced graph.
  const chips = () => [...query("[data-flow-filter] [data-boundary]")].map(chip => chip.getAttribute("data-boundary"));
  assert.deepEqual(chips(), ["all", "other"], "both fixture entries render plain source files");
  assert.deepEqual(railEntries().sort(), ["home", "profile"]);
  const other = dom.window.document.querySelector('[data-flow-filter] [data-boundary="other"]') as HTMLInputElement;
  await act(async () => { other.click(); });
  assert.deepEqual(railEntries(), [], "unticking the only boundary empties the rail");
  assert.ok(refs().length > 0, "the filter is the rail's, so the traced graph still draws in full");
  await act(async () => { (dom.window.document.querySelector('[data-flow-filter] [data-boundary="all"]') as HTMLInputElement).click(); });
  assert.deepEqual(railEntries().sort(), ["home", "profile"], "All brings them back");

  // Dragging pans the board itself, which is what a scroll-based pan failed to do when the graph
  // already fitted its pane. The drag must not re-root the graph on the card underneath.
  const canvas = dom.window.document.querySelector("[data-flow-canvas]") as HTMLElement;
  const board = canvas.firstElementChild as HTMLElement;
  const pointer = (type: string, x: number, y: number, target: EventTarget) =>
    target.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }));
  assert.equal(board.style.transform, "translate(0px, 0px) scale(1)");
  await act(async () => {
    pointer("pointerdown", 300, 200, canvas);
    pointer("pointermove", 220, 170, dom.window);
    pointer("pointerup", 220, 170, dom.window);
  });
  assert.equal(board.style.transform, "translate(-80px, -30px) scale(1)", "the board follows the pointer");
  const folds = panel.getSnapshot().toggled.length;
  await act(async () => { group("2:other").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(panel.getSnapshot().toggled.length, folds, "the click that ends a drag is swallowed");
  // Folding a boundary is a re-render, and must not move the board the reader panned.
  await act(async () => { group("2:other").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(board.style.transform, "translate(-80px, -30px) scale(1)", "a fold leaves the view where it was");
  await act(async () => { canvas.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })); });
  assert.equal(board.style.transform, "translate(0px, 0px) scale(1)", "double-click resets");

  // Zoom is the buttons and the readout beside them, on the same transform as the pan.
  const zoom = (which: string) => dom.window.document.querySelector(`[data-zoom="${which}"]`) as HTMLButtonElement;
  const level = () => (dom.window.document.querySelector("[data-zoom-level]") as HTMLElement).textContent;
  assert.equal(level(), "100%");
  await act(async () => { zoom("in").click(); });
  assert.equal(level(), "125%");
  assert.match(board.style.transform, /scale\(1\.25\)/);
  await act(async () => { zoom("out").click(); zoom("out").click(); });
  assert.equal(level(), "80%");
  await act(async () => { for (let press = 0; press < 12; press++) zoom("out").click(); });
  assert.equal(level(), "30%", "zooming out stops at the floor");
  await act(async () => { zoom("reset").click(); });
  assert.equal(board.style.transform, "translate(0px, 0px) scale(1)", "reset returns both pan and zoom");

  // A card is not a control: clicking one leaves the graph rooted on the screen the rail picked.
  await act(async () => { group("2:component").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  const card = [...query("[data-flow-node]")].find(node => node.getAttribute("data-flow-node") === "file:src/components/Button.tsx") as Element;
  assert.equal(card.getAttribute("role"), "img", "and it is not announced as one either");
  await act(async () => { card.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(refs()[0], "screen:profile", "the root is still the screen");
  assert.equal(panel.getSnapshot().selectedScreen, "profile");

  // Picking another screen is the only way to re-root, and it forgets the folds of the old one.
  const home = [...rail.querySelectorAll("button")].find(button => button.textContent?.includes("Home")) as HTMLButtonElement;
  await act(async () => { home.click(); });
  assert.equal(refs()[0], "screen:home");
  assert.deepEqual(panel.getSnapshot().toggled, [], "the folds belonged to the old screen");
  assert.deepEqual(panel.getSnapshot().expanded, []);

  // The whole right bar can be hidden too, giving the Flow the full width back.
  const asideToggle = dom.window.document.querySelector("[data-aside-toggle]") as HTMLButtonElement;
  assert.equal(asideToggle.getAttribute("aria-pressed"), "true");
  await act(async () => { asideToggle.click(); });
  assert.equal(dom.window.document.querySelector("aside"), null, "hiding it removes the whole bar, not just its list");
  assert.equal(asideToggle.getAttribute("aria-pressed"), "false");
  await act(async () => { asideToggle.click(); });
  assert.ok(dom.window.document.querySelector("aside"), "and it comes back");

  // Clear asks first, then throws the saved graph away but keeps the project selected.
  const clear = () => dom.window.document.getElementById("app-intel-clear") as HTMLButtonElement | null;
  assert.ok(clear(), "Clear sits beside Regenerate while there is a graph");
  const before = calls.length;
  await act(async () => { clear()?.click(); });
  assert.equal(calls.length, before, "pressing it only opens the confirmation");
  const confirm = dom.window.document.querySelector("[data-confirm]") as HTMLButtonElement;
  assert.ok(confirm, "which offers Cancel and Clear");
  await act(async () => { confirm.click(); });
  assert.deepEqual(calls.at(-1), { name: "mobile_clear_app_intel", arguments: { projectPath: "/tmp/other-app" } });
  assert.equal(panel.getSnapshot().snapshot, null);
  assert.equal(panel.getSnapshot().projectPath, "/tmp/other-app", "the project stays selected");
  assert.equal(clear(), null, "and there is nothing left to clear");
  assert.match(dom.window.document.querySelector("header")?.textContent ?? "", /Generate/);
});

test("reopening the panel shows a loading state instead of flashing the empty project picker", async t => {
  const snapshot = fixture();
  // A reopened panel is a fresh instance: it remembers nothing until this call resolves, so a
  // real delay is needed to observe the in-between state the way a slow host round trip would.
  const app = { async callServerTool({ name }: { name: string }) {
    if (name === "mobile_app_intel_snapshot") {
      await new Promise(done => setTimeout(done, 20));
      return { content: [], structuredContent: { projectPath: "/tmp/social-app", snapshot, recents: ["/tmp/social-app"] } };
    }
    return { content: [], structuredContent: {} };
  } };
  const { dom, act, panel } = await mount(t, app);
  const text = () => dom.window.document.getElementById("app-intelligence-panel")?.textContent ?? "";

  await act(async () => { panel.setAvailable(true); panel.show(); });
  assert.equal(panel.getSnapshot().busy, "loading", "the load just started");
  assert.match(text(), /Loading/, "a neutral loading state shows while a remembered project reloads");
  assert.doesNotMatch(text(), /Map a React Native app/, "not the empty state, as if nothing had ever been chosen");

  await act(async () => { await new Promise(done => setTimeout(done, 30)); });
  assert.equal(panel.getSnapshot().busy, null);
  assert.match(text(), /social-app/, "the remembered project's graph lands once the load resolves");
});

test("re-showing a panel that already has a graph reloads quietly, with no disabled flash", async t => {
  const snapshot = fixture();
  let calls = 0;
  const app = { async callServerTool({ name }: { name: string }) {
    if (name === "mobile_app_intel_snapshot") {
      calls++;
      await new Promise(done => setTimeout(done, 20));
      return { content: [], structuredContent: { projectPath: "/tmp/social-app", snapshot, recents: ["/tmp/social-app"] } };
    }
    return { content: [], structuredContent: {} };
  } };
  const { dom, act, panel } = await mount(t, app);
  const generateButton = () => [...dom.window.document.querySelectorAll("header button")].find(button => /Generate|Regenerate/.test(button.textContent ?? "")) as HTMLButtonElement | undefined;
  const generate = () => generateButton()?.textContent ?? "";
  const generateDisabled = () => generateButton()?.disabled;

  // The first open has nothing cached, so it is the one case that still shows a loading state.
  await act(async () => { panel.setAvailable(true); panel.show(); });
  await act(async () => { await new Promise(done => setTimeout(done, 30)); });
  assert.equal(calls, 1);
  assert.match(generate(), /Regenerate/, "a graph is already loaded");

  // Simulating a tool-switch away and back: the view remounts and calls show() again, but this
  // time a graph is already cached, so it must not flash "Loading" or disable the controls.
  await act(async () => { panel.hide(); });
  await act(async () => { panel.show(); });
  assert.equal(panel.getSnapshot().busy, null, "no disabled-controls flash while the cached graph is still shown");
  assert.equal(generateDisabled(), false, "Regenerate stays clickable during the quiet reload");
  assert.doesNotMatch(dom.window.document.getElementById("app-intelligence-panel")?.textContent ?? "", /Loading App Intelligence/);
  await act(async () => { await new Promise(done => setTimeout(done, 30)); });
  assert.equal(calls, 2, "the graph is still refreshed in the background");
  assert.equal(panel.getSnapshot().busy, null);
});

test("a quiet reload cannot overwrite a newer project selection", async t => {
  const snapshot = fixture();
  let snapshotCalls = 0;
  let releaseStale!: () => void;
  const stale = new Promise<void>(resolve => { releaseStale = resolve; });
  const app = { async callServerTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
    if (name === "mobile_app_intel_snapshot") {
      snapshotCalls++;
      if (snapshotCalls === 2) await stale;
      return { content: [], structuredContent: { projectPath: "/tmp/social-app", snapshot, recents: ["/tmp/social-app", "/tmp/other-app"] } };
    }
    if (name === "mobile_select_app_intel_project") {
      return { content: [], structuredContent: { projectPath: args?.projectPath, snapshot, recents: ["/tmp/other-app", "/tmp/social-app"] } };
    }
    return { content: [], structuredContent: {} };
  } };
  const { act, panel } = await mount(t, app);

  await act(async () => { panel.setAvailable(true); panel.show(); await new Promise(done => setTimeout(done, 0)); });
  assert.equal(panel.getSnapshot().projectPath, "/tmp/social-app");
  await act(async () => { panel.hide(); panel.show(); });
  await act(async () => { await panel.selectProject("/tmp/other-app"); });
  assert.equal(panel.getSnapshot().projectPath, "/tmp/other-app");

  releaseStale();
  await act(async () => { await stale; await new Promise(done => setTimeout(done, 0)); });
  assert.equal(panel.getSnapshot().projectPath, "/tmp/other-app", "the late response from the previous project is ignored");
});
