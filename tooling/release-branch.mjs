import { execFileSync, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBuildEnvironment } from "./telemetry-build.mjs";
import { compareReleaseVersions, isReleaseVersion } from "../packages/shared/src/release-version.ts";

function gitEnvironment(remote, token) {
  const env = { ...process.env };
  if (token) {
    const url = new URL(remote);
    if (url.protocol !== "https:") throw new Error("Authenticated release publishing requires an HTTPS Git URL.");
    const count = Number(env.GIT_CONFIG_COUNT ?? "0");
    const credentials = Buffer.from(`x-access-token:${token}`);
    const authorization = credentials.toString("base64");
    env.GIT_CONFIG_COUNT = String(count + 1);
    env[`GIT_CONFIG_KEY_${count}`] = `http.${url.origin}/.extraheader`;
    env[`GIT_CONFIG_VALUE_${count}`] = `AUTHORIZATION: basic ${authorization}`;
  }
  return env;
}

/**
 * Publishes a packaged plugin release to a branch of this repository, so its host can
 * install the branch as a marketplace: the plugin at `pluginPath` and the marketplace
 * file at `catalogPath`, which `catalog(manifest)` lists it in. Each release is one
 * commit replacing the previous release's files, and the branch only moves forward: an
 * older or repeated version leaves it unchanged. The package must be a release build
 * of mobile-dev whose version matches `tag` and that has every `requiredFiles` path.
 */
export async function publishPluginRelease({ manifestPath, requiredFiles, branch, pluginPath, catalogPath, catalog }, { pluginDirectory, tag, remote, token }) {
  const manifest = JSON.parse(await readFile(`${pluginDirectory}/${manifestPath}`, "utf8"));
  const version = manifest.version;
  if (manifest.name !== "mobile-dev" || isReleaseVersion(version) === false || tag !== `v${version}`) {
    throw new Error("The packaged mobile-dev version must match the release tag.");
  }
  await assertBuildEnvironment(`${pluginDirectory}/dist`, "release");
  for (const path of requiredFiles) await access(`${pluginDirectory}/${path}`);
  const listing = catalog(manifest);
  return publishBranch({
    branch, version, remote, token, catalogPath, name: listing.name,
    async write(directory) {
      await cp(pluginDirectory, `${directory}/${pluginPath}`, { recursive: true, verbatimSymlinks: true });
      await mkdir(dirname(`${directory}/${catalogPath}`), { recursive: true });
      await writeFile(`${directory}/${catalogPath}`, JSON.stringify(listing, null, 2) + "\n");
    },
  });
}

export async function publishFromCommandLine(scriptUrl, publish) {
  if (process.argv[1] === undefined || resolve(process.argv[1]) !== fileURLToPath(scriptUrl)) return;
  const result = await publish({ pluginDirectory: resolve(process.argv[2]), tag: process.env.RELEASE_TAG, remote: process.env.RELEASE_REPOSITORY_URL, token: process.env.GH_TOKEN });
  console.log(JSON.stringify(result));
}

async function publishBranch({ branch, version, remote, token, catalogPath, name, write }) {
  const ref = `refs/heads/${branch}`;
  const env = gitEnvironment(remote, token);
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-publish-"));
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
    const existing = spawnSync("git", ["ls-remote", "--exit-code", "--heads", "origin", ref], {
      cwd: directory, env, encoding: "utf8",
    });
    if (existing.error) throw existing.error;
    if (existing.status === 0) {
      git(["fetch", "--depth=1", "origin", ref]);
      git(["checkout", "--detach", "FETCH_HEAD"]);
      const previousCatalog = JSON.parse(await readFile(`${directory}/${catalogPath}`, "utf8"));
      if (previousCatalog.name !== name) throw new Error(`${branch} must contain the ${name} marketplace.`);
      const subject = git(["log", "-1", "--format=%s"]).trim();
      const previousVersion = subject.match(/ (\S+)$/)?.[1];
      if (isReleaseVersion(previousVersion) === false) throw new Error(`${branch} must point to a Mobile Dev release commit.`);
      if (compareReleaseVersions(version, previousVersion) <= 0) return { published: false, version, latest: previousVersion };
    } else if (existing.status !== 2) {
      throw new Error(`Cannot inspect ${branch}: ${existing.stderr}`);
    }
    for (const entry of await readdir(directory)) {
      if (entry === ".git") continue;
      await rm(join(directory, entry), { recursive: true, force: true });
    }
    await write(directory);
    git(["add", "--all", "--force"]);
    git(["commit", "-m", `chore(release): release mobile-dev ${version}`]);
    git(["push", "origin", `HEAD:${ref}`]);
    return { published: true, version, latest: version };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
