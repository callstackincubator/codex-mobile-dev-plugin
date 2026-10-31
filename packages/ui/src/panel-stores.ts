import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { deviceSettingsResultSchema } from "@mobile-dev/shared/tool-results.ts";
import { AppToolsStore } from "./app-tools.ts";
import type { Platform } from "./device-discovery.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import { DeviceSettingsStore } from "./device-settings.ts";
import type { HostBridge } from "./host-bridge.ts";
import { ScreenAnnotationsStore } from "./screen-annotations.ts";
import type { ScreenSource } from "./screen-annotations.ts";
import { callTool } from "./tool-call.ts";

/** What a panel's stores act on: the device it shows, its frame and its screen. */
export type PanelStoreSource = ScreenSource & {
  device(): { selected?: SimulatorDevice; disposed: boolean };
  setFrame(visible: boolean): void;
};

/** The device settings, app tools and annotations a device panel owns, each acting on the panel's selected device. */
export function createPanelStores(app: HostBridge, platform: Platform, deviceApps: DeviceAppsStore, source: PanelStoreSource) {
  const settings = new DeviceSettingsStore({
    request: async change => {
      const { selected, disposed } = source.device();
      if (!selected || selected.state !== "Booted" || disposed) throw new Error("Select a running device first.");
      const params = { name: change ? "mobile_update_device_setting" : "mobile_device_settings", arguments: { target: { platform, id: selected.udid }, ...(change ? { change } : {}) } };
      return (await callTool(app, params, { timeout: 30000, schema: deviceSettingsResultSchema })).settings;
    },
    setFrame: visible => source.setFrame(visible),
  });
  const appTools = new AppToolsStore(async (name, args) => {
    const { selected, disposed } = source.device();
    if (!selected || disposed) throw new Error("Select a running device first.");
    return (await callTool(app, { name, arguments: args }, { timeout: 60000 })).structuredContent;
  }, device => deviceApps.installedApps(device));
  const annotations = new ScreenAnnotationsStore({ capture: () => source.capture(), readTree: simulator => source.readTree(simulator) });
  return { settings, appTools, annotations };
}
