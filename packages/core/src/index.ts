import "./instrument.ts";
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadUIResource } from "./ui-resource.ts";
import { configureUI, createPlugin, MAC_PAGE_URI } from "./plugin.ts";
import { closeServerTelemetry, installTracePropagation } from "./telemetry.ts";

const html = await readFile(new URL("./app.html", import.meta.url), "utf8");
const plugin = await createPlugin(() => loadUIResource(html, new URL("../ui-dev.json", import.meta.url)));
// The Mac app bundles its page beside this runtime and loads it through MCP, so it
// receives the same server-owned telemetry metadata as the Codex panel.
const macPage = await readFile(new URL("./mac.html", import.meta.url), "utf8").catch(() => undefined);
if (macPage !== undefined) {
  plugin.server.registerResource("mobile-dev-mac", MAC_PAGE_URI, { mimeType: "text/html" }, uri => ({
    contents: [{ uri: uri.href, mimeType: "text/html", text: configureUI(macPage) }],
  }));
}
const transport = new StdioServerTransport();
installTracePropagation(transport);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await plugin.close(); }
  finally { await closeServerTelemetry(); }
}
transport.onclose = () => { void close(); };
process.stdin.on("end", () => { void close(); });
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
process.on("uncaughtException", error => { console.error(error); void close().finally(() => { process.exitCode = 1; }); });
process.on("unhandledRejection", error => { console.error(error); void close().finally(() => { process.exitCode = 1; }); });
await plugin.server.connect(transport);
