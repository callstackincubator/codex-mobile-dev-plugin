import { execFileSync, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginMarketplace } from "./plugin-marketplace.mjs";
import { assertBuildEnvironment } from "./telemetry-build.mjs";

const branch = "refs/heads/release/latest";

function compareVersions(incoming, previous) {
  const incomingParts = incoming.split("-");
  const previousParts = previous.split("-");
  const incomingCore = incomingParts[0].split(".");
  const previousCore = previousParts[0].split(".");
  for (let index = 0; index < 3; index += 1) {
    const left = BigInt(incomingCore[index]);
    const right = BigInt(previousCore[index]);
    if (left !== right) return left > right ? 1 : -1;
  }
  const incomingLabels = incomingParts.slice(1);
  const previousLabels = previousParts.slice(1);
  const incomingPrerelease = incomingLabels.join("-");
  const previousPrerelease = previousLabels.join("-");
  if (incomingPrerelease === previousPrerelease) return 0;
  if (incomingPrerelease.length === 0) return 1;
  if (previousPrerelease.length === 0) return -1;
  const incomingIdentifiers = incomingPrerelease.split(".");
  const previousIdentifiers = previousPrerelease.split(".");
  const length = Math.max(incomingIdentifiers.length, previousIdentifiers.length);
  for (let index = 0; index < length; index += 1) {
    const left = incomingIdentifiers[index];
    const right = previousIdentifiers[index];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const leftNumber = BigInt(left);
      const rightNumber = BigInt(right);
      if (leftNumber === rightNumber) continue;
      return leftNumber > rightNumber ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

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
  const env = gitEnvironment(remote, token);
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-publish-");
  const directory = await mkdtemp(prefix);
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
      const previousCatalogText = await readFile(`${directory}/.agents/plugins/marketplace.json`, "utf8");
      const previousCatalog = JSON.parse(previousCatalogText);
      if (previousCatalog.name !== "mobile-dev") throw new Error("release/latest must contain the mobile-dev marketplace.");
      const previousSubject = git(["log", "-1", "--format=%s"]);
      const subject = previousSubject.trim();
      const previousRelease = subject.match(/ (\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?)$/);
      if (previousRelease === null) throw new Error("release/latest must point to a Mobile Dev release commit.");
      const previousVersion = previousRelease[1];
      const comparison = compareVersions(version, previousVersion);
      if (comparison <= 0) return { published: false, version, latest: previousVersion };
    } else if (existing.status !== 2) {
      throw new Error(`Cannot inspect release/latest: ${existing.stderr}`);
    }
    const entries = await readdir(directory);
    for (const entry of entries) {
      if (entry === ".git") continue;
      const path = join(directory, entry);
      await rm(path, { recursive: true, force: true });
    }
    await mkdir(`${directory}/.agents/plugins`, { recursive: true });
    await cp(pluginDirectory, `${directory}/plugins/mobile-dev`, { recursive: true, verbatimSymlinks: true });
    const catalog = pluginMarketplace(manifest.name, true);
    const catalogText = JSON.stringify(catalog, null, 2);
    await writeFile(`${directory}/.agents/plugins/marketplace.json`, catalogText + "\n");
    git(["add", "--all", "--force"]);
    git(["commit", "-m", `chore(release): release mobile-dev ${version}`]);
    git(["push", "origin", `HEAD:${branch}`]);
    return { published: true, version, latest: version };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const directory = resolve(process.argv[2]);
  const result = await publishRelease(directory, process.env.RELEASE_TAG, process.env.RELEASE_REPOSITORY_URL, process.env.GH_TOKEN);
  const output = JSON.stringify(result);
  console.log(output);
}
