import test from "node:test";
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

test("App Intelligence traces a screen, groups each hop by boundary and folds a group away", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Element: dom.window.Element, Event: dom.window.Event,
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

  const snapshot = fixture();
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const recents = ["/tmp/social-app", "/tmp/other-app"];
  const app = { async callServerTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
    calls.push({ name, arguments: args });
    if (name === "mobile_app_intel_snapshot") return { content: [], structuredContent: { projectPath: "/tmp/social-app", snapshot, recents } };
    if (name === "mobile_select_app_intel_project") return { content: [], structuredContent: { projectPath: args?.projectPath, snapshot, recents } };
    return { content: [], structuredContent: {} };
  } };
  const panel = new AppIntelligencePanel(app as unknown as App);
  const root = createRoot(dom.window.document.getElementById("root")!);
  unmount = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => { root.render(createElement(AppIntelligenceView, { panel })); });
  await act(async () => { panel.setAvailable(true); panel.show(); });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });

  const query = (selector: string) => dom.window.document.querySelectorAll(selector);
  const refs = () => [...query("[data-flow-node]")].map(node => node.getAttribute("data-flow-node"));
  const railEntries = () => [...query("aside [data-entry]")].map(entry => entry.getAttribute("data-entry"));
  const groups = () => [...query("[data-flow-group]")].map(node => node.getAttribute("data-flow-group"));
  assert.ok(dom.window.document.getElementById("app-intelligence-panel"), "the panel keeps the id the package smoke test asserts");

  // The picker is a dropdown over the remembered projects, so switching needs no folder picker.
  const picker = dom.window.document.querySelector("[data-project-picker]") as HTMLSelectElement;
  assert.equal(picker.tagName, "SELECT");
  assert.deepEqual([...picker.options].map(option => option.textContent), ["social-app", "other-app", "Choose another project…"]);
  await act(async () => {
    picker.value = "/tmp/other-app";
    picker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.deepEqual(calls.at(-1), { name: "mobile_select_app_intel_project", arguments: { projectPath: "/tmp/other-app" } });
  assert.equal(panel.getSnapshot().projectPath, "/tmp/other-app");

  // The Flow is the only view now: the rail lists entry points from the moment a snapshot loads.
  const rail = dom.window.document.querySelector("aside .overflow-auto") as HTMLElement;
  assert.equal(refs().length, 0, "no screen is selected yet");
  assert.ok(query("[data-flow-filter]").length === 1, "the entry-point filter is there before anything is traced");
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
  await act(async () => { chipDot.click(); });
  assert.equal(panel.getSnapshot().litBoundary, "*:other");
  assert.equal(chipDot.getAttribute("aria-pressed"), "true");
  assert.deepEqual(litOpacity("2:other"), ["1"], "a chip lights its boundary wherever it appears");
  assert.deepEqual(railEntries().sort(), ["home", "profile"], "and lighting it does not filter the rail");
  await act(async () => { chipDot.click(); });

  // An overflow is a control, not a label: clicking it opens the rest of that boundary.
  await act(async () => { panel.showAllIn("2:component"); });
  assert.deepEqual(panel.getSnapshot().expanded, ["2:component"]);

  // The orientation toggle re-reads the same graph downwards instead of across.
  const svg = () => dom.window.document.querySelector("[data-flow-orientation]") as SVGElement;
  assert.equal(svg().getAttribute("data-flow-orientation"), "columns");
  const before = refs();
  await act(async () => { (dom.window.document.querySelector('[data-orientation="tree"]') as HTMLButtonElement).click(); });
  assert.equal(svg().getAttribute("data-flow-orientation"), "tree");
  assert.deepEqual(refs(), before, "the toggle changes the reading direction, not the graph");
  assert.equal(panel.getSnapshot().orientation, "tree");

  // The filter is the entry-point rail's filter: unticking a boundary takes those entries out of
  // the rail without touching the traced graph.
  const chips = () => [...query("[data-flow-filter] [data-boundary]")].map(chip => chip.getAttribute("data-boundary"));
  assert.deepEqual(chips(), ["all", "other"], "both fixture entries render plain source files");
  assert.deepEqual(railEntries().sort(), ["home", "profile"]);
  const other = dom.window.document.querySelector('[data-flow-filter] [data-boundary="other"]') as HTMLButtonElement;
  await act(async () => { other.click(); });
  assert.deepEqual(railEntries(), [], "unticking the only boundary empties the rail");
  assert.ok(refs().length > 0, "the filter is the rail's, so the traced graph still draws in full");
  await act(async () => { (dom.window.document.querySelector('[data-flow-filter] [data-boundary="all"]') as HTMLButtonElement).click(); });
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
});
