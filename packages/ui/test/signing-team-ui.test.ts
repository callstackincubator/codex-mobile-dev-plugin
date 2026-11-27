import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const TEAMS = [{ id: "ABCDE12345", name: "Hur Ali" }, { id: "FGHIJ67890", name: "Callstack" }];

async function mountSigning(scenario: { signing: Record<string, unknown>; device?: Record<string, unknown>; matrixDevices?: unknown[] }) {
  const built = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { TestingPanel } from "./packages/ui/src/testing-panel.ts";
      import { SigningTeam } from "./packages/ui/src/components/testing-matrix.tsx";
      export function mount(scenario) {
        const calls = [];
        const host = { async callServerTool({ name, arguments: input }) {
          calls.push({ name, input });
          if (name === "mobile_testing_ios_signing") return { content: [], structuredContent: scenario.signing };
          if (name === "mobile_testing_ios_signing_team") return { content: [], structuredContent: { ...scenario.signing, saved: input.teamId } };
          return { content: [], structuredContent: {} };
        }, getHostCapabilities() { return undefined; } };
        const state = { device: scenario.device, apps: [], ready: true };
        const deviceApps = { subscribe: () => () => undefined, getSnapshot: () => state };
        const panel = new TestingPanel(host, deviceApps, { heartbeatMs: 1e9 });
        panel.update({ available: true, matrixDevices: scenario.matrixDevices ?? [] });
        const root = createRoot(document.getElementById("root"));
        flushSync(() => root.render(<SigningTeam panel={panel} />));
        return { panel, calls, close: () => { root.unmount(); panel.dispose?.(); } };
      }`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", globalName: "RenderTest", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, runScripts: "outside-only", url: "https://mobile-dev.test/" });
  const window = dom.window as unknown as Record<string, any>;
  window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.eval(built.outputFiles[0]!.text);
  const mounted = window.RenderTest.mount(scenario);
  await new Promise(resolve => setTimeout(resolve, 50));
  return { dom, mounted, root: dom.window.document.getElementById("root")! };
}

test("an env-pinned team is read-only and says how to change it; any other source is a dropdown", async t => {
  const pinned = await mountSigning({ signing: { teams: TEAMS, resolved: { id: "ABCDE12345", name: "Hur Ali", source: "env", envVar: "AGENT_DEVICE_IOS_TEAM_ID" } } });
  t.after(() => pinned.mounted.close());
  assert.equal(pinned.root.querySelector("[role=combobox]"), null);
  assert.match(pinned.root.textContent ?? "", /set by AGENT_DEVICE_IOS_TEAM_ID/);
  assert.match(pinned.root.textContent ?? "", /unset AGENT_DEVICE_IOS_TEAM_ID and restart/);

  const chosen = await mountSigning({ signing: { teams: TEAMS, saved: "ABCDE12345", resolved: { id: "ABCDE12345", name: "Hur Ali", source: "user" } } });
  t.after(() => chosen.mounted.close());
  const trigger = chosen.root.querySelector("[role=combobox]") as HTMLElement | null;
  assert.ok(trigger, "the dropdown renders for a saved choice");
  assert.match(trigger!.textContent ?? "", /Hur Ali \(ABCDE12345\)/);
  assert.equal(chosen.root.querySelector("[data-ios-signing]")?.getAttribute("data-ios-signing"), "user");
});

test("choosing Automatic clears the saved team and another team switches it", async t => {
  const view = await mountSigning({ signing: { teams: TEAMS, saved: "ABCDE12345", resolved: { id: "ABCDE12345", source: "user" } } });
  t.after(() => view.mounted.close());
  await view.mounted.panel.chooseIosTeam("FGHIJ67890");
  await view.mounted.panel.chooseIosTeam(undefined);
  const saves = view.mounted.calls.filter((call: { name: string }) => call.name === "mobile_testing_ios_signing_team");
  assert.deepEqual(Array.from(saves, (call: { input: { teamId?: string } }) => call.input.teamId), ["FGHIJ67890", undefined]);
  // The control offers every keychain team and an Automatic row, however it is opened.
  const trigger = view.root.querySelector("[role=combobox]") as HTMLElement;
  const window = view.dom.window;
  trigger.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  trigger.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await new Promise(resolve => setTimeout(resolve, 100));
  const options = [...window.document.querySelectorAll("[role=option]")].map(option => option.textContent);
  assert.deepEqual(options, ["Automatic", "Hur Ali (ABCDE12345)", "Callstack (FGHIJ67890)"]);
});

test("the signing team shows only for a connected iPhone", async t => {
  const phone = { deviceId: "p", name: "iPhone", platform: "ios", kind: "physical", runtime: "iOS", booted: false };
  const cases: [string, { device?: Record<string, unknown>; matrixDevices?: unknown[] }, boolean][] = [
    ["a paired but unplugged iPhone in the matrix", { matrixDevices: [phone] }, false],
    ["a connected, paired iPhone in the matrix", { matrixDevices: [{ ...phone, booted: true }] }, true],
    ["an Android phone", { matrixDevices: [{ ...phone, platform: "android", booted: true }] }, false],
    ["a simulator", { matrixDevices: [{ ...phone, kind: "simulator", booted: true }] }, false],
    ["a disconnected mirrored iPhone", { device: { udid: "p", name: "iPhone", state: "disconnected", platform: "ios", kind: "physical" } }, false],
    ["a connected mirrored iPhone", { device: { udid: "p", name: "iPhone", state: "connected", platform: "ios", kind: "physical" } }, true],
  ];
  for (const [label, scenario, expected] of cases) {
    const view = await mountSigning({ signing: { teams: TEAMS }, ...scenario });
    t.after(() => view.mounted.close());
    assert.equal(view.mounted.panel.showsSigningTeam, expected, label);
  }
});
