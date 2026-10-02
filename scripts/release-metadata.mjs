import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function releaseMetadata(tag, directory = ".") {
  const manifestText = await readFile(`${directory}/plugin.json`, "utf8");
  const manifest = JSON.parse(manifestText);
  const version = manifest.version;
  const validVersion = typeof version === "string" && /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version);
  if (validVersion === false) throw new Error("The plugin manifest needs a semantic release version.");
  if (tag !== `v${version}`) throw new Error(`Release tag must be v${version}; received ${tag}.`);
  if (manifest.name !== "mobile-dev") throw new Error("Expected the mobile-dev plugin manifest.");
  for (const file of ["package.json", "package-lock.json"]) {
    const contents = await readFile(`${directory}/${file}`, "utf8");
    const metadata = JSON.parse(contents);
    if (metadata.version !== version) throw new Error(`${file} version does not match plugin.json.`);
    if (file === "package-lock.json" && metadata.packages[""].version !== version) {
      throw new Error("The package-lock.json root package version does not match plugin.json.");
    }
  }
  const source = await readFile(`${directory}/src/shared/version.ts`, "utf8");
  const expectedSource = `export const PLUGIN_VERSION = "${version}";`;
  if (source.trim() !== expectedSource) throw new Error("src/shared/version.ts does not match plugin.json.");
  return { tag, version, archive: `release/mobile-dev-${version}-darwin-arm64.zip` };
}

const scriptPath = resolve("scripts/release-metadata.mjs");
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const metadata = await releaseMetadata(process.env.RELEASE_TAG);
  const output = Object.entries(metadata).map(([name, value]) => `${name}=${value}`);
  const text = output.join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, text);
  console.log(text.trim());
}
