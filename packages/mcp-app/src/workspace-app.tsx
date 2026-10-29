import { App } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Workspace } from "./components/workspace";
import { DisplayModeButton } from "./components/display-mode-button";
import { ContextAttachments } from "./components/context-attachments";
import { panelTargetSchema } from "@mobile-dev/shared/panel-target.ts";
import { DeviceWorkspace } from "@mobile-dev/ui/device-workspace.ts";
import { WorkspaceTools } from "@mobile-dev/ui/workspace-tools.ts";
import { startLiveReload } from "./live-reload.ts";
import { ErrorBoundary, captureUiError, startUiTelemetry, stopUiTelemetry } from "@mobile-dev/ui/telemetry.ts";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { RecordingController } from "@mobile-dev/ui/recording-controller.ts";
import type { WorkspaceOptions } from "./workspace-extension.ts";
import { runMcpView } from "./mcp-view.ts";

/**
 * Starts the device workspace: the panel MCP Apps hosts open beside the chat, or over
 * it when `fullscreen`.
 */
export function startWorkspaceApp(options: WorkspaceOptions = {}, { fullscreen }: { fullscreen: boolean }) {
  const app = new App({ name: "mobile-dev-ui", version: PLUGIN_VERSION }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: false });
  startUiTelemetry(app);
  const extensions = new OpenAIExtensions(app);
  // Codex shows context as composer attachments through OpenAI's extension.
  const attachments = () => extensions.modelContext;
  const panels = WorkspaceTools.create(app, attachments);
  const recordingController = new RecordingController(app, { attachments, workspace: true });
  const extension = options.extension?.(app);
  const devices = new DeviceWorkspace(app, panels, { connectionFailed });
  const reactRoot = createRoot(document.getElementById("root")!);
  flushSync(() => {
    reactRoot.render(<ErrorBoundary fallback={<p role="alert">Mobile Dev could not render. Reopen the panel to try again.</p>}>
      <Workspace panels={panels} devices={devices.panels} recordingController={recordingController} banner={extension?.banner} displayModeControl={options.displayModeControl === false ? undefined : <DisplayModeButton app={app} />} contextControl={<ContextAttachments context={panels.context} />} fullscreen={fullscreen} />
    </ErrorBoundary>);
  });

  if (fullscreen) panels.logs.openForSplitLayout();

  let stopLiveReload = () => {};
  let disposingUI: Promise<void> | undefined;
  // Live reload disposes without closing the view, then replaces the document.
  function disposeUI() {
    return disposingUI ??= (async () => {
      window.removeEventListener("focus", resumeContext);
      window.removeEventListener("pageshow", resumeContext);
      document.removeEventListener("visibilitychange", resumeContext);
      recordingController.dispose();
      extension?.dispose();
      await Promise.allSettled([devices.dispose(), panels.dispose()]);
      reactRoot.unmount();
      await stopUiTelemetry();
    })();
  }

  // MCP Apps sizing: fill fullscreen, a fixed container height, or a host that sends
  // no dimensions. A container without a fixed height sizes to the app, so choose an
  // inline height within its maxHeight and report it.
  let reportedInlineHeight: number | undefined;
  function fitContainer(host: ReturnType<App["getHostContext"]>) {
    const dimensions = host?.containerDimensions;
    const flexible = host?.displayMode !== "fullscreen" && !!dimensions && !("height" in dimensions);
    const maximum = flexible && "maxHeight" in dimensions ? dimensions.maxHeight : undefined;
    const height = flexible ? Math.min(600, typeof maximum === "number" && maximum > 0 ? maximum : 600) : undefined;
    const root = document.documentElement;
    root.style.setProperty("--workspace-height", height ? `${height}px` : "100dvh");
    root.style.setProperty("--workspace-bottom-inset", `${host?.safeAreaInsets?.bottom ?? 0}px`);
    if (height === reportedInlineHeight) return;
    reportedInlineHeight = height;
    if (height) void app.sendSizeChanged({ height }).catch(error => captureUiError(error, "workspace.resize"));
  }
  function hostContext(host: ReturnType<App["getHostContext"]>) {
    if (disposingUI) return;
    panels.hostChanged();
    recordingController.hostChanged();
    devices.refit();
    fitContainer(host);
  }
  function resumeContext() {
    if (document.visibilityState !== "hidden" && !disposingUI) {
      panels.context.hostChanged();
      panels.context.resume();
    }
  }
  window.addEventListener("focus", resumeContext);
  window.addEventListener("pageshow", resumeContext);
  document.addEventListener("visibilitychange", resumeContext);
  function connectionFailed(error: unknown) {
    captureUiError(error, "host.connect");
    const message = error instanceof Error ? error.message : "Could not connect to the host.";
    devices.notice(message);
  }
  function openDevices(input: unknown) {
    const target = panelTargetSchema.safeParse(input);
    if (target.success === false) {
      const error = new Error("Mobile Dev received an invalid opening target.");
      connectionFailed(error);
      return;
    }
    void devices.open(target.data).catch(connectionFailed);
  }
  app.ontoolinput = input => {
    if (input.arguments && "recordingId" in input.arguments) return;
    openDevices(input.arguments ?? {});
  };
  app.ontoolresult = result => {
    // mobile_open_performance_recording sends the recording's ID (older servers send the recording).
    if (result.structuredContent?.recording !== undefined || result.structuredContent?.recordingId !== undefined) {
      try { recordingController.accept(result); }
      catch (error) { captureUiError(error, "recording.workspace_result"); }
      return;
    }
    if (result.isError) {
      const message = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
      devices.notice(message);
      return;
    }
    if (result.structuredContent && "panelTarget" in result.structuredContent) openDevices(result.structuredContent.panelTarget);
  };
  runMcpView({
    app,
    onHost: hostContext,
    onConnect: async () => {
      const capabilities = app.getHostCapabilities();
      const available = !!capabilities?.serverTools && !!capabilities?.serverResources;
      panels.setAvailable(available);
      extension?.setAvailable(available);
      if (!available) devices.notice("This host cannot call the plugin's simulator tools.");
      if (available) {
        stopLiveReload = startLiveReload(app, disposeUI);
      }
      await devices.setAvailable(available);
    },
    connectFailed: connectionFailed,
    dispose: () => { stopLiveReload(); return disposeUI(); },
  });
}
