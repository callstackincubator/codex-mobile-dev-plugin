import { build } from "esbuild";
import SentryCli from "@sentry/cli";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exploreUILayerCSS } from "./explore-css.mjs";

/**
 * esbuild options for one host's UI: the entry's script and its stylesheet, with
 * Tailwind compiling the theme from the class names in `sources`, the directories it
 * scans (the shared UI and the host's own shell), resolved from `root`. The theme
 * reports what it read as watch files for a watching build.
 */
export function pageBuildOptions({ entry, sources, outfile, root = process.cwd() }) {
  return {
    entryPoints: [entry], jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "dataurl", ".woff": "dataurl" },
    plugins: [{ name: "shadcn-theme", setup(build) {
      build.onLoad({ filter: /theme\.css$/ }, async ({ path }) => {
        const dependencies = [];
        const compiler = await compile(await readFile(path, "utf8"), { base: dirname(path), onDependency(file) { dependencies.push(file); } });
        const scanner = new Scanner({ sources: sources.map(base => ({ base: resolve(root, base), pattern: "**/*.{ts,tsx}", negated: false })) });
        const contents = compiler.build(scanner.scan());
        return { contents, loader: "css", resolveDir: dirname(path), watchFiles: [...dependencies, ...scanner.files] };
      });
    } }],
    bundle: true, write: false, format: "iife", platform: "browser",
    outfile, target: "chrome120", minify: true, legalComments: "eof",
  };
}

/**
 * Folds a built script and stylesheet into the page template: the Explore sheet joins
 * the styles, the environment meta tag takes `environment`, and the script names
 * itself `sourceURL` for stack traces.
 */
export async function inlinePage({ js, css, template, environment, sourceURL }) {
  // The Explore sheet ships compiled, so it joins the inlined styles after the
  // plugin's foundation rather than through it.
  const styles = `${css}\n${await exploreUILayerCSS()}`;
  // Inlined sheets must not close their own tag; esbuild escapes the script side.
  if (styles.includes("</style")) throw new Error(`An inlined stylesheet contains a </style sequence and cannot be folded into ${template}.`);
  const html = await readFile(template, "utf8");
  return html.replace('name="mobile-dev-environment" content="development"', `name="mobile-dev-environment" content="${environment}"`)
    .replace("<!-- APP_STYLE -->", () => `<style>${styles}</style>`)
    .replace("<!-- APP_SCRIPT -->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}\n//# sourceURL=${sourceURL}\n</script>`);
}

/**
 * Bundles one host's UI into a single self-contained HTML page: the script and
 * every stylesheet are inlined, and Sentry debug IDs are injected into the copy
 * kept under `sentryDirectory` for source-map upload.
 */
export async function buildUIPage({ sentryDirectory, entry, template, sources, output, environment, sourceURL }) {
  const result = await build({ ...pageBuildOptions({ entry, sources, outfile: `${sentryDirectory}/app.js` }), sourcemap: "external", metafile: true });
  await mkdir(sentryDirectory, { recursive: true });
  for (const file of result.outputFiles) await writeFile(file.path, file.contents);
  await new SentryCli().execute(["sourcemaps", "inject", sentryDirectory]);
  const js = await readFile(`${sentryDirectory}/app.js`, "utf8");
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const html = await inlinePage({ js, css, template, environment, sourceURL });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  return result.metafile;
}

/** The MCP Apps panel as hosts without their own chrome load it, the runtime's `app.html`. */
export function buildSharedPage({ output, environment, sentryRoot }) {
  return buildUIPage({
    sentryDirectory: `${sentryRoot}/ui/mcp-app`, entry: "packages/mcp-app/src/main.tsx", template: "packages/mcp-app/src/index.html",
    sources: ["packages/ui/src", "packages/mcp-app/src"], output, environment, sourceURL: "app:///mobile-dev-ui.js",
  });
}
