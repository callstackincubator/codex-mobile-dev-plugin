import type { UIResource } from "./ui-resource.ts";
import type { ServerFeature } from "./server-feature.ts";
import { addToolIcons, PHONE_ICONS } from "./tool-icons.ts";
import { LIVE_UI_URI } from "@mobile-dev/shared/live-ui.ts";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { SENTRY_ORIGIN } from "@mobile-dev/shared/telemetry.ts";
import { instrumentMcpServer, setServerTelemetryHost } from "./telemetry.ts";
import { resolveTelemetryEnvironment } from "./telemetry-environment.ts";
import { getTelemetryIdentity } from "./telemetry-identity.ts";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { OpenAIExtensions } from "@openai/mcp-extensions/server";
import { createDrivers, registerAppControlTools } from "./app-control/tools.ts";
import { systemCommands } from "./app-control/commands.ts";
import { registerAppStorageTools } from "./app-storage/tools.ts";
import { ServeEmu } from "./serve-emu.ts";
import { listIosDevices, registerIosDeviceTools } from "./ios-devices.ts";
import { deviceChoiceFormSupport, registerDeviceChoiceTools } from "./device-choice-tools.ts";
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
import type { Panel } from "./panel-tools.ts";

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

/**
 * Services the server runs on; tests replace them with fakes. `panel` is Mobile Dev's own
 * device views (see createPanel), which hosts that show devices themselves leave out;
 * `features` are the host's additions.
 */
export type PluginOptions = {
  panel?: Panel;
  simulators?: Simctl;
  logs?: LogSessions;
  android?: ServeEmu;
  cpu?: CpuSessions;
  features?: ServerFeature[];
};

export async function createPlugin(html: string | (() => Promise<UIResource>), options: PluginOptions = {}) {
  const { panel, simulators = new Simctl(), logs = new LogSessions(), android = new ServeEmu(), features = [] } = options;
  const cpu = options.cpu ?? await createCpuSessions();
  const fps = new DisplayFpsSessions();
  const server = new McpServer({ name: "mobile-dev", version: PLUGIN_VERSION }, { instructions: panel?.instructions ?? INSTRUCTIONS });
  instrumentMcpServer(server);
  addToolIcons(server, { mobile_open_workspace: PHONE_ICONS, mobile_open_simulator: PHONE_ICONS, mobile_choose_devices: PHONE_ICONS });
  const extensions = new OpenAIExtensions(server);
  server.server.oninitialized = () => {
    setServerTelemetryHost(server.server.getClientVersion()?.name);
    // The device form goes with Mobile Dev's own device views, for hosts that render one.
    const form = panel && deviceChoiceFormSupport(server.server.getClientCapabilities());
    if (form) registerDeviceChoiceTools(server, extensions, {
      simulators: () => simulators.list(), android: () => android.list(), physicalIos: listIosDevices,
    }, form);
  };
  const simulatorForeground = panel?.simulatorForeground ?? unknownSimulatorForeground;
  const drivers = createDrivers(systemCommands, simulatorForeground);
  registerIosDeviceTools(server);
  registerLogTools(server, logs, simulators);
  const validateCpuDevice = registerCpuTools(server, cpu, simulators, {
    apps: (deviceId, signal, platform, kind) => readDeviceApps(deviceId, signal, platform, kind, { ...deviceAppSources, simulator: simulatorForeground }),
  });
  const recordings = new PerformanceRecordings(cpu, fps);
  const showRecording = registerRecordingTools(server, recordings, validateCpuDevice);
  const traceSift = new TraceSiftClient();
  registerTraceSiftTools(server, traceSift);
  const stopRecordingStorageMetrics = startStorageMetrics({ recordings: recordings.store.directory });
  registerDisplayFpsTools(server, fps);
  registerAppControlTools(server, drivers);
  registerAppStorageTools(server);

  const resource = async () => typeof html === "string" ? { html } : await html();
  const page = async () => configureUI((await resource()).html);
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
  for (const [name, resourceUri, view] of [
    ["mobile-dev-recording", RECORDING_URI, "recording"],
    ["mobile-dev-comparison", COMPARISON_URI, "comparison"],
    ["mobile-dev-tracesift", TRACESIFT_URI, "tracesift"],
  ]) {
    const readCard = async (uri: URL) => {
      // Cards from a server with the workspace can open recordings there.
      const content = (await page()).replace('data-view="panel"', `data-view="${view}"${panel ? " data-workspace" : ""}`);
      return { contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: content, _meta: {
        ui: { prefersBorder: true, permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } },
        "openai/ui": { preferredDisplayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] },
      } }] };
    };
    registerAppResource(server, name, resourceUri, {}, readCard);
    registerEarlierReleases(server, `${name}-earlier`, view, readCard);
  }
  const closePanel = panel?.register(server, { android, cpu, fps, drivers, page, showRecording });
  const featureCleanups = features.flatMap(feature => feature(server) ?? []);

  return {
    server,
    async close() {
      await Promise.allSettled(featureCleanups.map(cleanup => cleanup()));
      stopRecordingStorageMetrics();
      // Recordings finish while the collectors they read are still open.
      await recordings.close();
      try { await Promise.all([logs.close(), cpu.close(), fps.close(), traceSift.close(), closePanel?.()]); }
      finally { android.dispose(); await server.close(); }
    },
  };
}
