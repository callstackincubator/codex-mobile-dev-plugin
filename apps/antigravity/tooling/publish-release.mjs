import { pluginMarketplace } from "../../../tooling/plugin-marketplace.mjs";
import { publishFromCommandLine, publishPluginRelease } from "../../../tooling/release-branch.mjs";

const release = {
  manifestPath: ".antigravity-plugin/plugin.json",
  requiredFiles: ["dist/server.mjs", "mcp_config.json", "hooks.json", "sidecars/device-panel/sidecar.json", "sidecars/launch.mjs"],
  branch: "release/antigravity",
  pluginPath: "mobile-dev",
  catalogPath: ".antigravity-plugin/marketplace.json",
  catalog: manifest => pluginMarketplace("mobile-dev", "Mobile Dev for Antigravity: iOS and Android device panel, control, logs, and performance charts.", manifest),
};

export function publishRelease(pluginDirectory, tag, remote, token) {
  return publishPluginRelease(release, { pluginDirectory, tag, remote, token });
}

await publishFromCommandLine(import.meta.url, ({ pluginDirectory, tag, remote, token }) => publishRelease(pluginDirectory, tag, remote, token));
