import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { assertRuntime, RELEASE_DOCUMENTS as documents, releaseVersion, stageRuntime } from "./host-runtime.mjs";
import { pluginHost } from "./plugin-hosts.mjs";

// Packages the shared server and MCP Apps panel for a plugin host: the host-neutral
// runtime plus the host's manifest, without Codex-only files.
//   node tooling/package-plugin.mjs <claude|cursor> [--release]
const name = process.argv[2];
const host = pluginHost(name);
const environment = telemetryBuildEnvironment(process.argv.slice(3));
await assertRuntime(environment);
const version = await releaseVersion();

if (host.desktopBundle) {
  // MCPB is a ZIP with manifest.json at its root. Preserve executable modes.
  const manifest = { ...JSON.parse(await readFile(host.desktopBundle, "utf8")), version };
  const directory = resolve(`release/${name}-desktop/mobile-dev`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await stageRuntime(`${directory}/dist`);
  for (const path of documents) await copyFile(path, `${directory}/${path}`);
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  const archive = resolve(`release/mobile-dev-${version}-${name}-desktop-darwin-arm64.mcpb`);
  await rm(archive, { force: true });
  execFileSync("zip", ["-qr", archive, "manifest.json", "dist", ...documents], { cwd: directory });
  execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
  console.log(`${host.label} Desktop bundle: ${archive}`);
}

const { name: pluginName, ...fields } = JSON.parse(await readFile(`${host.app}/${host.manifest}/plugin.json`, "utf8"));
const directory = resolve(`release/${name}-plugin/${pluginName}`);
await rm(directory, { recursive: true, force: true });
await mkdir(`${directory}/${host.manifest}`, { recursive: true });
await stageRuntime(`${directory}/dist`);
await cp(`${host.app}/assets`, `${directory}/assets`, { recursive: true });
for (const skill of ["mobile-dev", "mobile-dev-setup"]) await cp(`packages/skills/${skill}`, `${directory}/skills/${skill}`, { recursive: true, verbatimSymlinks: true });
for (const path of documents) await copyFile(path, `${directory}/${path}`);
await writeFile(`${directory}/${host.manifest}/plugin.json`, JSON.stringify({ name: pluginName, version, ...fields }, null, 2) + "\n");
console.log(`${host.label} plugin: ${directory}`);
