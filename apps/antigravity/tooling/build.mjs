import { rm } from "node:fs/promises";
import { buildServerBundles } from "../../../tooling/server-bundle.mjs";

export async function buildHost(outdir, { sentryDirectory = ".sentry/server/antigravity" } = {}) {
  await rm(sentryDirectory, { recursive: true, force: true });
  await buildServerBundles({ entryPoints: { server: "apps/antigravity/server/index.ts" }, outdir, sentryDirectory, splitting: true });
}
