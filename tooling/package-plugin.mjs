import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { assertRuntime, oversizedFiles, RELEASE_DOCUMENTS as documents, releaseArchive, releaseVersion, stageRuntime } from "./host-runtime.mjs";
import { buildHost, pluginHost, pluginRelease } from "./plugin-hosts.mjs";

// Packages the shared server and MCP Apps views for a plugin host: the host-neutral
// runtime, without the panel's parts for hosts without it, the host's own server or
// page where it builds them, and the host's manifest, files and skills.
//   node tooling/package-plugin.mjs <host> [--release]
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
// The server runs agent-device's CLI by its path; npm's bin links are symlinks, which
// most plugin directories reject.
if (host.symlinks !== true) await rm(`${runtime}/agent-device/node_modules/.bin`, { recursive: true, force: true });
await buildHost(host, { outdir: runtime, environment, sentryRoot: ".sentry" });

// A host with its own README ships it instead of the repository's.
const documentSource = path => path === "README.md" && host.readme ? host.readme : path;

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
  for (const path of documents) await copyFile(documentSource(path), `${directory}/${path}`);
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  await assertFileSizes(directory);
  const archive = resolve(releaseArchive(host, version, { desktop: true }));
  await rm(archive, { force: true });
  execFileSync("zip", ["-qr", archive, "manifest.json", "dist", ...documents], { cwd: directory });
  execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
  console.log(`${host.label} Desktop bundle: ${archive}`);
}

// The version comes from the workspace; the source manifest has none.
const { name: pluginName, ...fields } = JSON.parse(await readFile(`${host.app}/${host.manifest}/plugin.json`, "utf8"));
const release = pluginRelease(host, pluginName);
const root = resolve(release.root);
const directory = resolve(release.plugin);
await rm(directory, { recursive: true, force: true });
await mkdir(`${directory}/${host.manifest}`, { recursive: true });
await cp(runtime, `${directory}/dist`, { recursive: true, verbatimSymlinks: true });
await cp(`${host.app}/assets`, `${directory}/assets`, { recursive: true });
// A skill's agents/ folder holds display metadata only some hosts read.
const skillFiles = skill => source => host.keepSkillAgents === true || relative(skill, source) !== "agents";
for (const skill of host.skills) await cp(skill, `${directory}/skills/${basename(skill)}`, { recursive: true, verbatimSymlinks: true, filter: skillFiles(skill) });
for (const folder of host.folders) await cp(folder, `${directory}/${basename(folder)}`, { recursive: true });
for (const path of host.files) {
  await mkdir(dirname(`${directory}/${path}`), { recursive: true });
  await copyFile(`${host.app}/${path}`, `${directory}/${path}`);
}
for (const path of documents) await copyFile(documentSource(path), `${directory}/${path}`);
await writeFile(`${directory}/${host.manifest}/plugin.json`, JSON.stringify({ name: pluginName, version, ...fields }, null, 2) + "\n");
await assertFileSizes(directory);
await rm(runtime, { recursive: true, force: true });
// The ZIP keeps executable modes, for release assets and hosts that install one.
const archive = resolve(releaseArchive(host, version));
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, "."], { cwd: directory });
if (host.maxArchiveBytes !== undefined && (await stat(archive)).size > host.maxArchiveBytes) {
  throw new Error(`The ${host.label} plugin ZIP exceeds its ${host.maxArchiveBytes}-byte upload limit.`);
}
console.log(`${host.label} plugin: ${directory}\n${host.label} plugin ZIP: ${archive}`);

// A host that installs plugins from a marketplace gets a local one beside the plugin.
if (host.marketplace) {
  const { pluginMarketplace } = await import(resolve(host.marketplace.module));
  const catalog = pluginMarketplace({ name: pluginName, ...fields });
  await mkdir(dirname(`${root}/${host.marketplace.manifest}`), { recursive: true });
  await writeFile(`${root}/${host.marketplace.manifest}`, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`${host.label} marketplace: ${root}`);
}
