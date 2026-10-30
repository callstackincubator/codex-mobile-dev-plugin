import type { UIResource } from "./ui-resource.ts";
import type { PageDisplay, PanelOpener, ReadPage, ServerFeature, ServerServices } from "./server-feature.ts";
import type { SharedTransport } from "./shared-transport.ts";
import { PHONE_ICONS, toolIcons } from "./tool-icons.ts";
import { LIVE_UI_URI } from "@mobile-dev/shared/live-ui.ts";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { SENTRY_ORIGIN } from "@mobile-dev/shared/telemetry.ts";
import { captureServerError, instrumentMcpServer, setServerTelemetryHost } from "./telemetry.ts";
import { resolveTelemetryEnvironment } from "./telemetry-environment.ts";
import { getTelemetryIdentity } from "./telemetry-identity.ts";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createDrivers, registerAppControlTools } from "./app-control/tools.ts";
import { systemCommands } from "./app-control/commands.ts";
import { registerAppStorageTools } from "./app-storage/tools.ts";
import { ServeEmu } from "./serve-emu.ts";
import { registerIosDeviceTools } from "./ios-devices.ts";
import { LogSessions } from "./log-sessions.ts";
import { registerLogTools } from "./log-tools.ts";
import { CpuSessions, createCpuSessions } from "./cpu/sessions.ts";
import { registerCpuTools } from "./cpu/tools.ts";
import { deviceAppSources, readDeviceApps } from "./device-apps/sources.ts";
import { unknownSimulatorForeground } from "./device-apps/foreground.ts";
import { PerformanceRecordings } from "./performance-recordings.ts";
import { registerRecordingTools } from "./recording-tools.ts";
import { RECORDING_URI } from "@mobile-dev/shared/recordings.ts";
import { COMPARISON_URI } from "@mobile-dev/shared/performance-comparison.ts";
import { TRACESIFT_URI } from "@mobile-dev/shared/tracesift.ts";
import { TraceSiftClient } from "./tracesift-client.ts";
import { registerTraceSiftTools } from "./tracesift-tools.ts";
import { startStorageMetrics } from "./storage-metrics.ts";
import { DisplayFpsSessions } from "./fps/sessions.ts";
import { registerDisplayFpsTools } from "./fps/tools.ts";
import { registerEarlierReleases } from "./earlier-releases.ts";
import { Simctl } from "./simctl.ts";
import { DeviceSessions } from "./device-sessions.ts";
import { DeviceResolver } from "./devices.ts";

// Servers without the panel serve hosts that show devices themselves, when they can.
const INSTRUCTIONS = "For mobile app development, read logs, record CPU, memory and FPS, and inspect app storage with these tools; control devices with the device_* tools when the server has them. Mobile Dev shows no device view here: when the user asks to open or see a simulator or emulator, use the host's own simulator view if it has one, such as Claude Code's iOS Simulator or Android Emulator. Use device IDs from tool results; never invent them. If a task has ambiguous device targets, ask the user with your own question tool when you have one, otherwise in chat; proceed only after they choose. Show recordings with mobile_render_performance_recording and comparisons with mobile_compare_performance_recordings. For a local CPU or React profile path, use mobile_analyze_profile to show TraceSift findings. See the Mobile Dev skill, when installed, for logs, profiles, and performance workflows.";

/** Gives a served UI page the server's telemetry environment, opt-out and anonymous identity. */
export function configureUI(content: string): string {
  const telemetryEnvironment = resolveTelemetryEnvironment();
  const identity = getTelemetryIdentity();
  const enabled = identity ? "on" : "off";
  const identityMeta = identity
    ? `<meta name="mobile-dev-user-id" content="${identity.userId}"><meta name="mobile-dev-session-id" content="${identity.sessionId}">`
    : "";
  const metadata = `<meta name="mobile-dev-environment" content="${telemetryEnvironment}"><meta name="mobile-dev-telemetry" content="${enabled}">${identityMeta}`;
  return content.replace(/<meta name="mobile-dev-environment" content="(?:development|release)">/, metadata);
}

/** Services the server runs on; tests replace them with fakes. */
export type PluginOptions = {
  simulators?: Simctl;
  logs?: LogSessions;
  android?: ServeEmu;
  cpu?: CpuSessions;
  /** What the host adds after the shared tools, in order, such as Mobile Dev's panel (createPanel). Hosts that show devices themselves leave the panel out. */
  features?: ServerFeature[];
  /** The transport the server will connect to, which features can let other connections join. */
  connections?: SharedTransport;
};

export function createPlugin(html: string | (() => Promise<UIResource>), options: PluginOptions = {}) {
  const { simulators = new Simctl(), logs = new LogSessions(), android = new ServeEmu(), features = [] } = options;
  const cpu = options.cpu ?? createCpuSessions();
  const fps = new DisplayFpsSessions();
  const devices = new DeviceSessions();
  for (const sessions of [logs, cpu, fps]) devices.add(deviceId => sessions.closeDevice(deviceId));
  const instructions = features.find(feature => feature.instructions !== undefined)?.instructions ?? INSTRUCTIONS;
  const server = new McpServer({ name: "mobile-dev", version: PLUGIN_VERSION }, { instructions });
  instrumentMcpServer(server, toolIcons({ mobile_open_workspace: PHONE_ICONS, mobile_open_simulator: PHONE_ICONS, mobile_choose_devices: PHONE_ICONS }));
  const initialized: (() => void)[] = [];
  server.server.oninitialized = () => {
    setServerTelemetryHost(server.server.getClientVersion()?.name);
    for (const listener of initialized) listener();
  };
  const simulatorForeground = features.find(feature => feature.simulatorForeground !== undefined)?.simulatorForeground ?? unknownSimulatorForeground;
  const drivers = createDrivers(systemCommands, simulatorForeground);
  const resolver = new DeviceResolver({ simulators });
  registerIosDeviceTools(server);
  registerLogTools(server, logs, resolver);
  registerCpuTools(server, cpu, resolver, {
    apps: (deviceId, signal, platform, kind) => readDeviceApps(deviceId, signal, platform, kind, { ...deviceAppSources, simulator: simulatorForeground }),
  });
  const recordings = new PerformanceRecordings(cpu, fps);
  const showRecording = registerRecordingTools(server, recordings, resolver);
  const traceSift = new TraceSiftClient();
  registerTraceSiftTools(server, traceSift);
  const stopRecordingStorageMetrics = startStorageMetrics({ recordings: recordings.store.directory });
  registerDisplayFpsTools(server, fps, resolver);
  registerAppControlTools(server, drivers);
  registerAppStorageTools(server, systemCommands, drivers);

  const resource = async () => typeof html === "string" ? { html } : await html();
  server.registerResource("mobile-dev-live", new ResourceTemplate(`${LIVE_UI_URI}?after={revision}`, { list: undefined }), {
    mimeType: "application/json",
    description: "Read a changed local development UI through MCP. Unchanged reads omit the HTML.",
  }, async uri => {
    const { html: content, liveRevision: revision } = await resource();
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({
      revision,
      html: revision && revision !== uri.searchParams.get("after") ? configureUI(content) : undefined,
    }) }] };
  });
  // Cards from a server with the workspace can open recordings there.
  const workspace = features.some(feature => feature.workspace);
  const servePage = (view: string, display: PageDisplay): ReadPage => async uri => {
    let content = configureUI((await resource()).html).replace('data-view="panel"', `data-view="${view}"${display === "inline" && workspace ? " data-workspace" : ""}`);
    if (view === "workspace") content = content.replace('data-layout="stacked"', 'data-layout="split"');
    return { contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: content, _meta: {
      ui: { ...(display === "inline" ? { prefersBorder: true } : {}), permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } },
      "openai/ui": { preferredDisplayMode: display, availableDisplayModes: ["inline", "fullscreen"] },
    } }] };
  };
  for (const [name, resourceUri, view] of [
    ["mobile-dev-recording", RECORDING_URI, "recording"],
    ["mobile-dev-comparison", COMPARISON_URI, "comparison"],
    ["mobile-dev-tracesift", TRACESIFT_URI, "tracesift"],
  ]) {
    registerAppResource(server, name, resourceUri, {}, servePage(view, "inline"));
    registerEarlierReleases(server, `${name}-earlier`, view, servePage(view, "inline"));
  }
  // Devices cards that chats saved from earlier releases say they came from one.
  registerEarlierReleases(server, "mobile-dev-devices-earlier", "devices", servePage("devices", "inline"));
  const panelOpeners: PanelOpener[] = [];
  const services: ServerServices = {
    closeDevice: deviceId => devices.closeDevice(deviceId), deviceSessions: devices, android, simulators, drivers, servePage, showRecording,
    onInitialized: listener => { initialized.push(listener); },
    connections: options.connections,
    onPanelOpen: opener => { panelOpeners.push(opener); },
    // One place shows the panel beyond the host; the first feature that offers one wins.
    panelOpening: async open => {
      const openings = await Promise.all(panelOpeners.map(opener => opener(open)));
      return openings.find(opening => opening !== undefined);
    },
  };
  const featureCleanups = features.flatMap(feature => feature.register(server, services) ?? []);

  return {
    server,
    async close() {
      const cleanups = await Promise.allSettled(featureCleanups.map(cleanup => Promise.resolve().then(cleanup)));
      for (const cleanup of cleanups) if (cleanup.status === "rejected") captureServerError(cleanup.reason, "plugin.feature_cleanup");
      stopRecordingStorageMetrics();
      // Recordings finish while the collectors they read are still open.
      await recordings.close();
      try { await Promise.all([logs.close(), cpu.close(), fps.close(), traceSift.close()]); }
      finally { android.dispose(); await server.close(); }
    },
  };
}
