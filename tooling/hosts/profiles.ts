import type { McpUiHostCapabilities, McpUiHostContext, McpUiStyles } from "@modelcontextprotocol/ext-apps/app-bridge";

export type Theme = "light" | "dark";
export type Target = "codex" | "claude" | "mac";

/**
 * What an MCP Apps host advertises to the panel. These stand in for the real hosts,
 * whose apps cannot run in CI: they reproduce the capabilities and context the UI
 * branches on, and representative style tokens. When a host changes what it
 * advertises, update its profile here.
 */
export type HostProfile = {
  /** The name the host's MCP client reports to the server. */
  clientName: string;
  hostInfo: { name: string; version: string };
  capabilities: McpUiHostCapabilities;
  context(theme: Theme, displayMode: "inline" | "fullscreen"): McpUiHostContext;
};

const chat = { serverTools: {}, serverResources: {}, openLinks: {}, message: { text: {} }, updateModelContext: { text: {}, image: {}, structuredContent: {} } };

// Hosts send a subset of the standard tokens; the UI falls back for the rest.
function tokens(theme: Theme, radius: string, font: string): McpUiStyles {
  const dark = theme === "dark";
  return {
    "--font-sans": font,
    "--border-radius-md": radius,
    "--color-background-primary": dark ? "#181818" : "#ffffff",
    "--color-background-secondary": dark ? "#212121" : "#f7f7f7",
    "--color-background-tertiary": dark ? "#2a2a2a" : "#efefef",
    "--color-background-inverse": dark ? "#f5f5f5" : "#0d0d0d",
    "--color-text-primary": dark ? "#f5f5f5" : "#0d0d0d",
    "--color-text-secondary": dark ? "#a3a3a3" : "#5d5d5d",
    "--color-text-inverse": dark ? "#0d0d0d" : "#ffffff",
    "--color-text-danger": dark ? "#ff8583" : "#e02e2a",
    "--color-border-primary": dark ? "#333333" : "#e5e5e5",
    "--color-border-secondary": dark ? "#2a2a2a" : "#ededed",
    "--color-ring-primary": dark ? "#5c9eff" : "#0169cc",
  } as McpUiStyles;
}

export const HOSTS: Record<Exclude<Target, "mac">, HostProfile> = {
  codex: {
    clientName: "codex-mcp-client",
    hostInfo: { name: "codex", version: "1" },
    // Codex routes messages and model context through OpenAI's extensions.
    capabilities: { ...chat, experimental: { "openai/message": {}, "openai/modelContext": {}, "openai/files": {} } },
    context: (theme, displayMode) => ({
      theme, displayMode, availableDisplayModes: ["inline", "fullscreen"], platform: "desktop", locale: "en-US",
      // Codex sends its own UI font, the system font.
      styles: { variables: tokens(theme, "10px", '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif') },
    }),
  },
  claude: {
    clientName: "claude-ai",
    hostInfo: { name: "Claude Desktop", version: "1" },
    capabilities: chat,
    context: (theme, displayMode) => ({
      theme, displayMode, availableDisplayModes: ["inline", "fullscreen"], platform: "desktop", locale: "en-US",
      styles: { variables: tokens(theme, "8px", "ui-sans-serif, system-ui, sans-serif") },
    }),
  },
};
