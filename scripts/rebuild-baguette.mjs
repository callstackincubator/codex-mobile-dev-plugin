import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNativeSentry, nativeTelemetrySourceHash, nativeSentryLicense, saveNativeSymbols } from "./native-telemetry.mjs";

import { patchBaguetteCapture } from "./patch-baguette-capture.mjs";

const execute = promisify(execFile);

export async function baguetteTelemetrySourceHash() {
  const hash = createHash("sha256");
  await nativeTelemetrySourceHash(hash);
  const script = await readFile("scripts/rebuild-baguette.mjs");
  hash.update(script);
  hash.update(await readFile("scripts/patch-baguette-capture.mjs"));
  for (const file of ["ForegroundCommand.swift", "foreground-method.swift", "Server+Screenshot.swift", "ServerScreenshotCaptureTests.swift"]) {
    const contents = await readFile(`native/baguette/${file}`);
    hash.update(contents);
  }
  return hash.digest("hex");
}

async function addBaguetteTelemetry(source, sdk) {
  const packagePath = join(source, "Package.swift");
  const packageText = await readFile(packagePath, "utf8");
  const targetMarker = "    targets: [\n";
  const dependencyMarker = '            dependencies: [\n                .product(name: "ArgumentParser"';
  if (packageText.includes(targetMarker) === false || packageText.includes(dependencyMarker) === false) {
    throw new Error("The pinned Baguette package does not match its telemetry integration points.");
  }
  const includeLiteral = JSON.stringify(sdk.include);
  const libraryLiteral = JSON.stringify(sdk.library);
  const telemetryTarget = `        .target(name: "MobileDevTelemetry", path: "Sources/MobileDevTelemetry",\n`
    + `            cSettings: [.define("SENTRY_BUILD_STATIC", to: "1"), .unsafeFlags(["-I", ${includeLiteral}])],\n`
    + `            linkerSettings: [.unsafeFlags([${libraryLiteral}]), .linkedLibrary("curl")]),\n`;
  const withTarget = packageText.replace(targetMarker, targetMarker + telemetryTarget);
  const updated = withTarget.replace(dependencyMarker, '            dependencies: [\n                "MobileDevTelemetry",\n                .product(name: "ArgumentParser"');
  await writeFile(packagePath, updated);
  const directory = join(source, "Sources/MobileDevTelemetry");
  const includeDirectory = join(directory, "include");
  const telemetrySource = join(directory, "telemetry.c");
  const telemetryHeader = join(includeDirectory, "telemetry.h");
  await mkdir(includeDirectory, { recursive: true });
  await copyFile("native/telemetry/telemetry.c", telemetrySource);
  await copyFile("native/telemetry/telemetry.h", telemetryHeader);
  const entrypoint = join(source, "Sources/Baguette/App/RootCommand.swift");
  const entryText = await readFile(entrypoint, "utf8");
  const mainMarker = "@main\nstruct Baguette:";
  if (entryText.includes(mainMarker) === false) throw new Error("The pinned Baguette entry point changed.");
  const entry = entryText.replace(mainMarker, "struct Baguette:");
  await writeFile(entrypoint, entry);
  const wrapper = `import MobileDevTelemetry\n\n@main\nenum MobileDevEntry {\n`
    + `    static func main() async {\n        mobile_dev_telemetry_init("baguette")\n`
    + `        await Baguette.main()\n        mobile_dev_telemetry_close()\n    }\n}\n`;
  const wrapperPath = join(source, "Sources/Baguette/App/MobileDevEntry.swift");
  await writeFile(wrapperPath, wrapper);
}

async function addForegroundDetection(source) {
  const entrypoint = join(source, "Sources/Baguette/App/RootCommand.swift");
  const entry = await readFile(entrypoint, "utf8");
  const commandMarker = "            DescribeUICommand.self,";
  if (entry.includes(commandMarker) === false) throw new Error("The pinned Baguette command registration changed.");
  const updated = entry.replace(commandMarker, commandMarker + "\n            ForegroundCommand.self,");
  await writeFile(entrypoint, updated);
  const commandPath = join(source, "Sources/Baguette/App/Commands/ForegroundCommand.swift");
  await copyFile("native/baguette/ForegroundCommand.swift", commandPath);
  const adapterPath = join(source, "Sources/Baguette/Infrastructure/Accessibility/AXPTranslatorAccessibility.swift");
  const adapter = await readFile(adapterPath, "utf8");
  const adapterMarker = "    // MARK: - Accessibility";
  if (adapter.includes(adapterMarker) === false) throw new Error("The pinned Baguette accessibility adapter changed.");
  const method = await readFile("native/baguette/foreground-method.swift", "utf8");
  const withForeground = adapter.replace(adapterMarker, method + adapterMarker);
  await writeFile(adapterPath, withForeground);
}

export async function rebuildBaguette(sourceDirectory) {
  const release = JSON.parse(await readFile("vendor/baguette-release.json", "utf8"));
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Rebuilding Baguette requires an Apple Silicon Mac.");
  const { stdout: swift } = await execute("xcrun", ["swift", "--version"]);
  const version = /Swift version (\d+)\.(\d+)/.exec(swift);
  if (!version || Number(version[1]) < 6 || (Number(version[1]) === 6 && Number(version[2]) < 4)) {
    throw new Error("Rebuilding this runtime requires Swift 6.4 or later, included in Xcode 27.");
  }
  const temporary = sourceDirectory ? undefined : await mkdtemp(join(tmpdir(), "mobile-dev-baguette-build-"));
  const source = resolve(sourceDirectory ?? temporary);
  try {
    if (!sourceDirectory) {
      await execute("git", ["init", source]);
      await execute("git", ["-C", source, "remote", "add", "origin", "https://github.com/tddworks/baguette.git"]);
      await execute("git", ["-C", source, "fetch", "--depth", "1", "origin", release.rebuild.sourceCommit]);
      await execute("git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"]);
    }
    const { stdout: commit } = await execute("git", ["-C", source, "rev-parse", "HEAD"]);
    if (commit.trim() !== release.rebuild.sourceCommit) throw new Error("Baguette source does not match the pinned commit.");
    const { stdout: changes } = await execute("git", ["-C", source, "status", "--porcelain", "--untracked-files=no"]);
    if (changes.trim()) throw new Error("Baguette source has changes. Rebuild from the pinned source.");
    const sdk = await buildNativeSentry();
    await addBaguetteTelemetry(source, sdk);
    await addForegroundDetection(source);
    await patchBaguetteCapture(source);
    console.log(`Rebuilding Baguette ${release.version} with ${swift.trim().split("\n")[0]}…`);
    try {
      await execute("xcrun", ["swift", "build", "-c", "release", "--product", "Baguette"], {
        cwd: source, timeout: 600000, maxBuffer: 20 * 1024 * 1024,
      });
    } catch (error) { throw new Error(`Baguette build failed. ${String(error.stderr ?? error.message).slice(-5000)}`); }
    const executable = join(source, ".build/release/Baguette");
    await saveNativeSymbols(executable, "Baguette");
    const target = "vendor/baguette/Baguette";
    // Replace the inode so macOS cannot reuse the old code-signature cache.
    await rm(target, { force: true });
    await copyFile(executable, target);
    const licenses = [];
    const checkouts = join(source, ".build/checkouts");
    for (const dependency of (await readdir(checkouts)).sort()) {
      for (const file of (await readdir(join(checkouts, dependency))).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file))) {
        licenses.push(`${dependency} (${file})\n\n${await readFile(join(checkouts, dependency, file), "utf8")}`);
      }
    }
    const sentryLicense = await nativeSentryLicense();
    licenses.push(sentryLicense);
    const licenseText = licenses.join("\n\n====================\n\n");
    await writeFile("vendor/baguette/third-party-licenses.txt", licenseText);
    const binarySha256 = createHash("sha256").update(await readFile(target)).digest("hex");
    await writeFile("vendor/baguette/release.json", JSON.stringify({ ...release, build: {
      sourceCommit: commit.trim(), swift: swift.trim(), binarySha256,
      telemetrySourceSHA256: await baguetteTelemetrySourceHash(),
    } }, null, 2) + "\n");
    console.log(`Bundled runtime rebuilt; SHA-256 ${binarySha256}.`);
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await rebuildBaguette(process.argv[2]);
