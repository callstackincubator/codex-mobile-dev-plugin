import { rm } from "node:fs/promises";
import { buildServerBundles } from "../../../tooling/server-bundle.mjs";
import { telemetryBuildEnvironment } from "../../../tooling/telemetry-build.mjs";
import { buildHostPage, buildUIPage } from "../../../tooling/ui-page.mjs";

export async function buildHost(outdir, { sentryDirectory = ".sentry/server/antigravity", includeUIPage = false } = {}) {
  await rm(sentryDirectory, { recursive: true, force: true });
  if (includeUIPage) {
    await buildUIPage({
      name: "ui/mcp-app", entry: "packages/mcp-app/src/main.tsx", template: "packages/mcp-app/src/index.html",
      sources: ["packages/ui/src", "packages/mcp-app/src"], output: `${outdir}/app.html`,
      environment: telemetryBuildEnvironment(), sourceURL: "app:///mobile-dev-ui.js",
    });
  }
  await buildHostPage({ entry: "packages/mcp-app/src/browser-panel.ts", template: "packages/mcp-app/src/browser-panel.html", output: `${outdir}/browser-panel.html` });
  await buildServerBundles({ entryPoints: { server: "apps/antigravity/server/index.ts" }, outdir, sentryDirectory, splitting: true });
}
