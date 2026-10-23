import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { assertRuntime, releaseVersion, stageRuntime } from "../../../tooling/host-runtime.mjs";
import { buildServerBundles } from "../../../tooling/server-bundle.mjs";
import { buildUIPage } from "../../../tooling/ui-page.mjs";

// Assembles `release/mac/Mobile Dev.app` from the shared runtime in `dist/`, the
// Mac page, the SwiftUI shell and a Node runtime. Run `npm run build` first.
const option = name => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const telemetryEnvironment = telemetryBuildEnvironment(process.argv.slice(2).filter(arg => arg === "--release"));
await assertRuntime(telemetryEnvironment);
const version = await releaseVersion();
const node = resolve(option("--node") ?? process.execPath);
const nodeLibraries = execFileSync("otool", ["-L", node], { encoding: "utf8" }).split("\n").slice(1).map(line => line.trim().split(" ")[0]).filter(Boolean);
const external = nodeLibraries.filter(path => !path.startsWith("/usr/lib/") && !path.startsWith("/System/"));
if (external.length) throw new Error(`${node} links libraries outside macOS (${external.join(", ")}). Pass --node with a self-contained Node build.`);

const app = resolve("release/mac/Mobile Dev.app");
const contents = `${app}/Contents`;
await rm(app, { recursive: true, force: true });
await mkdir(`${contents}/MacOS`, { recursive: true });
await mkdir(`${contents}/Resources/node`, { recursive: true });

// The server is the one Codex runs; the Mac page sits beside it so the server
// registers and serves it with its telemetry metadata.
// The shared runtime with the Mac app's own server, which serves the page its window loads.
const runtime = `${contents}/Resources/runtime`;
await stageRuntime(runtime);
await buildServerBundles({ entryPoints: { server: "apps/mac/server/index.ts" }, outdir: runtime, sentryDirectory: ".sentry/server/mac" });
await buildUIPage({
  name: "ui/mac", entry: "apps/mac/web/main.tsx", template: "apps/mac/web/index.html",
  sources: ["packages/ui/src", "apps/mac/web"], output: `${runtime}/mac.html`,
  environment: telemetryEnvironment, sourceURL: "app:///mobile-dev-mac-ui.js",
});
await copyFile(node, `${contents}/Resources/node/node`);
await chmod(`${contents}/Resources/node/node`, 0o755);

// SwiftPM links with the deployment target as the recorded SDK version, and AppKit
// uses that version to choose the window's appearance. Record the SDK it compiled
// against, so the app gets the current system design while still running on 15.
const minimumSystem = "15.0";
const sdkVersion = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-version"], { encoding: "utf8" }).trim();
const swiftBuild = ["build", "-c", "release", "--package-path", "apps/mac",
  "-Xlinker", "-platform_version", "-Xlinker", "macos", "-Xlinker", minimumSystem, "-Xlinker", sdkVersion];
execFileSync("swift", swiftBuild, { stdio: "inherit" });
const binDirectory = execFileSync("swift", [...swiftBuild, "--show-bin-path"], { encoding: "utf8" }).trim();
const linked = execFileSync("otool", ["-l", `${binDirectory}/MobileDev`], { encoding: "utf8" });
if (!new RegExp(`\\bsdk ${sdkVersion.replace(".", "\\.")}\\b`).test(linked)) throw new Error(`MobileDev does not record the macOS ${sdkVersion} SDK it was built with.`);
await copyFile(`${binDirectory}/MobileDev`, `${contents}/MacOS/MobileDev`);
await copyFile("apps/mac/Resources/AppIcon.icns", `${contents}/Resources/AppIcon.icns`).catch(error => { if (error.code !== "ENOENT") throw error; });
await writeFile(`${contents}/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Mobile Dev</string>
  <key>CFBundleDisplayName</key><string>Mobile Dev</string>
  <key>CFBundleIdentifier</key><string>com.callstack.mobile-dev</string>
  <key>CFBundleExecutable</key><string>MobileDev</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>${minimumSystem}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>MobileDevTelemetryEnvironment</key><string>${telemetryEnvironment}</string>
</dict>
</plist>
`);
// Local builds are signed ad hoc. Distribution needs a Developer ID identity,
// hardened runtime entitlements for Node, and notarization.
execFileSync("codesign", ["--force", "--sign", option("--sign") ?? "-", app], { stdio: "inherit" });
console.log(`Mac app: ${app}`);
