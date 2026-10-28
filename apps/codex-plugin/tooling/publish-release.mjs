import { pluginMarketplace } from "./plugin-marketplace.mjs";
import { publishFromCommandLine, publishPluginRelease } from "../../../tooling/release-branch.mjs";

// Codex installs the release from this branch as a Git marketplace.
const release = {
  manifestPath: ".codex-plugin/plugin.json", requiredFiles: ["dist/server.mjs", "scripts/launch-mcp.sh", ".mcp.json"],
  branch: "release/latest", pluginPath: "plugins/mobile-dev", catalogPath: ".agents/plugins/marketplace.json",
  catalog: manifest => pluginMarketplace(manifest.name, true),
};

export function publishRelease(pluginDirectory, tag, remote, token) {
  return publishPluginRelease(release, { pluginDirectory, tag, remote, token });
}

await publishFromCommandLine(import.meta.url, ({ pluginDirectory, tag, remote, token }) => publishRelease(pluginDirectory, tag, remote, token));
