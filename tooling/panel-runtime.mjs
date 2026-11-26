import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DOWNLOADED_RUNTIME_PARTS } from "./host-runtime.mjs";

/** The panel runtime archive each release attaches beside its packages. */
const platform = process.platform === "win32" ? `win32-${process.arch}` : "darwin-arm64";
export const testingRuntimeArchive = version => `mobile-dev-${version}-testing-runtime-${platform}.tar.gz`;
export const panelRuntimeArchive = version => `mobile-dev-${version}-panel-runtime-darwin-arm64.tar.gz`;

/**
 * Packs the downloadable runtime from dist/ into the release archive and returns the pin a
 * package ships as panel-runtime.json. A release pins the archive on its GitHub
 * release, under the tag `v<version>`; a local build pins the file it just wrote, so
 * development packages work before anything is published.
 */
export async function packPanelRuntime(version, { release = false, repository = defaultRepository(), testingOnly = false } = {}) {
  const name = testingOnly ? testingRuntimeArchive(version) : panelRuntimeArchive(version);
  const parts = testingOnly ? ["e2e"] : DOWNLOADED_RUNTIME_PARTS;
  const archive = resolve("release", name);
  await rm(archive, { force: true });
  // The runtime accepts plain files. Testing Studio invokes the runner directly.
  const tar = process.platform === "win32" ? "tar.exe" : "/usr/bin/tar";
  const metadataFlags = process.platform === "darwin" ? ["--no-mac-metadata"] : [];
  execFileSync(tar, [
    "-czf", archive, ...metadataFlags, "--exclude", ".DS_Store",
    "--exclude", "e2e/node_modules/.bin", "-C", "dist", ...parts,
  ], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const bytes = await readFile(archive);
  const { size } = await stat(archive);
  const url = release
    ? `https://github.com/${repository}/releases/download/v${version}/${name}`
    : pathToFileURL(archive).href;
  return { archive, pin: { version, url, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: size } };
}

// The release workflow names the repository it publishes to.
function defaultRepository() {
  return process.env.GITHUB_REPOSITORY ?? "callstackincubator/mobile-dev";
}
