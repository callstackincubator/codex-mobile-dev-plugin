import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { androidCpuSourceHash } from "./build-android-cpu.mjs";
import { fpsSourceHash } from "./build-fps.mjs";
import { iosLogsSourceHash } from "./build-ios-logs.mjs";
import { iosMirrorSourceHash } from "./build-ios-mirror.mjs";
import { ANDROID_ABIS } from "./ndk-build.mjs";
import { baguetteBuildScripts, baguetteTelemetrySourceHash } from "./rebuild-baguette.mjs";

const darwinSymbols = name => [`.sentry/native/darwin-arm64/${name}.dSYM`];
const android = name => ({
  binaries: ANDROID_ABIS.map(abi => `${abi}/${name}`),
  symbols: ANDROID_ABIS.map(abi => `.sentry/native/${abi}/${name}`),
});

/**
 * Every bundled native helper; its build is in packages/native/vendor/<name> and
 * ships in dist/<name>.
 * - command: the npm script that produces the build. `rebuild` names the one to run
 *   after editing `label`, when it differs.
 * - scripts, inputs, tools: what the release artifact key hashes besides the sources.
 * - committed: the build is checked in (Baguette's comes from vendor:baguette).
 * - sourceHash: the sources' current hash, which release.json must record.
 * - release: maps another release.json shape to { sourceSHA256, binaries: { [path]: { sha256 } } }.
 * - binaries: the executables and bundles the runtime runs; `executables` start on the Mac.
 * - runtimeFiles: other files a package must ship. `extraFiles` are [repository path, name]
 *   pairs copied beside the build.
 * - symbols: debug symbols retained for Sentry.
 * - verify: further integrity checks of the build in `root`.
 */
export const nativeHelpers = [
  {
    name: "baguette", label: "Baguette's integration or native telemetry", command: "vendor:baguette", rebuild: "rebuild:baguette",
    scripts: ["vendor-baguette.mjs", ...baguetteBuildScripts], inputs: ["packages/native/vendor/baguette-release.json"],
    tools: ["darwin", "swift"], committed: false, sourceHash: () => baguetteTelemetrySourceHash(),
    release: metadata => ({
      sourceSHA256: metadata.build?.telemetrySourceSHA256,
      binaries: { Baguette: { sha256: metadata.build?.binarySha256 } },
    }),
    binaries: ["Baguette", "Baguette_Baguette.bundle"], executables: ["Baguette"], runtimeFiles: [], extraFiles: [],
    symbols: darwinSymbols("Baguette"),
  },
  {
    name: "ios-fps", label: "the iPhone FPS helper", command: "rebuild:ios-fps", scripts: ["build-fps.mjs"], inputs: [],
    tools: ["darwin", "rust"], committed: true, sourceHash: () => fpsSourceHash("ios"),
    binaries: ["mobile-dev-ios-fps"], executables: ["mobile-dev-ios-fps"], runtimeFiles: ["third-party-licenses.txt"],
    extraFiles: [["packages/native/ios-fps/README.md", "README.md"]],
    symbols: darwinSymbols("mobile-dev-ios-fps"),
  },
  {
    name: "ios-mirror", label: "the physical iOS capture addon", command: "rebuild:ios-mirror", scripts: ["build-ios-mirror.mjs"], inputs: [],
    tools: ["darwin", "rust"], committed: true, sourceHash: () => iosMirrorSourceHash(),
    binaries: ["darwin-arm64.node"], executables: [], runtimeFiles: ["third-party-licenses.txt"],
    extraFiles: ["README.md", "IDEVICE-LICENSE.txt", "DEVICE-HUB-LICENSE.txt"].map(file => [`packages/native/ios-mirror/${file}`, file]),
    symbols: darwinSymbols("darwin-arm64.node"),
  },
  {
    name: "ios-logs", label: "the physical iOS log reader", command: "rebuild:ios-logs", scripts: ["build-ios-logs.mjs"], inputs: [],
    tools: ["darwin", "iosLogs"], committed: true, sourceHash: () => iosLogsSourceHash(),
    binaries: ["mobile-dev-ios-logs"], executables: ["mobile-dev-ios-logs"], runtimeFiles: ["third-party-licenses.txt"],
    // The LGPL reader ships with its source and build script.
    extraFiles: [
      ...["README.md", "LICENSE", "collector.c", "dependencies.json"].map(file => [`packages/native/ios-logs/${file}`, file]),
      ["tooling/build-ios-logs.mjs", "build-ios-logs.mjs"], ["tooling/native-telemetry.mjs", "native-telemetry.mjs"],
    ],
    symbols: darwinSymbols("mobile-dev-ios-logs"),
    async verify(metadata, root) {
      for (const source of metadata.sources) {
        const archive = `${source.name}-${source.version}.tar.bz2`;
        if (await fileSHA256(`${root}/sources/${archive}`) !== source.sha256) {
          throw new Error(`Physical iOS log dependency source integrity check failed for ${archive}.`);
        }
      }
    },
  },
  {
    name: "android-fps", label: "the Android FPS collector", command: "rebuild:android-fps", scripts: ["build-fps.mjs", "ndk-build.mjs"], inputs: [],
    tools: ["android"], committed: true, sourceHash: () => fpsSourceHash("android"),
    ...android("mobile-dev-fps"), executables: [], runtimeFiles: [],
    extraFiles: [["packages/native/android-fps/README.md", "README.md"], ["packages/native/android-fps/perfetto/LIBCXX-LICENSE.TXT", "LIBCXX-LICENSE.TXT"]],
  },
  {
    name: "android-cpu", label: "the Android CPU collector", command: "rebuild:android-cpu", scripts: ["build-android-cpu.mjs", "ndk-build.mjs"], inputs: [],
    tools: ["android"], committed: true, sourceHash: () => androidCpuSourceHash(),
    ...android("mobile-dev-cpu"), executables: [], runtimeFiles: ["LICENSE"],
    extraFiles: ["LICENSE", "README.md", "collector.c"].map(file => [`packages/native/android-cpu/${file}`, file]),
  },
];

export function nativeHelper(name) {
  const helper = nativeHelpers.find(entry => entry.name === name);
  if (helper === undefined) throw new Error(`Unknown native helper ${name}.`);
  return helper;
}

/** The dist-relative files a runtime with these helpers must contain. */
export function nativeRuntimeFiles(names = nativeHelpers.map(helper => helper.name)) {
  return names.flatMap(name => {
    const helper = nativeHelper(name);
    return [...helper.binaries, ...helper.runtimeFiles].map(file => `${name}/${file}`);
  });
}

/** The dist-relative executables the Mac starts directly. */
export function nativeExecutables() {
  return nativeHelpers.flatMap(helper => helper.executables.map(file => `${helper.name}/${file}`));
}

export async function fileSHA256(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

/** Checks that a helper's vendored build matches its sources and recorded hashes. */
export async function verifyNativeHelper(helper) {
  const root = `packages/native/vendor/${helper.name}`;
  for (const path of helper.binaries) await access(`${root}/${path}`);
  const text = await readFile(`${root}/release.json`, "utf8");
  const metadata = JSON.parse(text);
  const release = helper.release ? helper.release(metadata) : metadata;
  const sourceSHA256 = await helper.sourceHash();
  if (sourceSHA256 !== release.sourceSHA256) throw new Error(`Run npm run ${helper.rebuild ?? helper.command} after editing ${helper.label}.`);
  for (const [path, binary] of Object.entries(release.binaries)) {
    if (await fileSHA256(`${root}/${path}`) !== binary.sha256) throw new Error(`The bundled ${helper.name} helper failed its integrity check for ${path}.`);
  }
  await helper.verify?.(metadata, root);
}
