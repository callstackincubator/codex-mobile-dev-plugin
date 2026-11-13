import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

test("assertion row inserts directly while its arrow offers an explicit timeout", async t => {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { AssertionBranch } from "./packages/ui/src/components/step-commands.tsx";
      export function mount() {
        const chosen = [];
        const root = createRoot(document.getElementById("root"));
        flushSync(() => root.render(<>
          <AssertionBranch offer={{ kind: "assertVisible", source: "expect(locator).toBeVisible()" }}
            onChoose={(...args) => chosen.push(args)} />
          <AssertionBranch offer={{ kind: "assertText", source: "expect(locator).toHaveText()", needsValue: true, suggestedValue: "Hello" }}
            onChoose={(...args) => chosen.push(args)} />
        </>));
        return { chosen, close: () => root.unmount() };
      }`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "AssertionMenuTest", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/",
  });
  const window = dom.window;
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", { value() {
    return { x: 0, y: 0, left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40, toJSON() {} };
  } });
  window.eval(built.outputFiles[0].text);
  const mounted = window.AssertionMenuTest.mount();
  t.after(() => { mounted.close(); window.close(); });
  const settle = () => new Promise(resolve => window.setTimeout(resolve, 25));
  const row = (kind: string) => window.document.querySelector<HTMLButtonElement>(`[data-recorder-offer="${kind}"]`)!;
  const panel = (kind: string) => window.document.querySelector<HTMLElement>(`[data-recorder-assertion-panel="${kind}"]`);

  row("assertVisible").click();
  await settle();
  assert.deepEqual(Array.from(mounted.chosen[0]), ["assertVisible"]);

  row("assertVisible").dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  await new Promise(resolve => window.setTimeout(resolve, 120));
  assert.ok(panel("assertVisible"), "Hover opens the assertion choices");
  row("assertVisible").dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
  await new Promise(resolve => window.setTimeout(resolve, 170));

  window.document.querySelector<HTMLButtonElement>('[aria-label="Is Visible options"]')!.click();
  await settle();
  assert.ok(panel("assertVisible"));
  assert.ok(panel("assertVisible")!.textContent?.includes("Insert"));
  assert.equal(panel("assertVisible")!.textContent?.includes("Use default timeout"), false);
  panel("assertVisible")!.querySelector<HTMLButtonElement>('[data-recorder-assertion-timeout]')!.click();
  await settle();
  const timeout = panel("assertVisible")!.querySelector<HTMLInputElement>('[aria-label="Assertion timeout in milliseconds"]')!;
  assert.equal(timeout.value, "5000");
  timeout.value = "30000";
  panel("assertVisible")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await settle();
  assert.deepEqual(Array.from(mounted.chosen[1]), ["assertVisible", undefined, 30000]);

  row("assertText").click();
  await settle();
  assert.equal(mounted.chosen.length, 2);
  assert.ok(panel("assertText")!.querySelector<HTMLInputElement>('[aria-label="Text to expect"]'));
  panel("assertText")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await settle();
  assert.deepEqual(Array.from(mounted.chosen[2]), ["assertText", "Hello", undefined]);
});
