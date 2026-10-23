import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";

// Reuse the existing artifact inventory, native assets and environment checks.
telemetryBuildEnvironment();
execFileSync(process.execPath, ["scripts/package.mjs", ...process.argv.slice(2)], { stdio: "inherit" });
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("claude-desktop/manifest.json", "utf8"));
manifest.version = metadata.version;
const source = resolve("release/marketplace/plugins/mobile-dev");
const documents = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];
const directory = resolve("release/claude-desktop/mobile-dev");
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
for (const path of ["dist", ...documents]) {
  await cp(`${source}/${path}`, `${directory}/${path}`, { recursive: true, verbatimSymlinks: true });
}
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
const archive = resolve(`release/mobile-dev-${manifest.version}-claude-desktop-darwin-arm64.mcpb`);
await rm(archive, { force: true });
// MCPB is a ZIP with manifest.json at its root. Preserve executable modes.
execFileSync("zip", ["-qr", archive, "manifest.json", "dist", ...documents], { cwd: directory });
execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
console.log(`Claude Desktop bundle: ${archive}`);

// Claude plugin: the same payload without the Codex manifest, .mcp.json or launcher.
// The server starts from PATH Node, and the updater stays off outside Codex packages.
const plugin = JSON.parse(await readFile(".claude-plugin/plugin.json", "utf8"));
plugin.version = metadata.version;
const pluginDirectory = resolve(`release/claude-plugin/${plugin.name}`);
await rm(pluginDirectory, { recursive: true, force: true });
await mkdir(`${pluginDirectory}/.claude-plugin`, { recursive: true });
for (const path of ["dist", "assets", "skills", ...documents]) {
  await cp(`${source}/${path}`, `${pluginDirectory}/${path}`, { recursive: true, verbatimSymlinks: true });
}
await writeFile(`${pluginDirectory}/.claude-plugin/plugin.json`, JSON.stringify(plugin, null, 2) + "\n");
console.log(`Claude plugin: ${pluginDirectory}`);
