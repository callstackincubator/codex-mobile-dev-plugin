import "./instrument.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { agentDeviceBackend, createAgentDeviceAdapter } from "./agent-device-adapter.ts";
import { startStorageMetrics } from "./storage-metrics.ts";
import { captureServerError, closeServerTelemetry, installTracePropagation } from "./telemetry.ts";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runtimeUrl = new URL("./agent-device/", import.meta.url);
const runtime = fileURLToPath(runtimeUrl);
const cli = join(runtime, "node_modules/agent-device/bin/agent-device.mjs");
const temporary = tmpdir();
const statePrefix = join(temporary, "mobile-dev-agent-device-");
const stateDir = await mkdtemp(statePrefix);
const home = homedir();
const runnerCache = join(home, ".agent-device/apple-runner");
const stopStorageMetrics = startStorageMetrics({ agent_device_state: stateDir, apple_runner_cache: runnerCache });
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("AGENT_DEVICE_") === false && value !== undefined) env[key] = value;
}
env.AGENT_DEVICE_CONFIG = join(runtime, "config.json");
env.AGENT_DEVICE_STATE_DIR = stateDir;
env.AGENT_DEVICE_NO_UPDATE_NOTIFIER = "1";
console.error(`[mobile-dev] agent-device state directory: ${stateDir}`);
const client = new Client({ name: "mobile-dev-agent-device-adapter", version: "1" });
const backendTransport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], cwd: stateDir, env, stderr: "inherit" });
const transport = new StdioServerTransport();
installTracePropagation(transport);
const run = promisify(execFile);
let server;
let closing = false;
let closed;
function close() {
  if (closing) return closed;
  closing = true;
  closed = (async () => {
    stopStorageMetrics();
    process.stdin.destroy();
    try {
      try { await server?.close(); }
      finally { await client.close(); }
    } finally {
      try {
        // The CLI checks the daemon's PID identity and releases only its own runner leases.
        await run(process.execPath, [cli, "daemon", "stop", "--state-dir", stateDir, "--clean"], {
          cwd: stateDir, env, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        const detail = error.stderr?.trim() || error.message;
        console.error(`[mobile-dev] agent-device cleanup failed: ${detail}`);
        const failure = new Error("Agent Device cleanup failed.");
        captureServerError(failure, "agent_device.cleanup");
      }
      // Keep logs and artifacts readable after a chat closes. The OS manages this temp directory.
      await closeServerTelemetry();
    }
  })();
  return closed;
}
client.onclose = () => {
  if (closing) return;
  process.exitCode = 1;
  const error = new Error("Agent Device runtime disconnected unexpectedly.");
  captureServerError(error, "agent_device.exit");
  void close();
};
transport.onclose = () => { void close(); };
process.stdin.once("end", () => { void close(); });
process.stdin.once("close", () => { void close(); });
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
try {
  await client.connect(backendTransport);
  const backend = agentDeviceBackend(client);
  server = await createAgentDeviceAdapter(backend);
  if (closing === false) await server.connect(transport);
} catch (error) {
  console.error(`[mobile-dev] agent-device failed to start: ${error.message}`);
  const failure = new Error("Agent Device adapter failed to start.");
  captureServerError(failure, "agent_device.start");
  process.exitCode = 1;
  await close();
}
