import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nativeTelemetrySourceHash, nativeSentryLicense } from "./native-telemetry.mjs";
import { NDK_WARNINGS, ndkBuild, ndkTools } from "./ndk-build.mjs";

export async function androidCpuSourceHash() {
  const sourceBytes = await readFile("packages/native/android-cpu/collector.c");
  const hash = createHash("sha256");
  hash.update(sourceBytes);
  await nativeTelemetrySourceHash(hash);
  return hash.digest("hex");
}

async function buildAndroidCpu() {
  const compiler = execFileSync(join(ndkTools(), "clang"), ["--version"], { encoding: "utf8" });
  const sourceSHA256 = await androidCpuSourceHash();
  const binaries = await ndkBuild({
    name: "mobile-dev-cpu", directory: "packages/native/vendor/android-cpu", api: 21,
    sources: [{ path: "packages/native/android-cpu/collector.c", flags: ["-std=c11", "-O2", ...NDK_WARNINGS, "-fPIE"] }],
  });
  const release = {
    sourceSHA256, compiler, api: 21,
    flashlightCommit: "5ef203ae184547a3b2984fa4f9b76d672895f861", binaries,
  };
  const text = JSON.stringify(release, null, 2);
  await writeFile("packages/native/vendor/android-cpu/release.json", text + "\n");
  console.log("Built Android CPU collectors for all four ABIs.");
  const sentryLicense = await nativeSentryLicense();
  await writeFile("packages/native/vendor/android-cpu/SENTRY-LICENSE.txt", sentryLicense);
  await copyFile("packages/native/android-fps/perfetto/LIBCXX-LICENSE.TXT", "packages/native/vendor/android-cpu/LIBCXX-LICENSE.TXT");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("tooling/build-android-cpu.mjs")) {
  await buildAndroidCpu();
}
