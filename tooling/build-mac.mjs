import { access, chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertBuildEnvironment, telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { buildUIPage } from "./ui-page.mjs";

// Assembles `release/mac/Mobile Dev.app` from the shared runtime in `dist/`, the
// Mac page, the SwiftUI shell and a Node runtime. Run `npm run build` first.
const option = name => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const telemetryEnvironment = telemetryBuildEnvironment(process.argv.slice(2).filter(arg => arg === "--release"));
await assertBuildEnvironment("dist", telemetryEnvironment);
await access("dist/server.mjs");
const manifest = JSON.parse(await readFile("apps/codex-plugin/.codex-plugin/plugin.json", "utf8"));
const node = resolve(option("--node") ?? process.execPath);
const linked = execFileSync("otool", ["-L", node], { encoding: "utf8" }).split("\n").slice(1).map(line => line.trim().split(" ")[0]).filter(Boolean);
const external = linked.filter(path => !path.startsWith("/usr/lib/") && !path.startsWith("/System/"));
if (external.length) throw new Error(`${node} links libraries outside macOS (${external.join(", ")}). Pass --node with a self-contained Node build.`);

const app = resolve("release/mac/Mobile Dev.app");
const contents = `${app}/Contents`;
await rm(app, { recursive: true, force: true });
await mkdir(`${contents}/MacOS`, { recursive: true });
await mkdir(`${contents}/Resources/node`, { recursive: true });

// The server is the one Codex runs; the Mac page sits beside it so the server
// registers and serves it with its telemetry metadata.
await cp("dist", `${contents}/Resources/runtime`, { recursive: true, verbatimSymlinks: true });
await buildUIPage({
  name: "mac-ui", entry: "apps/mac/web/main.tsx", template: "apps/mac/web/index.html",
  sources: ["packages/ui/src", "apps/mac/web"], output: `${contents}/Resources/runtime/mac.html`,
  environment: telemetryEnvironment, sourceURL: "app:///mobile-dev-mac-ui.js",
});
await copyFile(node, `${contents}/Resources/node/node`);
await chmod(`${contents}/Resources/node/node`, 0o755);

execFileSync("swift", ["build", "-c", "release", "--package-path", "apps/mac"], { stdio: "inherit" });
const binDirectory = execFileSync("swift", ["build", "-c", "release", "--package-path", "apps/mac", "--show-bin-path"], { encoding: "utf8" }).trim();
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
  <key>CFBundleShortVersionString</key><string>${manifest.version}</string>
  <key>CFBundleVersion</key><string>${manifest.version}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
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
