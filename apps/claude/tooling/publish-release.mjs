import { pluginMarketplace } from "../../../tooling/plugin-marketplace.mjs";
import { publishFromCommandLine, publishPluginRelease } from "../../../tooling/release-branch.mjs";

// Claude Code installs the release from this branch as a marketplace, laid out as the
// local package's (release/claude-plugin):
//   claude plugin marketplace add https://github.com/callstackincubator/mobile-dev.git#release/claude
//   claude plugin install mobile-dev@mobile-dev
const release = {
  manifestPath: ".claude-plugin/plugin.json", requiredFiles: ["dist/server.mjs"],
  branch: "release/claude", pluginPath: "mobile-dev", catalogPath: ".claude-plugin/marketplace.json",
  catalog: manifest => pluginMarketplace("mobile-dev", "Mobile Dev for Claude Code: iOS and Android device control, logs, and performance charts.", manifest),
};

export function publishRelease(pluginDirectory, tag, remote, token) {
  return publishPluginRelease(release, { pluginDirectory, tag, remote, token });
}

await publishFromCommandLine(import.meta.url, ({ pluginDirectory, tag, remote, token }) => publishRelease(pluginDirectory, tag, remote, token));
