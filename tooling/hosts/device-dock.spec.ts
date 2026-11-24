import type { FrameLocator, Locator, Page } from "@playwright/test";
import { expect, hasPanel, test } from "./fixtures.ts";
import type { SimulatorDevice } from "../../packages/shared/src/protocol.ts";

const iphone: SimulatorDevice = { udid: "iphone", name: "iPhone 17 Pro", platform: "ios", state: "Shutdown", runtime: "iOS 27" };
const pixel: SimulatorDevice = { udid: "pixel", name: "Pixel 9", platform: "android", kind: "physical", state: "offline", runtime: "Android" };
const tablet = { ...pixel, udid: "tablet", name: "Pixel Tablet" };
const inventory = { ios: [iphone], android: [pixel, tablet] };

async function selectAndroid(view: FrameLocator) {
  await view.getByRole("button", { name: "Add device" }).click();
  const picker = view.getByRole("dialog");
  await picker.getByRole("button", { name: /Pixel 9/ }).click();
  await expect(picker).toBeHidden();
  await view.getByRole("button", { name: "Add device" }).last().click();
  await picker.getByRole("button", { name: /Pixel Tablet/ }).click();
  await expect(picker).toBeHidden();
  await expect(view.getByRole("tab")).toHaveCount(3);
}

async function drag(page: Page, source: Locator, destination: Locator, x: number, y: number) {
  const start = await source.boundingBox();
  const end = await destination.boundingBox();
  if (!start || !end) throw new Error("Missing device tab or drop target");
  const fromX = start.x + start.width / 3;
  const fromY = start.y + start.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + 10, fromY + 4, { steps: 4 });
  await page.mouse.move(end.x + end.width * x, end.y + end.height * y, { steps: 16 });
  await page.mouse.up();
}

for (const theme of ["light", "dark"] as const) {
  test(`mixed device tab groups in ${theme} @visual`, async ({ page, openView, pageErrors }) => {
    const { view } = await openView("mobile_open_simulator", { arguments: { deviceId: iphone.udid }, displayMode: "inline", theme, width: 900, inventory });
    await selectAndroid(view);
    const pane = view.locator("[data-device-pane]:visible");
    await expect(pane).toHaveCount(3);
    const pixelTab = view.getByRole("tab", { name: pixel.name });
    const phone = view.locator(`[data-device-pane][aria-label="${iphone.name}"]`);
    await drag(page, pixelTab, phone, 0.5, 0.5);
    await expect(pane).toHaveCount(2);
    await expect(view.getByRole("tablist")).toHaveCount(2);
    await expect.soft(view.locator("#simulator-panels")).toHaveScreenshot(`device-tabs-split-${theme}.png`);
    expect(pageErrors).toEqual([]);
  });
}

test("rounded dock overlays do not resize a device that fits", async ({ openView, server }) => {
  test.skip(hasPanel(server) === false, "This target opens the workspace in a separate browser tab.");
  const { view } = await openView("mobile_open_simulator", { arguments: { deviceId: iphone.udid }, displayMode: "inline", width: 720, inventory });
  const dock = view.locator("#simulator-panels");
  await dock.getByRole("tab", { name: iphone.name }).waitFor();
  await dock.evaluate(element => { element.style.width = "706.67px"; });
  // A rounded Dockview layer can extend past its shell at fractional host zoom.
  await dock.locator(".dv-render-overlay").evaluate(element => {
    element.style.boxSizing = "content-box";
    element.style.paddingRight = "1px";
    element.style.paddingBottom = "1px";
  });
  const fits = await dock.evaluate(async element => {
    for (let frame = 0; frame < 12; frame++) {
      await new Promise(requestAnimationFrame);
      if (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight) return false;
    }
    return true;
  });
  expect(fits).toBe(true);
});

test("choosing a device dismisses the picker and keeps Add device centered in narrow groups", async ({ openView, server }) => {
  test.skip(hasPanel(server) === false, "This target opens the workspace in a separate browser tab.");
  const { view } = await openView("mobile_open_simulator", { displayMode: "inline", width: 360, inventory });
  await view.getByRole("button", { name: "Add device" }).click();
  const picker = view.getByRole("dialog");
  await picker.getByRole("button", { name: /Pixel 9/ }).press("Enter");
  await expect(picker).toBeHidden();
  const firstAdd = view.getByRole("button", { name: "Add device" });
  await expect(firstAdd).toBeFocused();
  const buttonBox = (await firstAdd.boundingBox())!;
  const tabBox = (await view.getByRole("tab", { name: pixel.name }).boundingBox())!;
  const buttonCenter = buttonBox.y + buttonBox.height / 2;
  const tabCenter = tabBox.y + tabBox.height / 2;
  expect(Math.abs(buttonCenter - tabCenter)).toBeLessThan(1);
  await firstAdd.press("Enter");
  await picker.getByRole("button", { name: /Pixel Tablet/ }).click();
  await expect(picker).toBeHidden();
  await expect(view.getByRole("tablist")).toHaveCount(2);
  const dock = view.locator("#simulator-panels");
  await expect.poll(() => dock.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(60);
  const add = dock.getByRole("button", { name: "Add device" }).last();
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await expect(picker).toBeVisible();
});

test("devices split at every edge, nest, rejoin and reorder without replacing their canvases", async ({ page, openView, pageErrors, server }) => {
  test.skip(hasPanel(server) === false, "This target opens the workspace in a separate browser tab.");
  const { view } = await openView("mobile_open_simulator", { arguments: { deviceId: iphone.udid }, displayMode: "inline", width: 1000, inventory });
  await selectAndroid(view);
  const dock = view.locator("#simulator-panels");
  const tab = (name: string) => dock.getByRole("tab", { name, exact: true });
  const panel = (name: string) => dock.locator(`[data-device-pane][aria-label="${name}"]`);
  await dock.locator("canvas").evaluateAll(canvases => canvases.forEach(canvas => canvas.setAttribute("data-original", "")));
  await expect(dock.getByRole("tablist")).toHaveCount(3);
  const bounds = await dock.locator("[data-device-pane]:visible").evaluateAll(panes => panes.map(pane => pane.getBoundingClientRect().x));
  expect(new Set(bounds).size).toBe(3);
  await drag(page, tab(pixel.name), panel(iphone.name), 0.5, 0.5);
  await drag(page, tab(tablet.name), panel(pixel.name), 0.5, 0.5);
  await expect(dock.getByRole("tablist")).toHaveCount(1);
  const edges = [[0.08, 0.5], [0.92, 0.5], [0.5, 0.08], [0.5, 0.92]];
  for (const [x, y] of edges) {
    await drag(page, tab(tablet.name), panel(tablet.name), x, y);
    await expect(dock.getByRole("tablist")).toHaveCount(2);
    await expect(dock.locator("[data-device-pane]:visible")).toHaveCount(2);
    const peer = dock.locator(`[data-device-pane]:visible:not([aria-label="${tablet.name}"])`);
    const from = (await panel(tablet.name).boundingBox())!;
    const to = (await peer.boundingBox())!;
    if (x < 0.5) expect(from.x + from.width).toBeLessThanOrEqual(to.x + 2);
    if (x > 0.5) expect(from.x).toBeGreaterThanOrEqual(to.x + to.width - 2);
    if (y < 0.5) expect(from.y + from.height).toBeLessThanOrEqual(to.y + 2);
    if (y > 0.5) expect(from.y).toBeGreaterThanOrEqual(to.y + to.height - 2);
    await drag(page, tab(tablet.name), peer, 0.5, 0.5);
    await expect(dock.getByRole("tablist")).toHaveCount(1);
  }
  await drag(page, tab(tablet.name), panel(tablet.name), 0.92, 0.5);
  await drag(page, tab(iphone.name), panel(tablet.name), 0.5, 0.9);
  await expect(dock.getByRole("tablist")).toHaveCount(3);
  await drag(page, tab(iphone.name), tab(pixel.name), 0.1, 0.5);
  await expect(dock.getByRole("tablist")).toHaveCount(2);
  const group = dock.getByRole("tablist").filter({ has: view.getByRole("tab", { name: pixel.name, exact: true }) });
  await drag(page, tab(pixel.name), tab(iphone.name), 0.1, 0.5);
  await expect(group.getByRole("tab").first()).toHaveAccessibleName(pixel.name);
  const header = dock.locator(".dv-tabs-and-actions-container").filter({ has: view.getByRole("tab", { name: pixel.name, exact: true }) });
  await drag(page, header.locator(".dv-void-container"), panel(tablet.name), 0.5, 0.92);
  const moved = (await panel(pixel.name).boundingBox())!;
  const above = (await panel(tablet.name).boundingBox())!;
  expect(moved.y).toBeGreaterThanOrEqual(above.y + above.height - 2);
  await expect(group.getByRole("tab")).toHaveCount(2);
  await expect(dock.locator("canvas[data-original]")).toHaveCount(3);
  await tab(pixel.name).getByRole("button").click();
  await expect(tab(pixel.name)).toHaveCount(0);
  const phoneGroup = dock.locator(".dv-groupview").filter({ has: view.getByRole("tab", { name: iphone.name, exact: true }) });
  await tab(tablet.name).click();
  await phoneGroup.getByRole("button", { name: "Add device" }).click();
  await expect(view.getByRole("button", { name: /Pixel 9/ })).toHaveAttribute("aria-pressed", "false");
  await view.getByRole("button", { name: /Pixel 9/ }).click();
  await expect(view.getByRole("dialog")).toBeHidden();
  const restored = (await panel(pixel.name).boundingBox())!;
  const phoneBox = (await panel(iphone.name).boundingBox())!;
  expect(restored.x).toBeGreaterThanOrEqual(phoneBox.x + phoneBox.width - 2);
  expect(Math.abs(restored.y - phoneBox.y)).toBeLessThan(2);
  expect(pageErrors).toEqual([]);
});
