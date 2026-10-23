import { buildServerBundles } from "../../../tooling/server-bundle.mjs";
import { buildUIPage } from "../../../tooling/ui-page.mjs";

/**
 * Builds Codex's own pieces into dist/hosts/codex: its server, with the updater for
 * Codex plugin installs, and its panel, with the update banner. The package step
 * lays them over the shared runtime.
 */
export async function buildCodexHost(environment) {
  const page = await buildUIPage({
    name: "ui/codex", entry: "apps/codex-plugin/ui/main.tsx", template: "packages/mcp-app/src/index.html",
    sources: ["packages/ui/src", "packages/mcp-app/src", "apps/codex-plugin/ui"], output: "dist/hosts/codex/app.html",
    environment, sourceURL: "app:///mobile-dev-ui.js",
  });
  const server = await buildServerBundles({ entryPoints: { server: "apps/codex-plugin/server/index.ts" }, outdir: "dist/hosts/codex", sentryDirectory: ".sentry/server/codex" });
  return [page, server];
}
