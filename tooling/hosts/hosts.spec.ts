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

  test("Codex can read the panel's selected device without a composer attachment", async ({ openView, page, server, target }) => {
    test.skip(target !== "codex", "Exercises the native Codex panel.");
    const deviceId = "avd:Pixel";
    const device = { udid: deviceId, name: "Pixel", platform: "android", kind: "emulator", state: "Shutdown", runtime: "Android" };
    const callTool = server.client.callTool.bind(server.client);
    let readResourceSaving = false;
    server.client.callTool = async (request, ...options) => {
      if (request.name === "mobile_list_android_devices") {
        return { content: [], structuredContent: { connected: true, managed: false, baseUrl: "", devices: [device] } };
      }
      if (request.name === "mobile_resource_saving") {
        readResourceSaving = true;
        return { content: [], structuredContent: { state: { supported: false, enabled: false, running: false, restartRequired: false } } };
      }
      return callTool(request, ...options);
    };
    const { view } = await openView("mobile_open_simulator", { arguments: { platform: "android", deviceId } });
    const selection = async () => {
      const result = await callTool({ name: "mobile_read_panel_context", arguments: {} });
      return result.structuredContent;
    };
    await expect.poll(selection).toMatchObject({ activeDeviceId: deviceId });
    await expect.poll(() => readResourceSaving).toBe(true);
    await expect(view.locator('[data-device-pane][data-platform="android"]').getByRole("button", { name: "Resource saving" })).toHaveCount(0);
    const attachments = await page.evaluate(() => window.harness.events.filter(event => event.method === "modelContext"));
    expect(attachments).toEqual([]);
    await page.evaluate(() => window.harness.teardown());
    await expect.poll(selection).toEqual({ devices: [] });
  });

  test("a host without local iOS opens Android setup and keeps the iOS panel selectable", async ({ openView, page, server, target }) => {
    test.skip(target !== "codex", "Exercises the native Codex panel.");
    // The Windows server runs against the fixture's fresh profile and empty PATH. On other
    // systems substitute its iOS capability, so the same panel behavior is exercised on CI.
    if (process.platform !== "win32") {
      const empty = { connected: false, managed: false, baseUrl: "", devices: [] };
      const callTool = server.client.callTool.bind(server.client);
      server.client.callTool = async (request, ...options) => {
        if (request.name === "mobile_list_simulators") return { content: [], structuredContent: { ...empty, localIosSupported: false } };
        if (request.name === "mobile_list_ios_devices") return { content: [], structuredContent: { physicalDevices: [] } };
        return callTool(request, ...options);
      };
    }
    const { view } = await openView("mobile_open_simulator");
    await expect(view.locator("#simulator-panels")).toContainText(/Install Android SDK Platform-Tools.*SDK Manager/);
    await view.getByRole("button", { name: "Add device" }).click();
    const picker = view.getByRole("dialog", { name: "Choose devices" });
    await expect(picker.getByText("Local iOS devices require macOS.")).toBeVisible();
    await expect(picker.getByText(/Install Android SDK Platform-Tools.*SDK Manager/)).toBeVisible();
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

  test("Testing Studio downloads on open and recovers from a failed installation", async ({ openView, server, target, pageErrors }) => {
    test.skip(target !== "codex");
    let phase = "downloading";
    let configReads = 0;
    let polls = 0;
    const callTool = server.client.callTool.bind(server.client);
    server.client.callTool = async (request, ...options) => {
      if (request.name === "mobile_testing_project_config") {
        configReads++;
        return { content: [], structuredContent: { runtimeMode: "bundled", targets: [], needsRuntime: true } };
      }
      if (request.name === "mobile_testing_prepare_runtime" || request.name === "mobile_testing_runtime_progress") {
        polls++;
        if (request.arguments?.retry) phase = "installing";
        const progress = { phase, received: 5_000_000, total: 25_000_000, message: "The download was interrupted." };
        return { content: [], structuredContent: { progress } };
      }
      return callTool(request, ...options);
    };
    const { view } = await openView("mobile_open_workspace");
    await expect.poll(() => configReads).toBeGreaterThan(0);
    expect(polls).toBe(0);
    await view.locator("#tool-select").click();
    await view.getByRole("option", { name: "Testing Studio" }).click();
    await expect(view.getByRole("progressbar")).toHaveAttribute("value", "5000000");
    await expect(view.getByText("5.0 of 25.0 MB")).toBeVisible();
    phase = "failed";
    await expect(view.getByText("The download was interrupted.")).toBeVisible();
    await view.getByRole("button", { name: "Retry download" }).click();
    await expect(view.getByText("Installing the Testing Studio runtime")).toBeVisible();
    phase = "ready";
    await expect(view.getByText("Installing the Testing Studio runtime")).toHaveCount(0);
    await expect(view.getByRole("button", { name: "Retry download" })).toHaveCount(0);
    await expect(view.locator("[data-testing-blocker]")).toBeVisible();
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
      const device = { udid: "phone", name: "iPhone", runtime: "iOS", state: "Shutdown" };
      const inventory = { ios: [device], android: [] };
      const { view } = await openView("mobile_open_workspace", { displayMode, inventory, arguments: { deviceId: device.udid } });
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
    const device = { udid: "phone", name: "iPhone", runtime: "iOS", state: "Booted" };
    const inventory = { ios: [] as typeof device[], android: [] };
    await page.setViewportSize({ width: 1280, height: 800 });
    const { view } = await openView("mobile_open_workspace", { displayMode: "fullscreen", inventory });
    await view.locator("#tool-select").click();
    await view.getByRole("option", { name: "Testing" }).click();
    await view.locator("[data-testing-recorder-workspace]").waitFor();
    const mirror = view.locator("#simulators-resizable");
    await expect.poll(async () => Math.round((await mirror.boundingBox())?.width ?? 0)).toBe(0);
    inventory.ios.push(device);
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
