import { parseResourceInput } from "./resource-input.ts";
import { openRequestSession } from "./request-session.ts";
import type { ServerRequestContext } from "./request-session.ts";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { SENTRY_ORIGIN } from "@mobile-dev/shared/telemetry.ts";
import { errorMessage, streamMessageSchema, udidSchema } from "@mobile-dev/shared/protocol.ts";
import { panelTargetSchema } from "@mobile-dev/shared/panel-target.ts";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { registerEarlierReleases } from "./earlier-releases.ts";
import { readBezel } from "./bezel.ts";
import { Baguette } from "./baguette.ts";
import type { ServeEmu } from "./serve-emu.ts";
import { registerAndroidTools } from "./android-tools.ts";
import { registerIosMirrorTools } from "./ios-mirror-tools.ts";
import { registerInspectionTools } from "./inspection-tools.ts";
import { registerDeviceSettingsTools } from "./device-settings.ts";
import { StreamSessions } from "./stream-sessions.ts";
import type { CpuSessions } from "./cpu/sessions.ts";
import type { DisplayFpsSessions } from "./fps/sessions.ts";
import { SimulatorInputService } from "./simulator-input.ts";
import type { InputStatus, SimulatorInput } from "./simulator-input.ts";
import { retryableFailure } from "./simulator-unavailable.ts";
import { copyPNGToClipboard } from "./clipboard.ts";
import { sessionIdSchema } from "./session-registry.ts";
import { guarded as guardedTool, jsonResult, READ_ONLY as read, WRITES as write } from "./tool-results.ts";
import { assertPng, MAX_SCREENSHOT_BYTES, screenshotResult } from "./png.ts";
import { registerPanelAppControlTools } from "./app-control/tools.ts";
import type { DriverFactory } from "./app-control/tools.ts";
import { registerOpenRecordingTool } from "./recording-tools.ts";
import type { ShowRecording } from "./recording-tools.ts";
import { foregroundSimulatorPid } from "./device-apps/foreground.ts";
import type { SimulatorForeground } from "./device-apps/foreground.ts";

export const APP_URI = `ui://mobile-dev/${PLUGIN_VERSION}/simulator.html`;
export const WORKSPACE_URI = `ui://mobile-dev/${PLUGIN_VERSION}/workspace.html`;
// Earlier releases' addresses serve the current UI (see registerEarlierReleases); these
// older addresses do not fit that pattern.
const unversionedAppUris = ["ui://mobile-dev/simulator.html", "ui://mobile-dev/0.1.24/mcp-stream/simulator.html"];
const unversionedWorkspaceUris = ["ui://mobile-dev/workspace.html", "ui://mobile-dev/0.1.24/mcp-stream/workspace.html"];
const deviceInput = { udid: udidSchema.describe("A simulator UDID returned by mobile_list_simulators.") };
const deviceSchema = z.object({ udid: udidSchema, name: z.string(), state: z.string(), runtime: z.string() });
const statusOutput = {
  connected: z.boolean(), managed: z.boolean(), baseUrl: z.string(),
  devices: z.array(deviceSchema), error: z.string().optional(),
};

const result = (data: Record<string, unknown>, message: string) => jsonResult(data, message);
const guarded = <T>(handler: (input: T, context: ServerRequestContext) => Promise<CallToolResult>) => guardedTool({ operation: "simulator.tool", retryable: true }, handler);

const INSTRUCTIONS = "For mobile app development, open mobile_open_simulator before the first device launch, or reuse the open view. Use selected device IDs. Control apps with the device_* tools when the server has them. When the user asks to see their devices, open or reuse the view, whose device menu lists them. If a task has ambiguous device targets, ask the user with mobile_choose_devices when it is available, otherwise in chat; proceed only after they choose. For a local CPU or React profile path, use mobile_analyze_profile to show TraceSift findings, then wait for the user to choose Investigate. See the Mobile Dev skill, when installed, for device control, logs, profiles, and performance workflows.";

/** Mobile Dev's own device views, which a host adds to the server it runs (see createPanel). */
export type Panel = {
  instructions: string;
  simulatorForeground: SimulatorForeground;
  register(server: McpServer, shared: PanelShared): () => Promise<void>;
};

/** What the server shares with its panel. */
export type PanelShared = {
  android: ServeEmu;
  cpu: CpuSessions;
  fps: DisplayFpsSessions;
  drivers: DriverFactory;
  /** The page every view loads, configured for this server. */
  page(): Promise<string>;
  showRecording: ShowRecording;
};

/** Services the panel runs on; tests replace them with fakes. */
export type PanelOptions = {
  baguette?: Baguette;
  simulatorInput?: SimulatorInput;
  copyScreenshot?: typeof copyPNGToClipboard;
};

/**
 * Mobile Dev's live device panel and workspace with the tools only they use: device
 * streams and input, screenshots, UI inspection, device settings, physical iPhone
 * mirroring, Baguette's simulator controls, the App tab's reads, opening recordings in
 * the workspace and asking for devices in a native form. Hosts that show devices
 * themselves, such as Claude, leave it out.
 */
export function createPanel({ baguette = new Baguette(), simulatorInput, copyScreenshot = copyPNGToClipboard }: PanelOptions = {}): Panel {
  return {
    instructions: INSTRUCTIONS,
    simulatorForeground: foregroundSimulatorPid,
    register: (server, shared) => registerPanel(server, shared, {
      baguette, copyScreenshot, simulatorInput: simulatorInput ?? new SimulatorInputService(udid => baguette.repairInput(udid)),
    }),
  };
}

function registerPanel(server: McpServer, { android, cpu, fps, drivers, page, showRecording }: PanelShared,
  { baguette, simulatorInput, copyScreenshot }: Required<PanelOptions>) {
  const streams = new StreamSessions(baguette);
  const closeIosMirror = registerIosMirrorTools(server, APP_URI);
  const closeInspection = registerInspectionTools(server, baguette, android);
  const closeAndroid = registerAndroidTools(server, android, APP_URI, copyScreenshot, async deviceId => {
    const closeCpu = cpu.closeDevice(deviceId);
    const closeFps = fps.closeDevice(deviceId);
    await Promise.all([closeCpu, closeFps]);
  });
  const closeDeviceSettings = registerDeviceSettingsTools(server, baguette, android);
  registerPanelAppControlTools(server, drivers);
  registerOpenRecordingTool(server, showRecording, WORKSPACE_URI);

  const readApp = async (uri: URL): Promise<ReadResourceResult> => {
    const content = await page();
    return { contents: [{
      uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: uri.href.endsWith("/workspace.html")
        ? content.replace('data-view="panel"', 'data-view="workspace"').replace('data-layout="stacked"', 'data-layout="split"')
        : content,
      _meta: {
        ui: { permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } },
        "openai/ui": { preferredDisplayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] },
      },
    }] };
  };

  type PanelInputStatus = { inputStatus: InputStatus; inputRepairMessage?: string };
  const automaticRepairs = new Map<string, { attemptedAt: number; pending: Promise<PanelInputStatus> }>();
  async function panelInputStatus(udid: string): Promise<PanelInputStatus> {
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

  registerAppResource(server, "mobile-dev-simulator", APP_URI, {}, readApp);
  registerAppResource(server, "mobile-dev-workspace", WORKSPACE_URI, {}, readApp);
  for (const [index, uri] of [...unversionedAppUris, ...unversionedWorkspaceUris].entries()) {
    registerAppResource(server, `mobile-dev-unversioned-${index}`, uri, {}, readApp);
  }
  registerEarlierReleases(server, "mobile-dev-simulator-earlier", "simulator", readApp);
  registerEarlierReleases(server, "mobile-dev-workspace-earlier", "workspace", readApp);

  const frameTemplate = new ResourceTemplate("mobile-frame://{sessionId}/latest{?after}", { list: undefined });
  server.registerResource("simulator-latest-frame", frameTemplate, { mimeType: "image/jpeg" }, async (uri, variables, extra) => {
    const sessionId = parseResourceInput(sessionIdSchema, variables.sessionId);
    const cursor = uri.searchParams.get("after") ?? "0";
    const cursorSchema = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
    const after = parseResourceInput(cursorSchema, cursor);
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
      const text = JSON.stringify({ state: "failed", error: errorMessage(error), retryable: retryableFailure(error) });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    }
  });

  const openPanel = guarded(async (panelTarget: PanelTarget) => {
    let status;
    try { status = await baguette.start(); }
    catch (error) {
      // The start already waited on the device list, so don't wait its full timeout again.
      const fallback = await baguette.status(AbortSignal.timeout(2000));
      status = { ...fallback, error: errorMessage(error) };
    }
    return result({ ...status, panelTarget }, status.connected ? `Found ${status.devices.length} simulators.` : status.error ?? "The bundled simulator backend could not start.");
  });

  registerAppTool(server, "mobile_open_workspace", {
    title: "Mobile Dev",
    description: "Open the Mobile Dev workspace, with logs and performance tools beside the devices, when the user asks for fullscreen or for those tools. It opens fullscreen where the host supports it. Pass established platform, kind, or discovered deviceId to select the initial device; omit undecided fields. For app development alongside a chat, prefer mobile_open_simulator. Starts the bundled backend without booting a device.",
    inputSchema: panelTargetSchema, outputSchema: { ...statusOutput, panelTarget: panelTargetSchema }, annotations: write,
    _meta: {
      ui: { resourceUri: WORKSPACE_URI, visibility: ["app", "model"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    },
  }, openPanel);

  registerAppTool(server, "mobile_open_simulator", {
    title: "Mobile Dev",
    description: "Open Mobile Dev alongside the chat for local mobile app development, before the first device launch unless a view is open or the workflow is tool-only. Pass established platform, kind, or discovered deviceId to select the initial device; omit undecided fields. Starts the bundled backend without booting devices.",
    inputSchema: panelTargetSchema, outputSchema: { ...statusOutput, panelTarget: panelTargetSchema }, annotations: write,
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
      description: action === "boot"
        ? "Boot an installed iOS simulator chosen for the app task. Follow the user's choice or choose a suitable device from the list when none runs. Reuse a suitable running device. Use a UDID from the device list."
        : "Shut down the selected simulator. Use a UDID from the device list.",
      inputSchema: deviceInput, outputSchema: statusOutput,
      annotations: { ...write, destructiveHint: action === "shutdown" },
    }, guarded(async ({ udid }: { udid: string }) => {
      if (action === "shutdown") await cpu.closeDevice(udid);
      const status = await baguette.changeDeviceState(udid, action);
      if (action === "shutdown") streams.closeDevice(udid);
      return result(status, `${action === "boot" ? "Booted" : "Shut down"} ${udid}.`);
    }));
  }

  // The panel's annotations fall back to this tree; the agent reads screens with device_snapshot.
  registerAppTool(server, "mobile_describe_ui", {
    title: "Read simulator UI", description: "Read the selected booted simulator's accessibility tree and frames in device points.",
    inputSchema: deviceInput, annotations: read, _meta: { ui: { visibility: ["app"] } },
  }, guarded(async ({ udid }: { udid: string }) => {
    await baguette.device(udid, true);
    const tree = await baguette.describeUi(udid);
    return result({ udid, tree }, JSON.stringify(tree));
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
    return assertPng(Buffer.from(await response.arrayBuffer()), MAX_SCREENSHOT_BYTES, "Baguette");
  }

  registerAppTool(server, "mobile_capture_screenshot", {
    title: "Screenshot to chat and clipboard",
    description: "Capture the selected booted simulator as a PNG and copy it to the macOS clipboard. Returns the same image for the panel to attach to the chat input.",
    inputSchema: deviceInput, annotations: write,
    _meta: { ui: { resourceUri: APP_URI, visibility: ["app"] } },
  }, guarded(async ({ udid }: { udid: string }) => {
    const bytes = await captureScreenshot(udid);
    return screenshotResult(bytes, { udid }, { copy: copyScreenshot, operation: "simulator.clipboard" });
  }));

  registerAppTool(server, "mobile_stream_session", {
    title: "Connect simulator stream", description: "Open the bundled Baguette's MJPEG capture for the panel. Frames and input use the host's MCP bridge; no browser network access is needed.",
    inputSchema: { ...deviceInput, fps: z.number().int().min(1).max(60).default(60) },
    annotations: write,
    _meta: { ui: { resourceUri: APP_URI, visibility: ["app"] } },
  }, guarded(async ({ udid, fps }: { udid: string; fps: number }, context) => {
    context.signal.throwIfAborted();
    const definition = await baguette.definition(udid);
    const bezel = await readBezel(baguette, udid, definition.screen);
    const { inputStatus, inputRepairMessage } = await panelInputStatus(udid);
    const sessionId = await openRequestSession(context.signal, () => streams.open(udid, fps), id => streams.closeSession(id));
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

  return async () => {
    // Clearing Android throttles waits on adb, so it runs alongside the other cleanup.
    const deviceSettingsClosed = closeDeviceSettings();
    closeInspection(); closeAndroid(); streams.close();
    try { await Promise.all([closeIosMirror(), deviceSettingsClosed]); }
    finally { baguette.dispose(); }
  };
}
