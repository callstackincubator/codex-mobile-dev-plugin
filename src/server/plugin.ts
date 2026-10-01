import type { UIResource } from "./ui-resource.ts";
import { LIVE_UI_URI } from "../shared/live-ui.ts";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { OpenAIExtensions } from "@openai/mcp-extensions/server";
import { z } from "zod";
import { registerDeviceSettingsTools } from "./device-settings.ts";
import { readBezel } from "./bezel.ts";
import { ServeEmu } from "./serve-emu.ts";
import { registerAndroidTools } from "./android-tools.ts";
import { Baguette } from "./baguette.ts";
import { registerIosDeviceTools } from "./ios-devices.ts";
import { StreamSessions } from "./stream-sessions.ts";
import { LogSessions } from "./log-sessions.ts";
import { registerLogTools } from "./log-tools.ts";
import { CpuSessions, createCpuSessions } from "./cpu/sessions.ts";
import { registerCpuTools } from "./cpu/tools.ts";
import { SimulatorInputService } from "./simulator-input.ts";
import type { InputStatus, SimulatorInput } from "./simulator-input.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { copyPNGToClipboard } from "./clipboard.ts";
import { errorMessage, inputSchema, streamMessageSchema, udidSchema } from "../shared/protocol.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const APP_URI = "ui://mobile-dev/0.1.48/simulator.html";
export const WORKSPACE_URI = "ui://mobile-dev/0.1.48/workspace.html";
// Codex can retain entrypoint metadata after updating the installed plugin.
const legacyAppUris = [
  "ui://mobile-dev/0.1.44/simulator.html",
  "ui://mobile-dev/0.1.43/simulator.html",
  "ui://mobile-dev/0.1.42/simulator.html",
  "ui://mobile-dev/0.1.41/simulator.html",
  "ui://mobile-dev/0.1.40/simulator.html",
  "ui://mobile-dev/0.1.39/simulator.html",
  "ui://mobile-dev/0.1.38/simulator.html",
  "ui://mobile-dev/0.1.37/simulator.html",
  "ui://mobile-dev/0.1.36/simulator.html",
  "ui://mobile-dev/0.1.35/simulator.html",
  "ui://mobile-dev/0.1.34/simulator.html",
  "ui://mobile-dev/0.1.33/simulator.html",
  "ui://mobile-dev/0.1.32/simulator.html",
  "ui://mobile-dev/0.1.24/mcp-stream/simulator.html",
  "ui://mobile-dev/0.1.31/simulator.html",
  "ui://mobile-dev/0.1.30/simulator.html",
  "ui://mobile-dev/0.1.29/simulator.html", "ui://mobile-dev/0.1.28/simulator.html", "ui://mobile-dev/0.1.27/simulator.html", "ui://mobile-dev/0.1.26/simulator.html", "ui://mobile-dev/0.1.25/simulator.html", "ui://mobile-dev/0.1.24/simulator.html", "ui://mobile-dev/0.1.23/simulator.html", "ui://mobile-dev/0.1.22/simulator.html", "ui://mobile-dev/0.1.21/simulator.html", "ui://mobile-dev/0.1.20/simulator.html", "ui://mobile-dev/0.1.19/simulator.html", "ui://mobile-dev/0.1.18/simulator.html", "ui://mobile-dev/0.1.17/simulator.html", "ui://mobile-dev/0.1.16/simulator.html", "ui://mobile-dev/0.1.15/simulator.html", "ui://mobile-dev/0.1.14/simulator.html", "ui://mobile-dev/0.1.13/simulator.html", "ui://mobile-dev/0.1.12/simulator.html", "ui://mobile-dev/0.1.11/simulator.html", "ui://mobile-dev/simulator.html", ...Array.from({ length: 6 }, (_, index) => `ui://mobile-dev/v${index + 1}/simulator.html`)];
const legacyWorkspaceUris = [
  "ui://mobile-dev/0.1.44/workspace.html",
  "ui://mobile-dev/0.1.43/workspace.html",
  "ui://mobile-dev/0.1.42/workspace.html",
  "ui://mobile-dev/0.1.41/workspace.html",
  "ui://mobile-dev/0.1.40/workspace.html",
  "ui://mobile-dev/0.1.39/workspace.html",
  "ui://mobile-dev/0.1.38/workspace.html",
  "ui://mobile-dev/0.1.37/workspace.html",
  "ui://mobile-dev/0.1.36/workspace.html",
  "ui://mobile-dev/0.1.35/workspace.html",
  "ui://mobile-dev/0.1.34/workspace.html",
  "ui://mobile-dev/0.1.33/workspace.html",
  "ui://mobile-dev/0.1.32/workspace.html",
  "ui://mobile-dev/0.1.24/mcp-stream/workspace.html",
  "ui://mobile-dev/0.1.31/workspace.html",
  "ui://mobile-dev/0.1.30/workspace.html",
  "ui://mobile-dev/0.1.29/workspace.html", "ui://mobile-dev/0.1.28/workspace.html", "ui://mobile-dev/0.1.27/workspace.html", "ui://mobile-dev/0.1.26/workspace.html", "ui://mobile-dev/0.1.25/workspace.html", "ui://mobile-dev/0.1.24/workspace.html", "ui://mobile-dev/0.1.23/workspace.html", "ui://mobile-dev/0.1.22/workspace.html", "ui://mobile-dev/0.1.21/workspace.html", "ui://mobile-dev/0.1.20/workspace.html", "ui://mobile-dev/0.1.19/workspace.html", "ui://mobile-dev/0.1.18/workspace.html", "ui://mobile-dev/0.1.17/workspace.html", "ui://mobile-dev/0.1.16/workspace.html", "ui://mobile-dev/0.1.15/workspace.html", "ui://mobile-dev/0.1.14/workspace.html", "ui://mobile-dev/0.1.13/workspace.html", "ui://mobile-dev/0.1.12/workspace.html", "ui://mobile-dev/0.1.11/workspace.html", "ui://mobile-dev/workspace.html"];
const sessionIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const deviceInput = { udid: udidSchema.describe("A simulator UDID returned by mobile_list_simulators.") };
const deviceSchema = z.object({ udid: udidSchema, name: z.string(), state: z.string(), runtime: z.string() });
const statusOutput = {
  connected: z.boolean(), managed: z.boolean(), baseUrl: z.string(),
  devices: z.array(deviceSchema), error: z.string().optional(),
};

function result(data: Record<string, unknown>, message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], structuredContent: data };
}

function guarded<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try { return await handler(input); }
    catch (error) { return { isError: true, content: [{ type: "text", text: errorMessage(error) }], _meta: { retryable: !(error instanceof SimulatorUnavailableError) } }; }
  };
}

export async function createPlugin(html: string | (() => Promise<UIResource>), baguette = new Baguette(), simulatorInput: SimulatorInput = new SimulatorInputService(udid => baguette.repairInput(udid)), logs = new LogSessions(), android = new ServeEmu(), copyScreenshot = copyPNGToClipboard, providedCpu?: CpuSessions) {
  const streams = new StreamSessions(baguette);
  let selectedCpu = providedCpu;
  if (selectedCpu === undefined) selectedCpu = await createCpuSessions();
  const cpu = selectedCpu;
  const server = new McpServer({ name: "mobile-dev", version: "0.1.48" }, {
    instructions: "Use mobile_list_simulators to get simulator UDIDs before acting. For app control, use the plugin's agent-device MCP tools with the same UDID and a named session. Prefer its snapshot refs and selectors for press, fill, and scroll. Baguette handles the panel stream and pointer input. Boot only a simulator the user selected. Read mobile_describe_ui or mobile_screenshot before sending coordinates. Coordinates use device points. For Android use mobile_list_android_devices and the mobile_android tools. Use the selected serial with agent-device and platform android. serve-emu handles Android video and panel input. Opening the panel does not boot a device.",
  });
  new OpenAIExtensions(server);
  registerIosDeviceTools(server);
  registerLogTools(server, logs, baguette);
  registerCpuTools(server, cpu, baguette);
  const closeAndroid = registerAndroidTools(server, android, APP_URI, copyScreenshot, deviceId => cpu.closeDevice(deviceId));
  registerDeviceSettingsTools(server, baguette, android);

  const automaticRepairs = new Map<string, { attemptedAt: number; pending: Promise<{ inputStatus: InputStatus; inputRepairMessage: string }> }>();
  async function panelInputStatus(udid: string) {
    const inputStatus = await simulatorInput.status(udid, { fresh: true });
    if (inputStatus.state !== "blocked") return { inputStatus };
    const previous = automaticRepairs.get(udid);
    if (previous && Date.now() - previous.attemptedAt < 60000) {
      const repaired = await previous.pending;
      const current = await simulatorInput.status(udid);
      return current.state === "ready" ? repaired : { inputStatus: current, inputRepairMessage: "Input is blocked again. Automatic repair paused to avoid repeatedly closing apps." };
    }
    const pending = (async () => {
      streams.closeDevice(udid);
      try {
        const inputStatus = await simulatorInput.repair(udid);
        return { inputStatus, inputRepairMessage: "Input repaired automatically. Reopen your app." };
      } catch (error) {
        return { inputStatus: await simulatorInput.status(udid), inputRepairMessage: `Automatic input repair failed: ${errorMessage(error)}` };
      }
    })();
    automaticRepairs.set(udid, { attemptedAt: Date.now(), pending });
    return pending;
  }

  async function blockedInput(udid: string): Promise<CallToolResult | undefined> {
    if ((await simulatorInput.status(udid)).state !== "blocked") return;
    return {
      isError: true,
      content: [{ type: "text", text: "Device Hub blocks simulator input. Repair input to continue; the repair closes running simulator apps." }],
      _meta: { inputBlocked: true },
    };
  }

  const readApp = async (uri: URL) => {
    const resource = typeof html === "string" ? { html } : await html();
    const content = resource.html;
    return ({
    contents: [{
      uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: (uri.href === WORKSPACE_URI || legacyWorkspaceUris.includes(uri.href))
        ? content.replace('data-view="panel"', 'data-view="workspace"').replace('data-layout="stacked"', 'data-layout="split"')
        : content,
      _meta: {
        ui: { csp: { connectDomains: [], resourceDomains: [] } },
        "openai/ui": { preferredDisplayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] },
      },
    }],
  });
  };
  server.registerResource("mobile-dev-live", new ResourceTemplate(`${LIVE_UI_URI}?after={revision}`, { list: undefined }), {
    mimeType: "application/json",
    description: "Read a changed local development UI through MCP. Unchanged reads omit the HTML.",
  }, async uri => {
    const resource = typeof html === "string" ? { html } : await html();
    const revision = resource.liveRevision;
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({
      revision,
      html: revision && revision !== uri.searchParams.get("after") ? resource.html : undefined,
    }) }] };
  });
  registerAppResource(server, "mobile-dev-simulator", APP_URI, {}, readApp);
  registerAppResource(server, "mobile-dev-workspace", WORKSPACE_URI, {}, readApp);
  for (const [index, uri] of legacyWorkspaceUris.entries()) {
    registerAppResource(server, `mobile-dev-workspace-legacy-${index}`, uri, {}, readApp);
  }
  for (const [index, uri] of legacyAppUris.entries()) {
    registerAppResource(server, `mobile-dev-simulator-v${index + 1}`, uri, {}, readApp);
  }

  const frameTemplate = new ResourceTemplate("mobile-frame://{sessionId}/latest{?after}", { list: undefined });
  server.registerResource("simulator-latest-frame", frameTemplate, { mimeType: "image/jpeg" }, async (uri, variables, extra) => {
    const sessionId = sessionIdSchema.parse(variables.sessionId);
    const cursor = uri.searchParams.get("after") ?? "0";
    const after = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(cursor);
    try {
      const read = await streams.frame(sessionId, after, extra.signal);
      const timings = { serverWaitMs: read.serverWaitMs, serverStartedAt: read.serverStartedAt, serverPreparedAt: read.serverPreparedAt };
      if (read.frame) {
        const { data, ...metadata } = read.frame;
        return { contents: [{ uri: uri.href, mimeType: "image/jpeg", blob: data, _meta: { ...metadata, ...timings } }] };
      }
      const text = JSON.stringify({ state: "waiting", connectionState: streams.connectionState(sessionId), ...timings });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text, _meta: timings }] };
    } catch (error) {
      const text = JSON.stringify({ state: "failed", error: errorMessage(error), retryable: !(error instanceof SimulatorUnavailableError) });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    }
  });

  const openPanel = guarded(async () => {
    let status;
    try { status = await baguette.start(); }
    catch (error) { status = { ...await baguette.status(), error: errorMessage(error) }; }
    return result(status, status.connected ? `Found ${status.devices.length} simulators.` : status.error ?? "The bundled simulator backend could not start.");
  });

  registerAppTool(server, "mobile_open_workspace", {
    title: "Mobile Dev",
    description: "Open the fullscreen Mobile Dev workspace with logs and performance tools on the left and iOS and Android devices side by side on the right. Starts the bundled backend without booting a device.",
    inputSchema: {}, outputSchema: statusOutput, annotations: write,
    _meta: {
      ui: { resourceUri: WORKSPACE_URI, visibility: ["app", "model"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    },
  }, openPanel);

  registerAppTool(server, "mobile_open_simulator", {
    title: "Mobile simulator",
    description: "Open the Mobile Dev simulator panel in Codex and start the plugin's bundled Baguette backend. Shows iOS and Android side by side without booting any devices.",
    inputSchema: {}, outputSchema: statusOutput, annotations: write,
    _meta: {
      ui: { resourceUri: APP_URI, visibility: ["app", "model"] },
      "openai/ui": { entrypoints: [{ type: "thread" }] },
    },
  }, openPanel);

  server.registerTool("mobile_list_simulators", {
    title: "List iOS simulators", description: "Start the plugin's bundled backend if needed and list available and booted simulators.",
    inputSchema: {}, outputSchema: statusOutput, annotations: write,
  }, guarded(async () => {
    const status = await baguette.start();
    return result(status, status.connected ? JSON.stringify(status.devices) : status.error ?? "Baguette is offline.");
  }));

  server.registerTool("mobile_start_baguette", {
    title: "Start simulator backend", description: "Start or reconnect the Baguette backend bundled inside this plugin. Requires an Apple Silicon Mac with Xcode 26 or later. No separate Baguette install is needed.",
    inputSchema: {}, outputSchema: statusOutput, annotations: write,
  }, guarded(async () => {
    const status = await baguette.start();
    return result(status, status.managed ? "Baguette is running." : "Connected to the existing Baguette server.");
  }));

  for (const action of ["boot", "shutdown"] as const) {
    server.registerTool(`mobile_${action}_simulator`, {
      title: action === "boot" ? "Boot iOS simulator" : "Shut down iOS simulator",
      description: `${action === "boot" ? "Boot" : "Shut down"} the selected simulator. Use a UDID from the device list.`,
      inputSchema: deviceInput, outputSchema: statusOutput,
      annotations: { ...write, destructiveHint: action === "shutdown" },
    }, guarded(async ({ udid }: { udid: string }) => {
      if (action === "shutdown") await cpu.closeDevice(udid);
      const status = await baguette.changeDeviceState(udid, action);
      if (action === "shutdown") streams.closeDevice(udid);
      return result(status, `${action === "boot" ? "Booted" : "Shut down"} ${udid}.`);
    }));
  }

  server.registerTool("mobile_describe_ui", {
    title: "Read simulator UI", description: "Read the selected booted simulator's accessibility tree and frames in device points before sending input.",
    inputSchema: deviceInput, annotations: read,
  }, guarded(async ({ udid }: { udid: string }) => {
    await baguette.device(udid, true);
    const tree = await baguette.json(`/simulators/${udid}/describe-ui.json`);
    return result({ udid, tree }, JSON.stringify(tree));
  }));

  server.registerTool("mobile_send_input", {
    title: "Send simulator input", description: "Send a tap, swipe, hardware button, key, or printable US-ASCII text to a booted simulator. Read its UI first. Width and height must match the device screen in points.",
    inputSchema: { ...deviceInput, input: inputSchema }, annotations: write,
  }, guarded(async ({ udid, input }: { udid: string; input: z.infer<typeof inputSchema> }) => {
    await baguette.device(udid, true);
    const blocked = await blockedInput(udid);
    if (blocked) return blocked;
    const acknowledgement = await baguette.json(`/simulators/${udid}/input`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    return result({ udid, acknowledgement }, "Baguette accepted the input. Read the screen to confirm the result.");
  }));

  registerAppTool(server, "mobile_repair_input", {
    title: "Repair simulator input",
    description: "Reclaim input blocked by Xcode 27 Device Hub. Restarts backboardd and SpringBoard and closes running simulator apps. Use when the user asks to fix blocked input or when the panel detects blocked input.",
    inputSchema: deviceInput, annotations: { ...write, destructiveHint: true },
    _meta: { ui: { visibility: ["app", "model"] } },
  }, guarded(async ({ udid }: { udid: string }) => {
    await baguette.device(udid, true);
    streams.closeDevice(udid);
    const inputStatus = await simulatorInput.repair(udid);
    return result({ udid, inputStatus }, "Simulator input is ready. Reconnect the stream and reopen the app if needed.");
  }));

  async function captureScreenshot(udid: string) {
    await baguette.device(udid, true);
    const response = await fetch(new URL(`/simulators/${udid}/screenshot.png`, baguette.baseUrl), {
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Screenshot failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error("Baguette returned an invalid or oversized PNG screenshot.");
    }
    return bytes;
  }

  server.registerTool("mobile_screenshot", {
    title: "Capture simulator screen", description: "Return a PNG screenshot of the selected booted simulator for the model to inspect.",
    inputSchema: deviceInput, annotations: read,
  }, guarded(async ({ udid }: { udid: string }) => {
    const bytes = await captureScreenshot(udid);
    return { content: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }, { type: "text", text: `Screen of ${udid}.` }], structuredContent: { udid } };
  }));

  registerAppTool(server, "mobile_capture_screenshot", {
    title: "Screenshot to chat and clipboard",
    description: "Capture the selected booted simulator as a PNG and copy it to the macOS clipboard. Returns the same image for the panel to attach to the chat input.",
    inputSchema: deviceInput, annotations: write,
    _meta: { ui: { resourceUri: APP_URI, visibility: ["app"] } },
  }, guarded(async ({ udid }: { udid: string }) => {
    const bytes = await captureScreenshot(udid);
    let copied = false;
    let clipboardError: string | undefined;
    try { await copyScreenshot(bytes); copied = true; }
    catch (error) { clipboardError = errorMessage(error); }
    return {
      content: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }],
      structuredContent: { udid, copied, ...(clipboardError ? { clipboardError } : {}) },
    };
  }));

  registerAppTool(server, "mobile_stream_session", {
    title: "Connect simulator stream", description: "Open the bundled Baguette's MJPEG capture for the panel. Frames and input use the host's MCP bridge; no browser network access is needed.",
    inputSchema: { ...deviceInput, fps: z.number().int().min(1).max(60).default(60) },
    annotations: write,
    _meta: { ui: { resourceUri: APP_URI, visibility: ["app"] } },
  }, guarded(async ({ udid, fps }: { udid: string; fps: number }) => {
    const definition = await baguette.definition(udid);
    const bezel = await readBezel(baguette, udid, definition.screen);
    const { inputStatus, inputRepairMessage } = await panelInputStatus(udid);
    const sessionId = await streams.open(udid, fps);
    return {
      ...result({ udid, definition, fps, inputStatus, ...(inputRepairMessage ? { inputRepairMessage } : {}) }, `Stream ready for ${definition.identity.name}.`),
      _meta: { ...(bezel ? { bezel } : {}), sessionId, frameUri: `mobile-frame://${sessionId}/latest?after=0` },
    };
  }));

  registerAppTool(server, "mobile_stream_input", {
    title: "Send panel input", description: "Send a batch of validated gestures, keys, or buttons to an authorized panel stream.",
    inputSchema: { sessionId: sessionIdSchema, messages: z.array(streamMessageSchema).min(1).max(64) },
    annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ sessionId, messages }: { sessionId: string; messages: unknown[] }) => {
    if (streams.connectionState(sessionId) === "reconnecting") return {
      isError: true, content: [{ type: "text", text: "The simulator stream is reconnecting." }], _meta: { streamDisconnected: true },
    };
    const udid = streams.deviceId(sessionId);
    const blocked = await blockedInput(udid);
    if (blocked) {
      streams.closeDevice(udid);
      return { isError: true, content: [{ type: "text", text: "Repairing simulator input and reconnecting…" }], _meta: { streamDisconnected: true } };
    }
    const accepted = await streams.input(sessionId, messages);
    return result({ accepted }, "Input sent to the simulator.");
  }));

  registerAppTool(server, "mobile_stream_close", {
    title: "Close panel stream", description: "Stop one panel's simulator capture without shutting down its device.",
    inputSchema: { sessionId: sessionIdSchema },
    annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ sessionId }: { sessionId: string }) => {
    streams.closeSession(sessionId);
    return result({}, "Simulator stream closed.");
  }));

  registerAppTool(server, "mobile_stream_reset", {
    title: "Recover iOS panel video", description: "Restart one panel's MJPEG capture after a decode error, keeping its session and frame sequence. Does not boot a device or repair input.",
    inputSchema: { sessionId: sessionIdSchema },
    annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ sessionId }: { sessionId: string }) => {
    streams.reset(sessionId);
    return result({}, "Restarting simulator capture.");
  }));

  return {
    server,
    async close() {
      closeAndroid(); streams.close();
      try { await Promise.all([logs.close(), cpu.close()]); }
      finally { baguette.dispose(); await server.close(); }
    },
  };
}
