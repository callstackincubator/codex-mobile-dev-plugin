import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const NATIVE_SENTRY_VERSION = "0.17.1";
const archiveSHA256 = "e510b714ac0fb5c24b08011e07c5b13fa01c9bd0f40708356e4af022aa20c5a1";
const root = resolve(".local-dev/sentry-native");

export async function nativeTelemetrySourceHash(hash) {
  for (const file of ["native/telemetry/telemetry.h", "native/telemetry/telemetry.c", "scripts/native-telemetry.mjs"]) {
    const bytes = await readFile(file);
    hash.update(file);
    hash.update(bytes);
  }
}

export async function buildNativeSentry(abi) {
  await mkdir(root, { recursive: true });
  const archive = join(root, "sdk.zip");
  let bytes;
  try { bytes = await readFile(archive); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const url = `https://github.com/getsentry/sentry-native/releases/download/${NATIVE_SENTRY_VERSION}/sentry-native.zip`;
    const response = await fetch(url);
    if (response.ok === false) throw new Error(`Sentry native download failed: HTTP ${response.status}.`);
    const downloaded = await response.arrayBuffer();
    bytes = Buffer.from(downloaded);
    await writeFile(archive, bytes);
  }
  const hash = createHash("sha256");
  hash.update(bytes);
  const digest = hash.digest("hex");
  if (digest !== archiveSHA256) throw new Error("Sentry native source archive failed its integrity check.");
  const source = join(root, "source");
  const header = join(source, "include/sentry.h");
  try { await access(header); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    execFileSync("unzip", ["-q", archive, "-d", source]);
  }
  const target = abi ?? "darwin-arm64";
  const build = join(root, target);
  const prefix = join(build, "install");
  const flags = ["-S", source, "-B", build, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=RelWithDebInfo",
    "-DSENTRY_BUILD_SHARED_LIBS=OFF", "-DSENTRY_BACKEND=inproc", "-DSENTRY_BUILD_TESTS=OFF",
    "-DSENTRY_BUILD_EXAMPLES=OFF", "-DSENTRY_SCREENSHOT=none",
    `-DCMAKE_INSTALL_PREFIX=${prefix}`];
  if (abi) {
    const ndk = process.env.ANDROID_NDK_HOME;
    if (ndk === undefined) throw new Error("Set ANDROID_NDK_HOME to build native Android telemetry.");
    flags.push(`-DCMAKE_TOOLCHAIN_FILE=${ndk}/build/cmake/android.toolchain.cmake`,
      `-DANDROID_ABI=${abi}`, "-DANDROID_PLATFORM=android-21", "-DANDROID_STL=c++_static", "-DSENTRY_TRANSPORT=none");
  } else {
    if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build native host telemetry on an Apple Silicon Mac.");
    const sdkOutput = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
    const sdk = sdkOutput.trim();
    flags.push("-DCMAKE_OSX_ARCHITECTURES=arm64", "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0",
      `-DCMAKE_OSX_SYSROOT=${sdk}`, "-DSENTRY_TRANSPORT=curl", "-DCURL_LIBRARY=/usr/lib/libcurl.dylib",
      "-DCURL_LIBRARY_RELEASE=/usr/lib/libcurl.dylib");
  }
  execFileSync("cmake", flags, { stdio: "inherit" });
  execFileSync("cmake", ["--build", build, "--parallel", "4"], { stdio: "inherit" });
  execFileSync("cmake", ["--install", build], { stdio: "inherit" });
  const include = join(prefix, "include");
  const library = join(prefix, "lib/libsentry.a");
  const unwind = abi ? join(prefix, "lib/libunwindstack.a") : undefined;
  const environment = { ...process.env, MOBILE_DEV_SENTRY_PREFIX: prefix, MACOSX_DEPLOYMENT_TARGET: "14.0" };
  return { include, library, unwind, environment };
}

export async function saveNativeSymbols(binary, name, target = "darwin-arm64") {
  const directory = resolve(`.sentry/native/${target}`);
  await mkdir(directory, { recursive: true });
  if (target === "darwin-arm64") {
    execFileSync("dsymutil", [binary, "-o", `${directory}/${name}.dSYM`], { stdio: "inherit" });
    await rm(`${binary}.dSYM`, { recursive: true, force: true });
  } else {
    await copyFile(binary, `${directory}/${name}`);
  }
}

export async function nativeSentryLicense() {
  const licensePath = join(root, "source/LICENSE");
  const unwindPath = join(root, "source/external/libunwindstack-ndk/LICENSE");
  const syscallPath = join(root, "source/external/third_party/lss/LICENSE");
  const license = await readFile(licensePath, "utf8");
  const unwind = await readFile(unwindPath, "utf8");
  const syscall = await readFile(syscallPath, "utf8");
  return `sentry-native ${NATIVE_SENTRY_VERSION}\nhttps://github.com/getsentry/sentry-native\n\n${license}`
    + `\n\nAndroid libunwindstack\n\n${unwind}\n\nLinux syscall support\n\n${syscall}`;
}
