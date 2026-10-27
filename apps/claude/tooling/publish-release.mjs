import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { publishBranch } from "../../../tooling/release-branch.mjs";

// Claude Code installs the release from this branch as a marketplace:
//   claude plugin marketplace add callstackincubator/mobile-dev#release/claude
//   claude plugin install mobile-dev@mobile-dev
const branch = "release/claude";

/** The marketplace at the branch's root, listing the plugin beside it. */
export function claudeMarketplace(manifest) {
  return {
    name: "mobile-dev",
    description: "Mobile Dev for Claude Code: iOS and Android device control, logs, and performance charts.",
    owner: manifest.author,
    plugins: [{ name: manifest.name, source: `./plugins/${manifest.name}`, description: manifest.description, category: "development" }],
  };
}

export async function publishRelease(pluginDirectory, tag, remote, token) {
  const manifest = JSON.parse(await readFile(`${pluginDirectory}/.claude-plugin/plugin.json`, "utf8"));
  const version = manifest.version;
  const validVersion = typeof version === "string" && /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version);
  if (manifest.name !== "mobile-dev" || validVersion === false || tag !== `v${version}`) {
    throw new Error("The packaged mobile-dev version must match the release tag.");
  }
  await assertBuildEnvironment(`${pluginDirectory}/dist`, "release");
  await access(`${pluginDirectory}/dist/server.mjs`);
  return publishBranch({
    branch, version, remote, token, catalog: ".claude-plugin/marketplace.json", name: "mobile-dev",
    async write(directory) {
      await cp(pluginDirectory, `${directory}/plugins/${manifest.name}`, { recursive: true, verbatimSymlinks: true });
      await mkdir(`${directory}/.claude-plugin`, { recursive: true });
      await writeFile(`${directory}/.claude-plugin/marketplace.json`, JSON.stringify(claudeMarketplace(manifest), null, 2) + "\n");
    },
  });
}

const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const directory = resolve(process.argv[2]);
  const result = await publishRelease(directory, process.env.RELEASE_TAG, process.env.RELEASE_REPOSITORY_URL, process.env.GH_TOKEN);
  console.log(JSON.stringify(result));
}
