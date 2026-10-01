import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

export async function iosMirrorSourceHash() {
  const hash = createHash("sha256");
  async function add(path) {
    const files = await readdir(path, { withFileTypes: true });
    for (const entry of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await add(child);
      else { hash.update(child); hash.update(await readFile(child)); }
    }
  }
  for (const file of ["Cargo.toml", "Cargo.lock", "build.rs"]) {
    hash.update(file);
    hash.update(await readFile(`native/ios-mirror/${file}`));
  }
  await add("native/ios-mirror/src");
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/build-ios-mirror.mjs")) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build the physical iOS capture addon on an Apple Silicon Mac.");
  execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", "native/ios-mirror/Cargo.toml"], {
    stdio: "inherit", env: process.env,
  });
  await mkdir("vendor/ios-mirror", { recursive: true });
  const metadataText = execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--manifest-path", "native/ios-mirror/Cargo.toml"], { encoding: "utf8" });
  const metadata = JSON.parse(metadataText);
  const licenses = [];
  for (const dependency of metadata.packages) {
    if (dependency.name === "mobile-dev-ios-mirror") continue;
    const directory = resolve(dependency.manifest_path, "..");
    const entries = await readdir(directory);
    const files = entries.filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE)([-._]|$)/i.test(name));
    if (dependency.name === "idevice") files.push("../LICENSE.txt");
    const texts = [];
    for (const file of files) {
      try { texts.push(await readFile(`${directory}/${file}`, "utf8")); }
      catch { /* License directories are represented by separate files when present. */ }
    }
    licenses.push(`${dependency.name} ${dependency.version} (${dependency.license ?? "see source"})\n${dependency.repository ?? ""}\n\n${texts.join("\n\n")}`);
  }
  await writeFile("vendor/ios-mirror/third-party-licenses.txt", licenses.join("\n\n====================\n\n"));
  const binaryPath = "vendor/ios-mirror/darwin-arm64.node";
  await copyFile("native/ios-mirror/target/release/libmobile_dev_ios_mirror.dylib", binaryPath);
  const require = createRequire(import.meta.url);
  const addonPath = resolve(binaryPath);
  const addon = require(addonPath);
  if (typeof addon.openDevice !== "function") throw new Error("The physical iOS capture addon did not export its Node-API entry point.");
  const binary = await readFile(binaryPath);
  const binaryHash = createHash("sha256");
  binaryHash.update(binary);
  const binarySHA256 = binaryHash.digest("hex");
  const sourceSHA256 = await iosMirrorSourceHash();
  await writeFile("vendor/ios-mirror/release.json", JSON.stringify({ name: "mobile-dev-ios-mirror", napi: 8, target: "darwin-arm64", sourceSHA256, binarySHA256 }, null, 2) + "\n");
  console.log(`Built the physical iOS capture addon (${binary.length} bytes).`);
}
