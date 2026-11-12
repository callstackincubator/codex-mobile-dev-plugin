import { rm } from "node:fs/promises";
import { buildServerBundles } from "../../../tooling/server-bundle.mjs";

/**
 * Builds Claude's server, with the native panel and agent-device's commands, into a
 * staged runtime, replacing the shared server.mjs there. Its modules split into chunks
 * beside server.mjs, so each file stays under the Claude plugin directory's 5 MiB limit.
 */
export async function buildHost(outdir, { sentryDirectory = ".sentry/server/claude" } = {}) {
  // The staged shared runtime includes a browser host that Claude no longer uses.
  await rm(`${outdir}/browser-panel.html`, { force: true });
  await rm(sentryDirectory, { recursive: true, force: true });
  await buildServerBundles({ entryPoints: { server: "apps/claude/server/index.ts" }, outdir, sentryDirectory, splitting: true });
}
