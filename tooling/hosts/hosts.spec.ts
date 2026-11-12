import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { codexToolBudget } from "../../apps/codex-plugin/tooling/codex-tool-limits.mjs";
import { oversizedFiles, PANEL_PARTS } from "../host-runtime.mjs";
import { pluginHost, pluginHosts } from "../plugin-hosts.mjs";
import { expect, test } from "./fixtures.ts";

const root = join(import.meta.dirname, "../..");

// Regression checks for each shipped target, against its real server and page
// in a stand-in for its host. Device-backed behavior needs a simulator or emulator
// and is covered by the smoke scripts instead.

// Claude shows devices in its own simulator views, so its server has no panel.
// A panel that renders in the chat; Claude's shows beside it, in a browser (browser-panel.spec.ts).
const hasPanel = (server: { tools: { name: string; _meta?: Record<string, unknown> }[] }) =>
  server.tools.some(tool => tool.name === "mobile_open_workspace" && (tool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri !== undefined);

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

  test("the Testing panel puts the mirror, the preview and the steps side by side", async ({ openView, page, server }) => {
    test.skip(hasPanel(server) === false, "This target's server renders no panel in the chat.");
    // Recording is done by tapping the mirror and read back in the preview beside it, so the three
    // panes are a row: a quarter for the mirror, which is tapped, and the rest for what is read.
    // This asks for the row itself rather than for `split`, which is false outside the fullscreen
    // workspace — the mirror then kept the 60% default meant for a tool stacked under it, and the
    // preview and the steps were left sharing the height below it.
    for (const displayMode of ["fullscreen", "inline"] as const) {
      await page.setViewportSize({ width: 1280, height: 800 });
      const { view } = await openView("mobile_open_workspace", { displayMode });
      // A mirror needs a platform to show: with none the pane is collapsed, which is the point of
      // the shares below. These hosts see no devices, so the platform is chosen here.
      await view.locator("#platform-select").click();
      await view.getByRole("option", { name: "iOS" }).click();
      await page.keyboard.press("Escape");
      await view.locator("#tool-select").click();
      await view.getByRole("option", { name: "Testing" }).click();
      await view.locator("[data-testing-recorder-workspace]").waitFor();
      const share = async (selector: string) => {
        const box = await view.locator(selector).boundingBox();
        return Math.round((box?.width ?? 0) / 1280 * 100);
      };
      // The panel's own padding and the gaps between the panes come off the two that are read, so
      // the shares are 25/45/30 of the pane area and a little under that of the window.
      expect(await share("#simulators-resizable"), `the mirror in ${displayMode}`).toBe(25);
      expect(await share("#testing-preview-resizable"), `the preview in ${displayMode}`).toBeGreaterThan(40);
      expect(await share("#testing-steps-resizable"), `the steps in ${displayMode}`).toBeGreaterThan(26);
      // And in that order, left to right: the mirror leads, because it is what is acted on.
      const mirror = await view.locator("#simulators-resizable").boundingBox();
      const preview = await view.locator("#testing-preview-resizable").boundingBox();
      const steps = await view.locator("#testing-steps-resizable").boundingBox();
      expect(mirror!.x).toBeLessThan(preview!.x);
      expect(preview!.x).toBeLessThan(steps!.x);
    }
  });

  test("a platform found while the Testing panel is open opens the mirror", async ({ openView, page, server }) => {
    test.skip(hasPanel(server) === false, "This target's server renders no panel in the chat.");
    // The ordinary order: the panel opens while the backend is still looking, and discovery
    // selects a simulator a moment later. The mirror used to stay shut through that — the panel
    // asked for its own shares during the commit that changed its panels' constraints, where the
    // group discards them and keeps what it last requested, which was a mirror of nothing.
    await page.setViewportSize({ width: 1280, height: 800 });
    const { view } = await openView("mobile_open_workspace", { displayMode: "fullscreen" });
    await view.locator("#tool-select").click();
    await view.getByRole("option", { name: "Testing" }).click();
    await view.locator("[data-testing-recorder-workspace]").waitFor();
    const mirror = view.locator("#simulators-resizable");
    // Nothing to mirror yet, so the pane is collapsed rather than an empty quarter of the window.
    await expect.poll(async () => Math.round((await mirror.boundingBox())?.width ?? 0)).toBe(0);
    await page.keyboard.press("Escape");
    await view.locator("#platform-select").click();
    await view.getByRole("option", { name: "iOS" }).click();
    await expect.poll(async () => Math.round((await mirror.boundingBox())?.width ?? 0)).toBe(320);
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
    await expect(view.locator("#ios-panel, #android-panel").first()).toBeAttached();
    expect(pageErrors).toEqual([]);
  });

  test("an Android panel initialized while hidden shows its device controls and keeps tools collapsed", async ({ openView, page, pageErrors, target }) => {
    test.skip(target !== "codex", "Codex retains inactive panels before displaying them.");
    const { view } = await openView("mobile_open_simulator", {
      arguments: { platform: "android" }, displayMode: "inline", initiallyHidden: true,
    });
    await expect(view.locator("#platform-select")).toContainText("Android");
    await expect(view.locator("#android-panel")).toHaveJSProperty("hidden", false);
    const frame = page.locator("#view");
    await frame.evaluate(element => { element.removeAttribute("hidden"); });

    await expect(view.locator("#android-panel")).toBeVisible();
    await expect(view.getByRole("toolbar", { name: "Android controls" })).toBeVisible();
    await expect(view.locator("#android-devices")).toBeVisible();
    const android = await view.locator("#android-resizable").boundingBox();
    const ios = await view.locator("#ios-resizable").boundingBox();
    const tools = await view.locator("#tools-resizable").boundingBox();
    expect(android?.width).toBeGreaterThan(0);
    expect(ios?.width).toBe(0);
    expect(tools?.height).toBe(0);
    await expect(view.locator("#tool-select")).toContainText("Tools");

    const toolSelect = view.locator("#tool-select");
    await toolSelect.click();
    const logsOption = view.getByRole("option", { name: "Logs" });
    await logsOption.click();
    const toolsPanel = view.locator("#tools-resizable");
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
    await expect(view.locator("#android-panel")).toBeHidden();
    await frame.evaluate(element => { element.removeAttribute("hidden"); });
    await expect(view.locator("#android-panel")).toBeVisible();
    const restoredTools = await toolsPanel.boundingBox();
    expect(restoredTools?.height).toBeCloseTo(resizedTools!.height, 1);
    await expect(toolSelect).toContainText("Logs");
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
