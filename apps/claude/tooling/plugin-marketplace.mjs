/**
 * A marketplace in Claude Code's format that lists the plugin from the folder beside its
 * `.claude-plugin/`, as both the local package and the release branch lay it out: the
 * public `mobile-dev` one for a release, `mobile-dev-local` for a checkout's package.
 */
export function pluginMarketplace(manifest, { release = false } = {}) {
  return {
    name: release ? "mobile-dev" : "mobile-dev-local",
    description: release ? "Mobile Dev for Claude Code: iOS and Android device control, logs, and performance charts." : "Claude plugin built from this checkout",
    owner: manifest.author,
    plugins: [{ name: manifest.name, source: `./${manifest.name}`, description: manifest.description, category: "development" }],
  };
}
