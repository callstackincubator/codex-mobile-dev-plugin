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
    files: { "app/index.tsx": file(1), "app/profile.tsx": file(1), "src/shared.ts": file(2), "src/only.ios.ts": file(1) },
    packages: { "left-pad": { name: "left-pad", reach: 2, entry: "node_modules/left-pad/index.js" } },
    screens: {
      home: { title: "Home", route: "/", source: "app/index.tsx", layouts: [] },
      profile: { title: "Profile", route: "/profile", source: "app/profile.tsx", layouts: [] },
    },
    edges, diagnostics: [], indexes,
  };
}

test("App Intelligence renders the Atlas, hides packages by default and traces a screen in the Flow", async t => {
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
  assert.ok(dom.window.document.getElementById("app-intelligence-panel"), "the panel keeps the id the package smoke test asserts");
  const cells = [...query("[data-atlas-cell]")].map(cell => cell.getAttribute("data-atlas-cell"));
  assert.ok(cells.length > 0, "the Atlas draws cells");
  assert.ok(cells.includes("src/shared.ts"), "every file gets a cell");
  assert.ok(!cells.some(path => path?.startsWith("node_modules")), "packages are hidden until asked for");

  const packages = dom.window.document.getElementById("app-intel-packages") as HTMLButtonElement;
  assert.equal(packages.getAttribute("aria-pressed"), "false");
  await act(async () => { packages.click(); });
  assert.equal(packages.getAttribute("aria-pressed"), "true");
  assert.ok([...query("[data-atlas-cell]")].some(cell => cell.getAttribute("data-atlas-cell") === "node_modules/left-pad"), "the toggle brings packages in");

  // The hottest file is reached by both screens, so it outranks the two screen sources.
  const rail = dom.window.document.querySelector("aside .overflow-auto") as HTMLElement;
  assert.match(rail.textContent ?? "", /src\/shared\.ts/);

  await act(async () => { (dom.window.document.querySelector('[data-view="flow"]') as HTMLButtonElement).click(); });
  assert.equal(query("[data-flow-node]").length, 0, "no screen is selected yet");
  assert.ok(query("[data-flow-filter]").length === 1, "the entry-point filter is there before anything is traced");
  const screenButton = [...rail.querySelectorAll("button")].find(button => button.textContent?.includes("Profile"));
  assert.ok(screenButton, "the rail lists screens in the Flow view");
  await act(async () => { screenButton.click(); });
  const nodes = [...query("[data-flow-node]")].map(node => node.getAttribute("data-flow-node"));
  assert.deepEqual(nodes.slice(0, 2), ["screen:profile", "file:app/profile.tsx"], "the screen leads, then its source");
  assert.ok(nodes.includes("file:src/shared.ts") && nodes.includes("file:src/only.ios.ts"), "both imports appear at the next hop");
  assert.ok(!nodes.includes("screen:home"), "the other screen is not part of this flow");

  assert.ok(!/\bHOP\b|\bROOT\b/.test(dom.window.document.querySelector("[data-flow-canvas]")?.textContent ?? ""), "the depth tint carries the hop, with no column headings");

  // The Flow tints each hop rather than drawing one muted ladder.
  const hops = [...query("[data-flow-node]")].map(node => (node.querySelector("rect") as SVGRectElement).getAttribute("fill"));
  assert.equal(new Set(hops).size > 1, true, "cards differ in colour by depth");

  // The filter is the entry-point rail's filter: its chips come from what the entry points are,
  // and unticking one takes those entries out of the rail without touching the traced graph.
  const chips = () => [...query("[data-flow-filter] [data-boundary]")].map(chip => chip.getAttribute("data-boundary"));
  const railEntries = () => [...query("aside [data-entry]")].map(entry => entry.getAttribute("data-entry"));
  assert.deepEqual(chips(), ["all", "other"], "both fixture entries render plain source files");
  assert.deepEqual(railEntries().sort(), ["home", "profile"]);
  const other = dom.window.document.querySelector('[data-flow-filter] [data-boundary="other"]') as HTMLButtonElement;
  await act(async () => { other.click(); });
  assert.equal(other.getAttribute("aria-pressed"), "false");
  assert.deepEqual(railEntries(), [], "unticking the only boundary empties the rail");
  assert.match((dom.window.document.querySelector("aside") as HTMLElement).textContent ?? "", /0 entry points/, "the header counts what the rail shows");
  assert.ok([...query("[data-flow-node]")].length > 0, "the filter is the rail's, so the traced graph still draws in full");
  await act(async () => { (dom.window.document.querySelector('[data-flow-filter] [data-boundary="all"]') as HTMLButtonElement).click(); });
  assert.deepEqual(railEntries().sort(), ["home", "profile"], "All brings them back");

  // Dragging pans the board itself, which is what the old scroll-based pan failed to do when the
  // graph already fitted its pane. The drag must not re-root the graph on the card underneath.
  const canvas = dom.window.document.querySelector("[data-flow-canvas]") as HTMLElement;
  const board = canvas.firstElementChild as HTMLElement;
  const pointer = (type: string, x: number, y: number, target: EventTarget) =>
    target.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }));
  assert.equal(board.style.transform, "translate(0px, 0px)");
  const rooted = panel.getSnapshot().flowRoot;
  await act(async () => {
    pointer("pointerdown", 300, 200, canvas);
    pointer("pointermove", 220, 170, dom.window);
    pointer("pointerup", 220, 170, dom.window);
  });
  assert.equal(board.style.transform, "translate(-80px, -30px)", "the board follows the pointer");
  await act(async () => { (dom.window.document.querySelector("[data-flow-node]") as Element).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  assert.equal(panel.getSnapshot().flowRoot, rooted, "the click that ends a drag is swallowed");
  await act(async () => { canvas.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })); });
  assert.equal(board.style.transform, "translate(0px, 0px)", "double-click recentres");

  // The picker is a dropdown over the remembered projects, so switching needs no folder picker.
  const picker = dom.window.document.querySelector("[data-project-picker]") as HTMLSelectElement;
  assert.equal(picker.tagName, "SELECT");
  assert.deepEqual([...picker.options].map(option => option.textContent), ["social-app", "other-app", "Choose another project…"]);
  assert.equal(picker.value, "/tmp/social-app", "the current project is the one shown");
  await act(async () => {
    picker.value = "/tmp/other-app";
    picker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.deepEqual(calls.at(-1), { name: "mobile_select_app_intel_project", arguments: { projectPath: "/tmp/other-app" } });
  assert.equal(panel.getSnapshot().projectPath, "/tmp/other-app");

  // A directory in the Atlas is clickable in its own right, not only through its children.
  await act(async () => { (dom.window.document.querySelector('[data-view="atlas"]') as HTMLButtonElement).click(); });
  const group = dom.window.document.querySelector("[data-atlas-group]") as HTMLButtonElement;
  assert.ok(group, "the Atlas draws at least one directory frame");
  const target = group.getAttribute("data-atlas-group") as string;
  await act(async () => { group.click(); });
  assert.equal(panel.getSnapshot().atlasPath, target, "clicking the directory name zooms into it");
});
