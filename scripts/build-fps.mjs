import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildNativeSentry, nativeTelemetrySourceHash, nativeSentryLicense, saveNativeSymbols } from "./native-telemetry.mjs";

export async function fpsSourceHash(platform) {
  const files = platform === "ios"
    ? ["Cargo.toml", "Cargo.lock", "src/main.rs", "src/foreground.rs"]
    : ["collector.cpp", "perfetto/perfetto.h", "perfetto/perfetto.cc"];
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = await readFile(`native/${platform}-fps/${file}`);
    hash.update(file);
    hash.update(bytes);
  }
  await nativeTelemetrySourceHash(hash);
  if (platform === "ios") {
    for (const file of ["Cargo.toml", "build.rs", "src/lib.rs"]) {
      const bytes = await readFile(`native/telemetry/${file}`);
      hash.update(file);
      hash.update(bytes);
    }
  }
  return hash.digest("hex");
}

async function buildIos() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build the iOS FPS helper on an Apple Silicon Mac.");
  const sdk = await buildNativeSentry();
  execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", "native/ios-fps/Cargo.toml"], {
    stdio: "inherit", env: sdk.environment,
  });
  await mkdir("vendor/ios-fps", { recursive: true });
  const path = "vendor/ios-fps/mobile-dev-ios-fps";
  await copyFile("native/ios-fps/target/release/mobile-dev-ios-fps", path);
  const symbols = ".sentry/native/darwin-arm64/mobile-dev-ios-fps.dSYM";
  await mkdir(".sentry/native/darwin-arm64", { recursive: true });
  await rm(symbols, { recursive: true, force: true });
  await cp("native/ios-fps/target/release/mobile-dev-ios-fps.dSYM", symbols, { recursive: true, dereference: true });
  execFileSync("strip", ["-x", path]);
  await chmod(path, 0o755);
  const bytes = await readFile(path);
  const hash = createHash("sha256");
  hash.update(bytes);
  const sourceSHA256 = await fpsSourceHash("ios");
  const release = { target: "darwin-arm64", sourceSHA256, binarySHA256: hash.digest("hex"), bytes: bytes.length,
    ideviceCommit: "a64b8867815b3da17b5c927531bdba877e8456ef" };
  const text = JSON.stringify(release, null, 2);
  await writeFile("vendor/ios-fps/release.json", text + "\n");
  const metadataText = execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--manifest-path", "native/ios-fps/Cargo.toml"], { encoding: "utf8" });
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
  await writeFile("vendor/ios-fps/third-party-licenses.txt", notices);
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
    const directory = `vendor/android-fps/${abi}`;
    await mkdir(directory, { recursive: true });
    const path = `${directory}/mobile-dev-fps`;
    const compiler = join(root, `${target}-clang++`);
    const telemetryObject = resolve(`.local-dev/sentry-native/${abi}/telemetry.o`);
    const cCompiler = join(root, `${target}-clang`);
    execFileSync(cCompiler, ["-std=c11", "-O2", "-g", "-DSENTRY_BUILD_STATIC=1", "-I", sdk.include,
      "-c", "native/telemetry/telemetry.c", "-o", telemetryObject], { stdio: "inherit" });
    execFileSync(compiler, ["-std=c++17", "-Oz", "-g", "-DNDEBUG", "-fPIE", "-pie", "-static-libstdc++",
      "native/android-fps/collector.cpp", "native/android-fps/perfetto/perfetto.cc", telemetryObject,
      sdk.library, sdk.unwind, "-I", "native/android-fps", "-llog", "-lz", "-o", path], { stdio: "inherit" });
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
  await writeFile("vendor/android-fps/release.json", text + "\n");
  await copyFile("native/android-fps/perfetto/LICENSE", "vendor/android-fps/LICENSE");
  const sentryLicense = await nativeSentryLicense();
  await writeFile("vendor/android-fps/SENTRY-LICENSE.txt", sentryLicense);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/build-fps.mjs")) {
  const platform = process.argv[2];
  if (platform === "ios") await buildIos();
  else if (platform === "android") await buildAndroid();
  else throw new Error("Choose ios or android.");
}
