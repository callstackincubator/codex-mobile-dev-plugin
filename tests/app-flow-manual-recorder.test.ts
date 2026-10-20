import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AppFlowRecordingStore } from "../src/ui/app-flow-recording.ts";
import { layoutWireframe } from "../src/ui/components/manual-wireframe.ts";

/**
 * The panel's one unrecoverable state was a status that never came back: an interaction that
 * failed, or whose tool call timed out, left `acting` on screen and the header read "Sending the
 * command…" over a session that had already given up. Both ends are covered — the store clears it
 * for the transport-level failure that produces no event at all, and `ManualSession.act` emits
 * `recording` again for the device-level one that does.
 */
test("a failed interaction returns the panel to recording instead of leaving it on 'Sending the command…'", async () => {
  const store = new AppFlowRecordingStore({
    callServerTool: async () => ({ isError: true, content: [{ type: "text", text: "That element is no longer on screen." }] }),
  } as never);
  store.accept({ type: "status", projectId: "p", nodeId: "n", status: "recording" });
  // `nodeId` is set by `start`; accept it the way the event channel would for a live session.
  store.accept({ type: "snapshot", projectId: "p", nodeId: "n", revision: 1, nodes: [], bounds: { x: 0, y: 0, width: 10, height: 10 } });
  store.accept({ type: "status", projectId: "p", nodeId: "n", status: "acting" });
  assert.equal(store.getSnapshot().status, "acting");

  await store.act("/tmp/project", { type: "scroll", direction: "down" });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, "recording", "the panel must not stay on the acting status");
  assert.equal(snapshot.pending, null, "the in-flight label must be cleared on every exit path");
  assert.match(snapshot.error ?? "", /no longer on screen/);
});

test("a second interaction is refused while one is in flight, and the one in flight is named", async () => {
  let release: (() => void) | null = null;
  const calls: unknown[] = [];
  const store = new AppFlowRecordingStore({
    callServerTool: async (request: unknown) => {
      calls.push(request);
      await new Promise<void>(resolve => { release = resolve; });
      return { isError: false, content: [] };
    },
  } as never);
  const first = store.act("/tmp/project", { type: "tap", target: { ref: "@1", label: "Compose new post" } });
  assert.deepEqual(store.getSnapshot().pending?.label, "Tapping Compose new post");
  await store.act("/tmp/project", { type: "scroll", direction: "up" });
  assert.equal(calls.length, 1, "a device call in flight owns the session — a second must not be queued behind it");
  release!();
  await first;
  assert.equal(store.getSnapshot().pending, null);
});

/** The panel itself: the lock, the named wait, and the list view onto a dense screen. */
test("the recorder panel locks its controls while the device is busy and lists every element", async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    localStorage: dom.window.localStorage, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const directory = await mkdtemp(resolve("node_modules/.mobile-dev-manual-recorder-test-"));
  let cleanup = async () => {};
  t.after(async () => { await cleanup(); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } await rm(directory, { recursive: true, force: true }); });
  const output = resolve(directory, "manual-recorder-panel.mjs");
  await build({
    stdin: { contents: 'export { ManualRecorderPanel } from "./src/ui/components/manual-recorder-panel.tsx";', resolveDir: process.cwd(), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*"],
  });
  const { ManualRecorderPanel } = await import(pathToFileURL(output).href);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const snapshot = {
    nodeId: "moderation", status: "acting" as const, statusMessage: null,
    snapshot: [{ ref: "@1", label: "Compose new post", rect: { x: 0, y: 100, width: 200, height: 40 } },
      { ref: "@2", label: "Discover", rect: { x: 0, y: 160, width: 200, height: 40 } }],
    bounds: { x: 0, y: 0, width: 390, height: 844 },
    steps: [{ command: "agent-device press 'label=Compose'", portable: true }],
    error: null, outcome: null, pending: { label: "Tapping Compose new post", startedAt: Date.now() },
  };
  const acted: unknown[] = [];
  const store = {
    subscribe: () => () => {}, getSnapshot: () => snapshot,
    act: async (_path: string, action: unknown) => { acted.push(action); },
    stop: async () => {}, cancel: async () => {}, dismiss: () => {}, clearError: () => {},
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  cleanup = async () => { await act(async () => { root.unmount(); }); };
  await act(async () => { root.render(createElement(ManualRecorderPanel, { projectPath: "/tmp/project", title: "Moderation", store })); });

  const panel = dom.window.document.querySelector('[role="dialog"]')!;
  assert.match(panel.textContent ?? "", /Tapping Compose new post/, "the header must name the command in flight, not say 'Sending the command…' forever");
  const elements = [...panel.querySelectorAll("button")].filter(button => /Compose new post|Discover/.test(button.textContent ?? ""));
  assert.ok(elements.length > 0, "the wireframe must draw the snapshot's elements");
  assert.ok(elements.every(button => (button as HTMLButtonElement).disabled), "every element must be locked while a device call is in flight");
  for (const button of elements) (button as HTMLButtonElement).click();
  assert.deepEqual(acted, [], "a click during the lock must not send a second command");

  const list = [...panel.querySelectorAll("button")].find(button => button.textContent === "list")!;
  await act(async () => { list.click(); });
  assert.match(panel.textContent ?? "", /Discover/, "the list view shows the same elements one per row");
});

/**
 * The overlap that made the preview unusable: a feed, a compose overlay and the tab bar's own
 * container each span most of the device, and whichever one hit-tested first swallowed every tap
 * aimed at a control inside it — "Chat" in the tab bar could not be reached at all.
 */
test("wrappers are marked as such and every nested control sits above them", () => {
  const bounds = { x: 0, y: 0, width: 390, height: 844 };
  const nodes = [
    { ref: "@screen", label: "Screen", rect: { x: 0, y: 0, width: 390, height: 844 } },
    { ref: "@compose", label: "New post", rect: { x: 0, y: 300, width: 390, height: 500 } },
    { ref: "@tabbar", label: "Tab Bar", rect: { x: 0, y: 780, width: 390, height: 60 } },
    { ref: "@chat", label: "Chat", rect: { x: 150, y: 790, width: 60, height: 40 } },
    { ref: "@badge", label: "3", rect: { x: 196, y: 792, width: 12, height: 12 } },
  ];
  const { boxes } = layoutWireframe(nodes, bounds, 360);
  const find = (ref: string) => boxes.find(box => box.node.ref === ref)!;

  assert.equal(find("@screen").container, true);
  assert.equal(find("@tabbar").container, true, "a row that encloses its own buttons is a wrapper");
  assert.equal(find("@chat").container, false, "a leaf control stays fully clickable");
  assert.ok(find("@chat").z > find("@tabbar").z && find("@chat").z > find("@screen").z,
    "the innermost element must paint and hit-test above everything that encloses it");
  assert.equal(find("@badge").container, false);
  // The case the "two or more enclosed children, and big" rule exists for: a tab button holding a
  // badge encloses something, and must still be a plain clickable box.
  assert.equal(find("@chat").container, false);
});

test("a screen too dense to compare every pair still lays out, with no wrapper detection", () => {
  const nodes = Array.from({ length: 700 }, (_, index) => ({
    ref: `@${index}`, label: `Row ${index}`, rect: { x: 0, y: index, width: 390, height: 844 - index },
  }));
  const { boxes } = layoutWireframe(nodes, { x: 0, y: 0, width: 390, height: 844 }, 360);
  assert.equal(boxes.length, 700);
  assert.ok(boxes.every(box => !box.container), "the O(n²) pass is skipped rather than run on a huge snapshot");
  assert.ok(boxes.every((box, index) => index === 0 || box.z > boxes[index - 1].z), "z still orders largest to smallest");
});

/**
 * The wireframe poll reschedules itself after each read rather than running on a fixed interval,
 * which means every exit path has to re-arm it. A failed interaction rethrows, and re-arming
 * anywhere that throw can skip froze the wireframe for the rest of the session — the panel went
 * on showing the screen the app had already left, with no interval underneath to recover it.
 */
test("the wireframe poll survives a failed interaction and stops dead on a discard", async () => {
  const { ManualSession } = await import("../src/app-flow/manual/session.ts");
  let snapshots = 0;
  let releaseSnapshot: (() => void) | null = null;
  let holdSnapshot = false;
  const closes: string[] = [];
  const device = {
    client: {
      capture: { snapshot: async () => {
        snapshots += 1;
        if (holdSnapshot) await new Promise<void>(resolve => { releaseSnapshot = resolve; });
        return { nodes: [] };
      } },
      sessions: { close: async () => { closes.push("close"); } },
      interactions: {},
    },
    launchProcess: null, metroLogPath: null, metroPort: 8081, deviceId: "sim", launchTarget: "app",
    launchUrl: null, setupCommands: [], lastRead: null,
  };
  const session = new ManualSession("/tmp/project", "project-1", "node-1");
  const live = session as unknown as { device: unknown; ctx: unknown };
  live.device = device;
  live.ctx = { projectPath: "/tmp/project", projectId: "project-1", platform: "ios", sessionName: "project-1-manual", scheme: null, appName: null, bundleId: null, slug: null };
  const statuses: string[] = [];
  session.on("event", (event: { type: string; status?: string }) => { if (event.type === "status" && event.status) statuses.push(event.status); });

  // No selector and no rect: `perform` refuses it, which is the ordinary "that element is stale"
  // failure the panel has to stay usable through.
  await assert.rejects(session.act({ type: "tap", target: { ref: "@gone" } }));
  assert.deepEqual(statuses, ["acting", "recording"], "the panel must be told the session is live again");
  const afterAct = snapshots;
  assert.ok(afterAct > 0, "the failed action still refreshes the wireframe — the app may have moved");

  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.ok(snapshots > afterAct, "the poll must be re-armed after a failed interaction, not left frozen");

  // A discard with a read in flight: it waits the read out before closing the session, because the
  // device is handed to the next recording rather than destroyed.
  holdSnapshot = true;
  await new Promise(resolve => setTimeout(resolve, 1200));
  const cancelled = session.cancel();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(closes, [], "the session must not be closed underneath an in-flight read");
  releaseSnapshot!();
  await cancelled;
  assert.ok(closes.length > 0, "the discard still releases the device once the read lands");

  const settled = snapshots;
  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.equal(snapshots, settled, "a discarded session must not keep polling");
});
