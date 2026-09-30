import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ndk = process.env.ANDROID_NDK_HOME;
if (!ndk) throw new Error("Set ANDROID_NDK_HOME to an installed Android NDK.");
const host = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
const compilerRoot = join(ndk, "toolchains/llvm/prebuilt", host, "bin");
const source = resolve("native/android-cpu/collector.c");
const targets = {
  "arm64-v8a": "aarch64-linux-android21", "armeabi-v7a": "armv7a-linux-androideabi21",
  "x86": "i686-linux-android21", "x86_64": "x86_64-linux-android21",
};
const compiler = execFileSync(join(compilerRoot, "clang"), ["--version"], { encoding: "utf8" });
const sourceBytes = await readFile(source);
const sourceSHA256 = createHash("sha256").update(sourceBytes).digest("hex");
const binaries = {};
for (const [abi, target] of Object.entries(targets)) {
  const directory = `vendor/android-cpu/${abi}`;
  await mkdir(directory, { recursive: true });
  const output = `${directory}/mobile-dev-cpu`;
  execFileSync(join(compilerRoot, `${target}-clang`), ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIE", "-pie", source, "-o", output], { stdio: "inherit" });
  execFileSync(join(compilerRoot, "llvm-strip"), [output]);
  const bytes = await readFile(output);
  binaries[abi] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}
await writeFile("vendor/android-cpu/release.json", JSON.stringify({
  sourceSHA256, compiler, api: 21,
  flashlightCommit: "5ef203ae184547a3b2984fa4f9b76d672895f861", binaries,
}, null, 2) + "\n");
console.log("Built Android CPU collectors for all four ABIs.");
