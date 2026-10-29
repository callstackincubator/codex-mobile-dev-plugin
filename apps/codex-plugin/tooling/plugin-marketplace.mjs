/**
 * A marketplace in Codex's format that lists the plugin from `plugins/<name>`: the public
 * `mobile-dev` one for a release, `mobile-dev-local` for a checkout's package.
 */
export function pluginMarketplace(manifest, { release = false } = {}) {
  return {
    name: release ? "mobile-dev" : "mobile-dev-local",
    interface: { displayName: release ? "Mobile Dev" : "Mobile Dev local" },
    plugins: [{
      name: manifest.name,
      source: { source: "local", path: `./plugins/${manifest.name}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    }],
  };
}
