import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildNativeSentry, nativeSentryLicense } from "./native-telemetry.mjs";
import { cargoBuild, cargoLicenses, cargoTarget, rustHelperSourceHash } from "./native-rust.mjs";
import { saveDarwinSymbols } from "./native-symbols.mjs";
import { createRequire } from "node:module";

export async function iosMirrorSourceHash() {
  const hash = createHash("sha256");
  await rustHelperSourceHash(hash, "ios-mirror");
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("tooling/build-ios-mirror.mjs")) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build the physical iOS capture addon on an Apple Silicon Mac.");
  const sdk = await buildNativeSentry();
  cargoBuild("mobile-dev-ios-mirror", sdk.environment);
  await mkdir("packages/native/vendor/ios-mirror", { recursive: true });
  const licenses = await cargoLicenses("mobile-dev-ios-mirror");
  const sentryLicense = await nativeSentryLicense();
  licenses.push(sentryLicense);
  const licenseText = licenses.join("\n\n====================\n\n");
  await writeFile("packages/native/vendor/ios-mirror/third-party-licenses.txt", licenseText);
  const binaryPath = "packages/native/vendor/ios-mirror/darwin-arm64.node";
  const built = `${cargoTarget}/release/libmobile_dev_ios_mirror.dylib`;
  await copyFile(built, binaryPath);
  await saveDarwinSymbols(`${built}.dSYM`, "darwin-arm64.node");
  execFileSync("strip", ["-x", binaryPath]);
  const require = createRequire(import.meta.url);
  const addonPath = resolve(binaryPath);
  const addon = require(addonPath);
  if (typeof addon.openDevice !== "function") throw new Error("The physical iOS capture addon did not export its Node-API entry point.");
  const binary = await readFile(binaryPath);
  const binaryHash = createHash("sha256");
  binaryHash.update(binary);
  const binarySHA256 = binaryHash.digest("hex");
  const sourceSHA256 = await iosMirrorSourceHash();
  await writeFile("packages/native/vendor/ios-mirror/release.json", JSON.stringify({ name: "mobile-dev-ios-mirror", napi: 8, target: "darwin-arm64", sourceSHA256, binarySHA256 }, null, 2) + "\n");
  console.log(`Built the physical iOS capture addon (${binary.length} bytes).`);
}
