import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";

// Reuse the existing artifact inventory, native assets and environment checks.
telemetryBuildEnvironment();
execFileSync(process.execPath, ["scripts/package.mjs", ...process.argv.slice(2)], { stdio: "inherit" });
const metadata = JSON.parse(await readFile("package.json", "utf8"));
// Cursor plugin: the same payload without the Codex manifest, .mcp.json or launcher.
// The server starts from PATH Node, and the updater stays off outside Codex packages.
const plugin = JSON.parse(await readFile(".cursor-plugin/plugin.json", "utf8"));
plugin.version = metadata.version;
const source = resolve("release/marketplace/plugins/mobile-dev");
const documents = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];
const directory = resolve(`release/cursor-plugin/${plugin.name}`);
await rm(directory, { recursive: true, force: true });
await mkdir(`${directory}/.cursor-plugin`, { recursive: true });
for (const path of ["dist", "assets", "skills", ...documents]) {
  await cp(`${source}/${path}`, `${directory}/${path}`, { recursive: true, verbatimSymlinks: true });
}
await writeFile(`${directory}/.cursor-plugin/plugin.json`, JSON.stringify(plugin, null, 2) + "\n");
console.log(`Cursor plugin: ${directory}`);
