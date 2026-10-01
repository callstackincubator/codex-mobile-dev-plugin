import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { access, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

await mkdir("dist", { recursive: true });
await access("vendor/baguette/Baguette");
await access("vendor/baguette/Baguette_Baguette.bundle");
await cp("vendor/baguette", "dist/baguette", { recursive: true });
const cpuRelease = JSON.parse(await readFile("vendor/android-cpu/release.json", "utf8"));
const cpuSource = await readFile("native/android-cpu/collector.c");
const cpuSourceHash = createHash("sha256").update(cpuSource).digest("hex");
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
await copyFile("src/server/agent-device-server.mjs", "dist/agent-device-server.mjs");
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
  outfile: "app.js",
  target: "chrome120", minify: true, legalComments: "eof", metafile: true,
});
const js = app.outputFiles.find(file => file.path.endsWith(".js") || file.path === "<stdout>").text;
const css = app.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const template = await readFile("src/ui/index.html", "utf8");
await writeFile("dist/app.html", template
  .replace("<!-- APP_STYLE -->", () => `<style>${css}</style>`)
  .replace("<!-- APP_SCRIPT -->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`));
const server = await build({
  entryPoints: ["src/server/index.ts"], outfile: "dist/server.mjs", bundle: true,
  format: "esm", platform: "node", target: "node22", minify: false, legalComments: "eof", metafile: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
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
console.log("Built the panel, Baguette, serve-emu, and agent-device runtimes.");
