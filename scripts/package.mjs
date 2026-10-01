import { access, chmod, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertBuildEnvironment, telemetryBuildEnvironment } from "./telemetry-build.mjs";

const telemetryEnvironment = telemetryBuildEnvironment();
await assertBuildEnvironment("dist", telemetryEnvironment);
const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
const marketplace = resolve("release/marketplace");
const plugin = `${marketplace}/plugins/${manifest.name}`;
await access("dist/server.mjs");
await access("dist/app.html");
await access("dist/baguette/Baguette");
await access("dist/baguette/Baguette_Baguette.bundle");
await access("dist/agent-device-server.mjs");
await access("dist/ios-fps/mobile-dev-ios-fps");
for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) await access(`dist/android-fps/${abi}/mobile-dev-fps`);
await access("dist/ios-mirror/darwin-arm64.node");
await access("dist/ios-mirror/third-party-licenses.txt");
await access("dist/ios-logs/mobile-dev-ios-logs");
await access("dist/ios-logs/third-party-licenses.txt");
for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) await access(`dist/android-cpu/${abi}/mobile-dev-cpu`);
await access("dist/android-cpu/LICENSE");
await access("dist/serve-emu/node_modules/serve-emu/src/cli.ts");
await access("dist/serve-emu/node_modules/serve-emu/vendor/scrcpy-server-v4.0");
await access("dist/agent-device/node_modules/agent-device/dist/apple/runner/AgentDeviceRunner/AgentDeviceRunner.xcodeproj/project.pbxproj");
await rm(plugin, { recursive: true, force: true });
await mkdir(plugin, { recursive: true });
for (const path of ["plugin.json", "mcp.json", "README.md", "THIRD_PARTY_NOTICES.md"]) await copyFile(path, `${plugin}/${path}`);
for (const path of ["assets", "dist", "skills/mobile-dev", "skills/mobile-dev-setup", "skills/agent-device"]) await cp(path, `${plugin}/${path}`, { recursive: true, verbatimSymlinks: true });
await chmod(`${plugin}/dist/baguette/Baguette`, 0o755);
await chmod(`${plugin}/dist/ios-logs/mobile-dev-ios-logs`, 0o755);
await mkdir(`${marketplace}/.agents/plugins`, { recursive: true });
await writeFile(`${marketplace}/.agents/plugins/marketplace.json`, JSON.stringify({
  name: "mobile-dev-local",
  interface: { displayName: "Mobile Dev local" },
  plugins: [{
    name: manifest.name,
    source: { source: "local", path: `./plugins/${manifest.name}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Developer Tools",
  }],
}, null, 2) + "\n");
const archive = resolve(`release/${manifest.name}-${manifest.version}-darwin-arm64.zip`);
await rm(archive, { force: true });
const files = await readdir(plugin);
execFileSync("zip", ["-qr", archive, ...files], { cwd: plugin });
if ((await stat(archive)).size > 100_000_000) throw new Error("The plugin ZIP exceeds the 100 MB upload limit.");
console.log(`Plugin: ${plugin}\nMarketplace: ${marketplace}\nZIP: ${archive}`);
