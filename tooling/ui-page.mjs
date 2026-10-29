import { build } from "esbuild";
import SentryCli from "@sentry/cli";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exploreUILayerCSS } from "./explore-css.mjs";

/**
 * Bundles one host's UI into a single self-contained HTML page: the script and
 * every stylesheet are inlined, and Sentry debug IDs are injected into the copy
 * kept under `.sentry/<name>` for source-map upload.
 *
 * `sources` lists the directories Tailwind scans for class names: the shared UI
 * and the host's own shell.
 */
export async function buildUIPage({ name, entry, template, sources, output, environment, sourceURL }) {
  const sentryDirectory = `.sentry/${name}`;
  const result = await build({
    entryPoints: [entry], jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "dataurl", ".woff": "dataurl" },
    plugins: [{ name: "shadcn-theme", setup(build) {
      build.onLoad({ filter: /theme\.css$/ }, async ({ path }) => {
        const compiler = await compile(await readFile(path, "utf8"), { base: dirname(path), onDependency() {} });
        const scanner = new Scanner({ sources: sources.map(base => ({ base: resolve(base), pattern: "**/*.{ts,tsx}", negated: false })) });
        return { contents: compiler.build(scanner.scan()), loader: "css", resolveDir: dirname(path) };
      });
    } }],
    bundle: true, write: false, format: "iife", platform: "browser",
    outfile: `${sentryDirectory}/app.js`, sourcemap: "external",
    target: "chrome120", minify: true, legalComments: "eof", metafile: true,
  });
  await mkdir(sentryDirectory, { recursive: true });
  for (const file of result.outputFiles) await writeFile(file.path, file.contents);
  await new SentryCli().execute(["sourcemaps", "inject", sentryDirectory]);
  const js = await readFile(`${sentryDirectory}/app.js`, "utf8");
  // The Explore sheet ships compiled, so it joins the inlined styles after the
  // plugin's foundation rather than through it.
  const css = `${result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}\n${await exploreUILayerCSS()}`;
  const html = await readFile(template, "utf8");
  const configured = html.replace('name="mobile-dev-environment" content="development"', `name="mobile-dev-environment" content="${environment}"`);
  // Inlined sheets must not close their own tag; esbuild escapes the script side.
  if (css.includes("</style")) throw new Error(`An inlined stylesheet contains a </style sequence and cannot be folded into ${output}.`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, configured
    .replace("<!-- APP_STYLE -->", () => `<style>${css}</style>`)
    .replace("<!-- APP_SCRIPT -->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}\n//# sourceURL=${sourceURL}\n</script>`));
  return result.metafile;
}

/**
 * Bundles a page that hosts the UI rather than being it, such as the browser panel
 * page, into one HTML file. It has no styles to compile and no telemetry of its own.
 */
export async function buildHostPage({ entry, template, output }) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser",
    target: "chrome120", minify: true, legalComments: "eof",
  });
  const js = result.outputFiles[0].text;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, (await readFile(template, "utf8"))
    .replace("<!-- APP_SCRIPT -->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`));
}
