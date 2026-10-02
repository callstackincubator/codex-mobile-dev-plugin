import type { App } from "@modelcontextprotocol/ext-apps";
import { DeviceAppsStore } from "../src/ui/device-apps.ts";

export class AppVisibility extends EventTarget {
  visibilityState = "visible";
  hide() { this.visibilityState = "hidden"; const event = new Event("visibilitychange"); this.dispatchEvent(event); }
  show() { this.visibilityState = "visible"; const event = new Event("visibilitychange"); this.dispatchEvent(event); }
}

export function createDeviceApps(app: App) {
  const visibility = new AppVisibility();
  return new DeviceAppsStore(app, visibility);
}
