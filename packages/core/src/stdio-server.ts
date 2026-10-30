import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadUIResource } from "./ui-resource.ts";
import { createPlugin } from "./plugin.ts";
import type { PluginOptions } from "./plugin.ts";
import { closeServerTelemetry, installTracePropagation, setLaunchingTelemetryHost } from "./telemetry.ts";
import type { TelemetryHost } from "@mobile-dev/shared/telemetry.ts";
import { declareSchemaDialect } from "./schema-dialect.ts";
import { SharedTransport } from "./shared-transport.ts";

/**
 * Runs the server over stdio, as every host launches it, with the host's features:
 * Mobile Dev's panel where the host shows it, and the host's own. A host whose MCP
 * client does not name it passes its `telemetryHost` label instead.
 * Import `./instrument.ts` before this module so telemetry starts first.
 */
export async function runStdioServer({ features, telemetryHost }: Pick<PluginOptions, "features"> & { telemetryHost?: TelemetryHost } = {}) {
  if (telemetryHost) setLaunchingTelemetryHost(telemetryHost);
  const html = await readFile(new URL("./app.html", import.meta.url), "utf8");
  // Features can let other connections, such as a browser panel, share the host's session.
  const transport = new SharedTransport(new StdioServerTransport());
  const plugin = createPlugin(() => loadUIResource(html, new URL("../ui-dev.json", import.meta.url)), { features, connections: transport });
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
  // Once the host is gone, closing answers requests still in flight into its closed pipes.
  // Unhandled, each EPIPE is an uncaught exception whose console.error to the same closed
  // stderr raises another, so the server spins and never finishes closing.
  process.stdout.on("error", () => { void close(); });
  process.stderr.on("error", () => {});
  process.on("SIGINT", () => { void close(); });
  process.on("SIGTERM", () => { void close(); });
  process.on("uncaughtException", error => { console.error(error); void close().finally(() => { process.exitCode = 1; }); });
  process.on("unhandledRejection", error => { console.error(error); void close().finally(() => { process.exitCode = 1; }); });
  await plugin.server.connect(transport);
}
