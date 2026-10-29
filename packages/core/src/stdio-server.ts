import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadUIResource } from "./ui-resource.ts";
import { createPlugin } from "./plugin.ts";
import type { PluginOptions } from "./plugin.ts";
import { closeServerTelemetry, installTracePropagation } from "./telemetry.ts";
import { declareSchemaDialect } from "./schema-dialect.ts";

/**
 * Runs the server over stdio, as every host launches it, with the host's features:
 * Mobile Dev's panel where the host shows it, and the host's own.
 * Import `./instrument.ts` before this module so telemetry starts first.
 */
export async function runStdioServer({ features }: Pick<PluginOptions, "features"> = {}) {
  const html = await readFile(new URL("./app.html", import.meta.url), "utf8");
  const plugin = await createPlugin(() => loadUIResource(html, new URL("../ui-dev.json", import.meta.url)), { features });
  const transport = new StdioServerTransport();
  installTracePropagation(transport);
  declareSchemaDialect(transport);
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
}
