import { build } from "esbuild";
import { sentryEsbuildPlugin } from "@sentry/node/esbuild";
import SentryCli from "@sentry/cli";
import { SENTRY_PROJECTS } from "./sentry-projects.mjs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

/**
 * Bundles Node entry points into `outdir` as `<name>.mjs`. Sentry debug IDs are
 * injected into the copies kept under `sentryDirectory` with their source maps,
 * and the shipped files carry the same IDs without the maps.
 *
 * A host's server is always named `server.mjs`: the runtime finds its bundled
 * helpers relative to that file.
 */
export async function buildServerBundles({ entryPoints, outdir, sentryDirectory }) {
  const result = await build({
    entryPoints, outdir, outExtension: { ".js": ".mjs" }, bundle: true,
    format: "esm", platform: "node", target: "node22", minify: false, legalComments: "eof", metafile: true,
    sourcemap: "external",
    plugins: [sentryEsbuildPlugin({ project: SENTRY_PROJECTS.server, telemetry: false, sourcemaps: { disable: true }, release: { inject: false, create: false, finalize: false } })],
    banner: { js: "import { createRequire as mobileDevBundleRequire } from 'node:module'; const require = mobileDevBundleRequire(import.meta.url);" },
  });
  const names = Object.keys(entryPoints).map(name => `${name}.mjs`);
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
