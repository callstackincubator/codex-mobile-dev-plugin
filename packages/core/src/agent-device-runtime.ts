import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as Sentry from "@sentry/node";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { agentDeviceBackend } from "./agent-device-adapter.ts";
import type { AgentDeviceBackend } from "./agent-device-adapter.ts";
import { startStorageMetrics } from "./storage-metrics.ts";
import { captureServerError } from "./telemetry.ts";

const run = promisify(execFile);

/**
 * The bundled agent-device runtime: its CLI's MCP server in a process of its own, with
 * a state directory for this server. It starts on the first command and restarts after
 * an unexpected exit; `close` stops its daemon and releases its runner leases.
 */
export class AgentDeviceRuntime {
  private readonly cli: string;
  private readonly config: string;
  private readonly onDisconnect?: () => void;
  private stateDir?: Promise<string>;
  private client?: Promise<Client>;
  private stopStorageMetrics?: () => void;
  private closing = false;

  constructor(root = new URL("./agent-device/", import.meta.url), { onDisconnect }: { onDisconnect?: () => void } = {}) {
    const directory = fileURLToPath(root);
    this.cli = join(directory, "node_modules/agent-device/bin/agent-device.mjs");
    this.config = join(directory, "config.json");
    this.onDisconnect = onDisconnect;
  }

  private environment(stateDir: string) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("AGENT_DEVICE_") === false && value !== undefined) env[key] = value;
    }
    env.AGENT_DEVICE_CONFIG = this.config;
    env.AGENT_DEVICE_STATE_DIR = stateDir;
    env.AGENT_DEVICE_NO_UPDATE_NOTIFIER = "1";
    return env;
  }

  private directory() {
    this.stateDir ??= (async () => {
      const stateDir = await mkdtemp(join(tmpdir(), "mobile-dev-agent-device-"));
      console.error(`[mobile-dev] agent-device state directory: ${stateDir}`);
      this.stopStorageMetrics = startStorageMetrics({ agent_device_state: stateDir, apple_runner_cache: join(homedir(), ".agent-device/apple-runner") });
      return stateDir;
    })();
    return this.stateDir;
  }

  /** Starts the runtime if it is not running. Callers report a failed start. */
  async connect(): Promise<AgentDeviceBackend> {
    if (this.closing) throw new Error("The plugin server has closed.");
    const starting = this.client ??= this.start();
    try { return agentDeviceBackend(await starting); }
    catch (error) {
      if (this.client === starting) this.client = undefined;
      throw error;
    }
  }

  private async start() {
    const startedAt = performance.now();
    const stateDir = await this.directory();
    const env = this.environment(stateDir);
    const client = new Client({ name: "mobile-dev-agent-device-adapter", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [this.cli, "mcp"], cwd: stateDir, env, stderr: "inherit" });
    client.onclose = () => {
      if (this.closing) return;
      this.client = undefined;
      captureServerError(new Error("Agent Device runtime disconnected unexpectedly."), "agent_device.exit");
      this.onDisconnect?.();
    };
    try { await client.connect(transport); }
    catch (error) {
      console.error(`[mobile-dev] agent-device failed to start: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    Sentry.metrics.distribution("agent_device.runtime.ready", performance.now() - startedAt, { unit: "millisecond" });
    return client;
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    this.stopStorageMetrics?.();
    const client = this.client;
    try { await (await client?.catch(() => undefined))?.close(); }
    finally {
      const directory = await this.stateDir?.catch(() => undefined);
      if (directory !== undefined) try {
        // The CLI checks the daemon's PID identity and releases only its own runner leases.
        await run(process.execPath, [this.cli, "daemon", "stop", "--state-dir", directory, "--clean"], {
          cwd: directory, env: this.environment(directory), timeout: 10000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        const detail = (error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error));
        console.error(`[mobile-dev] agent-device cleanup failed: ${detail}`);
        captureServerError(new Error("Agent Device cleanup failed."), "agent_device.cleanup");
      }
      // Keep logs and artifacts readable after a chat closes. The OS manages this temp directory.
    }
  }
}
