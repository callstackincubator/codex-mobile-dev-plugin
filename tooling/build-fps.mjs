import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildNativeSentry, nativeTelemetrySourceHash, nativeSentryLicense, saveNativeSymbols } from "./native-telemetry.mjs";
import { cargoBuild, cargoLicenses, cargoTarget, rustHelperSourceHash } from "./native-rust.mjs";
import { saveDarwinSymbols } from "./native-symbols.mjs";

export async function fpsSourceHash(platform) {
  const hash = createHash("sha256");
  if (platform === "ios") {
    await rustHelperSourceHash(hash, "ios-fps");
    return hash.digest("hex");
  }
  for (const file of ["collector.cpp", "perfetto/perfetto.h", "perfetto/perfetto.cc"]) {
    const bytes = await readFile(`packages/native/${platform}-fps/${file}`);
    hash.update(file);
    hash.update(bytes);
  }
  await nativeTelemetrySourceHash(hash);
  return hash.digest("hex");
}

async function buildIos() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build the iOS FPS helper on an Apple Silicon Mac.");
  const sdk = await buildNativeSentry();
  cargoBuild("mobile-dev-ios-fps", sdk.environment);
  await mkdir("packages/native/vendor/ios-fps", { recursive: true });
  const path = "packages/native/vendor/ios-fps/mobile-dev-ios-fps";
  const built = `${cargoTarget}/release/mobile-dev-ios-fps`;
  await copyFile(built, path);
  await saveDarwinSymbols(`${built}.dSYM`, "mobile-dev-ios-fps");
  execFileSync("strip", ["-x", path]);
  await chmod(path, 0o755);
  const bytes = await readFile(path);
  const hash = createHash("sha256");
  hash.update(bytes);
  const sourceSHA256 = await fpsSourceHash("ios");
  const release = { target: "darwin-arm64", sourceSHA256, binarySHA256: hash.digest("hex"), bytes: bytes.length,
    ideviceCommit: "a64b8867815b3da17b5c927531bdba877e8456ef" };
  const text = JSON.stringify(release, null, 2);
  await writeFile("packages/native/vendor/ios-fps/release.json", text + "\n");
  const licenses = await cargoLicenses("mobile-dev-ios-fps");
  const sentryLicense = await nativeSentryLicense();
  licenses.push(sentryLicense);
  const notices = licenses.join("\n\n====================\n\n");
  await writeFile("packages/native/vendor/ios-fps/third-party-licenses.txt", notices);
}

async function buildAndroid() {
  const ndk = process.env.ANDROID_NDK_HOME;
  if (ndk === undefined) throw new Error("Set ANDROID_NDK_HOME to an installed Android NDK.");
  const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  const root = join(ndk, "toolchains/llvm/prebuilt", host, "bin");
  const targets = { "arm64-v8a": "aarch64-linux-android31", "armeabi-v7a": "armv7a-linux-androideabi31", "x86": "i686-linux-android31", "x86_64": "x86_64-linux-android31" };
  const binaries = {};
  for (const [abi, target] of Object.entries(targets)) {
    const sdk = await buildNativeSentry(abi);
    const directory = `packages/native/vendor/android-fps/${abi}`;
    await mkdir(directory, { recursive: true });
    const path = `${directory}/mobile-dev-fps`;
    const compiler = join(root, `${target}-clang++`);
    const telemetryObject = resolve(`.local-dev/sentry-native/${abi}/telemetry.o`);
    const cCompiler = join(root, `${target}-clang`);
    execFileSync(cCompiler, ["-std=c11", "-O2", "-g", "-DSENTRY_BUILD_STATIC=1", "-I", sdk.include,
      "-c", "packages/native/telemetry/telemetry.c", "-o", telemetryObject], { stdio: "inherit" });
    execFileSync(compiler, ["-std=c++17", "-Oz", "-g", "-DNDEBUG", "-fPIE", "-pie", "-static-libstdc++",
      "packages/native/android-fps/collector.cpp", "packages/native/android-fps/perfetto/perfetto.cc", telemetryObject,
      sdk.library, sdk.unwind, "-I", "packages/native/android-fps", "-llog", "-lz", "-o", path], { stdio: "inherit" });
    await saveNativeSymbols(path, "mobile-dev-fps", abi);
    const strip = join(root, "llvm-strip");
    execFileSync(strip, [path]);
    const bytes = await readFile(path);
    const hash = createHash("sha256");
    hash.update(bytes);
    binaries[abi] = { sha256: hash.digest("hex"), bytes: bytes.length };
  }
  const sourceSHA256 = await fpsSourceHash("android");
  const release = { api: 31, perfettoVersion: "25.0", sourceSHA256, binaries };
  const text = JSON.stringify(release, null, 2);
  await writeFile("packages/native/vendor/android-fps/release.json", text + "\n");
  await copyFile("packages/native/android-fps/perfetto/LICENSE", "packages/native/vendor/android-fps/LICENSE");
  const sentryLicense = await nativeSentryLicense();
  await writeFile("packages/native/vendor/android-fps/SENTRY-LICENSE.txt", sentryLicense);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("tooling/build-fps.mjs")) {
  const platform = process.argv[2];
  if (platform === "ios") await buildIos();
  else if (platform === "android") await buildAndroid();
  else throw new Error("Choose ios or android.");
}
