import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { test as base, expect, startServer } from "./fixtures.ts";

const test = base.extend<{ browserPanel: { url: string; close(): Promise<void>; host: Client } }>({
  browserPanel: async ({}, use) => {
    const server = await startServer("claude");
    const host = new Client({ name: "claude-code", version: "1" });
    try {
      await host.connect(server.transport);
      const result = await host.callTool({ name: "mobile_open_simulator", arguments: { platform: "ios" } });
      const text = JSON.stringify(result.content);
      const url = text.match(/http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/\?[^"\s]+/)?.[0];
      if (url === undefined) throw new Error(`The host received no browser panel link: ${text}`);
      await use({ url, host, close: () => server.close() });
    } finally {
      await host.close();
      await server.close();
    }
  },
});

test.describe("Browser panels", { tag: "@browser" }, () => {
  test("the real page opens and reloads beside a host without MCP Apps", async ({ page, browserPanel, request }) => {
    const scriptErrors: string[] = [];
    page.on("pageerror", error => scriptErrors.push(error.message));
    const initialized = page.waitForResponse(response => response.headers()["mcp-session-id"] !== undefined);
    await page.goto(browserPanel.url);
    const response = await initialized;
    const session = response.headers()["mcp-session-id"];
    const view = page.frameLocator("iframe");
    await expect(view.locator("#ios-panel")).toBeVisible();
    await page.reload();
    await expect(view.locator("#ios-panel")).toBeVisible();
    const endpoint = new URL("mcp", browserPanel.url);
    await expect.poll(async () => {
      const probe = await request.post(endpoint.href, { headers: { "mcp-session-id": session } });
      return probe.status();
    }).toBe(404);
    await browserPanel.host.ping();
    expect(scriptErrors).toEqual([]);
  });

  test("the agent reads what the page would give a chat host's model context", async ({ page, browserPanel }) => {
    const read = async () => {
      const result = await browserPanel.host.callTool({ name: "mobile_read_panel_context", arguments: {} });
      return JSON.stringify(result.content);
    };
    expect(await read()).toContain("No Mobile Dev browser panel");
    await page.goto(browserPanel.url);
    await expect(page.frameLocator("iframe").locator("#ios-panel")).toBeVisible();
    await expect.poll(read).toContain("Mobile Dev browser panel.");
    await page.close();
    await expect.poll(read).toContain("No Mobile Dev browser panel");
  });

  test("closing a tab preserves the other tab and the chat connection", async ({ page, context, browserPanel }) => {
    await page.goto(browserPanel.url);
    const other = await context.newPage();
    try {
      await other.goto(browserPanel.url);
      const view = other.frameLocator("iframe");
      await expect(view.locator("#ios-panel")).toBeVisible();
      await page.close();
      await other.reload();
      await expect(view.locator("#ios-panel")).toBeVisible();
      await browserPanel.host.ping();
    } finally { await other.close(); }
  });

  test("a stopped chat server replaces the idle panel with a clear message", async ({ page, browserPanel }) => {
    await page.clock.install();
    await page.goto(browserPanel.url);
    const view = page.frameLocator("iframe");
    await expect(view.locator("#ios-panel")).toBeVisible();
    await browserPanel.close();
    await page.clock.runFor(30_000);
    await expect(page.getByRole("alert")).toContainText("Mobile Dev disconnected from its chat session");
  });

  test("a host that renders MCP Apps, like the desktop app's Code tab, gets the page beside the chat", async ({ page }) => {
    const server = await startServer("claude");
    const host = new Client({ name: "claude-code", version: "1" }, { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } as ClientCapabilities });
    try {
      await host.connect(server.transport);
      const { tools } = await host.listTools();
      expect(tools.find(tool => tool.name === "mobile_open_simulator")?._meta?.ui).toBeUndefined();
      const result = await host.callTool({ name: "mobile_open_simulator", arguments: { platform: "ios" } });
      const url = JSON.stringify(result.content).match(/http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/\?[^"\s\\]+/)?.[0];
      expect(url, "The link to show beside the chat").toBeDefined();
      await page.goto(url!);
      await expect(page.frameLocator("iframe").locator("#ios-panel")).toBeVisible();
    } finally {
      await host.close();
      await server.close();
    }
  });

  test("an unrelated tool cannot run from a panel link", async ({ page, browserPanel }) => {
    const url = new URL(browserPanel.url);
    url.searchParams.set("tool", "mobile_show_devices");
    await page.goto(url.href);
    await expect(page.getByRole("alert")).toContainText("This link does not open a Mobile Dev panel");
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});
