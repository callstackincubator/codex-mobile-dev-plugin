import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isReleaseVersion } from "../packages/shared/src/release-version.ts";

export async function releaseMetadata(tag, directory = ".") {
  // The workspace's package.json holds the one version every host ships; each
  // host's package step writes it into that host's manifest.
  const metadata = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
  const version = metadata.version;
  if (isReleaseVersion(version) === false) throw new Error("package.json needs a semantic release version.");
  if (tag !== `v${version}`) throw new Error(`Release tag must be v${version}; received ${tag}.`);
  const manifest = JSON.parse(await readFile(`${directory}/apps/codex-plugin/.codex-plugin/plugin.json`, "utf8"));
  if (manifest.name !== "mobile-dev") throw new Error("Expected the mobile-dev plugin manifest.");
  const lock = JSON.parse(await readFile(`${directory}/package-lock.json`, "utf8"));
  if (lock.version !== version) throw new Error("package-lock.json version does not match package.json.");
  if (lock.packages[""].version !== version) throw new Error("The package-lock.json root package version does not match package.json.");
  const source = await readFile(`${directory}/packages/shared/src/version.ts`, "utf8");
  const expectedSource = `export const PLUGIN_VERSION = "${version}";`;
  if (source.trim() !== expectedSource) throw new Error("packages/shared/src/version.ts does not match package.json.");
  return { tag, version, archive: `release/mobile-dev-${version}-darwin-arm64.zip` };
}

const scriptPath = resolve("tooling/release-metadata.mjs");
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const metadata = await releaseMetadata(process.env.RELEASE_TAG);
  const output = Object.entries(metadata).map(([name, value]) => `${name}=${value}`);
  const text = output.join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, text);
  console.log(text.trim());
}
