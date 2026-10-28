import { existsSync, readFileSync, readdirSync } from "node:fs";

/**
 * Hosts that load a plugin folder through their own manifest. Each is an app with a
 * `plugin-host.json`, which these scripts read:
 *   - `label`, `manifest`: the host's name and its manifest folder in the app.
 *   - `root`: the plugin-root variable its manifest starts the server from.
 *   - `config`: the local development config snippet (`npm run <host>:config`).
 *   - `desktopBundle`: an optional desktop bundle manifest, packaged as an MCPB.
 *   - `marketplace`: an optional local marketplace written beside the plugin.
 *   - `panel`: false for hosts whose server has no Mobile Dev panel; their packages
 *     leave out the panel's parts of the runtime.
 *   - `build`: an optional module in the app exporting `buildHost(outdir)`, which
 *     builds the host's own server into its staged runtime.
 *   - `skills`: the app's skill folders, instead of the shared ones.
 *   - `maxFileBytes`: the host's file size limit; packaging fails past it.
 * Adding such a host is adding that app; these scripts find it.
 */
export const pluginHosts = Object.fromEntries(readdirSync("apps")
  .filter(name => existsSync(`apps/${name}/plugin-host.json`))
  .map(name => [name, JSON.parse(readFileSync(`apps/${name}/plugin-host.json`, "utf8"))]));

// Codex-only files would load the Codex launcher or manifest.
export const codexOnlyPaths = [".mcp.json", "mcp.json", ".codex-plugin", "scripts/launch-mcp.sh"];

const sharedSkills = ["packages/skills/mobile-dev", "packages/skills/mobile-dev-setup"];

/** A host's settings with its app's paths resolved and defaults applied. */
export function pluginHost(name) {
  const host = pluginHosts[name];
  if (host === undefined) throw new Error(`Pass a host: ${Object.keys(pluginHosts).join(" or ")}.`);
  const app = `apps/${name}`;
  return {
    ...host, app, panel: host.panel !== false,
    desktopBundle: host.desktopBundle && `${app}/${host.desktopBundle}`,
    build: host.build && `${app}/${host.build}`,
    skills: host.skills?.map(path => `${app}/${path}`) ?? sharedSkills,
  };
}
