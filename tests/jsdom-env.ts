import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";

/**
 * A JSDOM global scope plus an esbuild bundle of one UI module, torn down on test end.
 *
 * The components under test render for real, so they need the DOM globals React and `@xyflow/react`
 * reach for. `exports` is the import statement esbuild bundles; the result is that module's exports.
 *
 * Pass React's root unmount to `onTeardown`: it runs before the window closes, so an effect firing
 * during unmount still has a live DOM.
 */
export async function renderEnvironment<T = Record<string, unknown>>(
  t: TestContext,
  options: {
    /** e.g. `export { AppFlowView } from "./src/ui/components/app-flow-view.tsx";` */
    exports: string;
    /** Suffix for the temp bundle directory, to keep parallel test files apart. */
    slug: string;
    /** `@xyflow/react` needs these; only the graph canvases ask for them. */
    graph?: boolean;
    /** Extra globals a particular component needs, merged over the defaults. */
    extraGlobals?: Record<string, unknown>;
    /** Settle time before `dom.window.close()`, for components with pending effects. */
    settleMs?: number;
  }
): Promise<{ module: T; dom: JSDOM; onTeardown(fn: () => Promise<void> | void): void }> {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: "http://localhost",
  });
  const w = dom.window;
  const ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const DOMMatrixReadOnly = class { m22 = 1; constructor() {} };
  const globals: Record<string, unknown> = {
    window: w, document: w.document, navigator: w.navigator,
    HTMLElement: w.HTMLElement, HTMLFormElement: w.HTMLFormElement, HTMLButtonElement: w.HTMLButtonElement,
    HTMLInputElement: w.HTMLInputElement, Node: w.Node,
    Event: w.Event, CustomEvent: w.CustomEvent, NodeFilter: w.NodeFilter,
    Element: w.Element, DocumentFragment: w.DocumentFragment, MutationObserver: w.MutationObserver,
    localStorage: w.localStorage, getComputedStyle: w.getComputedStyle.bind(w),
    requestAnimationFrame: w.requestAnimationFrame.bind(w), cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
    ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true,
    ...(options.graph ? { DOMMatrixReadOnly } : {}),
    ...options.extraGlobals,
  };

  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  if (options.graph) {
    Object.defineProperty(w, "ResizeObserver", { value: ResizeObserver, configurable: true });
    Object.defineProperty(w, "DOMMatrixReadOnly", { value: DOMMatrixReadOnly, configurable: true });
  }

  const directory = await mkdtemp(resolve(`node_modules/.mobile-dev-${options.slug}-test-`));
  let teardown: () => Promise<void> | void = () => {};
  t.after(async () => {
    await teardown();
    if (options.settleMs) await new Promise(done => setTimeout(done, options.settleMs));
    w.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await rm(directory, { recursive: true, force: true });
  });

  const outfile = resolve(directory, "bundle.mjs");
  await build({
    stdin: { contents: options.exports, resolveDir: process.cwd(), loader: "ts" },
    outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "radix-ui", "lucide-react", "@base-ui/react/*", "@xyflow/react"],
  });
  return {
    module: (await import(pathToFileURL(outfile).href)) as T,
    dom,
    onTeardown(fn) {
      teardown = fn;
    },
  };
}
