import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { assertRuntime, releaseVersion, stageRuntime } from "../../../tooling/host-runtime.mjs";

// Cursor runs the shared server and MCP Apps panel unchanged: the host-neutral
// runtime plus its plugin manifest, started with Node from PATH, without Codex files.
const telemetryEnvironment = telemetryBuildEnvironment();
await assertRuntime(telemetryEnvironment);
const version = await releaseVersion();
const documents = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];
const { name, ...fields } = JSON.parse(await readFile("apps/cursor/.cursor-plugin/plugin.json", "utf8"));
const plugin = resolve(`release/cursor-plugin/${name}`);
await rm(plugin, { recursive: true, force: true });
await mkdir(`${plugin}/.cursor-plugin`, { recursive: true });
await stageRuntime(`${plugin}/dist`);
await cp("apps/cursor/assets", `${plugin}/assets`, { recursive: true });
for (const skill of ["mobile-dev", "mobile-dev-setup"]) await cp(`packages/skills/${skill}`, `${plugin}/skills/${skill}`, { recursive: true, verbatimSymlinks: true });
for (const path of documents) await copyFile(path, `${plugin}/${path}`);
await writeFile(`${plugin}/.cursor-plugin/plugin.json`, JSON.stringify({ name, version, ...fields }, null, 2) + "\n");
console.log(`Cursor plugin: ${plugin}`);
