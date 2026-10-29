import { rm } from "node:fs/promises";
import { buildServerBundles } from "../../../tooling/server-bundle.mjs";
import { buildUIPage } from "../../../tooling/ui-page.mjs";

/**
 * Builds the Mac app's own server, which serves its page's telemetry metadata, and
 * the page its window loads from the runtime's `mac.html`, into a staged runtime.
 */
export async function buildHost({ outdir, environment, sentryRoot }) {
  const ui = `${sentryRoot}/ui/mac`;
  const server = `${sentryRoot}/server/mac`;
  for (const directory of [ui, server]) await rm(directory, { recursive: true, force: true });
  await buildServerBundles({ entryPoints: { server: "apps/mac/server/index.ts" }, outdir, sentryDirectory: server });
  await buildUIPage({
    sentryDirectory: ui, entry: "apps/mac/web/main.tsx", template: "apps/mac/web/index.html",
    sources: ["packages/ui/src", "apps/mac/web"], output: `${outdir}/mac.html`,
    environment, sourceURL: "app:///mobile-dev-mac-ui.js",
  });
}
