import { copyFile } from "node:fs/promises";
import { build } from "esbuild";
import { serverBundleBanner } from "../../../tooling/server-bundle.mjs";

export async function buildHost(outdir) {
  await build({
    entryPoints: ["apps/antigravity/server/index.ts"],
    outfile: `${outdir}/server.mjs`,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: "inline",
    banner: { js: serverBundleBanner },
  });
  await copyFile("dist/browser-panel.html", `${outdir}/browser-panel.html`);
}
