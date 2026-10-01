import { fpsSourceHash } from "./build-fps.mjs";
import { iosMirrorSourceHash } from "./build-ios-mirror.mjs";
import { iosLogsSourceHash } from "./build-ios-logs.mjs";
import { androidCpuSourceHash } from "./build-android-cpu.mjs";
import { baguetteTelemetrySourceHash } from "./rebuild-baguette.mjs";
import { build } from "esbuild";
import { sentryEsbuildPlugin } from "@sentry/node/esbuild";
import SentryCli from "@sentry/cli";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { access, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

await mkdir("dist", { recursive: true });
await access("vendor/baguette/Baguette");
await access("vendor/baguette/Baguette_Baguette.bundle");
const baguetteReleaseText = await readFile("vendor/baguette/release.json", "utf8");
const baguetteRelease = JSON.parse(baguetteReleaseText);
const baguetteTelemetryHash = await baguetteTelemetrySourceHash();
if (baguetteRelease.build.telemetrySourceSHA256 !== baguetteTelemetryHash) throw new Error("Run npm run rebuild:baguette after changing native telemetry.");
await cp("vendor/baguette", "dist/baguette", { recursive: true });
const iosMirrorRelease = JSON.parse(await readFile("vendor/ios-mirror/release.json", "utf8"));
const iosMirrorHash = await iosMirrorSourceHash();
if (iosMirrorHash !== iosMirrorRelease.sourceSHA256) throw new Error("Run npm run rebuild:ios-mirror after editing the physical iOS capture addon.");
const iosMirrorBinary = await readFile("vendor/ios-mirror/darwin-arm64.node");
const iosMirrorBinaryHash = createHash("sha256").update(iosMirrorBinary).digest("hex");
if (iosMirrorBinaryHash !== iosMirrorRelease.binarySHA256) throw new Error("Physical iOS capture addon integrity check failed.");
await cp("vendor/ios-mirror", "dist/ios-mirror", { recursive: true });
for (const file of ["README.md", "IDEVICE-LICENSE.txt", "DEVICE-HUB-LICENSE.txt"]) await copyFile(`native/ios-mirror/${file}`, `dist/ios-mirror/${file}`);
const iosLogsReleaseText = await readFile("vendor/ios-logs/release.json", "utf8");
const iosLogsRelease = JSON.parse(iosLogsReleaseText);
const iosLogsHash = await iosLogsSourceHash();
if (iosLogsHash !== iosLogsRelease.sourceSHA256) throw new Error("Run npm run rebuild:ios-logs after editing the physical iOS log reader.");
for (const [file, metadata] of Object.entries(iosLogsRelease.binaries)) {
  const bytes = await readFile(`vendor/ios-logs/${file}`);
  const hash = createHash("sha256");
  hash.update(bytes);
  const sha256 = hash.digest("hex");
  if (sha256 !== metadata.sha256) throw new Error(`Physical iOS log reader integrity check failed for ${file}.`);
}
await rm("dist/ios-logs", { recursive: true, force: true });
await cp("vendor/ios-logs", "dist/ios-logs", { recursive: true });
for (const source of iosLogsRelease.sources) {
  const archive = `${source.name}-${source.version}.tar.bz2`;
  const bytes = await readFile(`vendor/ios-logs/sources/${archive}`);
  const hash = createHash("sha256");
  hash.update(bytes);
  const sha256 = hash.digest("hex");
  if (sha256 !== source.sha256) throw new Error(`Physical iOS log dependency source integrity check failed for ${archive}.`);
}
for (const file of ["README.md", "LICENSE", "collector.c", "dependencies.json"]) await copyFile(`native/ios-logs/${file}`, `dist/ios-logs/${file}`);
await copyFile("scripts/build-ios-logs.mjs", "dist/ios-logs/build-ios-logs.mjs");
await copyFile("scripts/native-telemetry.mjs", "dist/ios-logs/native-telemetry.mjs");
await mkdir("dist/telemetry", { recursive: true });
for (const file of ["telemetry.c", "telemetry.h"]) await copyFile(`native/telemetry/${file}`, `dist/telemetry/${file}`);
for (const platform of ["ios", "android"]) {
  const root = `vendor/${platform}-fps`;
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
  await rm(`dist/${platform}-fps`, { recursive: true, force: true });
  await cp(root, `dist/${platform}-fps`, { recursive: true });
  await copyFile(`native/${platform}-fps/README.md`, `dist/${platform}-fps/README.md`);
  if (platform === "android") await copyFile("native/android-fps/perfetto/LIBCXX-LICENSE.TXT", "dist/android-fps/LIBCXX-LICENSE.TXT");
}
const cpuRelease = JSON.parse(await readFile("vendor/android-cpu/release.json", "utf8"));
const cpuSourceHash = await androidCpuSourceHash();
if (cpuSourceHash !== cpuRelease.sourceSHA256) throw new Error("Rebuild the Android CPU collector after editing its source.");
for (const [abi, metadata] of Object.entries(cpuRelease.binaries)) {
  const bytes = await readFile(`vendor/android-cpu/${abi}/mobile-dev-cpu`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== metadata.sha256) throw new Error(`Android CPU collector integrity check failed for ${abi}.`);
}
await rm("dist/android-cpu", { recursive: true, force: true });
await cp("vendor/android-cpu", "dist/android-cpu", { recursive: true });
for (const file of ["LICENSE", "README.md", "collector.c"]) await copyFile(`native/android-cpu/${file}`, `dist/android-cpu/${file}`);
const runtime = "runtimes/agent-device";
const lock = await readFile(`${runtime}/package-lock.json`, "utf8");
const pinned = JSON.parse(lock).packages["node_modules/agent-device"];
const installed = JSON.parse(await readFile(`${runtime}/node_modules/agent-device/package.json`, "utf8"));
if (installed.version !== "0.20.9" || pinned.version !== installed.version) throw new Error("Run npm run vendor:agent-device to install the pinned runtime.");
await rm("dist/agent-device", { recursive: true, force: true });
await cp(`${runtime}/node_modules`, "dist/agent-device/node_modules", { recursive: true, verbatimSymlinks: true });
await copyFile(`${runtime}/config.json`, "dist/agent-device/config.json");
await copyFile(`${runtime}/package-lock.json`, "dist/agent-device/package-lock.json");
await writeFile("dist/agent-device/release.json", JSON.stringify({
  name: installed.name, version: installed.version, url: pinned.resolved, integrity: pinned.integrity,
  lockfileSHA256: createHash("sha256").update(lock).digest("hex"),
}, null, 2) + "\n");
await mkdir("skills/agent-device/references", { recursive: true });
const workflow = execFileSync(process.execPath, [resolve(`${runtime}/node_modules/agent-device/bin/agent-device.mjs`), "help", "workflow"], {
  encoding: "utf8", env: { ...process.env, AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1" },
});
await writeFile("skills/agent-device/references/workflow.md", workflow);
const androidRuntime = "runtimes/serve-emu";
const androidLock = await readFile(`${androidRuntime}/package-lock.json`, "utf8");
const androidPinned = JSON.parse(androidLock).packages["node_modules/serve-emu"];
const androidInstalled = JSON.parse(await readFile(`${androidRuntime}/node_modules/serve-emu/package.json`, "utf8"));
if (androidInstalled.version !== "0.0.6" || androidPinned.version !== androidInstalled.version) throw new Error("Run npm run vendor:serve-emu to install the pinned Android runtime.");
const scrcpy = await readFile(`${androidRuntime}/node_modules/serve-emu/vendor/scrcpy-server-v4.0`);
const scrcpySHA256 = createHash("sha256").update(scrcpy).digest("hex");
if (scrcpySHA256 !== "84924bd564a1eb6089c872c7521f968058977f91f5ff02514a8c74aff3210f3a") throw new Error("The scrcpy 4.0 server does not match its pinned SHA-256.");
const scrcpyClient = await readFile(`${androidRuntime}/node_modules/serve-emu/src/scrcpy.ts`);
const scrcpyClientHash = createHash("sha256");
scrcpyClientHash.update(scrcpyClient);
const scrcpyClientSHA256 = scrcpyClientHash.digest("hex");
if (scrcpyClientSHA256 !== "5ca62e5fdf3f71144178bbd4251b82c4d7e944301399477a9b8595a68d58098f") throw new Error("Run npm run vendor:serve-emu to apply the physical Android scrcpy launch fix.");
await rm("dist/serve-emu", { recursive: true, force: true });
await cp(`${androidRuntime}/node_modules`, "dist/serve-emu/node_modules", { recursive: true, verbatimSymlinks: true });
await copyFile(`${androidRuntime}/package-lock.json`, "dist/serve-emu/package-lock.json");
await writeFile("dist/serve-emu/release.json", JSON.stringify({
  name: androidInstalled.name, version: androidInstalled.version, url: androidPinned.resolved, integrity: androidPinned.integrity,
  lockfileSHA256: createHash("sha256").update(androidLock).digest("hex"), scrcpyVersion: "4.0", scrcpySHA256, scrcpyClientSHA256,
}, null, 2) + "\n");
const app = await build({
  entryPoints: ["src/ui/app.tsx"], jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  plugins: [{ name: "shadcn-theme", setup(build) {
    build.onLoad({ filter: /theme\.css$/ }, async ({ path }) => {
      const compiler = await compile(await readFile(path, "utf8"), { base: dirname(path), onDependency() {} });
      const scanner = new Scanner({ sources: [{ base: resolve("src/ui"), pattern: "**/*.{ts,tsx}", negated: false }] });
      return { contents: compiler.build(scanner.scan()), loader: "css", resolveDir: dirname(path) };
    });
  } }],
  bundle: true, write: false, format: "iife", platform: "browser",
  outfile: ".sentry/ui/app.js", sourcemap: "external",
  target: "chrome120", minify: true, legalComments: "eof", metafile: true,
});
await mkdir(".sentry/ui", { recursive: true });
for (const file of app.outputFiles) await writeFile(file.path, file.contents);
const cli = new SentryCli();
await cli.execute(["sourcemaps", "inject", ".sentry/ui"]);
const js = await readFile(".sentry/ui/app.js", "utf8");
const css = app.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const template = await readFile("src/ui/index.html", "utf8");
await writeFile("dist/app.html", template
  .replace("<!-- APP_STYLE -->", () => `<style>${css}</style>`)
  .replace("<!-- APP_SCRIPT -->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}\n//# sourceURL=app:///mobile-dev-ui.js\n</script>`));
const server = await build({
  entryPoints: { server: "src/server/index.ts", "agent-device-server": "src/server/agent-device-server.mjs" }, outdir: "dist", outExtension: { ".js": ".mjs" }, bundle: true,
  format: "esm", platform: "node", target: "node22", minify: false, legalComments: "eof", metafile: true,
  sourcemap: "external",
  plugins: [sentryEsbuildPlugin({ org: "callstackincubator", project: "mobile-dev-server", telemetry: false, sourcemaps: { disable: true }, release: { inject: false, create: false, finalize: false } })],
  banner: { js: "import { createRequire as mobileDevBundleRequire } from 'node:module'; const require = mobileDevBundleRequire(import.meta.url);" },
});
await mkdir(".sentry/server", { recursive: true });
for (const name of ["server.mjs", "agent-device-server.mjs"]) {
  await copyFile(`dist/${name}`, `.sentry/server/${name}`);
  await copyFile(`dist/${name}.map`, `.sentry/server/${name}.map`);
  await rm(`dist/${name}.map`);
}
await cli.execute(["sourcemaps", "inject", ".sentry/server"]);
for (const name of ["server.mjs", "agent-device-server.mjs"]) {
  await copyFile(`.sentry/server/${name}`, `dist/${name}`);
  execFileSync(process.execPath, ["--check", `dist/${name}`]);
}
// Tailwind compiles these styles before esbuild records its input files.
const packageRoots = new Set(["shadcn", "tailwindcss", "tw-animate-css"].map(name => resolve("node_modules", name)));
for (const path of [...Object.keys(app.metafile.inputs), ...Object.keys(server.metafile.inputs)]) {
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
console.log("Built the panel, physical iOS logs, Baguette, serve-emu, and agent-device runtimes.");
