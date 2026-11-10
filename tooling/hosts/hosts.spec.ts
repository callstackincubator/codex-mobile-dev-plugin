import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { codexToolBudget } from "../../apps/codex-plugin/tooling/codex-tool-limits.mjs";
import { oversizedFiles, PANEL_PARTS } from "../host-runtime.mjs";
import { pluginHost, pluginHosts } from "../plugin-hosts.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { HOSTS } from "./profiles.ts";
import { expect, startServer, test } from "./fixtures.ts";

const root = join(import.meta.dirname, "../..");

// Regression checks for each shipped target, against its real server and page
// in a stand-in for its host. Device-backed behavior needs a simulator or emulator
// and is covered by the smoke scripts instead.

// Both hosts expose the shared native MCP Apps panel.
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

  test("Claude exposes the same device and app tools as Codex", async ({ server, target }) => {
    test.skip(target !== "claude", "Compare Claude with Codex once.");
    const codex = await startServer("codex");
    const client = new Client({ name: HOSTS.claude.clientName, version: "1" }, { capabilities: HOSTS.claude.clientCapabilities });
    try {
      await client.connect(codex.transport);
      const { tools } = await client.listTools();
      expect(server.tools).toEqual(tools.filter(tool => !tool.name.includes("plugin_")));
      expect(server.tools.some(tool => tool.name === "mobile_read_panel_context")).toBe(false);
    } finally { await client.close(); await codex.close(); }
  });

  test("native panels request the side panel and recordings can open in the workspace", async ({ server, target }) => {
    for (const name of ["mobile_open_simulator", "mobile_open_workspace", "mobile_open_app_intel", "mobile_open_performance_recording"]) {
      const tool = server.tools.find(tool => tool.name === name)!;
      expect(tool?._meta?.ui).toHaveProperty("resourceUri");
      const resource = await server.client.readResource({ uri: (tool._meta!.ui as { resourceUri: string }).resourceUri });
      expect(resource.contents[0]._meta?.ui).toHaveProperty("preferredDisplayMode", "fullscreen");
    }
    for (const name of ["mobile_render_performance_recording", "mobile_compare_performance_recordings"]) {
      const tool = server.tools.find(tool => tool.name === name)!;
      const resource = await server.client.readResource({ uri: (tool._meta!.ui as { resourceUri: string }).resourceUri });
      expect(resource.contents[0].text).toContain("data-workspace");
    }
    if (target === "claude") {
      expect(existsSync(join(root, ".host-tests/claude/browser-panel.html"))).toBe(false);
      // App Intelligence opens without device helpers, so check the opening result too.
      const result = await server.client.callTool({ name: "mobile_open_app_intel", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.browserPanel).toBeUndefined();
      expect(JSON.stringify(result.content)).not.toContain("http://127.0.0.1");
    }
  });

  test("the workspace opens every tool without errors", async ({ openView, pageErrors, server }) => {
    test.skip(hasPanel(server) === false, "This target's server renders no panel in the chat.");
    const { view } = await openView("mobile_open_workspace");
    await expect(view.locator("#tool-select")).toContainText("Logs");
    for (const label of ["Performance", "Storage", "App Intel", "TraceSift", "Logs"]) {
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
