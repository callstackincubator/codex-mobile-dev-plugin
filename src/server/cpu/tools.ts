import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { cpuDeviceSchema, cpuTargetSchema } from "../../shared/cpu.ts";
import type { CpuTarget } from "../../shared/cpu.ts";
import { errorMessage } from "../../shared/protocol.ts";
import type { Baguette } from "../baguette.ts";
import { runningCpuApps } from "./apps.ts";
import { listAndroidLogDevices } from "../native-logs.ts";
import type { CpuSessions } from "./sessions.ts";

const sessionId = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metadata = { ui: { visibility: ["app", "model"] as ("app" | "model")[] } };
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { ...read, readOnlyHint: false };

function safe<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try { return await handler(input); }
    catch (error) { return { isError: true, content: [{ type: "text", text: errorMessage(error) }] }; }
  };
}

export function registerCpuTools(server: McpServer, cpu: CpuSessions, baguette: Baguette,
  sources = { apps: runningCpuApps, androidDevices: listAndroidLogDevices }) {
  async function validateDevice(device: { platform: "ios" | "android"; deviceId: string }) {
    if (device.platform === "ios") { await baguette.device(device.deviceId, true); return; }
    const devices = await sources.androidDevices();
    if (devices.some(candidate => candidate.id === device.deviceId) === false) {
      throw new Error("The Android device is offline or unauthorized. Connect and authorize it through ADB.");
    }
  }
  server.registerResource("cpu-batch", new ResourceTemplate("cpu://mobile-dev/{sessionId}/batch?after={sequence}", { list: undefined }), {
    mimeType: "application/json", description: "Read live process and thread CPU plus main-process memory samples from an authorized Mobile Dev performance session.",
  }, async (uri, variables) => {
    const id = sessionId.parse(variables.sessionId);
    const after = sequence.parse(variables.sequence);
    const batch = await cpu.read(id, after);
    const text = JSON.stringify(batch);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  });

  registerAppTool(server, "mobile_performance_sources", {
    title: "Find running apps for CPU and memory monitoring", description: "List running user apps on a booted iOS simulator or connected Android device. Does not launch apps or attach a debugger.",
    inputSchema: cpuDeviceSchema, annotations: read, _meta: metadata,
  }, safe(async (device: z.infer<typeof cpuDeviceSchema>) => {
    await validateDevice(device);
    const running = await sources.apps(device.deviceId, undefined, device.platform);
    const data = { apps: running };
    const text = JSON.stringify(data);
    return { content: [{ type: "text", text }], structuredContent: data };
  }));

  registerAppTool(server, "mobile_cpu_session", {
    title: "Monitor native app CPU and memory", description: "Monitor process and per-thread CPU plus main-process memory once per second without an app SDK. Returns sessionId and cpuUri in the tool result. Poll mobile_read_cpu with sessionId and the previous cursor as after; close with mobile_cpu_close when finished. Android uses a small external native /proc collector over ADB, without root or debugger attachment; the device must permit ADB shell to read app counters. iOS uses Xcode debugserver and requires a development-signed build with get-task-allow and no existing Xcode/LLDB attachment. 100% is one occupied device CPU core. Memory is RSS on Android and physical footprint on iOS, reported in bytes. Idle sessions expire after five minutes.",
    inputSchema: { target: cpuTargetSchema }, annotations: write, _meta: metadata,
  }, safe(async ({ target }: { target: CpuTarget }) => {
    await validateDevice(target);
    const id = cpu.open(target);
    const data = { target, sessionId: id, cpuUri: `cpu://mobile-dev/${id}/batch?after=0` };
    const text = JSON.stringify(data);
    return { content: [{ type: "text", text }], structuredContent: data };
  }));

  registerAppTool(server, "mobile_read_cpu", {
    title: "Read native CPU and memory usage", description: "Read buffered CPU and memory samples and connection status using sessionId returned by mobile_cpu_session. Pass the previous result's cursor as after to read only new samples. Each sample includes process CPU, per-thread CPU and memoryBytes for the main process. The batch memoryMetric is rss on Android or physical-footprint on iOS; 100% CPU is one core. Startup can return connecting or an initial null CPU baseline before a full sampling interval has elapsed. Memory is an absolute byte reading available from the first sample.",
    inputSchema: { sessionId, after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0) }, annotations: read, _meta: metadata,
  }, safe(async ({ sessionId: id, after }: { sessionId: string; after: number }) => {
    const batch = await cpu.read(id, after, 0);
    const text = JSON.stringify(batch);
    return { content: [{ type: "text", text }], structuredContent: { ...batch } };
  }));

  registerAppTool(server, "mobile_cpu_close", {
    title: "Stop native CPU and memory monitor", description: "Stop the external CPU collector or detach the iOS CPU debugger, leaving the app running.",
    inputSchema: { sessionId }, annotations: write, _meta: metadata,
  }, safe(async ({ sessionId: id }: { sessionId: string }) => {
    await cpu.closeSession(id);
    return { content: [{ type: "text", text: "CPU and memory monitor stopped." }], structuredContent: {} };
  }));
}
