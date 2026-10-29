import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildNativeSentry, nativeTelemetrySourceHash, nativeSentryLicense } from "./native-telemetry.mjs";
import { NDK_WARNINGS, ndkBuild } from "./ndk-build.mjs";
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
  const binaries = { "mobile-dev-ios-fps": { sha256: hash.digest("hex"), bytes: bytes.length } };
  const release = { target: "darwin-arm64", sourceSHA256, binaries, ideviceCommit: "a64b8867815b3da17b5c927531bdba877e8456ef" };
  const text = JSON.stringify(release, null, 2);
  await writeFile("packages/native/vendor/ios-fps/release.json", text + "\n");
  const licenses = await cargoLicenses("mobile-dev-ios-fps");
  const sentryLicense = await nativeSentryLicense();
  licenses.push(sentryLicense);
  const notices = licenses.join("\n\n====================\n\n");
  await writeFile("packages/native/vendor/ios-fps/third-party-licenses.txt", notices);
}

async function buildAndroid() {
  const flags = ["-std=c++17", "-Oz", "-DNDEBUG", "-fPIE", "-I", "packages/native/android-fps"];
  const binaries = await ndkBuild({
    name: "mobile-dev-fps", directory: "packages/native/vendor/android-fps", api: 31,
    sources: [
      { path: "packages/native/android-fps/collector.cpp", flags: [...flags, ...NDK_WARNINGS] },
      { path: "packages/native/android-fps/perfetto/perfetto.cc", flags },
    ],
  });
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
