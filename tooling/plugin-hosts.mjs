// Hosts that load a plugin folder through their own manifest in `apps/<host>`. They
// start the shared server with Node from PATH at the manifest's plugin-root variable.
// Adding such a host is a manifest, an icon and an entry here.
export const pluginHosts = {
  claude: {
    label: "Claude", manifest: ".claude-plugin", root: "CLAUDE_PLUGIN_ROOT",
    // Claude Desktop also installs a self-contained MCPB bundle.
    desktopBundle: "apps/claude/manifest.json",
    config: { file: "claude-desktop-config.json", server: {}, target: "Claude Desktop Settings > Developer > Edit Config, then fully restart Claude" },
  },
  cursor: {
    label: "Cursor", manifest: ".cursor-plugin", root: "CURSOR_PLUGIN_ROOT",
    config: { file: "cursor-mcp.json", server: { type: "stdio" }, target: "~/.cursor/mcp.json, then reload Cursor" },
  },
};

export const documents = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];
// Codex-only files would load the Codex launcher or manifest.
export const codexOnlyPaths = [".mcp.json", "mcp.json", ".codex-plugin", "scripts/launch-mcp.sh"];

export function pluginHost(name) {
  const host = pluginHosts[name];
  if (host === undefined) throw new Error(`Pass a host: ${Object.keys(pluginHosts).join(" or ")}.`);
  return { ...host, app: `apps/${name}` };
}
