import { rm } from "node:fs/promises";
import { buildServerBundles } from "../../../tooling/server-bundle.mjs";

/**
 * Builds Claude's server, without the panel and with agent-device's commands, into a
 * staged runtime, replacing the shared server.mjs there. Its modules split into chunks
 * beside server.mjs, so each file stays under the Claude plugin directory's 5 MiB limit.
 */
export async function buildHost(outdir, { sentryDirectory = ".sentry/server/claude" } = {}) {
  await rm(sentryDirectory, { recursive: true, force: true });
  await buildServerBundles({ entryPoints: { server: "apps/claude/server/index.ts" }, outdir, sentryDirectory, splitting: true });
}
