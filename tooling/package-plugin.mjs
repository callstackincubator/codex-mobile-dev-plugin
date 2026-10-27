import { existsSync } from "node:fs";
import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { assertRuntime, RELEASE_DOCUMENTS as documents, releaseVersion, stageRuntime } from "./host-runtime.mjs";
import { pluginHost } from "./plugin-hosts.mjs";

// Packages the shared server and MCP Apps panel for a plugin host: the host-neutral
// runtime plus the host's manifest, without Codex-only files. The host's app may add
// `scripts`, `hooks` and `skills` files, and a README that replaces the repository's.
//   node tooling/package-plugin.mjs <claude|cursor> [--release]
const name = process.argv[2];
const host = pluginHost(name);
const environment = telemetryBuildEnvironment(process.argv.slice(3));
await assertRuntime(environment);
const version = await releaseVersion();

const { name: pluginName, ...fields } = JSON.parse(await readFile(`${host.app}/${host.manifest}/plugin.json`, "utf8"));
const directory = resolve(`release/${name}-plugin/${pluginName}`);
await rm(directory, { recursive: true, force: true });
await mkdir(`${directory}/${host.manifest}`, { recursive: true });
await stageRuntime(`${directory}/dist`);
// The server runs agent-device's CLI by path; npm's bin links are symlinks hosts reject.
await rm(`${directory}/dist/agent-device/node_modules/.bin`, { recursive: true, force: true });
await cp(`${host.app}/assets`, `${directory}/assets`, { recursive: true });
// A skill's agents/openai.yaml is Codex's skill metadata.
const skillFilter = source => basename(source) !== "agents";
for (const skill of ["mobile-dev", "mobile-dev-setup"]) await cp(`packages/skills/${skill}`, `${directory}/skills/${skill}`, { recursive: true, verbatimSymlinks: true, filter: skillFilter });
for (const path of ["scripts", "hooks", "skills"]) {
  if (existsSync(`${host.app}/${path}`)) await cp(`${host.app}/${path}`, `${directory}/${path}`, { recursive: true });
}
for (const path of documents) await copyFile(path === "README.md" && existsSync(`${host.app}/README.md`) ? `${host.app}/README.md` : path, `${directory}/${path}`);
await writeFile(`${directory}/${host.manifest}/plugin.json`, JSON.stringify({ name: pluginName, version, ...fields }, null, 2) + "\n");
console.log(`${host.label} plugin: ${directory}`);
