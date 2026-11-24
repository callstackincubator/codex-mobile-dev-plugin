import { expect, test } from "./fixtures.ts";
import { recordingFixture } from "../../packages/test-support/recording-fixtures.ts";
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

  test("visible hitch markers", async ({ openView, server }) => {
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
    const track = view.getByRole("region", { name: "Visible hitches", exact: true });
    const marker = track.getByRole("slider");
    await marker.press("End");
    await expect(marker).toHaveAttribute("aria-valuetext", /12.500 s · 60 Hz · 33.33 ms late/);
    const summary = view.getByRole("region", { name: "Hitch statistics" });
    await expect(summary).toContainText("33.33 ms");
    await expect(track).toHaveScreenshot(`recording-hitches-${theme}.png`);
  });

  test(`panel beside the chat`, async ({ openView }) => {
    const { view } = await openView("mobile_open_simulator", { theme, displayMode: "inline", width: 480, arguments: { platform: "ios" } });
    await expect(view.locator("#ios-panel")).toBeVisible();
    await expect.soft(view.locator("body")).toHaveScreenshot(`panel-${theme}.png`);
  });
});
