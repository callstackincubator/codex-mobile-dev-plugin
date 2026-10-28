import { access, cp, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { assertBuildEnvironment } from "./telemetry-build.mjs";

/** The documents every host's package ships beside the runtime. */
export const RELEASE_DOCUMENTS = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];

/**
 * The parts of `dist/` only Mobile Dev's panel uses: Baguette for iOS simulators,
 * serve-emu for Android, and physical iPhone mirroring with its service. Hosts whose
 * server has no panel leave them out.
 */
export const PANEL_PARTS = ["baguette", "serve-emu", "ios-mirror", "ios-mirror-service.mjs"];

// The files `npm run build` must produce, under dist/.
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

/** Copies the host-neutral runtime from `dist/` into a host's package, without the panel's parts for hosts without it. */
export async function stageRuntime(directory, { panel = true } = {}) {
  await cp("dist", directory, {
    recursive: true, verbatimSymlinks: true,
    filter: source => panel || PANEL_PARTS.includes(relative("dist", source).split(sep)[0]) === false,
  });
}

/** Files under `directory` larger than `maxBytes`, leaving out its top-level entries in `skip`. */
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

/** The release version every host ships, from the workspace's package.json. */
export async function releaseVersion() {
  const metadata = JSON.parse(await readFile("package.json", "utf8"));
  return metadata.version;
}

/** Checks that `npm run build` produced a complete runtime for `environment` before a host packages it. */
export async function assertRuntime(environment) {
  await assertBuildEnvironment("dist", environment);
  for (const path of RUNTIME_FILES) await access(`dist/${path}`);
}
