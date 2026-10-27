import { execFileSync, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, gitEnvironment } from "../../codex-plugin/tooling/publish-release.mjs";
import { assertBuildEnvironment } from "../../../tooling/telemetry-build.mjs";

// Publishes the packaged Claude plugin as the only content of release/claude: the plugin
// in plugins/mobile-dev, which the directory submission tracks, and a marketplace at the
// root that lists it for `claude plugin marketplace add <repo>@release/claude`. Each
// release is also tagged claude-v<version>.
const branch = "refs/heads/release/claude";
const pluginPath = "plugins/mobile-dev";

export function claudeMarketplace(manifest) {
  return {
    name: "mobile-dev",
    description: "Callstack's Mobile Dev plugin for iOS and Android development in Claude.",
    owner: { name: manifest.author.name, email: manifest.author.email },
    plugins: [{ name: manifest.name, source: `./${pluginPath}`, description: manifest.description, category: "development" }],
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
  await access(`${pluginDirectory}/scripts/launch-node.sh`);
  await access(`${pluginDirectory}/hooks/hooks.json`);
  const env = gitEnvironment(remote, token);
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-claude-publish-"));
  function git(args) {
    return execFileSync("git", args, {
      cwd: directory, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  }
  try {
    git(["init"]);
    git(["config", "user.name", "github-actions[bot]"]);
    git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["remote", "add", "origin", remote]);
    const existing = spawnSync("git", ["ls-remote", "--exit-code", "--heads", "origin", branch], {
      cwd: directory, env, encoding: "utf8",
    });
    if (existing.error) throw existing.error;
    if (existing.status === 0) {
      git(["fetch", "--depth=1", "origin", branch]);
      git(["checkout", "--detach", "FETCH_HEAD"]);
      const previous = JSON.parse(await readFile(`${directory}/${pluginPath}/.claude-plugin/plugin.json`, "utf8"));
      if (previous.name !== "mobile-dev") throw new Error("release/claude must contain the mobile-dev plugin.");
      if (compareVersions(version, previous.version) <= 0) return { published: false, version, latest: previous.version };
    } else if (existing.status !== 2) {
      throw new Error(`Cannot inspect release/claude: ${existing.stderr}`);
    }
    for (const entry of await readdir(directory)) {
      if (entry !== ".git") await rm(join(directory, entry), { recursive: true, force: true });
    }
    await cp(pluginDirectory, `${directory}/${pluginPath}`, { recursive: true, verbatimSymlinks: true });
    await mkdir(`${directory}/.claude-plugin`, { recursive: true });
    await writeFile(`${directory}/.claude-plugin/marketplace.json`, JSON.stringify(claudeMarketplace(manifest), null, 2) + "\n");
    git(["add", "--all", "--force"]);
    git(["commit", "-m", `chore(release): release mobile-dev ${version} for Claude`]);
    git(["tag", `claude-${tag}`]);
    git(["push", "--atomic", "origin", `HEAD:${branch}`, `refs/tags/claude-${tag}`]);
    return { published: true, version, latest: version };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const result = await publishRelease(resolve(process.argv[2]), process.env.RELEASE_TAG, process.env.RELEASE_REPOSITORY_URL, process.env.GH_TOKEN);
  console.log(JSON.stringify(result));
}
