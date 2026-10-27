import { existsSync, readFileSync, readdirSync } from "node:fs";

/**
 * Hosts that load a plugin folder through their own manifest. Each is an app with a
 * `plugin-host.json`: its manifest folder, the plugin-root variable its manifest
 * starts the shared server from, an optional desktop bundle manifest, and the local
 * config snippet. Adding such a host is adding that app; these scripts find it.
 */
export const pluginHosts = Object.fromEntries(readdirSync("apps")
  .filter(name => existsSync(`apps/${name}/plugin-host.json`))
  .map(name => [name, JSON.parse(readFileSync(`apps/${name}/plugin-host.json`, "utf8"))]));

// Codex-only files would load the Codex launcher or manifest.
export const codexOnlyPaths = [".mcp.json", "mcp.json", ".codex-plugin", "scripts/launch-mcp.sh"];

export function pluginHost(name) {
  const host = pluginHosts[name];
  if (host === undefined) throw new Error(`Pass a host: ${Object.keys(pluginHosts).join(" or ")}.`);
  const app = `apps/${name}`;
  return { ...host, app, desktopBundle: host.desktopBundle && `${app}/${host.desktopBundle}` };
}
