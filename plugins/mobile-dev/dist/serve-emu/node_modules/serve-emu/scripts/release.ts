import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Bump = "patch" | "minor" | "major";

const packageDir = resolve(import.meta.dir, "..");
const packageJsonPath = resolve(packageDir, "package.json");
const changelogPath = resolve(packageDir, "CHANGELOG.md");

const args = Bun.argv.slice(2);
const bumpArg = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");

function usage(): never {
  console.error("Usage: bun run release <patch|minor|major|x.y.z> [--dry-run]");
  process.exit(1);
}

function readJson(path: string): { version?: unknown; [key: string]: unknown } {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertVersion(version: unknown): string {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Expected a plain semver version, got ${String(version)}`);
  }
  return version;
}

function nextVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;

  if (!["patch", "minor", "major"].includes(bump)) usage();

  const [major, minor, patch] = current.split(".").map((part) => Number(part));
  switch (bump as Bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function runGit(args: string[]): string | null {
  const result = spawnSync("git", args, {
    cwd: packageDir,
    encoding: "utf8",
  });

  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function latestTag(): string | null {
  const tag = runGit(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
  return tag && tag.length > 0 ? tag : null;
}

function commitSubjectsSince(tag: string | null): string[] {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const output = runGit(["log", "--format=%s", "--no-merges", range]);
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function changelogEntry(version: string, subjects: string[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = subjects.length > 0 ? subjects : ["Release maintenance."];

  return [
    `## ${version} - ${date}`,
    "",
    "### Changed",
    "",
    ...lines.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

function prependChangelog(version: string, entry: string): string {
  const current = readFileSync(changelogPath, "utf8");

  if (current.includes(`## ${version} - `)) {
    throw new Error(`CHANGELOG.md already has an entry for ${version}`);
  }

  const firstRelease = current.match(/^## \d+\.\d+\.\d+ - /m);
  if (!firstRelease?.index) {
    return `${current.trimEnd()}\n\n${entry}`;
  }

  return `${current.slice(0, firstRelease.index)}${entry}\n${current.slice(firstRelease.index)}`;
}

if (!bumpArg) usage();

const packageJson = readJson(packageJsonPath);
const currentVersion = assertVersion(packageJson.version);
const version = nextVersion(currentVersion, bumpArg);

if (version === currentVersion) {
  throw new Error(`Version is already ${version}`);
}

packageJson.version = version;
const tag = latestTag();
const subjects = commitSubjectsSince(tag);
const nextChangelog = prependChangelog(version, changelogEntry(version, subjects));

console.log(`${currentVersion} -> ${version}`);
if (tag) console.log(`Changes since ${tag}`);
if (subjects.length === 0) console.log("No commit subjects found; using a maintenance placeholder.");

if (dryRun) {
  console.log("\nDry run only. No files changed.");
  process.exit(0);
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
writeFileSync(changelogPath, nextChangelog);

console.log("\nUpdated:");
console.log(`- ${packageJsonPath}`);
console.log(`- ${changelogPath}`);
console.log("\nNext:");
console.log("1. Review CHANGELOG.md and edit sections if needed.");
console.log("2. Run: bun run check");
console.log(`3. Commit: git commit -m "Release v${version}" -- packages/serve-emu/package.json packages/serve-emu/CHANGELOG.md`);
console.log(`4. Tag: git tag v${version}`);
console.log("5. Publish from a clean tree: npm publish packages/serve-emu");
