import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseMetadata } from "./release-metadata.mjs";

function git(args, directory) {
  return execFileSync("git", args, {
    cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function publicRelease(directory = ".") {
  const status = git(["status", "--porcelain"], directory);
  if (status.trim().length > 0) throw new Error("Commit your changes before running npm run public-release.");
  const manifestText = await readFile(`${directory}/.codex-plugin/plugin.json`, "utf8");
  const manifest = JSON.parse(manifestText);
  const release = await releaseMetadata(`v${manifest.version}`, directory);
  const existing = git(["tag", "--list", release.tag], directory);
  if (existing.trim().length > 0) {
    throw new Error(`${release.tag} already exists locally. To push it, run git push origin refs/tags/${release.tag}.`);
  }
  const head = git(["rev-parse", "HEAD"], directory);
  const commit = head.trim();
  git(["tag", release.tag, commit], directory);
  try {
    git(["push", "origin", `refs/tags/${release.tag}`], directory);
  } catch (error) {
    throw new Error(`Created ${release.tag}, but its push failed. Retry with git push origin refs/tags/${release.tag}.`, { cause: error });
  }
  return release;
}

const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const release = await publicRelease();
  console.log(`Pushed ${release.tag}. GitHub Actions will build the ZIP, create a draft release, and publish release/latest.`);
}
