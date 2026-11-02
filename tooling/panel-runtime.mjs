import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PANEL_PARTS } from "./host-runtime.mjs";

/** The panel runtime archive each release attaches beside its packages. */
export const panelRuntimeArchive = version => `mobile-dev-${version}-panel-runtime-darwin-arm64.tar.gz`;

/**
 * Packs the panel's parts from dist/ into the release archive and returns the pin a
 * package ships as panel-runtime.json. A release pins the archive on its GitHub
 * release, under the tag `v<version>`; a local build pins the file it just wrote, so
 * development packages work before anything is published.
 */
export async function packPanelRuntime(version, { release = false, repository = defaultRepository() } = {}) {
  const archive = resolve("release", panelRuntimeArchive(version));
  await rm(archive, { force: true });
  // No AppleDouble files or extended attributes: the server accepts only the parts.
  execFileSync("tar", ["-czf", archive, "--no-mac-metadata", "--exclude", ".DS_Store", "-C", "dist", ...PANEL_PARTS], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const bytes = await readFile(archive);
  const { size } = await stat(archive);
  const url = release
    ? `https://github.com/${repository}/releases/download/v${version}/${panelRuntimeArchive(version)}`
    : pathToFileURL(archive).href;
  return { archive, pin: { version, url, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: size } };
}

// The release workflow names the repository it publishes to.
function defaultRepository() {
  return process.env.GITHUB_REPOSITORY ?? "callstackincubator/codex-mobile-dev-plugin";
}
