import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { assertRuntime, releaseVersion, stageRuntime } from "../../../tooling/host-runtime.mjs";

// Claude runs the shared server and MCP Apps panel unchanged, in two formats: a
// Claude Desktop extension (MCPB) and a Claude Code plugin folder. Both are the
// host-neutral runtime plus their manifest; neither carries Codex-only files.
const telemetryEnvironment = telemetryBuildEnvironment();
await assertRuntime(telemetryEnvironment);
const version = await releaseVersion();
const documents = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];

// Claude Desktop: MCPB is a ZIP with manifest.json at its root. Preserve executable modes.
const manifest = { ...JSON.parse(await readFile("apps/claude/manifest.json", "utf8")), version };
const bundle = resolve("release/claude-desktop/mobile-dev");
await rm(bundle, { recursive: true, force: true });
await mkdir(bundle, { recursive: true });
await stageRuntime(`${bundle}/dist`);
for (const path of documents) await copyFile(path, `${bundle}/${path}`);
await writeFile(`${bundle}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
const archive = resolve(`release/mobile-dev-${version}-claude-desktop-darwin-arm64.mcpb`);
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, "manifest.json", "dist", ...documents], { cwd: bundle });
execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
console.log(`Claude Desktop bundle: ${archive}`);

// Claude Code: the plugin starts the server with Node from PATH and loads the shared skills.
const { name, ...fields } = JSON.parse(await readFile("apps/claude/.claude-plugin/plugin.json", "utf8"));
const plugin = resolve(`release/claude-plugin/${name}`);
await rm(plugin, { recursive: true, force: true });
await mkdir(`${plugin}/.claude-plugin`, { recursive: true });
await stageRuntime(`${plugin}/dist`);
await cp("apps/claude/assets", `${plugin}/assets`, { recursive: true });
for (const skill of ["mobile-dev", "mobile-dev-setup"]) await cp(`packages/skills/${skill}`, `${plugin}/skills/${skill}`, { recursive: true, verbatimSymlinks: true });
for (const path of documents) await copyFile(path, `${plugin}/${path}`);
await writeFile(`${plugin}/.claude-plugin/plugin.json`, JSON.stringify({ name, version, ...fields }, null, 2) + "\n");
console.log(`Claude Code plugin: ${plugin}`);
