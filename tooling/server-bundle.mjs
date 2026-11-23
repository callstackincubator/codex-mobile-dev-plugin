import { build } from "esbuild";
import { sentryEsbuildPlugin } from "@sentry/node/esbuild";
import SentryCli from "@sentry/cli";
import { SENTRY_PROJECTS } from "./sentry-projects.mjs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export const serverBundleBanner = [
  "import { createRequire as mobileDevBundleRequire } from 'node:module';",
  "import { fileURLToPath as mobileDevFileURLToPath } from 'node:url';",
  "import { dirname as mobileDevPathDirname } from 'node:path';",
  "const require = mobileDevBundleRequire(import.meta.url);",
  "const __filename = mobileDevFileURLToPath(import.meta.url);",
  "const __dirname = mobileDevPathDirname(__filename);",
].join(" ");

/**
 * Bundles Node entry points into `outdir` as `<name>.mjs`. Sentry debug IDs are
 * injected into the copies kept under `sentryDirectory` with their source maps,
 * and the shipped files carry the same IDs without the maps.
 *
 * A host's server is always named `server.mjs`: the runtime finds its bundled
 * helpers relative to that file. With `splitting`, modules an entry point imports
 * dynamically become chunks beside it, found the same way.
 */
export async function buildServerBundles({ entryPoints, outdir, sentryDirectory, splitting = false }) {
  const serverEntries = entryPoints.server && !entryPoints["app-intelligence-worker"]
    ? { ...entryPoints, "app-intelligence-worker": "packages/core/src/app-intelligence/worker.ts" }
    : entryPoints;
  const result = await build({
    entryPoints: serverEntries, outdir, outExtension: { ".js": ".mjs" }, bundle: true, splitting,
    // typescript.js is a single ~9.9 MB module, which no amount of splitting can bring under
    // Claude's 5 MiB per-file limit. App-flow's sources keep importing "typescript" so tsc
    // still sees the real declarations; at runtime this shim resolves the compiler from the
    // project being parsed, which always ships its own copy.
    alias: { typescript: resolve("packages/core/src/app-flow/typescript-runtime.ts") },
    format: "esm", platform: "node", target: "node22", minify: false, legalComments: "eof", metafile: true,
    sourcemap: "external",
    plugins: [sentryEsbuildPlugin({ project: SENTRY_PROJECTS.server, telemetry: false, sourcemaps: { disable: true }, release: { inject: false, create: false, finalize: false } })],
    // Some CommonJS dependencies that esbuild wraps inside the ESM output still
    // resolve these Node globals at runtime. Define all three compatibility
    // globals at bundle scope so an installed server behaves like its sources.
    banner: { js: serverBundleBanner },
  });
  const names = Object.keys(result.metafile.outputs).filter(path => path.endsWith(".mjs")).map(path => basename(path));
  await mkdir(sentryDirectory, { recursive: true });
  for (const name of names) {
    await copyFile(`${outdir}/${name}`, `${sentryDirectory}/${name}`);
    await copyFile(`${outdir}/${name}.map`, `${sentryDirectory}/${name}.map`);
    await rm(`${outdir}/${name}.map`);
  }
  await new SentryCli().execute(["sourcemaps", "inject", sentryDirectory]);
  for (const name of names) {
    await copyFile(`${sentryDirectory}/${name}`, `${outdir}/${name}`);
    execFileSync(process.execPath, ["--check", `${outdir}/${name}`]);
  }
  return result.metafile;
}
