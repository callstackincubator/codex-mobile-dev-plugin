import { access, cp, readFile } from "node:fs/promises";
import { assertBuildEnvironment } from "./telemetry-build.mjs";

/** The documents every host's package ships beside the runtime. */
export const RELEASE_DOCUMENTS = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"];

/** Copies the host-neutral runtime from `dist/` into a host's package. */
export async function stageRuntime(directory) {
  await cp("dist", directory, { recursive: true, verbatimSymlinks: true });
}

/** The release version every host ships, from the workspace's package.json. */
export async function releaseVersion() {
  const metadata = JSON.parse(await readFile("package.json", "utf8"));
  return metadata.version;
}

/** Checks that `npm run build` produced a complete runtime for `environment` before a host packages it. */
export async function assertRuntime(environment) {
  await assertBuildEnvironment("dist", environment);
  await access("dist/server.mjs");
  await access("dist/ios-mirror-service.mjs");
  await access("dist/app.html");
  await access("dist/baguette/Baguette");
  await access("dist/baguette/Baguette_Baguette.bundle");
  await access("dist/agent-device-server.mjs");
  await access("dist/ios-fps/mobile-dev-ios-fps");
  for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) await access(`dist/android-fps/${abi}/mobile-dev-fps`);
  await access("dist/ios-mirror/darwin-arm64.node");
  await access("dist/ios-mirror/third-party-licenses.txt");
  await access("dist/ios-logs/mobile-dev-ios-logs");
  await access("dist/ios-logs/third-party-licenses.txt");
  for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) await access(`dist/android-cpu/${abi}/mobile-dev-cpu`);
  await access("dist/android-cpu/LICENSE");
  await access("dist/serve-emu/src/cli.mjs");
  await access("dist/serve-emu/vendor/scrcpy-server-v4.0");
  await access("dist/agent-device/node_modules/agent-device/dist/apple/runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj/project.pbxproj");
}
