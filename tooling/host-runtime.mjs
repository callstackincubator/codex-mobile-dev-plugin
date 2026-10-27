import { access, cp, readFile } from "node:fs/promises";
import { assertBuildEnvironment } from "./telemetry-build.mjs";

/** The documents every host's package ships beside the runtime. */
export const RELEASE_DOCUMENTS = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];

// The files `npm run build` must produce, under dist/.
const RUNTIME_FILES = [
  "server.mjs", "ios-mirror-service.mjs", "app.html", "baguette/Baguette", "baguette/Baguette_Baguette.bundle", "agent-device-server.mjs",
  "ios-fps/mobile-dev-ios-fps",
  ...["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].map(abi => `android-fps/${abi}/mobile-dev-fps`),
  "ios-mirror/darwin-arm64.node", "ios-mirror/third-party-licenses.txt", "ios-logs/mobile-dev-ios-logs", "ios-logs/third-party-licenses.txt",
  ...["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].map(abi => `android-cpu/${abi}/mobile-dev-cpu`),
  "android-cpu/LICENSE", "serve-emu/src/cli.mjs", "serve-emu/vendor/scrcpy-server-v4.0",
  "agent-device/node_modules/agent-device/dist/apple/runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj/project.pbxproj",
  "agent-device/tools.json",
];

/**
 * Copies the host-neutral runtime from `dist/` into a host's package: all of it, or only
 * the top-level `parts` a host ships.
 */
export async function stageRuntime(directory, parts) {
  if (parts === undefined) return cp("dist", directory, { recursive: true, verbatimSymlinks: true });
  for (const part of parts) await cp(`dist/${part}`, `${directory}/${part}`, { recursive: true, verbatimSymlinks: true });
}

/** The release version every host ships, from the workspace's package.json. */
export async function releaseVersion() {
  const metadata = JSON.parse(await readFile("package.json", "utf8"));
  return metadata.version;
}

/**
 * Checks that `npm run build` produced a complete runtime for `environment`, or the
 * `parts` of it a host ships, before a host packages it.
 */
export async function assertRuntime(environment, parts) {
  await assertBuildEnvironment("dist", environment);
  for (const path of RUNTIME_FILES) {
    if (parts === undefined || parts.includes(path.split("/")[0])) await access(`dist/${path}`);
  }
}
