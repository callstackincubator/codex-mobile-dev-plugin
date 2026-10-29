import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test as base, expect, type FrameLocator, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, JSONRPCMessage, Tool } from "@modelcontextprotocol/sdk/types.js";
import { HOSTS, type Target, type Theme } from "./profiles.ts";

declare global {
  interface Window {
    /** The Mac page's entry points for the native sidebar, from apps/mac/web/main.tsx. */
    mobileDevShell?: { selectTool(tool: string | null): void; selectLayout(layout: string): void };
    /** Where Swift delivers the server's messages, from apps/mac/web/mac-bridge.ts. */
    __mobileDevReceive?: (message: JSONRPCMessage) => void;
  }
}

const root = resolve(import.meta.dirname, "../..");
const build = join(root, ".host-tests");
const HOST_ORIGIN = "https://host.test";

/** The real server a target ships, started over stdio in a throwaway home directory. */
async function startServer(target: Target) {
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-host-test-"));
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(build, target, "server.mjs")], cwd: join(build, target), stderr: "pipe",
    // No device tools on PATH or in the home directory: the tests see no devices on any machine.
    env: { PATH: "/usr/bin:/bin", HOME: home, MOBILE_DEV_TELEMETRY: "off" },
  });
  const stderr: string[] = [];
  transport.stderr?.on("data", chunk => { stderr.push(String(chunk)); });
  return { transport, stderr, async close() { await transport.close(); await rm(home, { recursive: true, force: true }); } };
}

type Opened = { view: FrameLocator; result: CallToolResult };

type Fixtures = {
  target: Target;
  /** Errors the page or the view logged; tests assert this stays empty. */
  pageErrors: string[];
  /** An MCP client for the target's server, as the host's MCP client. */
  server: { client: Client; tools: Tool[] };
  /** Opens the view a tool renders, as an MCP Apps host would after the model calls it. */
  openView(tool: string, options?: { arguments?: Record<string, unknown>; theme?: Theme; displayMode?: "inline" | "fullscreen"; width?: number }): Promise<Opened>;
  /** Loads the Mac app's page with a stand-in for the WebKit relay to its server. */
  openMac(options?: { theme?: Theme }): Promise<Page>;
};

export const test = base.extend<Fixtures>({
  target: ["claude", { option: true }],

  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await use(errors);
  },

  server: async ({ target }, use) => {
    const server = await startServer(target);
    const client = new Client({ name: HOSTS[target as keyof typeof HOSTS].clientName, version: "1" });
    try {
      await client.connect(server.transport);
      const { tools } = await client.listTools();
      await use({ client, tools });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error}\n${server.stderr.join("")}`);
    } finally {
      await client.close();
      await server.close();
    }
  },

  openView: async ({ page, target, server }, use) => {
    const host = HOSTS[target as keyof typeof HOSTS];
    await page.route(`${HOST_ORIGIN}/**`, async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || "host.html";
      await route.fulfill({ path: join(build, "harness", name) });
    });
    await page.exposeFunction("mcpRequest", (method: string, params: never) =>
      method === "tools/call" ? server.client.callTool(params) : server.client.readResource(params));
    await use(async (name, { arguments: args = {}, theme = "light", displayMode = "fullscreen", width } = {}) => {
      const tool = server.tools.find(candidate => candidate.name === name);
      const uri = (tool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri;
      if (uri === undefined) throw new Error(`${name} has no UI resource.`);
      const result = await server.client.callTool({ name, arguments: args }) as CallToolResult;
      const resource = await server.client.readResource({ uri });
      const html = (resource.contents[0] as { text: string }).text;
      await page.emulateMedia({ colorScheme: theme });
      if (width !== undefined) await page.setViewportSize({ width, height: page.viewportSize()!.height });
      const context = host.context(theme, displayMode);
      context.containerDimensions = { ...page.viewportSize()! };
      await page.goto(`${HOST_ORIGIN}/host.html`);
      await page.evaluate(options => window.harness.open(options), {
        html, hostInfo: host.hostInfo, capabilities: host.capabilities, context, tool: { arguments: args, result },
      });
      return { view: page.frameLocator("#view"), result };
    });
  },

  openMac: async ({ page, pageErrors }, use) => {
    const server = await startServer("mac");
    // Like the app, load the page built beside the server; the page is the server's only MCP client.
    await page.route(`${HOST_ORIGIN}/**`, route => route.fulfill({ contentType: "text/html", path: join(build, "mac", "mac.html") }));
    // Swift writes the page's messages to the server's stdin and evaluates each line it prints.
    server.transport.onmessage = message => { void page.evaluate(line => window.__mobileDevReceive?.(line), message as JSONRPCMessage).catch(() => {}); };
    await server.transport.start();
    await page.exposeFunction("macRelay", (text: string) => server.transport.send(JSON.parse(text)));
    // The page reports a failed connection, such as an unreadable telemetry resource, to the shell.
    await page.exposeFunction("macShell", (message: { type: string; message?: string }) => {
      if (message.type === "error") pageErrors.push(`Shell error: ${message.message}`);
    });
    await page.addInitScript(() => {
      const relay = window as unknown as { macRelay(text: string): void; macShell(message: unknown): void };
      Object.defineProperty(window, "webkit", { value: { messageHandlers: {
        mcp: { postMessage: (text: string) => relay.macRelay(text) },
        shell: { postMessage: (message: unknown) => relay.macShell(message) },
      } } });
    });
    try {
      await use(async ({ theme = "light" } = {}) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`${HOST_ORIGIN}/mac.html`);
        return page;
      });
    } finally {
      await server.close();
    }
  },
});

export { expect };
