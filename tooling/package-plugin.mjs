import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { assertRuntime, oversizedFiles, RELEASE_DOCUMENTS as documents, releaseVersion, stageRuntime } from "./host-runtime.mjs";
import { pluginHost } from "./plugin-hosts.mjs";
import { pluginMarketplace } from "./plugin-marketplace.mjs";

// Packages the shared server and MCP Apps views for a plugin host: the host-neutral
// runtime, without the panel's parts for hosts without it, the host's own server where
// it builds one, and the host's manifest, without Codex-only files.
//   node tooling/package-plugin.mjs <claude|cursor> [--release]
const name = process.argv[2];
const host = pluginHost(name);
const environment = telemetryBuildEnvironment(process.argv.slice(3));
await assertRuntime(environment);
const version = await releaseVersion();

// Stage the runtime once, so the desktop bundle and the plugin ship the same files with
// the same Sentry debug IDs.
const runtime = resolve(`release/${name}-runtime`);
await rm(runtime, { recursive: true, force: true });
await stageRuntime(runtime, { panel: host.panel });
if (host.build) {
  const { buildHost } = await import(resolve(host.build));
  await buildHost(runtime);
}

// A host whose store limits file sizes fails here rather than in review.
async function assertFileSizes(directory) {
  if (host.maxFileBytes === undefined) return;
  const oversized = await oversizedFiles(directory, host.maxFileBytes);
  if (oversized.length > 0) {
    throw new Error(`Over ${host.label}'s ${host.maxFileBytes}-byte file limit in ${directory}:\n${oversized.map(({ path, size }) => `  ${path}: ${size} bytes`).join("\n")}`);
  }
}

if (host.desktopBundle) {
  // MCPB is a ZIP with manifest.json at its root. Preserve executable modes.
  const manifest = { ...JSON.parse(await readFile(host.desktopBundle, "utf8")), version };
  const directory = resolve(`release/${name}-desktop/mobile-dev`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp(runtime, `${directory}/dist`, { recursive: true, verbatimSymlinks: true });
  for (const path of documents) await copyFile(path, `${directory}/${path}`);
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  await assertFileSizes(directory);
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
await cp(runtime, `${directory}/dist`, { recursive: true, verbatimSymlinks: true });
await cp(`${host.app}/assets`, `${directory}/assets`, { recursive: true });
for (const skill of host.skills) await cp(skill, `${directory}/skills/${basename(skill)}`, { recursive: true, verbatimSymlinks: true });
for (const path of documents) await copyFile(path, `${directory}/${path}`);
await writeFile(`${directory}/${host.manifest}/plugin.json`, JSON.stringify({ name: pluginName, version, ...fields }, null, 2) + "\n");
await assertFileSizes(directory);
await rm(runtime, { recursive: true, force: true });
// The ZIP keeps executable modes, for release assets and hosts that install one.
const archive = resolve(`release/mobile-dev-${version}-${name}-plugin-darwin-arm64.zip`);
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, "."], { cwd: directory });
console.log(`${host.label} plugin: ${directory}\n${host.label} plugin ZIP: ${archive}`);

// A host that installs plugins from a marketplace gets a local one beside the plugin,
// as Codex does from release/marketplace.
if (host.marketplace) {
  const root = resolve(`release/${name}-plugin`);
  const catalog = pluginMarketplace(host.marketplace.name, `${host.label} plugin built from this checkout`, { name: pluginName, ...fields });
  await mkdir(dirname(`${root}/${host.marketplace.manifest}`), { recursive: true });
  await writeFile(`${root}/${host.marketplace.manifest}`, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`${host.label} marketplace: ${root}`);
}
