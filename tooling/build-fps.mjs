import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildNativeSentry, nativeTelemetrySourceHash, nativeSentryLicense } from "./native-telemetry.mjs";
import { NDK_WARNINGS, ndkBuild } from "./ndk-build.mjs";

export async function fpsSourceHash(platform) {
  const files = platform === "ios"
    ? ["Cargo.toml", "Cargo.lock", "src/main.rs", "src/foreground.rs"]
    : ["collector.cpp", "perfetto/perfetto.h", "perfetto/perfetto.cc"];
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = await readFile(`packages/native/${platform}-fps/${file}`);
    hash.update(file);
    hash.update(bytes);
  }
  await nativeTelemetrySourceHash(hash);
  if (platform === "ios") {
    for (const file of ["Cargo.toml", "build.rs", "src/lib.rs"]) {
      const bytes = await readFile(`packages/native/telemetry/${file}`);
      hash.update(file);
      hash.update(bytes);
    }
  }
  return hash.digest("hex");
}

async function buildIos() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build the iOS FPS helper on an Apple Silicon Mac.");
  const sdk = await buildNativeSentry();
  execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", "packages/native/ios-fps/Cargo.toml"], {
    stdio: "inherit", env: sdk.environment,
  });
  await mkdir("packages/native/vendor/ios-fps", { recursive: true });
  const path = "packages/native/vendor/ios-fps/mobile-dev-ios-fps";
  await copyFile("packages/native/ios-fps/target/release/mobile-dev-ios-fps", path);
  const symbols = ".sentry/native/darwin-arm64/mobile-dev-ios-fps.dSYM";
  await mkdir(".sentry/native/darwin-arm64", { recursive: true });
  await rm(symbols, { recursive: true, force: true });
  await cp("packages/native/ios-fps/target/release/mobile-dev-ios-fps.dSYM", symbols, { recursive: true, dereference: true });
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
  const metadataText = execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--manifest-path", "packages/native/ios-fps/Cargo.toml"], { encoding: "utf8" });
  const metadata = JSON.parse(metadataText);
  const licenses = [];
  for (const dependency of metadata.packages) {
    if (dependency.name === "mobile-dev-ios-fps") continue;
    const directory = resolve(dependency.manifest_path, "..");
    const entries = await readdir(directory);
    const files = entries.filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE)([-._]|$)/i.test(name));
    if (dependency.name === "idevice") files.push("../LICENSE.txt");
    const texts = [];
    for (const file of files) {
      try { const license = await readFile(`${directory}/${file}`, "utf8"); texts.push(license); }
      catch { /* Some packages also have a license directory. */ }
    }
    const body = texts.join("\n\n");
    const notice = `${dependency.name} ${dependency.version} (${dependency.license})\n${dependency.repository ?? ""}\n\n${body}`;
    licenses.push(notice);
  }
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
