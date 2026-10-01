import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildNativeSentry, nativeTelemetrySourceHash, nativeSentryLicense, saveNativeSymbols } from "./native-telemetry.mjs";

export async function androidCpuSourceHash() {
  const sourceBytes = await readFile("native/android-cpu/collector.c");
  const hash = createHash("sha256");
  hash.update(sourceBytes);
  await nativeTelemetrySourceHash(hash);
  return hash.digest("hex");
}

async function buildAndroidCpu() {
  const ndk = process.env.ANDROID_NDK_HOME;
  if (!ndk) throw new Error("Set ANDROID_NDK_HOME to an installed Android NDK.");
  const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  const compilerRoot = join(ndk, "toolchains/llvm/prebuilt", host, "bin");
  const source = resolve("native/android-cpu/collector.c");
  const targets = {
    "arm64-v8a": "aarch64-linux-android21", "armeabi-v7a": "armv7a-linux-androideabi21",
    "x86": "i686-linux-android21", "x86_64": "x86_64-linux-android21",
  };
  const clang = join(compilerRoot, "clang");
  const compiler = execFileSync(clang, ["--version"], { encoding: "utf8" });
  const sourceSHA256 = await androidCpuSourceHash();
  const binaries = {};
  for (const [abi, target] of Object.entries(targets)) {
    const sdk = await buildNativeSentry(abi);
    const directory = `vendor/android-cpu/${abi}`;
    await mkdir(directory, { recursive: true });
    const output = `${directory}/mobile-dev-cpu`;
    const cCompiler = join(compilerRoot, `${target}-clang`);
    const telemetryObject = resolve(`.local-dev/sentry-native/${abi}/telemetry-cpu.o`);
    const collectorObject = resolve(`.local-dev/sentry-native/${abi}/collector-cpu.o`);
    execFileSync(cCompiler, ["-std=c11", "-O2", "-g", "-Wall", "-Wextra", "-Werror", "-DSENTRY_BUILD_STATIC=1",
      "-I", sdk.include, "-c", "native/telemetry/telemetry.c", "-o", telemetryObject], { stdio: "inherit" });
    execFileSync(cCompiler, ["-std=c11", "-O2", "-g", "-Wall", "-Wextra", "-Werror", "-fPIE", "-c", source, "-o", collectorObject], { stdio: "inherit" });
    const linker = join(compilerRoot, `${target}-clang++`);
    execFileSync(linker, ["-pie", "-static-libstdc++", collectorObject, telemetryObject, sdk.library, sdk.unwind,
      "-llog", "-lz", "-o", output], { stdio: "inherit" });
    await saveNativeSymbols(output, "mobile-dev-cpu", abi);
    const strip = join(compilerRoot, "llvm-strip");
    execFileSync(strip, [output]);
    const bytes = await readFile(output);
    const hash = createHash("sha256");
    hash.update(bytes);
    const sha256 = hash.digest("hex");
    binaries[abi] = { sha256, bytes: bytes.length };
  }
  const release = {
    sourceSHA256, compiler, api: 21,
    flashlightCommit: "5ef203ae184547a3b2984fa4f9b76d672895f861", binaries,
  };
  const text = JSON.stringify(release, null, 2);
  await writeFile("vendor/android-cpu/release.json", text + "\n");
  console.log("Built Android CPU collectors for all four ABIs.");
  const sentryLicense = await nativeSentryLicense();
  await writeFile("vendor/android-cpu/SENTRY-LICENSE.txt", sentryLicense);
  await copyFile("native/android-fps/perfetto/LIBCXX-LICENSE.TXT", "vendor/android-cpu/LIBCXX-LICENSE.TXT");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/build-android-cpu.mjs")) {
  await buildAndroidCpu();
}
