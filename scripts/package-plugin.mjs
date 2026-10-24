import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { documents, pluginHost } from "./plugin-hosts.mjs";

const name = process.argv[2];
const host = pluginHost(name);
const args = process.argv.slice(3);
// Reuse the existing artifact inventory, native assets and environment checks.
telemetryBuildEnvironment(args);
execFileSync(process.execPath, ["scripts/package.mjs", ...args], { stdio: "inherit" });
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const source = resolve("release/marketplace/plugins/mobile-dev");

if (host.desktopBundle) {
  const manifest = JSON.parse(await readFile(host.desktopBundle, "utf8"));
  manifest.version = metadata.version;
  const directory = resolve(`release/${name}-desktop/mobile-dev`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const path of ["dist", ...documents]) {
    await cp(`${source}/${path}`, `${directory}/${path}`, { recursive: true, verbatimSymlinks: true });
  }
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  const archive = resolve(`release/mobile-dev-${manifest.version}-${name}-desktop-darwin-arm64.mcpb`);
  await rm(archive, { force: true });
  // MCPB is a ZIP with manifest.json at its root. Preserve executable modes.
  execFileSync("zip", ["-qr", archive, "manifest.json", "dist", ...documents], { cwd: directory });
  execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
  console.log(`${host.label} Desktop bundle: ${archive}`);
}

// The same payload as the Codex package, without its manifest, .mcp.json or launcher.
const plugin = JSON.parse(await readFile(`${host.manifest}/plugin.json`, "utf8"));
plugin.version = metadata.version;
const directory = resolve(`release/${name}-plugin/${plugin.name}`);
await rm(directory, { recursive: true, force: true });
await mkdir(`${directory}/${host.manifest}`, { recursive: true });
for (const path of ["dist", "assets", "skills", ...documents]) {
  await cp(`${source}/${path}`, `${directory}/${path}`, { recursive: true, verbatimSymlinks: true });
}
await writeFile(`${directory}/${host.manifest}/plugin.json`, JSON.stringify(plugin, null, 2) + "\n");
console.log(`${host.label} plugin: ${directory}`);
