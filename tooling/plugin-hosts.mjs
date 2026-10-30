import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
 *   - `panelRuntime`: "download" for hosts whose packages leave out the panel's parts
 *     while their server keeps the panel. Packaging writes those parts as a release
 *     archive and pins it in dist/panel-runtime.json, which the server downloads.
 *   - `build`: an optional module in the app exporting `buildHost(outdir)`, which
 *     builds the host's own server into its staged runtime.
 *   - `skills`: the skill folders it ships, relative to the app, instead of the shared ones.
 *   - `folders`: app folders its plugin ships as they are, such as a launcher's
 *     `scripts` and the `hooks` that check it.
 *   - `readme`: the app's README, which its packages ship instead of the repository's,
 *     for a host whose directory lists the plugin with it.
 *   - `maxFileBytes`: the host's file size limit; packaging and the host regression
 *     tests fail past it.
 * Adding such a host is adding that app; these scripts find it.
 */
export const pluginHosts = Object.fromEntries(readdirSync("apps")
  .filter(name => existsSync(`apps/${name}/plugin-host.json`))
  .map(name => [name, JSON.parse(readFileSync(`apps/${name}/plugin-host.json`, "utf8"))]));

// Codex-only files would load the Codex launcher or manifest.
export const codexOnlyPaths = [".mcp.json", "mcp.json", ".codex-plugin", "scripts/launch-mcp.sh"];

export const sharedSkills = ["packages/skills/mobile-dev", "packages/skills/mobile-dev-setup", "packages/skills/agent-device"];

export function pluginHost(name) {
  const host = pluginHosts[name];
  if (host === undefined) throw new Error(`Pass a host: ${Object.keys(pluginHosts).join(" or ")}.`);
  const app = `apps/${name}`;
  return {
    ...host, app, panel: host.panel !== false,
    // Whether the package itself ships the panel's parts.
    bundlesPanel: host.panel !== false && host.panelRuntime !== "download",
    desktopBundle: host.desktopBundle && `${app}/${host.desktopBundle}`,
    build: host.build && `${app}/${host.build}`,
    folders: (host.folders ?? []).map(path => join(app, path)),
    readme: host.readme && join(app, host.readme),
    skills: host.skills?.map(path => join(app, path)) ?? sharedSkills,
  };
}
