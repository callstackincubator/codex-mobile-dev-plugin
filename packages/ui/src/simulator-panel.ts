import type { SimulatorDevice, Status } from "@mobile-dev/shared/protocol.ts";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { isDeviceActive, isPhysicalIos } from "@mobile-dev/shared/devices.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { canMessage } from "./chat-message.ts";
import { changeDeviceState, deviceOptions, DeviceDiscovery, discoverDevices, followOpeningTarget, platformTools, renamedAvd, selectionMessage } from "./device-discovery.ts";
import type { Discovered, Platform } from "./device-discovery.ts";
import { frameLayout } from "./device-frame-layout.ts";
import { initialPanelDevice } from "./device-layout.ts";
import { DevicePickerStore } from "./device-picker.ts";
import { DeviceScreen } from "./device-screen.ts";
import type { DeviceSettingsStore } from "./device-settings.ts";
import type { AppToolsStore } from "./app-tools.ts";
import { createPanelStores } from "./panel-stores.ts";
import { DeviceStream } from "./device-stream.ts";
import type { HostBridge } from "./host-bridge.ts";
import type { DeviceAppsStore } from "./device-apps.ts";
import type { PanelContext } from "./model-context.ts";
import type { ScreenAnnotationsStore } from "./screen-annotations.ts";
import { captureScreen, readScreenTree, takeScreenshot } from "./simulator-capture.ts";
import type { CaptureTarget } from "./simulator-capture.ts";
import { initialState, inputAllowance, message, panelControls, panelSnapshot, sameSnapshot } from "./simulator-state.ts";
import type { DeviceButton, PanelAction, PanelDisplay, PanelState, SimulatorPanelSnapshot } from "./simulator-state.ts";
import { Store } from "./store.ts";
import { streamTransports, transportFor } from "./stream-transports.ts";
import { countUiEvent, recordUiTiming } from "./telemetry.ts";
import { callTool } from "./tool-call.ts";

type SelectionChanged = (device?: SimulatorDevice, active?: boolean) => void;
/** The workspace's chat context and the installed-apps listings its panels share. */
export type PanelTools = { context: PanelContext; deviceApps: DeviceAppsStore };

/**
 * One platform's device panel: it lists and opens devices, streams the selected one and turns
 * the user's input into device input. Its view renders the snapshot and attaches the canvas.
 */
export class SimulatorPanel extends Store<SimulatorPanelSnapshot> {
  readonly platform: Platform;
  readonly picker: DevicePickerStore;
  readonly settings: DeviceSettingsStore;
  readonly appTools: AppToolsStore;
  readonly annotations: ScreenAnnotationsStore;
  private readonly app: HostBridge;
  private readonly context: PanelContext;
  private readonly selectionChanged: SelectionChanged;
  private readonly stream: DeviceStream;
  private readonly screen: DeviceScreen;
  private readonly discovery: DeviceDiscovery;
  private model: PanelState;
  private openingTarget?: PanelTarget;
  private onScreen = true;
  private disposing?: Promise<void>;
  private readonly stopObservingAnnotations: () => void;

  constructor(app: HostBridge, platform: Platform, { context, deviceApps }: PanelTools, selectionChanged: SelectionChanged) {
    const model = initialState(platform, frameLayout({ stage: { width: 0, height: 0 }, showFrame: true, platform }));
    super(panelSnapshot(model, { selecting: false, draft: false, capture: false }, { canAttach: false, canAttachScreenshots: false, canMessage: false }));
    this.model = model;
    this.app = app;
    this.platform = platform;
    this.context = context;
    this.selectionChanged = selectionChanged;
    this.stream = new DeviceStream({
      app, call: (name, args, options) => callTool(app, { name, arguments: args }, options),
      pointer: () => this.screen.input,
      draw: (image, width, height) => this.draw(image, width, height),
      bezel: bezel => this.screen.setBezel(bezel),
      notice: (text = "") => this.change({ notice: text }),
      failed: error => {
        const text = errorMessage(error);
        const selected = this.model.selected;
        this.change({ notice: text, ...(selected && streamTransports[transportFor(selected)].failureOnScreen ? { display: message("Screen unavailable", text) } : {}) });
      },
      changed: () => this.linkChanged(),
    });
    this.discovery = new DeviceDiscovery(() => discoverDevices(app, platform), found => this.discovered(found));
    this.picker = new DevicePickerStore({
      select: () => { this.openingTarget = undefined; void this.run("select", async () => { await this.stream.disconnect(); this.selectDevice(); await this.startSelected(); }); },
      stop: id => this.stopDevice(id),
      refresh: async () => { if (!this.model.pending && !this.model.disposed && this.model.available) await this.discovery.list(); },
    });
    ({ settings: this.settings, appTools: this.appTools, annotations: this.annotations } = createPanelStores(app, platform, deviceApps, {
      device: () => this.model, setFrame: visible => this.screen.setFrame(visible),
      capture: () => captureScreen(this.captureTarget()),
      readTree: simulator => readScreenTree(this.captureTarget(), simulator, this.annotations.getSnapshot().capture?.screen.width),
    }));
    this.annotations.connect(context);
    this.stopObservingAnnotations = this.annotations.subscribe(() => this.annotationsChanged());
    this.screen = new DeviceScreen({
      platform, annotations: this.annotations, allows: () => inputAllowance(this.model), screen: () => this.stream.points,
      send: next => this.stream.send(next), notice: text => this.change({ notice: text }), layoutChanged: layout => this.change({ layout }),
    });
    document.addEventListener("visibilitychange", this.visibilityChanged);
    window.addEventListener("pageshow", this.visibilityChanged);
    window.addEventListener("focus", this.visibilityChanged);
    this.sync();
  }

  get selected() { return this.model.selected; }
  /** Whether the workspace's layout shows this panel; only a shown panel polls for devices. */
  get visible() { return this.onScreen; }
  setVisible(visible: boolean) { this.onScreen = visible; }
  setActive(active: boolean) { if (active !== this.model.active) this.change({ active }); }
  setAvailable(available: boolean) { this.change({ available }); }
  notice(text: string) { this.change({ notice: text }); }
  /** Applies a host change, such as new attachment capabilities, to the controls. */
  controls() { this.sync(); }

  private captureTarget(): CaptureTarget { return { app: this.app, platform: this.platform, screen: this.screen, stream: this.stream, selected: this.model.selected }; }

  private change(patch: Partial<PanelState>) {
    this.model = { ...this.model, ...patch };
    this.sync();
  }

  private sync() {
    const controls = panelControls(this.model, this.selection(), this.abilities());
    this.settings.configure(controls.settings.deviceId, controls.settings.disabled);
    this.settings.prefetch();
    this.appTools.configure(this.platform, controls.appTools.deviceId, controls.appTools.disabled);
    this.picker.disabled = controls.picker.disabled;
    this.annotations.configure(controls.annotations.selected, controls.annotations.disabled);
    this.publish();
  }

  private publish() {
    const next = panelSnapshot(this.model, this.selection(), this.abilities());
    if (!sameSnapshot(next, this.state)) this.set(next);
  }

  private selection() {
    const state = this.annotations.getSnapshot();
    return { selecting: state.selecting, draft: !!state.draft, capture: !!state.capture };
  }

  private abilities() {
    return { canAttach: this.context.canAttach, canAttachScreenshots: this.context.canAttachScreenshots, canMessage: canMessage(this.app) };
  }

  private linkChanged() {
    const { stream, live, blocked, repair } = this.stream;
    this.change({ link: stream ? { kind: live ? "live" : "waiting", transport: stream.transport } : { kind: "closed" }, input: { blocked, repair } });
  }

  private annotationsChanged() {
    const state = this.annotations.getSnapshot();
    if (state.selecting || state.draft) this.screen.input?.release();
    // Leaving Select shows the latest frame that arrived while it held the screen still.
    const held = state.selecting ? undefined : this.screen.takeHeld();
    if (held && this.stream.live && this.stream.stream) this.draw(held, held.width, held.height);
    this.publish();
  }

  /** Connects the panel to the canvas and stage its view rendered, and returns how to disconnect them. */
  attach(canvas: HTMLCanvasElement, stage: HTMLElement) { return this.screen.attach(canvas, stage); }

  /** Fits the frame to the stage, as after the host's size changed. */
  fitScreen() { this.screen.fit(); }

  private draw(image: CanvasImageSource, width: number, height: number) {
    const startedAt = performance.now();
    const hold = this.annotations.getSnapshot().selecting;
    const resized = this.screen.draw(image, width, height, hold);
    const first = this.stream.frames === 0;
    const live = this.stream.framed();
    recordUiTiming("ui.video.paint", performance.now() - startedAt);
    countUiEvent(`ui.video.${this.platform}.frames`);
    // A frame held during Select keeps the stopped overlay; any other frame replaces the stage.
    const display: PanelDisplay = hold && this.model.display.kind === "stopped" ? this.model.display : { kind: "frame" };
    if (live) { this.model = { ...this.model, display, notice: "" }; this.linkChanged(); }
    else if (display.kind !== this.model.display.kind) this.change({ display });
    if (!hold && (first || resized)) this.fitScreen();
  }

  /** Runs one action at a time. One started meanwhile is dropped; a reconnect asked for meanwhile runs next. */
  private async run(action: PanelAction, work: () => Promise<void>, { quiet = false } = {}) {
    if (this.model.pending || this.model.disposed) return;
    this.change({ pending: action, ...(quiet ? {} : { screenshotError: "", notice: "" }) });
    try { await work(); }
    catch (error) { if (quiet) throw error; this.change({ notice: errorMessage(error) }); }
    finally {
      const resume = this.model.resume;
      this.change({ pending: undefined, resume: false });
      if (resume && !this.stream.reconnect.active && !this.model.disposed) void this.resume();
    }
  }

  private async discovered({ status, paired }: Discovered) {
    if (paired) this.model = { ...this.model, physical: paired.devices, discoveryError: paired.error };
    this.renderStatus(status);
    if (paired) this.change({ notice: "" });
    if (!this.model.pending && !this.stream.reconnect.active) await this.connect();
  }

  private renderStatus(next: Status, previous = this.model.selected?.udid) {
    this.discovery.supersede();
    const available = [...this.model.physical, ...next.devices];
    this.openingTarget = followOpeningTarget(this.openingTarget, next, this.model.selected, this.platform);
    const old = available.find(device => device.udid === previous);
    const nextDevice = initialPanelDevice(available, this.platform, previous, this.openingTarget);
    // A mirrored iPhone streams without the backend; every other device needs it.
    if (this.stream.reconnect.active && !(isDeviceActive(old) && (isPhysicalIos(old) || next.connected))) void this.stream.disconnect();
    this.model = { ...this.model, status: next };
    const placeholder = available.length ? "Select a device" : next.connected ? "No devices" : "Devices unavailable";
    this.picker.show({ items: deviceOptions(next, this.model.physical, this.platform), value: nextDevice?.udid ?? "", placeholder });
    this.selectDevice();
    if (!next.connected && this.model.physical.length === 0) this.change({ display: message("Could not start the simulator backend."), notice: next.error ?? "" });
  }

  private selectDevice() {
    const value = this.picker.value;
    const selected = this.model.status?.devices.find(device => device.udid === value) ?? this.model.physical.find(device => device.udid === value);
    this.model = { ...this.model, selected };
    this.selectionChanged(selected);
    const shown = selectionMessage(selected, { platform: this.platform, target: this.openingTarget, reconnecting: this.stream.reconnect.active, stopped: this.model.display.kind === "stopped" });
    this.change(shown ? { display: message(shown.title, shown.description) } : {});
  }

  private async connect() {
    const selected = this.model.selected;
    if (this.model.disposed || !this.model.available || !selected || !isDeviceActive(selected)) return;
    await this.stream.disconnect();
    if (document.visibilityState === "hidden" || this.model.disposed) return;
    if (this.model.display.kind === "message") this.change({ display: message("Connecting…", "Opening the device screen.") });
    this.stream.start(selected);
    this.sync();
  }

  private async startSelected() {
    await this.discovery.list();
    const selected = this.model.selected;
    if (!selected) return;
    if (selected.kind === "physical") { if (isDeviceActive(selected)) await this.connect(); return; }
    if (selected.state !== "Booted") {
      this.change({ display: message("Starting simulator…", "The screen will appear when the device is ready.") });
      const next = await changeDeviceState(this.app, this.platform, "boot", selected.udid);
      this.renderStatus(next);
      const booted = renamedAvd(this.platform, next, selected, "Booted");
      if (booted) { this.picker.value = booted.udid; this.selectDevice(); }
    }
    await this.connect();
  }

  // The picker shows a failed stop, so the action reports it there rather than in the notice.
  private stopDevice(id: string) {
    const device = this.model.status?.devices.find(item => item.udid === id);
    if (this.model.pending || this.model.disposed || !this.model.available || device?.state !== "Booted") return Promise.reject(new Error("This device is no longer running."));
    if (device.kind === "physical") return Promise.reject(new Error("Only simulators and emulators can be stopped from this panel."));
    const wasSelected = this.model.selected?.udid === id;
    this.discovery.supersede();
    return this.run("stop", async () => {
      try {
        if (wasSelected) await this.stream.disconnect();
        const next = await changeDeviceState(this.app, this.platform, "shutdown", id);
        // An emulator stops back to its avd: ID, so the panel keeps the same AVD selected.
        const selectedId = wasSelected && platformTools[this.platform].renames ? renamedAvd(this.platform, next, device)?.udid : this.model.selected?.udid;
        if (wasSelected && next.connected) this.model = { ...this.model, display: { kind: "stopped" } };
        this.renderStatus(next, selectedId);
        if (wasSelected && this.model.display.kind === "stopped") this.fitScreen();
      } catch (error) {
        this.change({ notice: errorMessage(error) });
        await this.discovery.list().catch(() => {});
        const selected = this.model.selected;
        if (wasSelected && selected?.udid === id && selected.state === "Booted") await this.connect().catch(() => {});
        throw error;
      }
    }, { quiet: true });
  }

  /** Reopens the device, as after its chat was hidden or the layout showed the panel again. */
  resume(): Promise<void> {
    if (this.model.pending) { this.model = { ...this.model, resume: true }; return Promise.resolve(); }
    return this.run("connect", () => this.connect());
  }

  private readonly visibilityChanged = () => {
    if (document.visibilityState === "hidden") void this.stream.disconnect();
    else if (this.model.available && isDeviceActive(this.model.selected) && !this.stream.live && !this.model.disposed) void this.resume();
  };

  load() {
    return this.run("load", async () => {
      await this.discovery.list();
      this.discovery.poll(() => document.visibilityState === "visible" && this.onScreen && !this.model.pending && this.model.available, error => this.change({ notice: errorMessage(error) }));
      await this.connect();
    });
  }

  startDevice = () => { void this.run("start", () => this.startSelected()); };
  screenshot = () => { void this.run("screenshot", () => takeScreenshot(this.captureTarget(), this.context, error => this.change({ screenshotError: error }))); };
  press = (button: DeviceButton) => { this.stream.send({ type: "button", button }); };
  /** The user pointed at or focused this panel, so logs and the chat follow its device. */
  activate = () => { this.selectionChanged(this.model.selected, true); };

  setOpeningTarget(target: PanelTarget | undefined) {
    this.openingTarget = target;
    if (this.model.status !== undefined) this.renderStatus(this.model.status);
  }

  acceptStatus(next: Status) {
    this.renderStatus(next);
    if (this.model.available && !this.stream.reconnect.active) void this.resume();
  }

  dispose() {
    if (this.disposing) return this.disposing;
    this.change({ disposed: true, available: false });
    this.discovery.dispose();
    this.settings.dispose();
    this.appTools.dispose();
    this.stopObservingAnnotations();
    this.annotations.dispose();
    this.screen.detach();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    window.removeEventListener("pageshow", this.visibilityChanged);
    window.removeEventListener("focus", this.visibilityChanged);
    return this.disposing = this.stream.disconnect().then(() => this.close());
  }
}

/** What SimulatorView reads: the panel's snapshot and stores, the canvas it attaches, and the actions its controls run. */
export type SimulatorPanelView = Pick<SimulatorPanel, "platform" | "picker" | "settings" | "appTools" | "annotations" | "subscribe" | "getSnapshot" | "attach" | "activate" | "press" | "screenshot" | "startDevice">;

/** Builds a panel for one platform; the workspace creates one for iOS and one for Android. */
export function createSimulatorPanel(app: HostBridge, platform: Platform, tools: PanelTools, selectionChanged: SelectionChanged) {
  return new SimulatorPanel(app, platform, tools, selectionChanged);
}
