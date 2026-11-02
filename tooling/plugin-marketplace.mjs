/**
 * A marketplace in Claude Code's format that lists one plugin from the folder beside its
 * `.claude-plugin/`, as both the local package and the release branch lay it out.
 */
export function pluginMarketplace(name, description, manifest) {
  return {
    name, description, owner: manifest.author,
    plugins: [{ name: manifest.name, source: `./${manifest.name}`, description: manifest.description, category: "development" }],
  };
}
