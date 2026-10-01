import { androidNinePatchSkin } from "./android-nine-patch.ts";
import { androidFrameGeometry, androidChromeScale } from "./android-frame-geometry.ts";
import { getDevicePicker } from "./device-picker.ts";
import { getDeviceSettings } from "./device-settings.ts";
import type { DeviceSettings } from "../shared/device-settings.ts";
import { bezelGeometrySchema } from "../shared/bezel.ts";
import type { Bezel } from "../shared/bezel.ts";
import type { SimulatorDevice, Status, TouchInput } from "../shared/protocol.ts";
import { physicalConnectionLabel } from "../shared/ios-devices.ts";
import type { PhysicalIosDevice } from "../shared/ios-devices.ts";
import type { DeviceOption } from "./device-picker.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import { captureUiError, countUiEvent, recordUiTiming } from "./telemetry.ts";
import type { PanelContext } from "./model-context.ts";
import { getScreenAnnotations } from "./screen-annotations.ts";
import type { ScreenAnnotation } from "../shared/screen-annotations.ts";
import { AndroidVideo } from "./android-video.ts";
import { PhysicalIosVideo } from "./ios-mirror-video.ts";
import { iosVideoBatchSchema } from "../shared/ios-video.ts";
import { FrameStream } from "./frame-stream.ts";
import { FrameArrivals } from "./frame-arrivals.ts";
import { readFrame } from "./read-frame.ts";
import { BrowserProfile } from "./browser-profile.ts";
import { StreamInput } from "./stream-input.ts";
import type { StreamMessage } from "./stream-input.ts";
import { IosVideo } from "./ios-video.ts";
import type { AndroidVideoBatch } from "./android-video.ts";
import type { App } from "@modelcontextprotocol/ext-apps";

export function createSimulatorPanel(
  app: App,
  root: HTMLElement,
  platform: "ios" | "android",
  panelContext: PanelContext,
  selectionChanged: (device?: SimulatorDevice, active?: boolean) => void,
) {
  function element<T extends HTMLElement = HTMLElement>(id: string): T { return root.querySelector(`[data-element="${id}"]`) as T; }
  const devicePickerElement = element("devices");
  const devices = getDevicePicker(devicePickerElement);
  const settings = getDeviceSettings(element("settings"));
  const canvas = element<HTMLCanvasElement>("screen");
  const context = canvas.getContext("2d")!;
  const frame = element("device-frame");
  const stage = element("stage");
  const annotations = getScreenAnnotations(stage);
  annotations.connect(panelContext);
  const bezelImage = element<HTMLImageElement>("device-bezel");
  let bezel: Bezel | undefined;
  let sourceBezel: Bezel | undefined;
  let showFrame = true;
  let stoppedDisplay = false;
  let useAndroidNinePatch = false;
  bezelImage.addEventListener("error", () => { setBezel(); fitScreen(); });
  const screenshotButton = element<HTMLButtonElement>("screenshot");
  let status: Status | undefined;
  let statusRevision = 0;
  let selected: SimulatorDevice | undefined;
  let physicalDevices: PhysicalIosDevice[] = [];
  let discoveryError = "";
  let listing: Promise<void> | undefined;
  let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  type PanelStream = { id: string; frameUri: string; epoch: number; platform: "ios" | "android"; physicalIos: boolean; generation?: number; controller: AbortController; input?: StreamInput; reader?: FrameStream<ImageBitmap>; closing?: Promise<void> };
  const reconnect = new ReconnectLoop();
  let stream: PanelStream | undefined;
  let ready = false;
  let firstFrameStartedAt: number | undefined;
  let inputBlocked = false;
  let inputRepairMessage = "";
  let epoch = 0;
  let points = { width: 0, height: 0 };
  let pointer: { id: number; x: number; y: number; edge?: TouchInput["edge"] } | undefined;
  let seenFrames = 0;
  let pausedFrame: HTMLCanvasElement | undefined;
  let busy = false;
  let resumeRequested = false;
  let toolsAvailable = false;
  let disposed = false;
  let disposing: Promise<void> | undefined;

  function notice(message = "") {
    if (!message) message = inputRepairMessage || (inputBlocked ? "Simulator input is blocked. Ask Codex to repair it." : discoveryError);
    element("notice-message").textContent = message;
    element("notice").title = message;
    element("notice").classList?.toggle("text-destructive", inputBlocked);
    element("notice").hidden = !message;
  }

  function controls() {
    settings.configure(selected?.udid ?? "", busy || !toolsAvailable || selected?.state !== "Booted" || disposed);
    settings.prefetch();
    element<HTMLButtonElement>("start-device").disabled = busy || !toolsAvailable || !selected || selected.kind === "physical" || selected.state === "Booted" || disposed;
    const hasDevices = status?.devices.length || physicalDevices.length;
    devices.disabled = busy || !toolsAvailable || !hasDevices || disposed;
    const connected = selectedDeviceConnected();
    const physicalIos = selected?.kind === "physical" && selected.platform === "ios";
    const screenshotReady = physicalIos ? ready && stream?.physicalIos === true : status?.connected;
    screenshotButton.disabled = busy || !toolsAvailable || !connected || !screenshotReady || !panelContext.canAttachScreenshots || disposed;
    screenshotButton.title = panelContext.canAttachScreenshots ? "Screenshot to chat and clipboard" : "This host does not support screenshot attachments";
    annotations.configure(selected, !ready || busy || !toolsAvailable || !connected || !panelContext.canAttachScreenshots || disposed);
    deviceButtons();
  }

  function selectedDeviceConnected() {
    const physicalIos = selected?.kind === "physical" && selected.platform === "ios";
    return physicalIos ? selected?.state === "connected" : selected?.state === "Booted";
  }

  function deviceButtons() {
    const state = annotations.getSnapshot();
    const unsupported = selected?.kind === "physical" && selected.platform === "ios";
    const active = ready && stream != null && !unsupported && !stream.physicalIos && !inputBlocked && !busy && toolsAvailable && !state.selecting && !state.draft;
    const buttons = root.querySelectorAll<HTMLButtonElement>("[data-button]");
    buttons.forEach(button => {
      const label = button.dataset.button === "home" ? "Home" : "App switcher";
      button.disabled = !active;
      button.dataset.unsupported = unsupported ? "true" : "false";
      button.title = unsupported ? `${label} is unavailable on physical iOS devices` : label;
    });
  }

  function send(message: StreamMessage) {
    if (!ready || !stream || inputBlocked) return;
    stream.input?.send(message);
  }

  function flushInput(session: PanelStream): Promise<void> {
    return session.input?.flush() ?? Promise.resolve();
  }

  function createInput(session: PanelStream) {
    return new StreamInput(async messages => {
      const started = performance.now();
      try {
        const tool = session.physicalIos ? "mobile_ios_mirror_input" : session.platform === "android" ? "mobile_android_stream_input" : "mobile_stream_input";
        const parameters = session.physicalIos
          ? { sessionId: session.id, messages, generation: session.generation }
          : { sessionId: session.id, messages };
        await call(tool, parameters, { timeout: 5000 });
      } finally {
        const elapsed = performance.now() - started;
        session.reader?.inputTiming(elapsed);
        recordUiTiming("ui.device_input.round_trip", elapsed);
      }
    }, error => {
      if (session.epoch !== epoch) return;
      const failure = error as Error & { inputBlocked?: boolean; streamDisconnected?: boolean };
      if (failure.inputBlocked) inputBlocked = true;
      ready = false;
      cancelPointer();
      notice(failure.streamDisconnected ? "Reconnecting…" : failure.message ?? "Simulator input failed.");
      controls();
      session.reader?.fail(error);
      session.controller.abort(error);
    });
  }

  function releasePointer() {
    if (!pointer) return;
    const previous = pointer;
    pointer = undefined;
    send({ type: "touch1-up", x: previous.x, y: previous.y, ...points, ...(previous.edge ? { edge: previous.edge } : {}) });
    if (canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
  }

  function cancelPointer() {
    const previous = pointer;
    pointer = undefined;
    if (previous && canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
  }

  function closePanel(session: PanelStream, graceful = false): Promise<void> {
    if (session.closing) return session.closing;
    session.closing = (async () => {
      if (graceful) await flushInput(session);
      session.input?.close();
      if (stream === session) { cancelPointer(); stream = undefined; ready = false; controls(); }
      try { await call(session.physicalIos ? "mobile_ios_mirror_close" : session.platform === "android" ? "mobile_android_stream_close" : "mobile_stream_close", { sessionId: session.id }, { timeout: 3000 }); }
      catch { /* Idle streams also expire on the server. */ }
    })();
    return session.closing;
  }

  async function disconnect() {
    releasePointer();
    const previous = stream;
    const closing = previous ? closePanel(previous, true) : Promise.resolve();
    reconnect.stop();
    epoch++;
    stream = undefined;
    ready = false;
    inputRepairMessage = "";
    if (inputBlocked) { inputBlocked = false; notice(); }
    controls();
    await closing;
  }

  async function call(name: string, args: Record<string, unknown> = {}, options: { signal?: AbortSignal; timeout?: number } = {}) {
    const result = await app.callServerTool({ name, arguments: args }, options);
    if (result.isError) {
      const message = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
      const error = result._meta?.retryable === false ? new StopReconnectError(message) : new Error(message);
      throw Object.assign(error, { inputBlocked: result._meta?.inputBlocked === true, streamDisconnected: result._meta?.streamDisconnected === true });
    }
    return result;
  }

  function captureScreen(): { screenshot: ScreenAnnotation["screenshot"]; screen: ScreenAnnotation["screen"] } {
    if (!ready || !canvas.width || !canvas.height || !points.width || !points.height) throw new Error("Wait for the device screen to load.");
    const started = performance.now();
    let data: string;
    try {
      const url = canvas.toDataURL("image/png");
      const parts = url.split(",");
      data = parts[1];
    } finally {
      const elapsed = performance.now() - started;
      recordUiTiming("ui.screenshot.capture", elapsed);
    }
    const physicalIos = selected?.kind === "physical" && selected.platform === "ios";
    const screen: ScreenAnnotation["screen"] = { ...points, units: platform === "android" || physicalIos ? "pixels" : "points" };
    const now = new Date();
    const capturedAt = now.toISOString();
    return {
      screenshot: { id: crypto.randomUUID(), data, capturedAt },
      screen,
    };
  }
  annotations.capture = captureScreen;
  annotations.readTree = async simulator => {
    if (simulator.kind === "physical" && simulator.platform === "ios") return [];
    const startedAt = performance.now();
    try {
      try {
        const result = await call("mobile_inspect_ui", { platform, deviceId: simulator.udid, deviceName: simulator.name, screenWidth: points.width }, { timeout: 10000 });
        if (!result.structuredContent?.tree) throw new Error("Component inspection returned no tree.");
        const runtime = result.structuredContent.runtime;
        if (runtime && typeof runtime === "object" && "available" in runtime && runtime.available === true) countUiEvent("ui.annotations.runtime_available");
        return result.structuredContent.tree;
      } catch {
        // Hosts with an older tool list and failed inspectors can still read AX.
        countUiEvent("ui.annotations.inspection_fallback");
        const result = await call(platform === "android" ? "mobile_android_describe_ui" : "mobile_describe_ui", platform === "android" ? { deviceId: simulator.udid } : { udid: simulator.udid }, { timeout: 5000 });
        return result.structuredContent?.tree;
      }
    } finally { recordUiTiming("ui.annotations.inspection", performance.now() - startedAt); }
  };
  const stopObservingAnnotations = annotations.subscribe(() => {
    const state = annotations.getSnapshot();
    canvas.dataset.selecting = String(state.selecting || !!state.draft);
    if (state.selecting || state.draft) releasePointer();
    if (!state.selecting && pausedFrame) {
      const latest = pausedFrame;
      pausedFrame = undefined;
      if (ready && stream) drawFrame(latest, latest.width, latest.height);
    }
    deviceButtons();
  });

  settings.request = async change => {
    if (!selected || selected.state !== "Booted" || disposed) throw new Error("Select a running device first.");
    const result = await call(change ? "mobile_update_device_setting" : "mobile_device_settings", {
      target: { platform, id: selected.udid }, ...(change ? { change } : {}),
    }, { timeout: 30000 });
    return (result.structuredContent as { settings: Partial<DeviceSettings> }).settings;
  };
  settings.setFrame = visible => { showFrame = visible; setBezel(sourceBezel); fitScreen(); };

  async function action(callback: () => Promise<void>) {
    if (busy || disposed) return;
    busy = true; controls(); notice();
    try { await callback(); } catch (error) { notice(error instanceof Error ? error.message : String(error)); }
    finally {
      busy = false;
      controls();
      if (resumeRequested) {
        resumeRequested = false;
        if (!reconnect.active && !disposed) void resume();
      }
    }
  }

  function empty(message: string, description = "") {
    stoppedDisplay = false;
    element("stopped").hidden = true;
    frame.hidden = true;
    element("empty").hidden = false;
    element("empty").textContent = message;
    element("empty-description").textContent = description;
    element("empty-description").hidden = !description;
  }

  function setBezel(value?: Bezel) {
    sourceBezel = value;
    if (!showFrame) value = undefined;
    useAndroidNinePatch = showFrame && platform === "android" && !value;
    const decoration = element("device-nine-patch");
    if (decoration) decoration.hidden = !useAndroidNinePatch;
    bezel = value;
    frame.dataset.bezel = String(!!value || useAndroidNinePatch || !showFrame);
    bezelImage.hidden = !value;
    canvas.removeAttribute("style");
    if (!value) { bezelImage.removeAttribute("src"); return; }
    bezelImage.src = value.image;
    const { rect, viewport, clipRadius } = value;
    canvas.style.left = `${rect.x / viewport.width * 100}%`;
    canvas.style.top = `${rect.y / viewport.height * 100}%`;
    canvas.style.width = `${rect.width / viewport.width * 100}%`;
    canvas.style.height = `${rect.height / viewport.height * 100}%`;
    canvas.style.borderRadius = `${clipRadius / rect.width * 100}% / ${clipRadius / rect.height * 100}%`;
    if (value.mask) {
      canvas.style.maskImage = `url("${value.mask}")`;
      canvas.style.maskSize = "100% 100%";
      canvas.style.maskRepeat = "no-repeat";
      canvas.style.borderRadius = "0";
    }
  }

  function fitScreen() {
    layoutScreen();
    const rect = canvas.getBoundingClientRect();
    const container = stage.getBoundingClientRect();
    annotations.setViewport({ x: rect.left - container.left, y: rect.top - container.top, width: rect.width, height: rect.height, stageWidth: stage.clientWidth, stageHeight: stage.clientHeight });
  }

  function layoutScreen() {
    if (frame.hidden || !canvas.width || !canvas.height) return;
    const style = getComputedStyle(stage);
    const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (!showFrame) {
      const scale = Math.max(0, Math.min(width / canvas.width, height / canvas.height));
      frame.style.width = `${canvas.width * scale}px`;
      frame.style.height = `${canvas.height * scale}px`;
      Object.assign(canvas.style, { left: "0", top: "0", width: "100%", height: "100%", borderRadius: "0" });
      return;
    }
    if (useAndroidNinePatch) {
      const skin = androidNinePatchSkin;
      const geometry = androidFrameGeometry(canvas.width, canvas.height, width, height);
      const { scale, screenWidth, screenHeight, frameWidth, frameHeight } = geometry;
      frame.style.width = `${frameWidth * scale}px`;
      frame.style.height = `${frameHeight * scale}px`;
      canvas.style.left = `${skin.bezel.left * androidChromeScale * scale}px`;
      canvas.style.top = `${skin.bezel.top * androidChromeScale * scale}px`;
      canvas.style.width = `${screenWidth * scale}px`;
      canvas.style.height = `${screenHeight * scale}px`;
      canvas.style.borderRadius = `${skin.screenCornerRadius * androidChromeScale * scale}px`;
      const decoration = element("device-nine-patch");
      if (decoration) {
        decoration.style.borderStyle = "solid";
        decoration.style.borderWidth = `${skin.slice * androidChromeScale * scale}px`;
        decoration.style.borderImage = `url("${skin.image}") ${skin.slice} / ${skin.slice * androidChromeScale * scale}px stretch`;
        decoration.replaceChildren(...skin.buttons.map(button => {
          const shape = document.createElement("span");
          const renderedSlice = skin.slice * androidChromeScale;
          const buttonHeight = button.height * androidChromeScale;
          const center = renderedSlice + (button.top + button.height / 2 - skin.slice) * (frameHeight - 2 * renderedSlice) / (skin.imageHeight - 2 * skin.slice);
          const top = Math.min(Math.max(center - buttonHeight / 2, renderedSlice), frameHeight - renderedSlice - buttonHeight);
          Object.assign(shape.style, { position: "absolute", top: `${(top - renderedSlice) * scale}px`, height: `${buttonHeight * scale}px`, width: `${button.depth * androidChromeScale * scale}px`, [button.side]: `${-(skin.slice + button.depth) * androidChromeScale * scale}px`, background: "#2b2b2b", borderRadius: "2px" });
          return shape;
        }));
      }
      return;
    }
    if (bezel) {
      const { rect, viewport } = bezel;
      const inset = 0;
      const videoScale = Math.min((rect.width - inset * 2) / canvas.width, (rect.height - inset * 2) / canvas.height);
      const videoWidth = canvas.width * videoScale;
      const videoHeight = canvas.height * videoScale;
      canvas.style.left = `${(rect.x + (rect.width - videoWidth) / 2) / viewport.width * 100}%`;
      canvas.style.top = `${(rect.y + (rect.height - videoHeight) / 2) / viewport.height * 100}%`;
      canvas.style.width = `${videoWidth / viewport.width * 100}%`;
      canvas.style.height = `${videoHeight / viewport.height * 100}%`;
      const scale = Math.max(0, Math.min(width / bezel.viewport.width, height / bezel.viewport.height));
      frame.style.width = `${bezel.viewport.width * scale}px`;
      frame.style.height = `${bezel.viewport.height * scale}px`;
      return;
    }
    const ratio = canvas.width / canvas.height;
    const screenWidth = Math.max(0, Math.min(width - 14, (height - 14) * ratio));
    frame.style.width = `${screenWidth + 14}px`;
    frame.style.height = `${screenWidth / ratio + 14}px`;
    frame.style.setProperty("--frame-radius", `${Math.max(16, Math.min(58, screenWidth * .12))}px`);
  }
  const resizeObserver = new ResizeObserver(fitScreen);
  resizeObserver.observe(stage);
  resizeObserver.observe(canvas);

  function runtimeLabel(runtime: string) {
    return runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "").replace(/^(iOS|tvOS|watchOS|visionOS)-/, "$1 ").replace(/-/g, ".");
  }

  function selectDevice() {
    selected = status?.devices.find(device => device.udid === devices.value);
    if (selected === undefined) selected = physicalDevices.find(device => device.udid === devices.value);
    selectionChanged(selected);
    if (selected?.kind === "physical" && selected.platform === "ios") {
      const connection = physicalConnectionLabel(selected.transportType);
      if (reconnect.active === false) empty(`${selected.name} · ${connection}`, "Opening the physical device screen…");
    } else if (selected?.kind === "physical" && selected.state !== "Booted") {
      const description = selected.state === "unauthorized"
        ? "Unlock the device and allow USB debugging, or pair it for wireless debugging."
        : "Reconnect the device and check that ADB debugging is enabled.";
      empty(`${selected.name} · ${selected.state}`, description);
    } else if (!reconnect.active && !stoppedDisplay) empty(selected ? "Select a device to open its screen." : (platform === "android" ? "No Android devices. Create an AVD in Android Studio or connect a device." : "No iOS devices. Connect an iPhone or add a simulator in Xcode."));
    controls();
  }

  function renderStatus(next: Status, previous = selected?.udid) {
    statusRevision++;
    status = next;
    const available = [...physicalDevices, ...next.devices];
    const oldDevice = available.find(device => device.udid === previous);
    const physicalIos = oldDevice?.kind === "physical" && oldDevice.platform === "ios";
    const availableForMirroring = physicalIos ? oldDevice.state === "connected" : next.connected && oldDevice?.state === "Booted";
    if (reconnect.active && availableForMirroring === false) void disconnect();
    const running = next.devices.find(device => device.state === "Booted");
    const physicalOptions: DeviceOption[] = physicalDevices.map(device => {
      const connection = physicalConnectionLabel(device.transportType);
      const kind = /ipad/i.test(device.model) ? "tablet" : "phone";
      return { value: device.udid, label: `${device.name} · ${connection}`, group: "Connected devices", kind, running: true, statusLabel: "Connected", canStop: false };
    });
    const virtualDevices = next.devices.filter(device => device.kind !== "physical");
    const androidPhysicalOptions: DeviceOption[] = next.devices.flatMap(device => {
      if (device.kind !== "physical") return [];
      const connection = physicalConnectionLabel(device.transportType);
      const running = device.state === "Booted";
      const stateLabel = device.state === "unauthorized" ? "Unauthorized" : "Offline";
      return [{
        value: device.udid, label: `${device.name} · ${connection}${running ? "" : ` · ${stateLabel}`}`,
        group: "Connected devices", kind: /tablet|pixel.*tab/i.test(device.name) ? "tablet" : "phone",
        running, statusLabel: "Connected", canStop: false,
      }];
    });
    const simulatorOptions: DeviceOption[] = virtualDevices.map(device => {
      const runtime = runtimeLabel(device.runtime);
      return {
        value: device.udid, label: `${device.name}${runtime ? ` · ${runtime}` : ""}`,
        group: platform === "ios" ? "Simulators" : "Emulators",
        kind: /ipad|tablet|pixel.*tab/i.test(device.name) ? "tablet" : "phone", running: device.state === "Booted",
        canStop: device.state === "Booted" && (platform === "ios" || /^emulator-\d+$/.test(device.udid)),
      };
    });
    devices.update({
      items: [...physicalOptions, ...androidPhysicalOptions, ...simulatorOptions],
      value: previous && oldDevice ? previous : running?.udid ?? physicalDevices[0]?.udid ?? "",
      placeholder: available.length ? "Select a device" : next.connected ? "No devices" : "Devices unavailable",
    });
    selectDevice();
    if (!next.connected && physicalDevices.length === 0) {
      empty("Could not start the simulator backend.");
      notice(next.error);
    }
  }

  async function connect() {
    if (disposed || !toolsAvailable || !selected) return;
    const connected = selected.kind === "physical" && selected.platform === "ios" ? selected.state === "connected" : selected.state === "Booted";
    if (connected === false) return;
    await disconnect();
    if (document.visibilityState === "hidden" || disposed) return;
    if (frame.hidden) empty("Connecting…", "Opening the device screen.");
    const sessionEpoch = epoch;
    const udid = selected.udid;
    reconnect.start(signal => openAndReceive(udid, sessionEpoch, signal), () => {
      ready = false;
      notice("Reconnecting…");
      controls();
    }, error => {
      ready = false;
      notice(error instanceof Error ? error.message : String(error));
      controls();
    });
    controls();
  }

  async function openAndReceive(udid: string, sessionEpoch: number, signal: AbortSignal) {
    const connectionStartedAt = performance.now();
    const streamPlatform = platform;
    const physicalIos = selected?.udid === udid && selected.kind === "physical" && selected.platform === "ios";
    const closeTool = physicalIos ? "mobile_ios_mirror_close" : streamPlatform === "android" ? "mobile_android_stream_close" : "mobile_stream_close";
    const openTool = physicalIos ? "mobile_ios_mirror_session" : streamPlatform === "android" ? "mobile_android_stream_session" : "mobile_stream_session";
    const arguments_ = physicalIos ? { udid } : streamPlatform === "android" ? { deviceId: udid } : { udid, fps: 60 };
    const result = await call(openTool, arguments_, { timeout: 45000 });
    const id = result._meta?.sessionId;
    const frameUri = result._meta?.frameUri;
    if (typeof id !== "string" || typeof frameUri !== "string") throw new StopReconnectError("The plugin did not return a stream session.");
    if (signal.aborted || sessionEpoch !== epoch) { await call(closeTool, { sessionId: id }, { timeout: 3000 }).catch(() => {}); return; }
    const data = result.structuredContent as { definition: { screen: { rect: { width: number; height: number } } }; inputStatus?: { state: string }; inputRepairMessage?: string };
    const candidate = result._meta?.bezel as Bezel | undefined;
    const geometry = bezelGeometrySchema.safeParse(candidate);
    const validImage = (value: unknown): value is string => typeof value === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
    setBezel(geometry.success && validImage(candidate?.image)
      ? { ...geometry.data, image: candidate.image, ...(validImage(candidate.mask) ? { mask: candidate.mask } : {}) } : undefined);
    inputBlocked = data.inputStatus?.state === "blocked";
    inputRepairMessage = data.inputRepairMessage ?? "";
    notice();
    if (physicalIos === false) points = { width: data.definition.screen.rect.width, height: data.definition.screen.rect.height };
    stream = { id, frameUri, epoch: sessionEpoch, platform: streamPlatform, physicalIos, controller: new AbortController() };
    ready = false;
    seenFrames = 0;
    firstFrameStartedAt = connectionStartedAt;
    controls();
    const session = stream;
    session.input = createInput(session);
    const receiveSignal = AbortSignal.any([signal, session.controller.signal]);
    try {
      if (session.physicalIos) await receiveIosFrames(session, receiveSignal);
      else if (session.platform === "android") await receiveAndroidFrames(session, receiveSignal);
      else await receiveFrames(session, receiveSignal);
      if (session.controller.signal.aborted) throw session.controller.signal.reason;
    }
    finally { await closePanel(session); }
  }

  const arrivals = new FrameArrivals();
  function observeFrame(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const arrivedAt = performance.timeOrigin + performance.now();
    arrivals.record(event.data, arrivedAt);
  }
  if (platform === "ios") window.addEventListener("message", observeFrame);

  async function receiveFrames(session: PanelStream, signal: AbortSignal) {
    const uri = new URL(session.frameUri);
    const browserProfile = new BrowserProfile();
    browserProfile.start();
    const decoder = new IosVideo(async () => {
      if (signal.aborted || session.epoch !== epoch) return;
      session.input?.clear();
      session.reader?.clearFrames();
      releasePointer(); ready = false;
      notice("Recovering iOS video…"); controls();
      await flushInput(session);
      if (signal.aborted || session.epoch !== epoch) return;
      await call("mobile_stream_reset", { sessionId: session.id }, { signal, timeout: 5000 });
    }, signal, (phase, elapsed, startedAt) => {
      session.reader?.decodeTiming(phase, elapsed);
      browserProfile.decode(phase, startedAt, elapsed);
    });
    const reader = new FrameStream<ImageBitmap>({
      async read(after, readSignal) {
        uri.searchParams.set("after", String(after));
        const resource = await app.readServerResource({ uri: uri.href }, { signal: readSignal, timeout: 15000 });
        const result = readFrame(resource);
        const browserArrivedAt = arrivals.take(uri.href, result.serverPreparedAt) ?? performance.timeOrigin + performance.now();
        browserProfile.response(result.serverPreparedAt,
          browserArrivedAt, result.frame?.sequence ?? null);
        if (result.connectionState === "reconnecting") {
          reader.clearFrames();
          ready = false; cancelPointer(); session.input?.clear();
          notice("Reconnecting…"); controls();
        }
        return { ...result, browserArrivedAt };
      },
      decode: data => decoder.decode(data),
      paint(bitmap) {
        if (signal.aborted || session.epoch !== epoch) return;
        drawFrame(bitmap, bitmap.width, bitmap.height);
      },
      requestPaint: callback => requestAnimationFrame(callback),
      cancelPaint: id => cancelAnimationFrame(id),
    });
    session.reader = reader;
    const stats = setInterval(() => {
      const report = reader.stats();
      const browser = browserProfile.stats(document.visibilityState);
      const diagnostics = JSON.stringify({ ...report, browser, logRenderingEnabled: true });
      console.info("[mobile-dev] Stream timings", diagnostics);
    }, 1000);
    try { await reader.run(signal); }
    finally {
      clearInterval(stats);
      browserProfile.stop();
      decoder.close();
      session.reader = undefined;
      arrivals.clear();
    }
  }

  function drawFrame(image: CanvasImageSource, width: number, height: number) {
    const paintStartedAt = performance.now();
    if (annotations.getSnapshot().selecting && ready) {
      pausedFrame ??= document.createElement("canvas");
      if (pausedFrame.width !== width || pausedFrame.height !== height) { pausedFrame.width = width; pausedFrame.height = height; }
      pausedFrame.getContext("2d")?.drawImage(image, 0, 0);
      seenFrames++;
      return;
    }
    stoppedDisplay = false;
    element("stopped").hidden = true;
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) { canvas.width = width; canvas.height = height; }
    context.drawImage(image, 0, 0);
    if (firstFrameStartedAt !== undefined) {
      const firstFrameElapsed = performance.now() - firstFrameStartedAt;
      recordUiTiming("ui.video.first_frame", firstFrameElapsed);
      firstFrameStartedAt = undefined;
    }
    const paintElapsed = performance.now() - paintStartedAt;
    recordUiTiming("ui.video.paint", paintElapsed);
    const frameMetric = platform === "ios" ? "ui.video.ios.frames" : "ui.video.android.frames";
    countUiEvent(frameMetric);
    frame.hidden = false; element("empty").hidden = true;
    if (!ready) { ready = true; reconnect.connected(); notice(); controls(); }
    if (!seenFrames || resized) fitScreen();
    seenFrames++;
  }

  async function receiveIosFrames(session: PanelStream, signal: AbortSignal) {
    const decoder = new PhysicalIosVideo(image => {
      if (signal.aborted || session.epoch !== epoch) return;
      points = { width: image.displayWidth, height: image.displayHeight };
      drawFrame(image, image.displayWidth, image.displayHeight);
    }, () => {
      if (signal.aborted || session.epoch !== epoch) return;
      session.input?.clear();
      cancelPointer();
      ready = false;
      notice("Recovering physical device video…");
      controls();
      void call("mobile_ios_mirror_reset", { sessionId: session.id }, { timeout: 5000 }).catch(error => {
        console.warn("[mobile-dev] Physical iOS keyframe request failed", error);
      });
    });
    const opened = performance.now();
    try {
      while (signal.aborted === false && session.epoch === epoch) {
        const resource = await app.readServerResource({ uri: session.frameUri }, { signal, timeout: 15000 });
        if (signal.aborted || session.epoch !== epoch) return;
        const content = resource.contents.find(item => item.mimeType === "application/json" && "text" in item);
        if (content === undefined || !("text" in content)) throw new StopReconnectError("The plugin returned an invalid physical device video batch.");
        const value: unknown = JSON.parse(content.text);
        const batch = iosVideoBatchSchema.parse(value);
        if (session.generation !== batch.generation) {
          session.input?.clear();
          cancelPointer();
          ready = false;
          session.generation = batch.generation;
          controls();
        }
        await decoder.accept(batch);
        if (seenFrames === 0 && performance.now() - opened > 15000) throw new Error("The iPhone has not produced a screen frame. Unlock it and retry.");
      }
    } finally { decoder.close(); }
  }

  async function receiveAndroidFrames(session: PanelStream, signal: AbortSignal) {
    const decoder = new AndroidVideo(image => {
      if (signal.aborted || session.epoch !== epoch) return;
      points = { width: image.displayWidth, height: image.displayHeight };
      drawFrame(image, image.displayWidth, image.displayHeight);
    }, () => {
      if (signal.aborted || session.epoch !== epoch) return;
      void call("mobile_android_stream_reset", { sessionId: session.id }, { timeout: 5000 }).catch(() => {});
    }, () => {
      if (signal.aborted || session.epoch !== epoch) return;
      session.input?.clear();
      releasePointer(); ready = false;
      notice("Recovering Android video…"); controls();
    });
    const uri = new URL(session.frameUri);
    let after = 0;
    let lastFrame = performance.now();
    let previousFrames = seenFrames;
    let generation = -1;
    try {
      while (!signal.aborted && session.epoch === epoch) {
        uri.searchParams.set("after", String(after));
        const resource = await app.readServerResource({ uri: uri.href }, { signal, timeout: 15000 });
        if (signal.aborted || session.epoch !== epoch) return;
        const content = resource.contents.find(item => item.mimeType === "application/json" && "text" in item);
        if (!content || !("text" in content)) throw new Error("The plugin returned an invalid Android video batch.");
        const batch = JSON.parse(content.text) as AndroidVideoBatch;
        after = batch.sequence;
        if (generation !== batch.generation) { generation = batch.generation; session.input?.clear(); releasePointer(); ready = false; controls(); }
        await decoder.accept(batch);
        if (seenFrames !== previousFrames) { lastFrame = performance.now(); previousFrames = seenFrames; }
        if (performance.now() - lastFrame > 15000) throw new Error("Android video stopped producing frames. Reconnecting.");
      }
    } finally { decoder.close(); }
  }

  async function listDevices() {
    if (listing) return listing;
    listing = readDevices();
    try { await listing; }
    finally { listing = undefined; }
  }

  async function readDevices() {
    const revision = ++statusRevision;
    const simulatorRead = call(platform === "android" ? "mobile_list_android_devices" : "mobile_list_simulators");
    if (platform === "android") {
      const result = await simulatorRead;
      if (revision === statusRevision && !disposed) {
        renderStatus(result.structuredContent as Status);
        if (!busy && !reconnect.active) await connect();
      }
      return;
    }
    const physicalRead = call("mobile_list_ios_devices");
    const results = await Promise.allSettled([simulatorRead, physicalRead]);
    if (revision !== statusRevision || disposed) return;
    const [simulators, physical] = results;
    const errors: string[] = [];
    let next: Status;
    if (simulators.status === "fulfilled") next = simulators.value.structuredContent as Status;
    else {
      const error = simulators.reason instanceof Error ? simulators.reason.message : String(simulators.reason);
      next = { connected: false, managed: false, baseUrl: "", devices: [], error };
    }
    if (next.error) errors.push(next.error);
    if (physical.status === "fulfilled") {
      const data = physical.value.structuredContent as { physicalDevices: PhysicalIosDevice[] };
      physicalDevices = data.physicalDevices.filter(device => device.state === "connected");
    } else {
      physicalDevices = [];
      const error = physical.reason instanceof Error ? physical.reason.message : String(physical.reason);
      errors.push(error);
    }
    discoveryError = errors.join(" · ");
    renderStatus(next);
    notice();
  }

  function scheduleDiscovery() {
    if (disposed || discoveryTimer !== undefined) return;
    discoveryTimer = setTimeout(async () => {
      discoveryTimer = undefined;
      try {
        if (document.visibilityState === "visible" && !root.hidden && !busy && toolsAvailable) await listDevices();
      } catch (error) {
        notice(error instanceof Error ? error.message : String(error));
      } finally { scheduleDiscovery(); }
    }, 3000);
  }

  async function start() {
    await listDevices();
    if (!selected) return;
    if (selected.kind === "physical") {
      const connected = selected.platform === "ios" ? selected.state === "connected" : selected.state === "Booted";
      if (connected) await connect();
      return;
    }
    if (selected.state !== "Booted") {
      empty("Starting simulator…", "The screen will appear when the device is ready.");
      const before = selected;
      const result = await call(platform === "android" ? "mobile_boot_android_emulator" : "mobile_boot_simulator",
        platform === "android" ? { deviceId: before.udid } : { udid: before.udid }, { timeout: 150000 });
      renderStatus(result.structuredContent as Status);
      if (platform === "android") {
        const booted = status?.devices.find(device => device.kind !== "physical" && device.name === before.name && device.state === "Booted");
        if (booted) { devices.value = booted.udid; selectDevice(); }
      }
    }
    await connect();
  }

  devices.refresh = async () => { if (!busy && !disposed && toolsAvailable) await listDevices(); };

  devices.stop = async id => {
    const device = status?.devices.find(device => device.udid === id);
    if (busy || disposed || !toolsAvailable || device?.state !== "Booted") throw new Error("This device is no longer running.");
    if (device.kind === "physical") throw new Error("Only simulators and emulators can be stopped from this panel.");
    const wasSelected = selected?.udid === id;
    statusRevision++;
    busy = true;
    controls();
    try {
      if (wasSelected) await disconnect();
      const result = await call(platform === "android" ? "mobile_shutdown_android_emulator" : "mobile_shutdown_simulator", platform === "android" ? { deviceId: id } : { udid: id }, { timeout: 30000 });
      const next = result.structuredContent as Status;
      const selectedId = wasSelected && platform === "android" ? next.devices.find(item => item.kind !== "physical" && item.name === device.name)?.udid : selected?.udid;
      if (wasSelected && next.connected) stoppedDisplay = true;
      renderStatus(next, selectedId);
      if (wasSelected && stoppedDisplay) {
        element("empty").hidden = true;
        element("stopped").hidden = false;
        fitScreen();
      }
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
      await listDevices().catch(() => {});
      if (wasSelected && selected?.udid === id && selected.state === "Booted") await connect().catch(() => {});
      throw error;
    } finally { busy = false; controls(); }
  };

  function mappedPoint(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const dimensions = annotations.getSnapshot().selecting ? annotations.getSnapshot().capture?.screen ?? points : points;
    return {
      x: Math.max(0, Math.min(dimensions.width, (event.clientX - rect.left) / rect.width * dimensions.width)),
      y: Math.max(0, Math.min(dimensions.height, (event.clientY - rect.top) / rect.height * dimensions.height)),
    };
  }

  let annotationPointer: number | undefined;
  const cancelAnnotationPointer = () => {
    annotations.cancelSelection();
    if (annotationPointer !== undefined && canvas.hasPointerCapture(annotationPointer)) canvas.releasePointerCapture(annotationPointer);
    annotationPointer = undefined;
  };
  canvas.addEventListener("pointerdown", event => {
    if (annotations.getSnapshot().selecting && event.button === 0) {
      event.preventDefault();
      if (annotations.beginSelection(mappedPoint(event))) {
        annotationPointer = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        canvas.focus();
      }
      return;
    }
    if (annotations.getSnapshot().draft) return;
    if (!ready || inputBlocked || busy || event.button !== 0 || pointer) return;
    const position = mappedPoint(event);
    const edge = position.y > points.height - 14 ? "bottom" : position.y < 14 ? "top" : undefined;
    pointer = { id: event.pointerId, ...position, edge };
    canvas.setPointerCapture(event.pointerId); canvas.focus();
    send({ type: "touch1-down", ...position, ...points, ...(edge ? { edge } : {}) });
  });
  canvas.addEventListener("pointermove", event => {
    if (annotations.getSnapshot().selecting) { if (annotationPointer === undefined || annotationPointer === event.pointerId) annotations.hover(mappedPoint(event)); return; }
    if (!pointer || pointer.id !== event.pointerId) return;
    Object.assign(pointer, mappedPoint(event));
    send({ type: "touch1-move", x: pointer.x, y: pointer.y, ...points, ...(pointer.edge ? { edge: pointer.edge } : {}) });
  });
  canvas.addEventListener("pointerleave", () => { if (annotationPointer === undefined) annotations.hover(); });
  canvas.addEventListener("pointerup", event => {
    if (annotationPointer === event.pointerId) {
      annotations.endSelection(mappedPoint(event));
      cancelAnnotationPointer();
      return;
    }
    if (pointer?.id === event.pointerId) releasePointer();
  });
  canvas.addEventListener("pointercancel", cancelAnnotationPointer);
  canvas.addEventListener("lostpointercapture", cancelAnnotationPointer);
  window.addEventListener("blur", cancelAnnotationPointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);
  window.addEventListener("blur", releasePointer);
  canvas.addEventListener("keydown", event => {
    if (annotations.getSnapshot().selecting || annotations.getSnapshot().draft) {
      if (event.key === "Escape") { event.preventDefault(); cancelAnnotationPointer(); annotations.exit(); }
      return;
    }
    if (stream?.physicalIos) return;
    if (!ready || inputBlocked || busy || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[\x20-\x7e]$/.test(event.key)) {
      event.preventDefault(); send({ type: "type", text: event.key });
    } else if (/^(Enter|Escape|Backspace|Tab|Arrow(Up|Down|Left|Right))$/.test(event.code)) {
      event.preventDefault(); send({ type: "key", code: event.code, modifiers: event.shiftKey ? ["shift"] : [] });
    }
  });
  devicePickerElement.addEventListener("change", () => { void action(async () => { await disconnect(); selectDevice(); await start(); }); });
  element("start-device").addEventListener("click", () => { void action(start); });
  root.querySelectorAll<HTMLButtonElement>("[data-button]").forEach(button => {
    button.addEventListener("click", () => { send({ type: "button", button: button.dataset.button === "home" ? "home" : "app-switcher" }); });
  });
  screenshotButton.addEventListener("click", () => { void action(async () => {
    if (!selected || !selectedDeviceConnected() || !panelContext.canAttachScreenshots) return;
    const simulator = selected;
    const screenshotStatus = element("screenshot-status");
    screenshotStatus.hidden = false;
    function screenshotMessage(message: string) {
      screenshotStatus.textContent = message;
      screenshotStatus.title = message;
    }
    screenshotMessage("Taking screenshot…");
    try {
      const physicalIos = simulator.kind === "physical" && simulator.platform === "ios";
      let tool: string;
      let parameters: Record<string, unknown>;
      if (physicalIos) {
        if (!ready || !stream?.physicalIos) throw new Error("Wait for the device screen to load.");
        const capture = captureScreen();
        tool = "mobile_ios_mirror_capture_screenshot";
        parameters = { sessionId: stream.id, image: capture.screenshot.data };
      } else {
        tool = platform === "android" ? "mobile_android_capture_screenshot" : "mobile_capture_screenshot";
        parameters = platform === "android" ? { deviceId: simulator.udid } : { udid: simulator.udid };
      }
      const result = await call(tool, parameters, { timeout: 30000 });
      const image = result.content.find(item => item.type === "image" && item.mimeType === "image/png");
      if (!image || image.type !== "image") throw new Error("The plugin did not return a PNG screenshot.");
      const clipboard = result.structuredContent as { copied: boolean; clipboardError?: string };
      const clipboardStatus = clipboard.copied ? "Copied to clipboard." : `Clipboard copy failed: ${clipboard.clipboardError ?? "Unknown error"}.`;
      let attached = false;
      try { attached = await panelContext.attachScreenshot({ id: crypto.randomUUID(), data: image.data, simulator }); }
      catch (error) {
        captureUiError(error, "screenshot.attach");
        screenshotMessage(`${clipboardStatus} Chat attachment failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      screenshotMessage(`${attached ? "Screenshot attached to chat." : "Screenshot removed from chat."} ${clipboardStatus}`);
    } catch (error) {
      captureUiError(error, "screenshot.capture");
      screenshotMessage(error instanceof Error ? error.message : String(error));
    }
  }); });
  root.addEventListener("pointerdown", activate, { capture: true });
  root.addEventListener("focusin", activate);
  function activate() { selectionChanged(selected, true); }
  function resume() {
    if (busy) { resumeRequested = true; return Promise.resolve(); }
    return action(connect);
  }
  function onVisibility() {
    const connected = selectedDeviceConnected();
    if (document.visibilityState === "hidden") void disconnect();
    else if (toolsAvailable && connected && !ready && !disposed) void resume();
  }
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onVisibility);
  window.addEventListener("focus", onVisibility);

  controls();
  return {
    root,
    platform,
    get selected() { return selected; },
    fitScreen,
    controls,
    notice,
    empty,
    resume,
    load: () => action(async () => { await listDevices(); scheduleDiscovery(); await connect(); }),
    acceptStatus(next: Status) { renderStatus(next); if (toolsAvailable && !reconnect.active) void resume(); },
    setAvailable(value: boolean) { toolsAvailable = value; controls(); },
    dispose() {
      if (disposing) return disposing;
      disposed = true;
      clearTimeout(discoveryTimer);
      devices.stop = undefined;
      devices.refresh = undefined;
      settings.dispose();
      stopObservingAnnotations();
      annotations.dispose();
      toolsAvailable = false;
      resizeObserver.disconnect();
      window.removeEventListener("blur", releasePointer);
      window.removeEventListener("blur", cancelAnnotationPointer);
      window.removeEventListener("message", observeFrame);
      arrivals.clear();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
      window.removeEventListener("focus", onVisibility);
      root.removeEventListener("pointerdown", activate, { capture: true });
      root.removeEventListener("focusin", activate);
      return disposing = disconnect();
    },
  };
}
