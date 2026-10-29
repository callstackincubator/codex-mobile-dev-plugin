import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every app that ships the runtime has a `plugin-host.json`, which these scripts read:
 *   - `name`: the host's name in commands, package and host-test folders, by default
 *     the app's folder name; `label`: its display name.
 *   - `build`: an optional module in the app exporting
 *     `buildHost({ outdir, environment, sentryRoot })`, which builds the host's own
 *     server or page into a staged runtime and keeps their Sentry files under
 *     `<sentryRoot>/ui/<page>` and `<sentryRoot>/server/<host>`.
 *   - `panel`: false for hosts whose server has no Mobile Dev panel; their packages
 *     leave out the panel's parts of the runtime.
 * Hosts that load a plugin folder through their own manifest (the plugin hosts) also have:
 *   - `manifest`: its manifest folder in the app.
 *   - `root`: the plugin-root variable its manifest starts the server from.
 *   - `config`: the local development config snippet (`npm run <host>:config`).
 *   - `desktopBundle`: an optional desktop bundle manifest, packaged as an MCPB.
 *   - `marketplace`: an optional local marketplace written beside the plugin: `module`,
 *     an app module exporting `pluginMarketplace(manifest, { release })`, and the
 *     `manifest` path it is written to.
 *   - `releaseFolder`: the folder under `release/` holding the plugin and its
 *     marketplace, by default `<host>-plugin`; `pluginPath`: the folder in it the
 *     plugin folder sits in, for a marketplace that lists plugins from one.
 *   - `archive`: the qualifier in the plugin ZIP's name, by default `<host>-plugin`.
 *   - `skills`: the skill folders it ships, relative to the app, instead of the shared ones.
 *   - `keepSkillAgents`: true to ship each skill's `agents/` display metadata.
 *   - `files`: app files its plugin ships at the same paths, such as a launcher.
 *   - `folders`: app folders its plugin ships as they are, such as a launcher's
 *     `scripts` and the `hooks` that check it.
 *   - `readme`: the app's README, which its packages ship instead of the repository's,
 *     for a host whose directory lists the plugin with it.
 *   - `symlinks`: true for a host that accepts symlinks, so npm's bin links stay.
 *   - `maxFileBytes`: the host's file size limit; packaging and the host regression
 *     tests fail past it. `maxArchiveBytes`: its plugin ZIP's upload limit.
 * Adding a host is adding that app; these scripts find it.
 */
export function discoverHosts(directory = ".") {
  const apps = join(directory, "apps");
  return Object.fromEntries(readdirSync(apps)
    .filter(app => existsSync(join(apps, app, "plugin-host.json")))
    .map(app => {
      const host = JSON.parse(readFileSync(join(apps, app, "plugin-host.json"), "utf8"));
      return [host.name ?? app, { ...host, app: `apps/${app}` }];
    }));
}

export const hosts = discoverHosts();

export const pluginHosts = Object.fromEntries(Object.entries(hosts).filter(([, host]) => host.manifest !== undefined));

export const sharedSkills = ["packages/skills/mobile-dev", "packages/skills/mobile-dev-setup", "packages/skills/agent-device"];

/** A host with its paths resolved from the repository root. */
export function appHost(name) {
  const host = hosts[name];
  if (host === undefined) throw new Error(`Pass a host: ${Object.keys(hosts).join(", ")}.`);
  return { ...host, name, panel: host.panel !== false, build: host.build && `${host.app}/${host.build}` };
}

/** A plugin host with its paths resolved from the repository root. */
export function pluginHost(name) {
  if (pluginHosts[name] === undefined) throw new Error(`Pass a plugin host: ${Object.keys(pluginHosts).join(" or ")}.`);
  const host = appHost(name);
  return {
    ...host,
    desktopBundle: host.desktopBundle && `${host.app}/${host.desktopBundle}`,
    marketplace: host.marketplace && { ...host.marketplace, module: `${host.app}/${host.marketplace.module}` },
    files: host.files ?? [],
    folders: (host.folders ?? []).map(path => join(host.app, path)),
    readme: host.readme && join(host.app, host.readme),
    skills: host.skills?.map(path => join(host.app, path)) ?? sharedSkills,
  };
}

/** Where a plugin host's package step writes its marketplace root and its plugin folder. */
export function pluginRelease(host, pluginName = "mobile-dev") {
  const root = `release/${host.releaseFolder ?? `${host.name}-plugin`}`;
  return { root, plugin: join(root, host.pluginPath ?? "", pluginName) };
}

/** Builds a host's own server or page into a staged runtime, if it has any. */
export async function buildHost(host, options) {
  if (host.build === undefined) return;
  const module = await import(new URL(`../${host.build}`, import.meta.url).href);
  await module.buildHost(options);
}

/**
 * The paths another plugin host's package adds, which would load that host's manifest
 * or launcher: its manifest folder and the app files and folders it ships.
 */
export function foreignPaths(name) {
  return Object.keys(pluginHosts).filter(other => other !== name).flatMap(other => {
    const host = pluginHost(other);
    const folderFiles = host.folders.flatMap(folder => readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile()).map(entry => relative(host.app, join(entry.parentPath, entry.name))));
    return [host.manifest, ...host.files, ...folderFiles];
  });
}
