import type { SimulatorDevice, Status } from "@mobile-dev/shared/protocol.ts";
import type { PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import { isDeviceActive, isPhysicalIos } from "@mobile-dev/shared/devices.ts";
import type { FrameLayout } from "./device-frame-layout.ts";
import type { InputAllowance } from "./device-input.ts";
import { streamTransports, transportFor } from "./stream-transports.ts";
import type { TransportKind } from "./stream-transports.ts";

/** What the stage shows: a message, the device's last frame, or that frame under the Device stopped overlay. */
export type PanelDisplay = { kind: "message"; title: string; description: string } | { kind: "frame" } | { kind: "stopped" };

/** The stream: none, open and waiting for a frame after opening or an interruption, or live and taking input. */
export type PanelLink = { kind: "closed" } | { kind: "waiting" | "live"; transport: TransportKind };

/** The one action running. Others started meanwhile are dropped, except a reconnect, which `resume` queues. */
export type PanelAction = "load" | "select" | "start" | "connect" | "screenshot" | "stop";

export type PanelState = {
  platform: "ios" | "android";
  /** The host can call the plugin's tools. */
  available: boolean;
  disposed: boolean;
  selected?: SimulatorDevice;
  status?: Status;
  physical: PhysicalIosDevice[];
  discoveryError: string;
  display: PanelDisplay;
  link: PanelLink;
  input: { blocked: boolean; repair: string };
  /** The latest message an event showed, until the next event restores the panel's own notice. */
  notice: string;
  /** A screenshot that could not be attached, shown until the next action. */
  screenshotError: string;
  pending?: PanelAction;
  resume: boolean;
  layout: FrameLayout;
  /** The panel the user last pointed at or focused, which logs and the chat follow. */
  active: boolean;
};

/** What the panel's annotations are doing, which takes precedence over device input. */
export type Selection = { selecting: boolean; draft: boolean; capture: boolean };
export type HostAbilities = { canAttach: boolean; canAttachScreenshots: boolean; canMessage: boolean };

export const deviceButtons = [{ action: "home", label: "Home" }, { action: "app-switcher", label: "App switcher" }] as const;
export type DeviceButton = typeof deviceButtons[number]["action"];

export type SimulatorPanelSnapshot = {
  active: boolean;
  display: PanelDisplay;
  notice: { message: string; destructive: boolean };
  start: { disabled: boolean };
  screenshot: { disabled: boolean; title: string };
  buttons: { action: DeviceButton; label: string; title: string; disabled: boolean; unsupported: boolean }[];
  layout: FrameLayout;
  selecting: boolean;
};

export function message(title: string, description = ""): PanelDisplay { return { kind: "message", title, description }; }

export function initialState(platform: "ios" | "android", layout: FrameLayout): PanelState {
  return {
    platform, available: false, disposed: false, physical: [], discoveryError: "",
    display: message("Loading devices...", `Finding available ${platform === "ios" ? "iOS devices" : "Android devices"}.`),
    link: { kind: "closed" }, input: { blocked: false, repair: "" }, notice: "", screenshotError: "", resume: false, layout, active: false,
  };
}

/** The notice, in priority order: a failed screenshot, the latest message, a repair, blocked input, then discovery errors. */
export function panelNotice(state: PanelState, canMessage: boolean) {
  // Agents repair blocked input; hosts without a chat have no one to ask.
  const blocked = state.input.blocked ? `Simulator input is blocked.${canMessage ? " Ask the agent to repair it." : ""}` : "";
  return { message: state.screenshotError || state.notice || state.input.repair || blocked || state.discoveryError, destructive: state.input.blocked };
}

const busy = (state: PanelState) => state.pending !== undefined || !state.available || state.disposed;

/** Which input reaches the device, before Select mode and open notes take theirs. */
export function inputAllowance(state: PanelState): InputAllowance {
  const live = state.link.kind === "live" && !state.input.blocked && state.pending === undefined;
  const touchOnly = state.link.kind !== "closed" && streamTransports[state.link.transport].touchOnly;
  return { touch: live, keys: live && !touchOnly, paste: live && !touchOnly && !busy(state) };
}

/** Every control's enablement, from the panel's state alone. */
export function panelControls(state: PanelState, selection: Selection, host: HostAbilities) {
  const { selected, status, link } = state;
  const kind = selected ? transportFor(selected) : undefined;
  const transport = kind ? streamTransports[kind] : undefined;
  const streaming = link.kind === "closed" ? undefined : link.transport;
  const connected = isDeviceActive(selected);
  const live = link.kind === "live";
  // Device settings and app tools use simctl and adb, which need a booted device and do not reach paired iPhones.
  const deviceTools = !busy(state) && selected?.state === "Booted";
  // Backend screenshots need the backend; a mirrored iPhone's need its live stream.
  const screenshotReady = transport?.backend === false ? live && streaming === kind : status?.connected === true;
  const frozenSelection = streaming !== undefined && selection.selecting && selection.capture;
  const unsupported = transport?.touchOnly === true;
  const pressable = live && !unsupported && streaming !== undefined && !streamTransports[streaming].touchOnly
    && !state.input.blocked && !busy(state) && !selection.selecting && !selection.draft;
  return {
    settings: { deviceId: selected?.udid ?? "", disabled: !deviceTools },
    appTools: { deviceId: selected?.udid ?? "", disabled: !deviceTools || isPhysicalIos(selected) },
    annotations: { selected, disabled: (!live && !frozenSelection) || busy(state) || !connected || !host.canAttach },
    picker: { disabled: busy(state) || !(status?.devices.length || state.physical.length) },
    start: { disabled: busy(state) || !selected || selected.kind === "physical" || selected.state === "Booted" },
    screenshot: {
      disabled: busy(state) || !connected || !screenshotReady || !host.canAttachScreenshots,
      title: host.canAttachScreenshots ? "Screenshot to chat and clipboard" : "This host does not support screenshot attachments",
    },
    buttons: deviceButtons.map(({ action, label }) => ({
      action, label, disabled: !pressable, unsupported,
      title: unsupported ? `${label} is unavailable on physical iOS devices` : label,
    })),
  };
}

/** Whether two snapshots render the same. The layout is compared by identity: the panel replaces it only when it changes. */
export function sameSnapshot(a: SimulatorPanelSnapshot, b: SimulatorPanelSnapshot) {
  const display = (value: PanelDisplay) => value.kind === "message" ? `${value.title}\n${value.description}` : value.kind;
  return a.active === b.active && display(a.display) === display(b.display) && a.layout === b.layout && a.selecting === b.selecting
    && a.notice.message === b.notice.message && a.notice.destructive === b.notice.destructive && a.start.disabled === b.start.disabled
    && a.screenshot.disabled === b.screenshot.disabled && a.screenshot.title === b.screenshot.title
    && a.buttons.every((button, index) => button.disabled === b.buttons[index].disabled && button.title === b.buttons[index].title && button.unsupported === b.buttons[index].unsupported);
}

export function panelSnapshot(state: PanelState, selection: Selection, host: HostAbilities): SimulatorPanelSnapshot {
  const controls = panelControls(state, selection, host);
  return {
    active: state.active, display: state.display, notice: panelNotice(state, host.canMessage),
    start: controls.start, screenshot: controls.screenshot, buttons: controls.buttons, layout: state.layout,
    selecting: selection.selecting || selection.draft,
  };
}
