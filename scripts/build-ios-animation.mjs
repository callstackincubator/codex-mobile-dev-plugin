import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = "native/ios-animation/MobileDevAnimationSpeed.m";

export async function iosAnimationSourceHash() {
  const hash = createHash("sha256");
  for (const file of [source, "scripts/build-ios-animation.mjs"]) {
    hash.update(file);
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/build-ios-animation.mjs")) {
  if (process.platform !== "darwin") throw new Error("Build the iOS simulator animation library on a Mac with Xcode.");
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-ios-animation-"));
  try {
    const slices = [];
    for (const arch of ["arm64", "x86_64"]) {
      const output = join(directory, `${arch}.dylib`);
      execFileSync("xcrun", ["--sdk", "iphonesimulator", "clang", "-target", `${arch}-apple-ios15.0-simulator`, "-dynamiclib", "-fobjc-arc", "-Os",
        "-framework", "UIKit", "-framework", "Foundation", "-o", output, source], { stdio: "inherit" });
      slices.push(output);
    }
    await mkdir("vendor/ios-animation", { recursive: true });
    const binaryPath = "vendor/ios-animation/MobileDevAnimationSpeed.dylib";
    execFileSync("lipo", ["-create", ...slices, "-output", binaryPath], { stdio: "inherit" });
    // Simulator apps load only signed libraries; an ad-hoc signature suffices.
    execFileSync("codesign", ["--force", "--sign", "-", binaryPath], { stdio: "inherit" });
    const binary = await readFile(binaryPath);
    const sdk = execFileSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"], { encoding: "utf8" }).trim();
    await writeFile("vendor/ios-animation/release.json", `${JSON.stringify({
      name: "mobile-dev-ios-animation",
      target: "ios-simulator arm64 x86_64, iOS 15.0 or later",
      sdk: `iphonesimulator ${sdk}`,
      sourceSHA256: await iosAnimationSourceHash(),
      binarySHA256: createHash("sha256").update(binary).digest("hex"),
    }, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
