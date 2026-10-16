// Visual check for the embedded Explore: folds the plugin's own stylesheet and the
// package's the same way scripts/build.mjs does, then renders the explorer twice —
// once as the plugin renders it, once as it rendered before the fix — over one
// real fixture. Throwaway evidence, like the rest of spike/.
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exploreUILayerCSS } from "../../scripts/explore-css.mjs";
import { sharedNodeModules } from "../../scripts/shared-node-modules.mjs";

const projectRoot = resolve(import.meta.dirname, "../..");
process.chdir(projectRoot);

const app = await build({
  entryPoints: ["spike/explore-visual/harness.tsx"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { react: resolve("node_modules/react"), "react-dom": resolve("node_modules/react-dom") },
  plugins: [sharedNodeModules(projectRoot), {
    name: "shadcn-theme",
    setup(build) {
      build.onLoad({ filter: /theme\.css$/ }, async ({ path }) => {
        const compiler = await compile(await readFile(path, "utf8"), { base: dirname(path), onDependency() {} });
        const scanner = new Scanner({ sources: [{ base: resolve("src/ui"), pattern: "**/*.{ts,tsx}", negated: false }] });
        return { contents: compiler.build(scanner.scan()), loader: "css", resolveDir: dirname(path) };
      });
    },
  }],
  bundle: true, write: false, format: "iife", platform: "browser", outfile: "spike/out/explore-visual.js",
  target: "chrome120", metafile: true,
});
const js = app.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = `${app.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}\n${await exploreUILayerCSS()}`;
const html = `<!doctype html><html lang="en" data-view="tracesift" data-theme="dark"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`;
await writeFile("spike/out/explore-visual.html", html);
console.log("wrote spike/out/explore-visual.html", (html.length / 1024).toFixed(0), "KB");
