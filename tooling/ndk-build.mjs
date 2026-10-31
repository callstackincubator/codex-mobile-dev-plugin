import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { buildNativeSentry, saveNativeSymbols } from "./native-telemetry.mjs";

export const ANDROID_ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"];
const TARGETS = { "arm64-v8a": "aarch64-linux-android", "armeabi-v7a": "armv7a-linux-androideabi", x86: "i686-linux-android", x86_64: "x86_64-linux-android" };
/** Our own sources compile warning-free; vendored SDK sources keep their upstream warnings. */
export const NDK_WARNINGS = ["-Wall", "-Wextra", "-Werror"];

/** The NDK's LLVM tools for this host, from ANDROID_NDK_HOME. */
export function ndkTools(environment = process.env) {
  const ndk = environment.ANDROID_NDK_HOME;
  if (!ndk) throw new Error("Set ANDROID_NDK_HOME to an installed Android NDK.");
  const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  return join(ndk, "toolchains/llvm/prebuilt", host, "bin");
}

/**
 * Builds `name` into `<directory>/<abi>/<name>` for every Android ABI, linked with
 * sentry-native and the shared telemetry. Saves each binary's symbols, strips it and
 * returns release metadata keyed by its path in `directory`.
 * Each source is `{ path, flags }`; `.c` files use clang, others clang++.
 */
export async function ndkBuild({ name, directory, api, sources }) {
  const tools = ndkTools();
  const binaries = {};
  for (const abi of ANDROID_ABIS) {
    const target = `${TARGETS[abi]}${api}`;
    const sdk = await buildNativeSentry(abi);
    const telemetry = { path: "packages/native/telemetry/telemetry.c",
      flags: ["-std=c11", "-O2", ...NDK_WARNINGS, "-DSENTRY_BUILD_STATIC=1", "-I", sdk.include] };
    const objects = [];
    for (const source of [telemetry, ...sources]) {
      const compiler = join(tools, extname(source.path) === ".c" ? `${target}-clang` : `${target}-clang++`);
      const object = resolve(`.local-dev/sentry-native/${abi}/${name}-${basename(source.path, extname(source.path))}.o`);
      execFileSync(compiler, [...source.flags, "-g", "-c", source.path, "-o", object], { stdio: "inherit" });
      objects.push(object);
    }
    await mkdir(`${directory}/${abi}`, { recursive: true });
    const output = `${directory}/${abi}/${name}`;
    execFileSync(join(tools, `${target}-clang++`), ["-pie", "-static-libstdc++", ...objects, sdk.library, sdk.unwind,
      "-llog", "-lz", "-o", output], { stdio: "inherit" });
    await saveNativeSymbols(output, name, abi);
    execFileSync(join(tools, "llvm-strip"), [output]);
    const bytes = await readFile(output);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    binaries[`${abi}/${name}`] = { sha256, bytes: bytes.length };
  }
  return binaries;
}
