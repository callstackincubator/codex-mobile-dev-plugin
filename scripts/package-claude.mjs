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
const directory = resolve("release/claude-desktop/mobile-dev");
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
for (const path of ["dist", "README.md", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"]) {
  await cp(`${source}/${path}`, `${directory}/${path}`, { recursive: true, verbatimSymlinks: true });
}
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
const archive = resolve(`release/mobile-dev-${manifest.version}-claude-desktop-darwin-arm64.mcpb`);
await rm(archive, { force: true });
// MCPB is a ZIP with manifest.json at its root. Preserve executable modes.
execFileSync("zip", ["-qr", archive, "manifest.json", "dist", "README.md", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"], { cwd: directory });
execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
console.log(`Claude Desktop bundle: ${archive}`);
