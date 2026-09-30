import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { OpenAIExtensions } from "@openai/mcp-extensions/server";
import { z } from "zod";
import { readBezel } from "./bezel.ts";
import { Baguette } from "./baguette.ts";
import { StreamSessions } from "./stream-sessions.ts";
import { SharedStreamService } from "./shared-stream-service.ts";
import type { SharedStreaming } from "./shared-stream-service.ts";
import { MacLocalCertificate } from "./local-certificate.ts";
import type { LocalCertificate } from "./local-certificate.ts";
import { LogSessions } from "./log-sessions.ts";
import { registerLogTools } from "./log-tools.ts";
import { SimulatorInputService } from "./simulator-input.ts";
import type { SimulatorInput } from "./simulator-input.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { errorMessage, inputSchema, udidSchema } from "../shared/protocol.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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

export async function createPlugin(html: string, baguette = new Baguette(), simulatorInput: SimulatorInput = new SimulatorInputService(udid => baguette.repairInput(udid)), logs = new LogSessions(), certificate: LocalCertificate = new MacLocalCertificate(), shared: SharedStreaming = new SharedStreamService()) {
  const marker = "<!-- STREAM_CONFIG -->";
  if (html.includes(marker) === false) throw new Error("The panel bundle is missing its streaming configuration placeholder. Rebuild the plugin.");
  const streams = new StreamSessions(baguette, simulatorInput);
  await streams.start();
  const streamOrigin = shared.origin;
  const appUri = "ui://mobile-dev/0.1.18/shared-stream/simulator.html";
  const workspaceUri = "ui://mobile-dev/0.1.18/shared-stream/workspace.html";
  const config = `<meta id="stream-origin" content="${streamOrigin}">`;
  const resourceHtml = html.replace(marker, config);
  const server = new McpServer({ name: "mobile-dev", version: "0.1.18" }, {
    instructions: "Use mobile_list_simulators to get simulator UDIDs before acting. For app control, use the plugin's agent-device MCP tools with the same UDID and a named session. Prefer its snapshot refs and selectors for press, fill, and scroll. Baguette handles the panel stream and pointer input. Boot only a simulator the user selected. Read mobile_describe_ui or mobile_screenshot before sending coordinates. Coordinates use device points. Opening the panel does not boot a device.",
  });
  new OpenAIExtensions(server);
  registerLogTools(server, logs, baguette);

  async function blockedInput(udid: string): Promise<CallToolResult | undefined> {
    if ((await simulatorInput.status(udid)).state !== "blocked") return;
    return {
      isError: true,
      content: [{ type: "text", text: "Device Hub blocks simulator input. Repair input to continue; the repair closes running simulator apps." }],
      _meta: { inputBlocked: true },
    };
  }

  const readApp = async (uri: URL) => ({
    contents: [{
      uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: uri.href === workspaceUri
        ? resourceHtml.replace('data-view="panel"', 'data-view="workspace"').replace('data-layout="stacked"', 'data-layout="split"')
        : resourceHtml,
      _meta: {
        ui: { csp: { connectDomains: [streamOrigin], resourceDomains: [] } },
        "openai/ui": { preferredDisplayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] },
      },
    }],
  });
  registerAppResource(server, "mobile-dev-simulator", appUri, {}, readApp);
  registerAppResource(server, "mobile-dev-workspace", workspaceUri, {}, readApp);

  const openPanel = guarded(async () => {
    let status;
    try { status = await baguette.start(); }
    catch (error) { status = { ...await baguette.status(), error: errorMessage(error) }; }
    return result(status, status.connected ? `Found ${status.devices.length} simulators.` : status.error ?? "The bundled simulator backend could not start.");
  });

  registerAppTool(server, "mobile_open_workspace", {
    title: "Mobile Dev",
    description: "Open the fullscreen Mobile Dev workspace with logs on the left and the iOS simulator on the right. Starts the bundled backend without booting a device.",
    inputSchema: {}, outputSchema: statusOutput, annotations: write,
    _meta: {
      ui: { resourceUri: workspaceUri, visibility: ["app", "model"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    },
  }, openPanel);

  registerAppTool(server, "mobile_open_simulator", {
    title: "iOS Simulator",
    description: "Open the Mobile Dev simulator panel in Codex and start the plugin's bundled Baguette backend. Shows devices without booting any.",
    inputSchema: {}, outputSchema: statusOutput, annotations: write,
    _meta: {
      ui: { resourceUri: appUri, visibility: ["app", "model"] },
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
      await baguette.device(udid);
      await baguette.json(`/simulators/${udid}/${action}`, { method: "POST" }, 60000);
      return result(await baguette.status(), `${action === "boot" ? "Booted" : "Shut down"} ${udid}.`);
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
    description: "Reclaim input blocked by Xcode 27 Device Hub. Restarts backboardd and SpringBoard and closes running simulator apps. Use when the user asks to fix blocked input or clicks Repair input in the panel.",
    inputSchema: deviceInput, annotations: { ...write, destructiveHint: true },
    _meta: { ui: { visibility: ["app", "model"] } },
  }, guarded(async ({ udid }: { udid: string }) => {
    await baguette.device(udid, true);
    streams.closeDevice(udid);
    const inputStatus = await simulatorInput.repair(udid);
    return result({ udid, inputStatus }, "Simulator input is ready. Reconnect the stream and reopen the app if needed.");
  }));

  server.registerTool("mobile_screenshot", {
    title: "Capture simulator screen", description: "Return a PNG screenshot of the selected booted simulator for the model to inspect.",
    inputSchema: deviceInput, annotations: read,
  }, guarded(async ({ udid }: { udid: string }) => {
    await baguette.device(udid, true);
    const response = await fetch(new URL(`/simulators/${udid}/screenshot.png`, baguette.baseUrl), {
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Screenshot failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error("Baguette returned an invalid or oversized PNG screenshot.");
    }
    return { content: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }, { type: "text", text: `Screen of ${udid}.` }], structuredContent: { udid } };
  }));

  registerAppTool(server, "mobile_certificate_status", {
    title: "Check local streaming setup", description: "Read local certificate status without creating certificates or changing Keychain trust.",
    inputSchema: {}, annotations: read, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async () => {
    return result(await certificate.status(), "Local streaming certificate status.");
  }));

  registerAppTool(server, "mobile_setup_certificate", {
    title: "Set up local streaming", description: "Create a unique local certificate and request macOS Keychain trust for SSL to 127.0.0.1. Invoke only from the panel's setup button after the user reads the explanation.",
    inputSchema: {}, annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async () => {
    const status = await certificate.setup();
    const material = await certificate.material();
    if (material == null) throw new Error("The local streaming certificate is not trusted yet.");
    await shared.configureTls(material);
    return result(status, "Local streaming is ready.");
  }));

  registerAppTool(server, "mobile_stream_session", {
    title: "Connect simulator stream", description: "Authorize a local H.264 WebSocket stream for the panel. Video and gestures use the local TLS endpoint.",
    inputSchema: { ...deviceInput, fps: z.number().int().min(1).max(60).default(60) },
    annotations: write,
    _meta: { ui: { resourceUri: appUri, visibility: ["app"] } },
  }, guarded(async ({ udid, fps }: { udid: string; fps: number }) => {
    const certificateStatus = await certificate.status();
    if (certificateStatus.state !== "ready") return { isError: true, content: [{ type: "text", text: "Set up the local streaming certificate in the panel." }], _meta: { tlsRequired: true, retryable: false } };
    const material = await certificate.material();
    if (material == null) throw new Error("The local streaming certificate is unavailable.");
    await shared.configureTls(material);
    const definition = await baguette.definition(udid);
    const bezel = await readBezel(baguette, udid, definition.screen);
    const inputStatus = await simulatorInput.status(udid);
    const session = await streams.open(udid, fps);
    let streamUrl: string;
    try { streamUrl = await shared.publish(session.id, session.url); }
    catch (error) { streams.closeSession(session.id); throw error; }
    return {
      ...result({ udid, definition, fps, inputStatus }, `Stream ready for ${definition.identity.name}.`),
      _meta: { ...(bezel ? { bezel } : {}), sessionId: session.id, streamUrl },
    };
  }));

  registerAppTool(server, "mobile_stream_close", {
    title: "Close panel stream", description: "Stop one panel's simulator capture without shutting down its device.",
    inputSchema: { sessionId: sessionIdSchema },
    annotations: write, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ sessionId }: { sessionId: string }) => {
    await shared.closeSession(sessionId);
    streams.closeSession(sessionId);
    return result({}, "Simulator stream closed.");
  }));

  return {
    server, appUri, workspaceUri,
    async close() { await shared.close(); await streams.close(); await logs.close(); baguette.dispose(); await server.close(); },
  };
}
