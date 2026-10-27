import { expect, test } from "./fixtures.ts";
import type { Theme } from "./profiles.ts";

// Screenshots of the Codex panel with no device attached, in light and dark. The
// baselines track main, so a pull request's diff shows what it changes visually.
// Comparisons are soft, so one changed screen does not hide the rest.
// Baselines come from the pinned Playwright Linux image so fonts and rendering
// match CI: refresh them with `npm run test:visual:docker -- --update-snapshots`, then review the diff.

const themes: Theme[] = ["light", "dark"];
const tools = [["performance", "Performance"], ["storage", "Storage"], ["tracesift", "TraceSift"]] as const;

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

  test(`panel beside the chat`, async ({ openView }) => {
    const { view } = await openView("mobile_open_simulator", { theme, displayMode: "inline", width: 480, arguments: { platform: "ios" } });
    await expect(view.locator("#ios-panel")).toBeVisible();
    await expect.soft(view.locator("body")).toHaveScreenshot(`panel-${theme}.png`);
  });
});
