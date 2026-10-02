import { context } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { readFile, writeFile, rm, mkdir, rename, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
const pluginRoot = process.env.MOBILE_DEV_PLUGIN_ROOT ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), ".codex"), "plugins/cache/mobile-dev-local/mobile-dev", version);
const configPath = resolve(pluginRoot, "ui-dev.json");
const output = resolve(projectRoot, ".local-dev");
const watcherPath = resolve(output, "ui-watch.json");
if (process.argv.includes("--off")) {
  await rm(configPath, { force: true });
  console.log("Live UI disabled. Reopen the Mobile Dev panel to use the bundled UI.");
  process.exit(0);
}
await readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"));
await mkdir(output, { recursive: true });
let running = false;
try {
  const watcher = JSON.parse(await readFile(watcherPath, "utf8"));
  const heartbeat = await stat(watcherPath);
  process.kill(watcher.pid, 0);
  running = watcher.projectRoot === projectRoot && Date.now() - heartbeat.mtimeMs < 10000;
} catch {}
if (!running) {
  const builder = await context({
    absWorkingDir: projectRoot,
    entryPoints: ["src/ui/app.tsx"], jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "dataurl", ".woff": "dataurl" },
    bundle: true, write: false, format: "iife", platform: "browser",
    outfile: "app.js", target: "chrome120", minify: true, legalComments: "eof",
    plugins: [{ name: "live-ui", setup(build) {
      build.onLoad({ filter: /theme\.css$/ }, async ({ path }) => {
        const dependencies = [];
        const compiler = await compile(await readFile(path, "utf8"), { base: dirname(path), onDependency(file) { dependencies.push(file); } });
        const scanner = new Scanner({ sources: [{ base: resolve(projectRoot, "src/ui"), pattern: "**/*.{ts,tsx}", negated: false }] });
        const contents = compiler.build(scanner.scan());
        return { contents, loader: "css", resolveDir: dirname(path), watchFiles: [...dependencies, ...scanner.files] };
      });
      build.onLoad({ filter: /\/app\.tsx$/ }, async ({ path }) => ({ contents: await readFile(path, "utf8"), loader: "tsx", resolveDir: dirname(path), watchFiles: [resolve(projectRoot, "src/ui/index.html")] }));
      build.onEnd(async result => {
        if (result.errors.length) return;
        const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
        const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
        const template = await readFile(resolve(projectRoot, "src/ui/index.html"), "utf8");
        const html = template.replace("<!-- APP_STYLE -->", () => `<style>${css}</style>`)
          .replace("<!-- APP_SCRIPT -->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
        await writeFile(resolve(output, "app.html.tmp"), html);
        await rename(resolve(output, "app.html.tmp"), resolve(output, "app.html"));
        console.log("Mobile Dev UI rebuilt. Open panels reload through MCP.");
      });
    } }],
  });
  try { await builder.rebuild(); } catch (error) { await builder.dispose(); throw error; }
  await writeFile(watcherPath, JSON.stringify({ pid: process.pid, projectRoot }));
  const heartbeat = setInterval(() => { const now = new Date(); void utimes(watcherPath, now, now).catch(console.error); }, 2000);
  await builder.watch();
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    await builder.dispose();
    await rm(watcherPath, { force: true });
    process.exit(0);
  });
}
await writeFile(configPath, JSON.stringify({ mode: "mcp-live", projectRoot }) + "\n");
console.log(`${running ? "Reusing" : "Started"} Mobile Dev live reload through MCP. Reopen the panel to connect.`);
