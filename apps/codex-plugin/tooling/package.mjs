import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { telemetryBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { pluginMarketplace } from "./plugin-marketplace.mjs";
import { buildCodexHost } from "./build.mjs";
import { assertRuntime, RELEASE_DOCUMENTS, releaseVersion, stageRuntime } from "../../../tooling/host-runtime.mjs";
import { sharedSkills } from "../../../tooling/plugin-hosts.mjs";

const telemetryEnvironment = telemetryBuildEnvironment();
const windows = process.platform === "win32";
await assertRuntime(telemetryEnvironment, { appleHelpers: !windows });
const source = "apps/codex-plugin";
// The version comes from the workspace; the source manifest has none.
const { name, ...fields } = JSON.parse(await readFile(`${source}/.codex-plugin/plugin.json`, "utf8"));
const manifest = { name, version: await releaseVersion(), ...fields };
const marketplace = resolve("release/marketplace");
const plugin = `${marketplace}/plugins/${manifest.name}`;
await rm(plugin, { recursive: true, force: true });
await mkdir(plugin, { recursive: true });
await copyFile(`${source}/.mcp.json`, `${plugin}/.mcp.json`);
for (const path of RELEASE_DOCUMENTS) await copyFile(path, `${plugin}/${path}`);
await stageRuntime(`${plugin}/dist`);
await buildCodexHost(telemetryEnvironment, `${plugin}/dist`);
for (const path of [".codex-plugin", "assets"]) await cp(`${source}/${path}`, `${plugin}/${path}`, { recursive: true, verbatimSymlinks: true });
for (const skill of sharedSkills) await cp(skill, `${plugin}/skills/${basename(skill)}`, { recursive: true, verbatimSymlinks: true });
await writeFile(`${plugin}/.codex-plugin/plugin.json`, JSON.stringify(manifest, null, 2) + "\n");
await mkdir(`${plugin}/scripts`, { recursive: true });
for (const launcher of ["launch-mcp", "launch-mcp.cmd"]) await copyFile(`${source}/scripts/${launcher}`, `${plugin}/scripts/${launcher}`);
await chmod(`${plugin}/scripts/launch-mcp`, 0o755);
if (!windows) {
  await chmod(`${plugin}/dist/baguette/Baguette`, 0o755);
  await chmod(`${plugin}/dist/ios-logs/mobile-dev-ios-logs`, 0o755);
}
await mkdir(`${marketplace}/.agents/plugins`, { recursive: true });
const catalog = pluginMarketplace(manifest.name);
const catalogText = JSON.stringify(catalog, null, 2);
await writeFile(`${marketplace}/.agents/plugins/marketplace.json`, catalogText + "\n");
const archive = resolve(`release/${manifest.name}-${manifest.version}-${windows ? "windows" : "darwin-arm64"}.zip`);
await rm(archive, { force: true });
const files = await readdir(plugin);
if (windows) execFileSync("tar.exe", ["-a", "-cf", archive, ...files], { cwd: plugin });
else execFileSync("zip", ["-qr", archive, ...files], { cwd: plugin });
if ((await stat(archive)).size > 100_000_000) throw new Error("The plugin ZIP exceeds the 100 MB upload limit.");
console.log(`Plugin: ${plugin}\nMarketplace: ${marketplace}\nZIP: ${archive}`);
