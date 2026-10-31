import { rm } from "node:fs/promises";
import { buildServerBundles } from "../../../tooling/server-bundle.mjs";
import { buildUIPage } from "../../../tooling/ui-page.mjs";

/**
 * Builds Codex's own server, with the updater for Codex plugin installs, and its
 * panel, with the update banner, into a staged runtime. They replace the shared
 * server.mjs and app.html there; their dependencies are the shared runtime's.
 */
export async function buildHost({ outdir, environment, sentryRoot }) {
  const ui = `${sentryRoot}/ui/codex`;
  const server = `${sentryRoot}/server/codex`;
  for (const directory of [ui, server]) await rm(directory, { recursive: true, force: true });
  await buildUIPage({
    sentryDirectory: ui, entry: "apps/codex-plugin/ui/main.tsx", template: "packages/mcp-app/src/index.html",
    sources: ["packages/ui/src", "packages/mcp-app/src", "apps/codex-plugin/ui"], output: `${outdir}/app.html`,
    environment, sourceURL: "app:///mobile-dev-ui.js",
  });
  await buildServerBundles({ entryPoints: { server: "apps/codex-plugin/server/index.ts" }, outdir, sentryDirectory: server });
}
