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
import { registerAppControlTools } from "./app-control/tools.ts";
import { registerAppStorageTools } from "./app-storage/tools.ts";
import { ServeEmu } from "./serve-emu.ts";
import { Baguette } from "./baguette.ts";
import { listIosDevices, registerIosDeviceTools } from "./ios-devices.ts";
import { deviceChoiceFormSupport, registerDeviceChoiceTools } from "./device-choice-tools.ts";
import { LogSessions } from "./log-sessions.ts";
import { registerLogTools } from "./log-tools.ts";
import { CpuSessions, createCpuSessions } from "./cpu/sessions.ts";
import { registerCpuTools } from "./cpu/tools.ts";
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
import { SimulatorInputService } from "./simulator-input.ts";
import type { SimulatorInput } from "./simulator-input.ts";
import { copyPNGToClipboard } from "./clipboard.ts";
import { registerEarlierReleases } from "./earlier-releases.ts";
import { registerPanels, WORKSPACE_URI } from "./panel-tools.ts";
import { SimctlSimulators } from "./simulator-directory.ts";
import type { SimulatorDirectory } from "./simulator-directory.ts";

export { APP_URI, WORKSPACE_URI } from "./panel-tools.ts";

const PANEL_INSTRUCTIONS = "For mobile app development, open mobile_open_simulator before the first device launch, or reuse the open view. Use selected device IDs. When the user asks to see their devices, open or reuse the view, whose device menu lists them. If a task has ambiguous device targets, ask the user with mobile_choose_devices when it is available, otherwise in chat; proceed only after they choose. For a local CPU or React profile path, use mobile_analyze_profile to show TraceSift findings, then wait for the user to choose Investigate. See the Mobile Dev skill, when installed, for device control, logs, profiles, and performance workflows.";
// Hosts without the panel show devices themselves, when they can.
const TOOL_INSTRUCTIONS = "For mobile app development, read logs, record CPU, memory and FPS, and inspect app storage with these tools; control devices with the device_* tools when the server has them. Mobile Dev shows no device view here: when the user asks to open or see a simulator or emulator, use the host's own simulator view if it has one, such as Claude Code's iOS Simulator or Android Emulator. Use device IDs from tool results; never invent them. If a task has ambiguous device targets, ask the user with your own question tool when you have one, otherwise with mobile_choose_devices or in chat; proceed only after they choose. Show recordings with mobile_render_performance_recording and comparisons with mobile_compare_performance_recordings. For a local CPU or React profile path, use mobile_analyze_profile to show TraceSift findings. See the Mobile Dev skill, when installed, for logs, profiles, and performance workflows.";

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

/** Services the server runs on; tests replace them with fakes. `features` are the host's additions. */
export type PluginOptions = {
  /**
   * The live device panel and workspace with the tools only they use (see registerPanels).
   * Hosts that show devices themselves leave it out; the chat cards stay. Defaults to true.
   */
  panels?: boolean;
  baguette?: Baguette;
  /** Finds simulators without the panel's Baguette; defaults to simctl. */
  simulators?: SimulatorDirectory;
  simulatorInput?: SimulatorInput;
  logs?: LogSessions;
  android?: ServeEmu;
  copyScreenshot?: typeof copyPNGToClipboard;
  cpu?: CpuSessions;
  features?: ServerFeature[];
};

export async function createPlugin(html: string | (() => Promise<UIResource>), options: PluginOptions = {}) {
  const { panels = true, logs = new LogSessions(), android = new ServeEmu(), copyScreenshot = copyPNGToClipboard, features = [] } = options;
  const baguette = panels ? options.baguette ?? new Baguette() : undefined;
  const simulators: SimulatorDirectory = baguette ?? options.simulators ?? new SimctlSimulators();
  const cpu = options.cpu ?? await createCpuSessions();
  const fps = new DisplayFpsSessions();
  const server = new McpServer({ name: "mobile-dev", version: PLUGIN_VERSION }, {
    instructions: panels ? PANEL_INSTRUCTIONS : TOOL_INSTRUCTIONS,
  });
  instrumentMcpServer(server);
  addToolIcons(server, { mobile_open_workspace: PHONE_ICONS, mobile_open_simulator: PHONE_ICONS, mobile_choose_devices: PHONE_ICONS });
  const extensions = new OpenAIExtensions(server);
  // Device choices use the host's native form; the tool is listed only for hosts that render one.
  let deviceChoiceRegistered = false;
  server.server.oninitialized = () => {
    setServerTelemetryHost(server.server.getClientVersion()?.name);
    const form = deviceChoiceFormSupport(server.server.getClientCapabilities());
    if (deviceChoiceRegistered || form === undefined) return;
    deviceChoiceRegistered = true;
    registerDeviceChoiceTools(server, extensions, {
      simulators: () => simulators.start(), android: () => android.list(), physicalIos: listIosDevices,
    }, form);
  };
  registerIosDeviceTools(server);
  registerLogTools(server, logs, simulators);
  const validateCpuDevice = registerCpuTools(server, cpu, simulators);
  const recordings = new PerformanceRecordings(cpu, fps);
  registerRecordingTools(server, recordings, validateCpuDevice, panels ? WORKSPACE_URI : undefined);
  const traceSift = new TraceSiftClient();
  registerTraceSiftTools(server, traceSift);
  const stopRecordingStorageMetrics = startStorageMetrics({ recordings: recordings.store.directory });
  registerDisplayFpsTools(server, fps);
  registerAppControlTools(server, undefined, { panels });
  registerAppStorageTools(server);

  const readApp = async (uri: URL) => {
    const resource = typeof html === "string" ? { html } : await html();
    const content = configureUI(resource.html);
    return ({
    contents: [{
      uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: uri.href.endsWith("/workspace.html")
        ? content.replace('data-view="panel"', 'data-view="workspace"').replace('data-layout="stacked"', 'data-layout="split"')
        : content,
      _meta: {
        ui: { permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } },
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
      html: revision && revision !== uri.searchParams.get("after") ? configureUI(resource.html) : undefined,
    }) }] };
  });
  for (const [name, resourceUri, view] of [
    ["mobile-dev-recording", RECORDING_URI, "recording"],
    ["mobile-dev-comparison", COMPARISON_URI, "comparison"],
    ["mobile-dev-tracesift", TRACESIFT_URI, "tracesift"],
  ]) {
    const readCard = async (uri: URL) => {
      const resource = typeof html === "string" ? { html } : await html();
      const configured = configureUI(resource.html);
      // Cards from a server with the workspace can open recordings there.
      const content = configured.replace('data-view="panel"', `data-view="${view}"${panels ? " data-workspace" : ""}`);
      return { contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: content, _meta: {
        ui: { prefersBorder: true, permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } },
        "openai/ui": { preferredDisplayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] },
      } }] };
    };
    registerAppResource(server, name, resourceUri, {}, readCard);
    registerEarlierReleases(server, `${name}-earlier`, view, readCard);
  }

  const closePanels = baguette && registerPanels(server, {
    baguette, android, cpu, fps, copyScreenshot,
    simulatorInput: options.simulatorInput ?? new SimulatorInputService(udid => baguette.repairInput(udid)),
  }, readApp);
  const featureCleanups = features.flatMap(feature => feature(server) ?? []);

  return {
    server,
    async close() {
      await Promise.allSettled(featureCleanups.map(cleanup => cleanup()));
      stopRecordingStorageMetrics();
      const panelsClosed = closePanels?.();
      await recordings.close();
      try { await Promise.all([logs.close(), cpu.close(), fps.close(), traceSift.close(), panelsClosed]); }
      finally {
        baguette?.dispose();
        // The panel's Android tools dispose serve-emu themselves.
        if (closePanels === undefined) android.dispose();
        await server.close();
      }
    },
  };
}
