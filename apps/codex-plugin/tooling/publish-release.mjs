import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginMarketplace } from "./plugin-marketplace.mjs";
import { assertBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { publishBranch } from "../../../tooling/release-branch.mjs";

export async function publishRelease(pluginDirectory, tag, remote, token) {
  const manifestText = await readFile(`${pluginDirectory}/.codex-plugin/plugin.json`, "utf8");
  const manifest = JSON.parse(manifestText);
  const version = manifest.version;
  const validVersion = typeof version === "string" && /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version);
  if (manifest.name !== "mobile-dev" || validVersion === false || tag !== `v${version}`) {
    throw new Error("The packaged mobile-dev version must match the release tag.");
  }
  await assertBuildEnvironment(`${pluginDirectory}/dist`, "release");
  await access(`${pluginDirectory}/dist/server.mjs`);
  await access(`${pluginDirectory}/scripts/launch-mcp.sh`);
  await access(`${pluginDirectory}/.mcp.json`);
  return publishBranch({
    branch: "release/latest", version, remote, token, catalog: ".agents/plugins/marketplace.json", name: "mobile-dev",
    async write(directory) {
      await mkdir(`${directory}/.agents/plugins`, { recursive: true });
      await cp(pluginDirectory, `${directory}/plugins/mobile-dev`, { recursive: true, verbatimSymlinks: true });
      const catalog = pluginMarketplace(manifest.name, true);
      const catalogText = JSON.stringify(catalog, null, 2);
      await writeFile(`${directory}/.agents/plugins/marketplace.json`, catalogText + "\n");
    },
  });
}

const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const directory = resolve(process.argv[2]);
  const result = await publishRelease(directory, process.env.RELEASE_TAG, process.env.RELEASE_REPOSITORY_URL, process.env.GH_TOKEN);
  const output = JSON.stringify(result);
  console.log(output);
}
