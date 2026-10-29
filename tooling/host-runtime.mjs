import { access, cp, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { assertBuildEnvironment } from "./telemetry-build.mjs";

export const RELEASE_DOCUMENTS = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];

/**
 * The parts of `dist/` only Mobile Dev's panel uses: Baguette for iOS simulators,
 * serve-emu for Android, and physical iPhone mirroring with its service. Hosts whose
 * server has no panel leave them out.
 */
export const PANEL_PARTS = ["baguette", "serve-emu", "ios-mirror", "ios-mirror-service.mjs"];

const RUNTIME_FILES = [
  "server.mjs", "ios-mirror-service.mjs", "app.html", "baguette/Baguette", "baguette/Baguette_Baguette.bundle",
  "ios-fps/mobile-dev-ios-fps",
  ...["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].map(abi => `android-fps/${abi}/mobile-dev-fps`),
  "ios-mirror/darwin-arm64.node", "ios-mirror/third-party-licenses.txt", "ios-logs/mobile-dev-ios-logs", "ios-logs/third-party-licenses.txt",
  ...["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].map(abi => `android-cpu/${abi}/mobile-dev-cpu`),
  "android-cpu/LICENSE", "serve-emu/src/cli.mjs", "serve-emu/vendor/scrcpy-server-v4.0",
  "agent-device/node_modules/agent-device/dist/apple/runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj/project.pbxproj",
  "agent-device/tools.json",
];

export async function stageRuntime(directory, { panel = true, runtime = "dist" } = {}) {
  await cp(runtime, directory, {
    recursive: true, verbatimSymlinks: true,
    filter: source => panel || PANEL_PARTS.includes(relative(runtime, source).split(sep)[0]) === false,
  });
}

export async function oversizedFiles(directory, maxBytes, skip = []) {
  const oversized = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() === false || skip.includes(relative(directory, path).split(sep)[0])) continue;
    const { size } = await stat(path);
    if (size > maxBytes) oversized.push({ path: relative(directory, path), size });
  }
  return oversized;
}

export async function releaseVersion() {
  const metadata = JSON.parse(await readFile("package.json", "utf8"));
  return metadata.version;
}

/** The files every staged runtime has, relative to it; without the panel's parts for hosts without it. */
export function runtimeFiles({ panel = true } = {}) {
  return RUNTIME_FILES.filter(path => panel || PANEL_PARTS.includes(path.split("/")[0]) === false);
}

export async function assertRuntime(environment) {
  await assertBuildEnvironment("dist", environment);
  for (const path of RUNTIME_FILES) await access(`dist/${path}`);
}

/**
 * The release asset a plugin host's package step writes, `mobile-dev-<version>-<qualifier>-darwin-arm64`:
 * the plugin ZIP qualified by the host's `archive` (by default `<host>-plugin`), or with
 * `desktop` its desktop bundle (`<host>-desktop`, an MCPB).
 */
export function releaseArchive(host, version, { desktop = false } = {}) {
  const qualifier = desktop ? `${host.name}-desktop` : host.archive ?? `${host.name}-plugin`;
  return `release/mobile-dev-${version}-${qualifier ? `${qualifier}-` : ""}darwin-arm64.${desktop ? "mcpb" : "zip"}`;
}
