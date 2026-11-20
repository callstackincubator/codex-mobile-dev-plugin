import type { App } from "@modelcontextprotocol/ext-apps";
import type { WorkspaceExtension } from "@mobile-dev/mcp-app/workspace-extension.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { captureUiError } from "@mobile-dev/ui/telemetry.ts";
import type { PanelSelection } from "../shared/panel-selection.ts";
import { PluginUpdateBanner } from "./plugin-update-banner.tsx";
import { PluginUpdateController } from "./plugin-updates.ts";

function panelDevice(device: SimulatorDevice): PanelSelection["devices"][number] {
  const platform = device.platform ?? "ios";
  const virtualKind = platform === "ios" ? "simulator" : "emulator";
  const kind = device.kind ?? virtualKind;
  const result = { platform, kind, deviceId: device.udid, name: device.name, runtime: device.runtime, state: device.state };
  if (device.kind === "physical") return { ...result, transportType: device.transportType };
  return result;
}

export function codexWorkspace(app: App): WorkspaceExtension {
  const updates = new PluginUpdateController(app);
  let panelId: string | undefined;
  let selection: PanelSelection = { devices: [] };
  let available = false;
  let pending: PanelSelection | undefined;
  let delivery = Promise.resolve();

  function report(value?: PanelSelection) {
    if (value !== undefined && value === pending) return;
    pending = value;
    panelId ??= crypto.randomUUID();
    const args = { panelId, ...value };
    delivery = delivery.then(async () => {
      try {
        const result = await app.callServerTool({ name: "mobile_set_panel_selection", arguments: args }, { timeout: 5000 });
        if (result.isError) {
          const error = new Error("Panel selection update was rejected.");
          captureUiError(error, "panel.selection");
        }
      } catch {
        // The instrumented MCP call reports transport errors. Resuming the panel retries the selection.
      } finally {
        if (pending === value) pending = undefined;
      }
    });
  }

  function sync() {
    if (available) report(selection);
  }

  return {
    banner: <PluginUpdateBanner controller={updates} />,
    setAvailable(canCallTools) {
      updates.setAvailable(canCallTools);
      const capabilities = app.getHostCapabilities();
      available = canCallTools && capabilities?.experimental?.["openai/modelContext"] !== undefined;
      sync();
    },
    onSelectionChange(selected, active) {
      const devices = selected.map(panelDevice);
      selection = { devices, activeDeviceId: active?.udid };
      sync();
    },
    resume: sync,
    dispose() {
      updates.dispose();
      if (available) report();
      available = false;
      return delivery;
    },
  };
}
