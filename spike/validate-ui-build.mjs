// One-off validation of the exact UI steps scripts/build.mjs performs, skipping
// the native vendor steps this worktree cannot build. Mirrors build.mjs lines
// for the app bundle: theme.css compile, react alias, CSS fold, </style assert.
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exploreUILayerCSS } from "../scripts/explore-css.mjs";
import { sharedNodeModules } from "../scripts/shared-node-modules.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
process.chdir(projectRoot);

const app = await build({
  entryPoints: ["src/ui/app.tsx"], jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  alias: { react: resolve("node_modules/react"), "react-dom": resolve("node_modules/react-dom") },
  loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  plugins: [sharedNodeModules(projectRoot), { name: "shadcn-theme", setup(build) {
    build.onLoad({ filter: /theme\.css$/ }, async ({ path }) => {
      const compiler = await compile(await readFile(path, "utf8"), { base: dirname(path), onDependency() {} });
      const scanner = new Scanner({ sources: [{ base: resolve("src/ui"), pattern: "**/*.{ts,tsx}", negated: false }] });
      return { contents: compiler.build(scanner.scan()), loader: "css", resolveDir: dirname(path) };
    });
  } }],
  bundle: true, write: false, format: "iife", platform: "browser", outfile: "spike/out/ui-validation.js",
  target: "chrome120", minify: true, legalComments: "eof", metafile: true,
});
const js = app.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = `${app.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}\n${await exploreUILayerCSS()}`;
if (css.includes("</style")) throw new Error("An inlined stylesheet contains a </style sequence and cannot be folded into app.html.");
const template = await readFile("src/ui/index.html", "utf8");
const html = template
  .replace("<!-- APP_STYLE -->", () => `<style>${css}</style>`)
  .replace("<!-- APP_SCRIPT -->", () => `<script>${js.replaceAll("</script", "<\\/script")}</script>`);
await writeFile("spike/out/ui-validation.html", html);
const reactCopies = Object.keys(app.metafile.inputs).filter(p => p.includes("node_modules/react/")).map(p => p.split("/node_modules/")[0].split("/").slice(-1)[0]);
console.log("html MB", (html.length / 1024 / 1024).toFixed(2), "| js MB", (js.length / 1024 / 1024).toFixed(2), "| css KB", (css.length / 1024).toFixed(0));
console.log("react roots in bundle:", [...new Set(Object.keys(app.metafile.inputs).filter(p => p.includes("/react/") || p.includes("/react-dom/")).map(p => { const i = p.lastIndexOf("node_modules/"); return p.slice(0, i).split("/").slice(-2).join("/"); }))]);
console.log("explore components in bundle:", Object.keys(app.metafile.inputs).filter(p => p.includes("tracesift-explore")).length);
console.log("frozen fonts survive:", css.includes("InterVariable") || css.includes("woff2"));
