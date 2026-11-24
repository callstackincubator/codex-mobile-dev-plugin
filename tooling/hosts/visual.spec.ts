import { expect, test } from "./fixtures.ts";
import { recordingFixture, recordingWithFramesFixture } from "../../packages/test-support/recording-fixtures.ts";
import type { Theme } from "./profiles.ts";

// Screenshots of the Codex panel with no device attached, in light and dark. The
// baselines track main, so a pull request's diff shows what it changes visually.
// Comparisons are soft, so one changed screen does not hide the rest.
// Baselines come from the pinned Playwright Linux image so fonts and rendering
// match CI: refresh them with `npm run test:visual:docker -- --update-snapshots`, then review the diff.

const themes: Theme[] = ["light", "dark"];
const tools = [["performance", "Performance"], ["storage", "Storage"], ["app-intel", "App Intel"], ["tracesift", "TraceSift"]] as const;

for (const theme of themes) test.describe(`${theme}`, { tag: "@visual" }, () => {
  test(`workspace`, async ({ openView }) => {
    const { view } = await openView("mobile_open_workspace", { theme });
    await expect(view.locator("#tool-select")).toContainText("Logs");
    await expect.soft(view.locator("body")).toHaveScreenshot(`workspace-logs-${theme}.png`);
    for (const [name, label] of tools) {
      await view.locator("#tool-select").click();
      // The open menu over the tool below it, where Performance's timeline once covered it.
      if (name === "storage") await expect.soft(view.locator("body")).toHaveScreenshot(`workspace-menu-over-performance-${theme}.png`);
      // The keyboard selects even where something covers the option; hosts.spec.ts clicks.
      await view.getByRole("option", { name: label }).press("Enter");
      await expect(view.locator("#tool-select")).toContainText(label);
      await expect.soft(view.locator("body")).toHaveScreenshot(`workspace-${name}-${theme}.png`);
    }
  });

  test("device picker", async ({ openView }) => {
    const device = { state: "Shutdown", runtime: "iOS 27.0" };
    const inventory = {
      ios: [{ ...device, name: "iPhone 17 Pro", udid: "iphone" }, { ...device, name: "iPad Air", udid: "ipad" }],
      android: [{ ...device, name: "Pixel 9", udid: "avd:Pixel_9", runtime: "Android" }],
    };
    const { view } = await openView("mobile_open_simulator", { theme, displayMode: "inline", width: 480, inventory });
    await view.getByRole("button", { name: "Add device" }).click();
    const picker = view.getByRole("dialog", { name: "Choose devices" });
    await expect(picker.getByText("iPhone 17 Pro")).toBeVisible();
    await expect.soft(picker).toHaveScreenshot(`device-picker-${theme}.png`);
  });

  test("Testing Studio runtime download", async ({ openView, server }) => {
    const callTool = server.client.callTool.bind(server.client);
    server.client.callTool = async (request, ...options) => {
      if (request.name === "mobile_testing_project_config") {
        return { content: [], structuredContent: { runtimeMode: "bundled", targets: [], needsRuntime: true } };
      }
      if (request.name === "mobile_testing_prepare_runtime" || request.name === "mobile_testing_runtime_progress") {
        return { content: [], structuredContent: { progress: { phase: "downloading", received: 5_000_000, total: 25_000_000 } } };
      }
      return callTool(request, ...options);
    };
    const { view } = await openView("mobile_open_workspace", { theme, width: 480 });
    await view.locator("#tool-select").click();
    await view.getByRole("option", { name: "Testing Studio" }).click();
    const studio = view.getByRole("region", { name: "Testing Studio", exact: true });
    await expect(studio.getByRole("progressbar")).toBeVisible();
    await expect(studio).toHaveScreenshot(`testing-runtime-${theme}.png`);
  });

  test("visible hitch markers on the FPS curve", async ({ openView, server, page }) => {
    const recording = recordingFixture();
    recording.target = { platform: "ios", kind: "physical", deviceId: "test-phone", bundleId: "dev.example.shop" };
    recording.iosHitches = { status: "finished", end: 30, events: [
      { time: 3.45, lateMs: 8.33, refreshIntervalMs: 8.33 },
      { time: 12.5, lateMs: 33.33, refreshIntervalMs: 16.67 },
    ] };
    const callTool = server.client.callTool.bind(server.client);
    server.client.callTool = (request, ...options) => {
      if (request.name === "mobile_render_performance_recording") {
        return Promise.resolve({ content: [], structuredContent: { recording, range: { start: 10, end: 15 } } });
      }
      return callTool(request, ...options);
    };
    const { view } = await openView("mobile_render_performance_recording", { theme, arguments: { recordingId: recording.id } });
    const track = view.getByRole("region", { name: "Display FPS", exact: true });
    const picker = track.getByRole("combobox", { name: "Inspect" });
    const marker = track.locator('[data-frame-index="1"]');
    await marker.click();
    await expect(picker).toHaveValue("marker-1");
    await expect(track).toContainText("12.500 s · 60 Hz · 33.33 ms late · 2 refresh intervals · 30.0 FPS in this sample");
    const summary = view.getByRole("region", { name: "Hitch statistics" });
    await expect(summary).toContainText("33.33 ms");
    await picker.selectOption("sample-14");
    await expect(track).toContainText("30.0 FPS · 0 visible hitches");
    const chart = track.locator(".recording-chart");
    const bounds = await chart.boundingBox();
    if (bounds === null) throw new Error("Missing FPS plot.");
    const x = (time: number) => bounds.x + 52 + time / 30 * (bounds.width - 64);
    const y = bounds.y + 64;
    await page.mouse.click(x(12.75), y);
    await expect(picker).toHaveValue("sample-12");
    await expect(track).toContainText("30.0 FPS · 1 visible hitch");
    await marker.hover();
    await page.mouse.down();
    await page.mouse.move(x(16), y, { steps: 4 });
    await page.mouse.up();
    const overview = view.getByRole("region", { name: "Recording range overview" });
    await expect(overview).toContainText("16.0s");
    await overview.getByRole("button", { name: "Clear" }).click();
    await picker.selectOption("marker-0");
    await expect(track).toContainText("120 Hz · 8.33 ms late · 1 refresh interval · 60.0 FPS");
    await expect(track.locator('[data-frame-index="0"] text')).toHaveText("3.450 s");
    await picker.blur();
    await expect(track).toHaveScreenshot(`recording-hitches-${theme}.png`);
  });

  test("Android display-frame markers", async ({ openView, server }) => {
    const recording = recordingWithFramesFixture();
    const callTool = server.client.callTool.bind(server.client);
    server.client.callTool = (request, ...options) => {
      if (request.name === "mobile_render_performance_recording") {
        return Promise.resolve({ content: [], structuredContent: { recording } });
      }
      return callTool(request, ...options);
    };
    const { view } = await openView("mobile_render_performance_recording", { theme, arguments: { recordingId: recording.id } });
    const track = view.getByRole("region", { name: "Display FPS", exact: true });
    const picker = track.getByRole("combobox", { name: "Inspect" });
    await expect(track.locator("[data-frame-index]")).toHaveCount(2);
    await track.locator('[data-frame-index="1"]').click();
    await expect(track).toContainText("Dropped display frame");
    await picker.selectOption("sample-12");
    await expect(track).toContainText("30.0 FPS · 2 flagged display frames");
    await picker.selectOption("sample-1");
    await expect(track).toContainText("FrameTimeline unavailable for this sample");
    await picker.selectOption("marker-0");
    await expect(track).toContainText("Late display frame · SurfaceFlinger scheduling");
    await picker.blur();
    await track.getByRole("heading").hover();
    await expect(track).toHaveScreenshot(`android-frame-markers-${theme}.png`);
  });

  test(`panel beside the chat`, async ({ openView }) => {
    const { view } = await openView("mobile_open_simulator", { theme, displayMode: "inline", width: 480, arguments: { platform: "ios" } });
    await expect(view.getByText("Requested iOS device unavailable.", { exact: false })).toBeVisible();
    await expect.soft(view.locator("body")).toHaveScreenshot(`panel-${theme}.png`);
  });
});
