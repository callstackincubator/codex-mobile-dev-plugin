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

export async function stageRuntime(directory, { panel = true } = {}) {
  await cp("dist", directory, {
    recursive: true, verbatimSymlinks: true,
    filter: source => panel || PANEL_PARTS.includes(relative("dist", source).split(sep)[0]) === false,
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

export async function assertRuntime(environment) {
  await assertBuildEnvironment("dist", environment);
  for (const path of RUNTIME_FILES) await access(`dist/${path}`);
}
