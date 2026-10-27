import "./instrument.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentDeviceAdapter } from "./agent-device-adapter.ts";
import { AgentDeviceRuntime } from "./agent-device-runtime.ts";
import { captureServerError, closeServerTelemetry, installTracePropagation } from "./telemetry.ts";

// agent-device's MCP server behind Mobile Dev's compact schemas, as a server of its own.
const transport = new StdioServerTransport();
installTracePropagation(transport);
let server;
let closed;
// This server only forwards to the runtime, so it ends with it.
const runtime = new AgentDeviceRuntime(new URL("./agent-device/", import.meta.url), {
  onDisconnect() { process.exitCode = 1; void close(); },
});
function close() {
  closed ??= (async () => {
    process.stdin.destroy();
    try { await server?.close(); }
    finally {
      try { await runtime.close(); }
      finally { await closeServerTelemetry(); }
    }
  })();
  return closed;
}
transport.onclose = () => { void close(); };
process.stdin.once("end", () => { void close(); });
process.stdin.once("close", () => { void close(); });
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
try {
  server = await createAgentDeviceAdapter(await runtime.connect());
  if (closed === undefined) await server.connect(transport);
} catch (error) {
  console.error(`[mobile-dev] agent-device failed to start: ${error.message}`);
  const failure = new Error("Agent Device adapter failed to start.");
  captureServerError(failure, "agent_device.start");
  process.exitCode = 1;
  await close();
}
