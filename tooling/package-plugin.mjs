import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { assertRuntime, RELEASE_DOCUMENTS as documents, releaseVersion, stageRuntime } from "./host-runtime.mjs";
import { pluginHost } from "./plugin-hosts.mjs";

// Packages the shared server and MCP Apps panel for a plugin host: the host-neutral
// runtime, or the parts of it the host ships with its own server, plus the host's
// manifest, without Codex-only files.
//   node tooling/package-plugin.mjs <claude|cursor> [--release]
const name = process.argv[2];
const host = pluginHost(name);
const environment = telemetryBuildEnvironment(process.argv.slice(3));
await assertRuntime(environment, host.runtime);
const version = await releaseVersion();

// Stage the runtime once, so the desktop bundle and the plugin ship the same files with
// the same Sentry debug IDs.
const runtime = resolve(`release/${name}-runtime`);
await rm(runtime, { recursive: true, force: true });
await stageRuntime(runtime, host.runtime);
if (host.server) {
  const { buildHost } = await import(resolve(host.app, host.server));
  await buildHost(runtime);
}

// A host whose store limits file sizes fails here rather than in review.
async function assertFileSizes(directory) {
  if (host.maxFileBytes === undefined) return;
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() === false) continue;
    const path = join(entry.parentPath, entry.name);
    const { size } = await stat(path);
    if (size > host.maxFileBytes) throw new Error(`${path} is ${size} bytes, over ${host.label}'s ${host.maxFileBytes}-byte file limit.`);
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
// Hosts with skills of their own ship those instead of the shared ones.
const skills = host.skills?.map(path => `${host.app}/${path}`) ?? ["packages/skills/mobile-dev", "packages/skills/mobile-dev-setup"];
for (const skill of skills) await cp(skill, `${directory}/skills/${basename(skill)}`, { recursive: true, verbatimSymlinks: true });
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
  const catalog = {
    name: host.marketplace.name, description: `${host.label} plugin built from this checkout`, owner: { name: fields.author?.name ?? "Callstack" },
    plugins: [{ name: pluginName, source: `./${pluginName}`, description: fields.description, version }],
  };
  await mkdir(dirname(`${root}/${host.marketplace.manifest}`), { recursive: true });
  await writeFile(`${root}/${host.marketplace.manifest}`, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`${host.label} marketplace: ${root}`);
}
