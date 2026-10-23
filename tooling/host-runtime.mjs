import { access, cp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertBuildEnvironment } from "./telemetry-build.mjs";

/**
 * Copies the host-neutral runtime from `dist/` into `directory`, then lays the
 * host's own build from `dist/hosts/<host>` over it, such as Codex's server and page.
 */
export async function stageRuntime(directory, host) {
  const hosts = resolve("dist/hosts");
  await cp("dist", directory, { recursive: true, verbatimSymlinks: true, filter: source => resolve(source) !== hosts });
  if (host !== undefined) await cp(`dist/hosts/${host}`, directory, { recursive: true });
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
