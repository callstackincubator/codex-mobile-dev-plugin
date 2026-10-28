import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { CallToolResultSchema, type CallToolRequest, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as Sentry from "@sentry/node";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startStorageMetrics } from "./storage-metrics.ts";
import { captureServerError } from "./telemetry.ts";

const run = promisify(execFile);

/** Runs one agent-device command. */
export type AgentDeviceBackend = {
  callTool(params: CallToolRequest["params"], options: RequestOptions): Promise<CallToolResult>;
};

/** The runtime's state directory for this server, and the storage measurement that watches it. */
type State = { directory: string; stopStorageMetrics: () => void };

/**
 * The bundled agent-device runtime: its CLI's MCP server in a process of its own, with a
 * state directory for this server. It starts on the first command and again after an
 * unexpected exit; `close` stops its daemon and releases its runner leases.
 */
export class AgentDeviceRuntime {
  private readonly cli: string;
  private readonly config: string;
  private state?: Promise<State>;
  private starting?: Promise<Client>;
  /** The connected client; only its unexpected exit restarts the runtime. */
  private client?: Client;
  private closing = false;

  constructor(root = new URL("./agent-device/", import.meta.url)) {
    const directory = fileURLToPath(root);
    this.cli = join(directory, "node_modules/agent-device/bin/agent-device.mjs");
    this.config = join(directory, "config.json");
  }

  /** Starts the runtime if it is not running. Callers report a failed start. */
  async connect(): Promise<AgentDeviceBackend> {
    if (this.closing) throw new Error("The plugin server has closed.");
    const starting = this.starting ??= this.start();
    let client: Client;
    try { client = await starting; }
    catch (error) {
      if (this.starting === starting) this.starting = undefined;
      throw error;
    }
    return {
      async callTool(params, options) {
        return CallToolResultSchema.parse(await client.callTool(params, CallToolResultSchema, options));
      },
    };
  }

  private environment(directory: string) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("AGENT_DEVICE_") === false && value !== undefined) env[key] = value;
    }
    env.AGENT_DEVICE_CONFIG = this.config;
    env.AGENT_DEVICE_STATE_DIR = directory;
    env.AGENT_DEVICE_NO_UPDATE_NOTIFIER = "1";
    return env;
  }

  private async createState(): Promise<State> {
    const directory = await mkdtemp(join(tmpdir(), "mobile-dev-agent-device-"));
    console.error(`[mobile-dev] agent-device state directory: ${directory}`);
    const stopStorageMetrics = startStorageMetrics({ agent_device_state: directory, apple_runner_cache: join(homedir(), ".agent-device/apple-runner") });
    return { directory, stopStorageMetrics };
  }

  private async start() {
    const startedAt = performance.now();
    const { directory } = await (this.state ??= this.createState());
    const client = new Client({ name: "mobile-dev-agent-device", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [this.cli, "mcp"], cwd: directory, env: this.environment(directory), stderr: "inherit" });
    // A start that fails closes its client too; connect reports that instead.
    client.onclose = () => {
      if (this.closing || this.client !== client) return;
      this.client = undefined;
      this.starting = undefined;
      captureServerError(new Error("Agent Device runtime disconnected unexpectedly."), "agent_device.exit");
    };
    await client.connect(transport);
    this.client = client;
    Sentry.metrics.distribution("agent_device.runtime.ready", performance.now() - startedAt, { unit: "millisecond" });
    return client;
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    const [client, state] = await Promise.all([this.starting?.catch(() => undefined), this.state?.catch(() => undefined)]);
    try { await client?.close(); }
    finally {
      state?.stopStorageMetrics();
      // Keep logs and artifacts readable after a chat closes. The OS manages this temp directory.
      if (state) await this.stopDaemon(state.directory);
    }
  }

  private async stopDaemon(directory: string) {
    try {
      // The CLI checks the daemon's PID identity and releases only its own runner leases.
      await run(process.execPath, [this.cli, "daemon", "stop", "--state-dir", directory, "--clean"], {
        cwd: directory, env: this.environment(directory), timeout: 10000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error));
      console.error(`[mobile-dev] agent-device cleanup failed: ${detail}`);
      captureServerError(new Error("Agent Device cleanup failed."), "agent_device.cleanup");
    }
  }
}
