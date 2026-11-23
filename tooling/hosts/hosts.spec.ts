import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { codexToolBudget } from "../../apps/codex-plugin/tooling/codex-tool-limits.mjs";
import { oversizedFiles, PANEL_PARTS } from "../host-runtime.mjs";
import { pluginHost, pluginHosts } from "../plugin-hosts.mjs";
import { expect, hasPanel, test } from "./fixtures.ts";

const root = join(import.meta.dirname, "../..");

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

  // Platform limits the packages must fit, checked on every pull request rather than at release.
  test("every model-visible tool fits Codex's tool limits", async ({ server, target }) => {
    test.skip(target !== "codex", "Only Codex limits tool specifications.");
    const [name] = Object.keys(JSON.parse(readFileSync(join(root, "apps/codex-plugin/.mcp.json"), "utf8")).mcpServers);
    // The Agent Plugin format, a plugin.json at the plugin root, also limits each tool and their total.
    const agentPlugin = existsSync(join(root, "apps/codex-plugin/plugin.json"));
    const budget = codexToolBudget({ server: name, instructions: server.client.getInstructions(), tools: server.tools, agentPlugin });
    expect(budget.oversized, "Input schemas Codex compacts or tools it hides").toEqual([]);
    expect(budget.overTotal, `${budget.bytes} bytes of tools over the Agent Plugin total`).toBe(false);
  });

  test("every runtime file fits the host's file size limit", async ({ target }) => {
    test.skip(pluginHosts[target]?.maxFileBytes === undefined, "This host has no file size limit.");
    const host = pluginHost(target);
    // The built runtime holds every large file the package ships; packaging checks the whole package again.
    const oversized = await oversizedFiles(join(root, ".host-tests", target), host.maxFileBytes, host.bundlesPanel ? [] : PANEL_PARTS);
    expect(oversized, `Files over ${host.label}'s ${host.maxFileBytes}-byte limit`).toEqual([]);
  });

  test("only Codex ships the plugin updater", async ({ server, target }) => {
    const updater = server.tools.filter(tool => tool.name.includes("plugin_")).map(tool => tool.name).sort();
    expect(updater).toEqual(target === "codex" ? ["mobile_check_plugin_update", "mobile_migrate_plugin_to_store"] : []);
  });

  test("the workspace opens every tool without errors", async ({ openView, pageErrors, server }) => {
    test.skip(hasPanel(server) === false, "This target's server renders no panel in the chat.");
    const { view } = await openView("mobile_open_workspace");
    await expect(view.locator("#tool-select")).toContainText("Logs");
    for (const label of ["Performance", "Storage", "TraceSift", "Logs"]) {
      await view.locator("#tool-select").click();
      await view.getByRole("option", { name: label }).click();
      await expect(view.locator("#tool-select")).toContainText(label);
    }
    expect(pageErrors).toEqual([]);
  });

  test("Back to chat appears only where the host has no control of its own", async ({ openView, target, server }) => {
    test.skip(hasPanel(server) === false, "This target's server renders no panel in the chat.");
    const { view } = await openView("mobile_open_workspace", { displayMode: "fullscreen" });
    await expect(view.locator(".workspace-toolbar")).toBeVisible();
    await expect(view.getByRole("button", { name: "Back to chat" })).toHaveCount(target === "codex" ? 0 : 1);
  });

  test("the panel beside the chat opens inline", async ({ openView, pageErrors, server }) => {
    test.skip(hasPanel(server) === false, "This target's server renders no panel in the chat.");
    const { view } = await openView("mobile_open_simulator", { displayMode: "inline" });
    await expect(view.getByRole("button", { name: "Add device" })).toBeAttached();
    expect(pageErrors).toEqual([]);
  });

  test("a targeted panel initialized while hidden shows the device picker and keeps tools collapsed", async ({ openView, page, pageErrors, target }) => {
    test.skip(target !== "codex", "Codex retains inactive panels before displaying them.");
    const { view } = await openView("mobile_open_simulator", {
      arguments: { platform: "android" }, displayMode: "inline", initiallyHidden: true,
    });
    const empty = view.locator('[role="status"]').filter({ hasText: "Requested Android device unavailable" });
    await expect(empty).toBeAttached();
    const frame = page.locator("#view");
    await frame.evaluate(element => { element.removeAttribute("hidden"); });
    await expect(empty).toBeVisible();
    await expect(view.getByRole("button", { name: "Add device" })).toBeVisible();
    const toolsPanel = view.locator("#tools-resizable");
    await expect.poll(async () => (await toolsPanel.boundingBox())?.height).toBe(0);
    await expect(view.locator("#tool-select")).toContainText("Tools");

    const toolSelect = view.locator("#tool-select");
    await toolSelect.click();
    const logsOption = view.getByRole("option", { name: "Logs" });
    await logsOption.click();
    await expect(toolsPanel).toBeVisible();
    const initialTools = await toolsPanel.boundingBox();
    const divider = view.getByRole("separator", { name: "Resize tools and simulators" });
    const dividerBounds = await divider.boundingBox();
    if (dividerBounds === null || initialTools === null) throw new Error("The open tools pane has no resize handle.");
    const dragX = dividerBounds.x + dividerBounds.width / 2;
    const dragY = dividerBounds.y + dividerBounds.height / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX, dragY + 100, { steps: 5 });
    await page.mouse.up();
    const resizedTools = await toolsPanel.boundingBox();
    expect(resizedTools?.height).toBeLessThan(initialTools.height - 50);

    await frame.evaluate(element => { element.setAttribute("hidden", ""); });
    await expect(empty).toBeHidden();
    await frame.evaluate(element => { element.removeAttribute("hidden"); });
    await expect(empty).toBeVisible();
    await expect.poll(async () => (await toolsPanel.boundingBox())?.height).toBeCloseTo(resizedTools!.height, 1);
    await expect(toolSelect).toContainText("Logs");
    expect(pageErrors).toEqual([]);
  });
});

test.describe("Mac app", { tag: "@mac" }, () => {
  test("the sidebar switches tools and the workspace offers both device inventories", async ({ openMac, pageErrors }) => {
    const page = await openMac();
    await page.waitForFunction(() => window.mobileDevShell !== undefined);
    for (const tool of ["logs", "performance", "storage", "tracesift"]) {
      await page.evaluate(next => window.mobileDevShell!.selectTool(next), tool);
      await expect(page.getByText("Choose a tool in the sidebar"), tool).toHaveCount(0);
    }
    await page.evaluate(() => window.mobileDevShell!.selectTool(null));
    await page.getByRole("button", { name: "Add device" }).click();
    await expect(page.getByRole("heading", { name: "iOS", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Android", exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
