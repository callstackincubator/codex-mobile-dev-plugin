import Ajv2020 from "ajv/dist/2020.js";
import { expect, test } from "./fixtures.ts";

// Regression checks for each shipped target, against its real server and page
// in a stand-in for its host. Device-backed behavior needs a simulator or emulator
// and is covered by the smoke scripts instead.

test.describe("MCP Apps hosts", () => {
  test("every tool schema compiles as JSON Schema 2020-12", async ({ server }) => {
    // Claude rejects tools that declare draft-07, which is what the MCP SDK emits.
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const tool of server.tools) {
      for (const [kind, schema] of [["input", tool.inputSchema], ["output", tool.outputSchema]] as const) {
        if (schema === undefined) continue;
        expect(schema.$schema ?? "https://json-schema.org/draft/2020-12/schema", `${tool.name} ${kind}`).toBe("https://json-schema.org/draft/2020-12/schema");
        expect(() => ajv.compile(schema), `${tool.name} ${kind}`).not.toThrow();
      }
    }
  });

  test("only Codex ships the plugin updater", async ({ server, target }) => {
    const updater = server.tools.filter(tool => tool.name.includes("plugin_update")).map(tool => tool.name).sort();
    expect(updater).toEqual(target === "codex" ? ["mobile_check_plugin_update", "mobile_install_plugin_update"] : []);
  });

  test("the workspace opens every tool without errors", async ({ openView, pageErrors }) => {
    const { view } = await openView("mobile_open_workspace");
    // Fullscreen opens with logs showing.
    await expect(view.locator("#tool-select")).toContainText("Logs");
    for (const label of ["Performance", "Storage", "TraceSift", "Logs"]) {
      await view.locator("#tool-select").click();
      await view.getByRole("option", { name: label }).click();
      await expect(view.locator("#tool-select")).toContainText(label);
    }
    expect(pageErrors).toEqual([]);
  });

  test("Back to chat appears only where the host has no control of its own", async ({ openView, target }) => {
    const { view } = await openView("mobile_open_workspace", { displayMode: "fullscreen" });
    await expect(view.locator(".workspace-toolbar")).toBeVisible();
    await expect(view.getByRole("button", { name: "Back to chat" })).toHaveCount(target === "codex" ? 0 : 1);
  });

  test("asking for devices shows the devices card", async ({ openView, pageErrors }) => {
    const { view } = await openView("mobile_show_devices", { displayMode: "inline" });
    // Without device tools the card lists what it can and notes the rest.
    await expect(view.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("the panel beside the chat opens inline", async ({ openView, pageErrors }) => {
    const { view } = await openView("mobile_open_simulator", { displayMode: "inline" });
    await expect(view.locator("#ios-panel, #android-panel").first()).toBeAttached();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("Mac app", { tag: "@mac" }, () => {
  test("the sidebar switches tools and platforms", async ({ openMac, pageErrors }) => {
    const page = await openMac();
    await page.waitForFunction(() => window.mobileDevShell !== undefined);
    for (const tool of ["logs", "performance", "storage", "tracesift"]) {
      await page.evaluate(next => window.mobileDevShell!.selectTool(next), tool);
      await expect(page.getByText("Choose a tool in the sidebar"), tool).toHaveCount(0);
    }
    await page.evaluate(() => window.mobileDevShell!.selectTool(null));
    await page.evaluate(() => window.mobileDevShell!.selectLayout("ios"));
    await expect(page.locator("#ios-panel")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
