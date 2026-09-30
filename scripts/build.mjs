import { build } from "esbuild";
import { access, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

await mkdir("dist", { recursive: true });
await access("vendor/baguette/Baguette");
await access("vendor/baguette/Baguette_Baguette.bundle");
await cp("vendor/baguette", "dist/baguette", { recursive: true });
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
const app = await build({
  entryPoints: ["src/ui/app.ts"], bundle: true, write: false, format: "iife", platform: "browser",
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
const packageRoots = new Set();
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
console.log("Built the panel, Baguette server, and bundled agent-device MCP runtime.");
