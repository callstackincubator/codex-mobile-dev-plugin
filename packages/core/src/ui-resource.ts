import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

export type UIResource = { html: string; liveRevision?: string };

// Release packages have no switch. A dead watcher falls back to the bundle.
export async function loadUIResource(productionHTML: string, configURL: URL): Promise<UIResource> {
  try {
    const config = JSON.parse(await readFile(configURL, "utf8"));
    if (config.mode !== "mcp-live" || typeof config.projectRoot !== "string" || !isAbsolute(config.projectRoot)) return { html: productionHTML };
    const output = resolve(config.projectRoot, ".local-dev");
    const heartbeat = await stat(resolve(output, "ui-watch.json"));
    if (Date.now() - heartbeat.mtimeMs > 10000) return { html: productionHTML };
    const html = await readFile(resolve(output, "app.html"), "utf8");
    if (!html.includes('id="root"') || !html.includes("</head>")) return { html: productionHTML };
    const liveRevision = createHash("sha256").update(html).digest("hex");
    return { liveRevision, html: html.replace("</head>", `<meta name="mobile-dev-live-revision" content="${liveRevision}"></head>`) };
  } catch { return { html: productionHTML }; }
}
