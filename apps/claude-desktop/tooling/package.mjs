import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { assertRuntime, releaseVersion, stageRuntime } from "../../../tooling/host-runtime.mjs";

// Claude Desktop runs the shared server and MCP Apps panel unchanged, so the bundle
// is the host-neutral runtime plus the MCPB manifest.
const telemetryEnvironment = telemetryBuildEnvironment();
await assertRuntime(telemetryEnvironment);
const manifest = JSON.parse(await readFile("apps/claude-desktop/manifest.json", "utf8"));
manifest.version = await releaseVersion();
const directory = resolve("release/claude-desktop/mobile-dev");
const documents = ["README.md", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await stageRuntime(`${directory}/dist`);
for (const path of documents) await copyFile(path, `${directory}/${path}`);
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
const archive = resolve(`release/mobile-dev-${manifest.version}-claude-desktop-darwin-arm64.mcpb`);
await rm(archive, { force: true });
// MCPB is a ZIP with manifest.json at its root. Preserve executable modes.
execFileSync("zip", ["-qr", archive, "manifest.json", "dist", ...documents], { cwd: directory });
execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
console.log(`Claude Desktop bundle: ${archive}`);
