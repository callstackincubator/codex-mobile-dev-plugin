import { fpsSourceHash } from "./build-fps.mjs";
import { iosMirrorSourceHash } from "./build-ios-mirror.mjs";
import { iosLogsSourceHash } from "./build-ios-logs.mjs";
import { androidCpuSourceHash } from "./build-android-cpu.mjs";
import { baguetteTelemetrySourceHash } from "./rebuild-baguette.mjs";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";
import { buildServeEmu } from "./build-serve-emu.mjs";
import { buildHostPage, buildUIPage } from "./ui-page.mjs";
import { buildServerBundles } from "./server-bundle.mjs";
import { access, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const telemetryEnvironment = telemetryBuildEnvironment();
// A fresh dist/, so packages never carry outputs an earlier build or branch left behind.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await access("packages/native/vendor/baguette/Baguette");
await access("packages/native/vendor/baguette/Baguette_Baguette.bundle");
const baguetteReleaseText = await readFile("packages/native/vendor/baguette/release.json", "utf8");
const baguetteRelease = JSON.parse(baguetteReleaseText);
const baguetteTelemetryHash = await baguetteTelemetrySourceHash();
if (baguetteRelease.build.telemetrySourceSHA256 !== baguetteTelemetryHash) throw new Error("Run npm run rebuild:baguette after changing native telemetry.");
await cp("packages/native/vendor/baguette", "dist/baguette", { recursive: true });
const iosMirrorRelease = JSON.parse(await readFile("packages/native/vendor/ios-mirror/release.json", "utf8"));
const iosMirrorHash = await iosMirrorSourceHash();
if (iosMirrorHash !== iosMirrorRelease.sourceSHA256) throw new Error("Run npm run rebuild:ios-mirror after editing the physical iOS capture addon.");
const iosMirrorBinary = await readFile("packages/native/vendor/ios-mirror/darwin-arm64.node");
const iosMirrorBinaryHash = createHash("sha256").update(iosMirrorBinary).digest("hex");
if (iosMirrorBinaryHash !== iosMirrorRelease.binarySHA256) throw new Error("Physical iOS capture addon integrity check failed.");
await cp("packages/native/vendor/ios-mirror", "dist/ios-mirror", { recursive: true });
for (const file of ["README.md", "IDEVICE-LICENSE.txt", "DEVICE-HUB-LICENSE.txt"]) await copyFile(`packages/native/ios-mirror/${file}`, `dist/ios-mirror/${file}`);
const iosLogsReleaseText = await readFile("packages/native/vendor/ios-logs/release.json", "utf8");
const iosLogsRelease = JSON.parse(iosLogsReleaseText);
const iosLogsHash = await iosLogsSourceHash();
if (iosLogsHash !== iosLogsRelease.sourceSHA256) throw new Error("Run npm run rebuild:ios-logs after editing the physical iOS log reader.");
for (const [file, metadata] of Object.entries(iosLogsRelease.binaries)) {
  const bytes = await readFile(`packages/native/vendor/ios-logs/${file}`);
  const hash = createHash("sha256");
  hash.update(bytes);
  const sha256 = hash.digest("hex");
  if (sha256 !== metadata.sha256) throw new Error(`Physical iOS log reader integrity check failed for ${file}.`);
}
await cp("packages/native/vendor/ios-logs", "dist/ios-logs", { recursive: true });
for (const source of iosLogsRelease.sources) {
  const archive = `${source.name}-${source.version}.tar.bz2`;
  const bytes = await readFile(`packages/native/vendor/ios-logs/sources/${archive}`);
  const hash = createHash("sha256");
  hash.update(bytes);
  const sha256 = hash.digest("hex");
  if (sha256 !== source.sha256) throw new Error(`Physical iOS log dependency source integrity check failed for ${archive}.`);
}
for (const file of ["README.md", "LICENSE", "collector.c", "dependencies.json"]) await copyFile(`packages/native/ios-logs/${file}`, `dist/ios-logs/${file}`);
await copyFile("tooling/build-ios-logs.mjs", "dist/ios-logs/build-ios-logs.mjs");
await copyFile("tooling/native-telemetry.mjs", "dist/ios-logs/native-telemetry.mjs");
await mkdir("dist/telemetry", { recursive: true });
for (const file of ["telemetry.c", "telemetry.h"]) await copyFile(`packages/native/telemetry/${file}`, `dist/telemetry/${file}`);
for (const platform of ["ios", "android"]) {
  const root = `packages/native/vendor/${platform}-fps`;
  const text = await readFile(`${root}/release.json`, "utf8");
  const release = JSON.parse(text);
  const sourceHash = await fpsSourceHash(platform);
  if (sourceHash !== release.sourceSHA256) throw new Error(`Run npm run rebuild:${platform}-fps after editing the FPS collector.`);
  const binaries = platform === "ios"
    ? [{ path: "mobile-dev-ios-fps", sha256: release.binarySHA256 }]
    : Object.entries(release.binaries).map(([abi, binary]) => ({ path: `${abi}/mobile-dev-fps`, sha256: binary.sha256 }));
  for (const binary of binaries) {
    const bytes = await readFile(`${root}/${binary.path}`);
    const hash = createHash("sha256");
    hash.update(bytes);
    if (hash.digest("hex") !== binary.sha256) throw new Error(`FPS helper integrity check failed for ${binary.path}.`);
  }
  await cp(root, `dist/${platform}-fps`, { recursive: true });
  await copyFile(`packages/native/${platform}-fps/README.md`, `dist/${platform}-fps/README.md`);
  if (platform === "android") await copyFile("packages/native/android-fps/perfetto/LIBCXX-LICENSE.TXT", "dist/android-fps/LIBCXX-LICENSE.TXT");
}
const cpuRelease = JSON.parse(await readFile("packages/native/vendor/android-cpu/release.json", "utf8"));
const cpuSourceHash = await androidCpuSourceHash();
if (cpuSourceHash !== cpuRelease.sourceSHA256) throw new Error("Rebuild the Android CPU collector after editing its source.");
for (const [abi, metadata] of Object.entries(cpuRelease.binaries)) {
  const bytes = await readFile(`packages/native/vendor/android-cpu/${abi}/mobile-dev-cpu`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== metadata.sha256) throw new Error(`Android CPU collector integrity check failed for ${abi}.`);
}
await cp("packages/native/vendor/android-cpu", "dist/android-cpu", { recursive: true });
for (const file of ["LICENSE", "README.md", "collector.c"]) await copyFile(`packages/native/android-cpu/${file}`, `dist/android-cpu/${file}`);
const runtime = "packages/runtimes/agent-device";
const lock = await readFile(`${runtime}/package-lock.json`, "utf8");
const pinned = JSON.parse(lock).packages["node_modules/agent-device"];
const installed = JSON.parse(await readFile(`${runtime}/node_modules/agent-device/package.json`, "utf8"));
const wanted = JSON.parse(await readFile(`${runtime}/package.json`, "utf8")).dependencies["agent-device"];
if (installed.version !== wanted || pinned.version !== installed.version) throw new Error("Run npm run vendor:agent-device to install the pinned runtime.");
await cp(`${runtime}/node_modules`, "dist/agent-device/node_modules", { recursive: true, verbatimSymlinks: true });
await copyFile(`${runtime}/config.json`, "dist/agent-device/config.json");
await copyFile(`${runtime}/package-lock.json`, "dist/agent-device/package-lock.json");
await writeFile("dist/agent-device/release.json", JSON.stringify({
  name: installed.name, version: installed.version, url: pinned.resolved, integrity: pinned.integrity,
  lockfileSHA256: createHash("sha256").update(lock).digest("hex"),
}, null, 2) + "\n");
// The commands the plugin servers register without starting the runtime (npm run catalog:agent-device).
await copyFile(`${runtime}/tools.json`, "dist/agent-device/tools.json");
await buildServeEmu("dist/serve-emu");
// The host-neutral runtime: the shared server, its services and the MCP Apps panel
// as hosts without their own chrome load it. A host that adds to them builds its
// own server or page in its package step, over a copy of this runtime.
await rm(".sentry/ui", { recursive: true, force: true });
await rm(".sentry/server", { recursive: true, force: true });
const pageMetafiles = [
  await buildUIPage({
    name: "ui/mcp-app", entry: "packages/mcp-app/src/main.tsx", template: "packages/mcp-app/src/index.html",
    sources: ["packages/ui/src", "packages/mcp-app/src"], output: "dist/app.html",
    environment: telemetryEnvironment, sourceURL: "app:///mobile-dev-ui.js",
  }),
];
// Hosts that render no MCP Apps panel open this page in a browser beside the chat.
await buildHostPage({ entry: "packages/mcp-app/src/browser-panel.ts", template: "packages/mcp-app/src/browser-panel.html", output: "dist/browser-panel.html" });
const serverMetafiles = [
  await buildServerBundles({
    entryPoints: { server: "packages/core/src/index.ts", "ios-mirror-service": "packages/core/src/ios-mirror-service.ts" },
    outdir: "dist", sentryDirectory: ".sentry/server",
  }),
];
// Tailwind compiles these styles before esbuild records its input files.
const packageRoots = new Set(["shadcn", "tailwindcss", "tw-animate-css"].map(name => resolve("node_modules", name)));
for (const path of [...pageMetafiles, ...serverMetafiles].flatMap(metafile => Object.keys(metafile.inputs))) {
  if (!path.includes("node_modules/")) continue;
  let directory = dirname(resolve(path));
  while (directory !== dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
      if (metadata.name) { packageRoots.add(directory); break; }
      directory = dirname(directory);
    }
    catch { directory = dirname(directory); }
  }
}
const licenses = [];
for (const directory of [...packageRoots].sort()) {
  const metadata = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
  const files = (await readdir(directory)).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file));
  for (const file of files) licenses.push(`${metadata.name} ${metadata.version} (${file})\n\n${await readFile(`${directory}/${file}`, "utf8")}`);
}
await writeFile("dist/third-party-licenses.txt", licenses.join("\n\n====================\n\n"));
const telemetryConfig = JSON.stringify({ environment: telemetryEnvironment }, null, 2);
await writeFile("dist/telemetry-environment.json", telemetryConfig + "\n");
console.log(`Built the panel and runtimes with Sentry environment ${telemetryEnvironment}.`);
