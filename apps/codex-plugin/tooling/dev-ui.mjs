import { context } from "esbuild";
import { readFile, writeFile, rm, mkdir, rename, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { inlinePage, pageBuildOptions } from "../../../tooling/ui-page.mjs";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const { version } = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
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
  const template = resolve(projectRoot, "packages/mcp-app/src/index.html");
  const options = pageBuildOptions({ entry: "apps/codex-plugin/ui/main.tsx", sources: ["packages/ui/src", "packages/mcp-app/src", "apps/codex-plugin/ui"], outfile: "app.js", root: projectRoot });
  const builder = await context({
    ...options, absWorkingDir: projectRoot,
    plugins: [...options.plugins, { name: "live-ui", setup(build) {
      // The page template is read after bundling; a change to it rebuilds the page too.
      build.onLoad({ filter: /\/codex-plugin\/ui\/main\.tsx$/ }, async ({ path }) => ({ contents: await readFile(path, "utf8"), loader: "tsx", resolveDir: dirname(path), watchFiles: [template] }));
      build.onEnd(async result => {
        if (result.errors.length) return;
        const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
        const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
        const html = await inlinePage({ js, css, template, environment: "development", sourceURL: "app:///mobile-dev-ui.js" });
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
