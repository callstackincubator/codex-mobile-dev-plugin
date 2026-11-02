import { readFileSync } from "node:fs";
import type { ServerFeature } from "@mobile-dev/core/server-feature.ts";
import { configureUI } from "@mobile-dev/core/plugin.ts";

export const MAC_PAGE_URI = "ui://mobile-dev/mac.html";

/**
 * Serves the Mac page bundled beside this server. The window reads it through MCP,
 * so it receives the same server-owned telemetry metadata as the MCP Apps panel.
 */
export const macPage: ServerFeature = server => {
  const html = readFileSync(new URL("./mac.html", import.meta.url), "utf8");
  server.registerResource("mobile-dev-mac", MAC_PAGE_URI, { mimeType: "text/html" }, uri => ({
    contents: [{ uri: uri.href, mimeType: "text/html", text: configureUI(html) }],
  }));
};
