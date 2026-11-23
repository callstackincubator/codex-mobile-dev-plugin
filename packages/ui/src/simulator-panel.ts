import { androidNinePatchSkin } from "./android-nine-patch.ts";
import { androidFrameGeometry, androidChromeScale } from "./android-frame-geometry.ts";
import type { DeviceInventory } from "./device-inventory.ts";
import { getDeviceSettings } from "./device-settings.ts";
import { getResourceSaving } from "./resource-saving.ts";
import type { ResourceSavingState } from "@mobile-dev/shared/resource-saving.ts";
import { getAppTools } from "./app-tools.ts";
import type { DeviceSettings } from "@mobile-dev/shared/device-settings.ts";
import { bezelGeometrySchema } from "@mobile-dev/shared/bezel.ts";
import type { Bezel } from "@mobile-dev/shared/bezel.ts";
import type { SimulatorDevice, TouchInput } from "@mobile-dev/shared/protocol.ts";
import { inputSchema } from "@mobile-dev/shared/protocol.ts";
import { physicalConnectionLabel } from "@mobile-dev/shared/ios-devices.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import { captureUiError, countUiEvent, recordUiTiming } from "./telemetry.ts";
import type { PanelContext } from "./model-context.ts";
import { encodeScreenshotAttachment } from "./screenshot-attachment.ts";
import { getScreenAnnotations } from "./screen-annotations.ts";
import { testRecorder } from "./test-recorder.ts";
import type { ScreenAnnotation } from "@mobile-dev/shared/screen-annotations.ts";
import { accessibilityScreen, scaledComponents, screenComponents, screenSize } from "@mobile-dev/shared/screen-annotations.ts";
import { AndroidVideo } from "./android-video.ts";
import { PhysicalIosVideo } from "./ios-mirror-video.ts";
import { iosVideoBatchSchema } from "@mobile-dev/shared/ios-video.ts";
import { FrameStream } from "./frame-stream.ts";
import { frameArrivals, observeFrameArrivals } from "./frame-arrivals.ts";
import { readFrame } from "./read-frame.ts";
import { BrowserProfile } from "./browser-profile.ts";
import { StreamInput } from "./stream-input.ts";
import type { StreamMessage } from "./stream-input.ts";
import { IosVideo } from "./ios-video.ts";
import type { AndroidVideoBatch } from "./android-video.ts";
import type { HostBridge } from "./host-bridge.ts";
import { isDeviceActive } from "./device-layout.ts";
import { isRecordableDevice, recordablePlatform } from "@mobile-dev/shared/panel-target.ts";

export function createSimulatorPanel(
  app: HostBridge,
  root: HTMLElement,
  inventory: DeviceInventory,
  panelContext: PanelContext,
  activate: () => void,
) {
  function element<T extends HTMLElement = HTMLElement>(id: string): T { return root.querySelector(`[data-element="${id}"]`) as T; }
  const platform = inventory.platform;
  const settings = getDeviceSettings(element("settings"));
  const resourceSaving = getResourceSaving(element("settings"));
  const appTools = getAppTools(element("settings"));
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
  let useAndroidNinePatch = false;
  bezelImage.addEventListener("error", () => { setBezel(); fitScreen(); });
  const screenshotButton = element<HTMLButtonElement>("screenshot");
  let selected: SimulatorDevice | undefined;
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
  let visible = true;
  let disposed = false;
  let disposing: Promise<void> | undefined;
  let screenshotAttachmentError = "";
  let discoveryError = "";

  function notice(message = "") {
    if (screenshotAttachmentError) message = screenshotAttachmentError;
    else if (message.length === 0) message = inputRepairMessage || (inputBlocked ? "Simulator input is blocked. Ask Codex to repair it." : inventory.error);
    element("notice-message").textContent = message;
    element("notice").title = message;
    element("notice").classList?.toggle("text-destructive", inputBlocked);
    element("notice").hidden = !message;
  }

  function controls() {
    const deviceToolsUnavailable = busy || !toolsAvailable || selected?.state !== "Booted" || disposed;
    settings.configure(selected?.udid ?? "", deviceToolsUnavailable);
    settings.prefetch();
    const resourceDeviceId = selected?.kind === "emulator" ? `avd:${selected.name}` : selected?.udid ?? "";
    resourceSaving.configure(resourceDeviceId, selected !== undefined && selected.kind !== "physical", busy || !toolsAvailable || disposed);
    // App tools use simctl and adb, which do not reach paired iPhones.
    appTools.configure(platform, selected?.udid ?? "", deviceToolsUnavailable || selected?.kind === "physical" && platform === "ios");
    element<HTMLButtonElement>("start-device").disabled = busy || !toolsAvailable || !selected || selected.kind === "physical" || selected.state === "Booted" || disposed;
    const connected = selectedDeviceConnected();
    const physicalIos = selected?.kind === "physical" && selected.platform === "ios";
    const screenshotReady = physicalIos ? ready && stream?.physicalIos === true : inventory.status?.connected;
    screenshotButton.disabled = busy || !toolsAvailable || !connected || !screenshotReady || !panelContext.canAttachScreenshots || disposed;
    screenshotButton.title = panelContext.canAttachScreenshots ? "Screenshot to chat and clipboard" : "This host does not support screenshot attachments";
    const annotationState = annotations.getSnapshot();
    const frozenSelection = stream != null && annotationState.selecting && annotationState.capture != null;
    annotations.configure(selected, (!ready && !frozenSelection) || busy || !toolsAvailable || !connected || !panelContext.canAttach || disposed);
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
    // Every input can change the screen, so a tree read before it no longer describes what the
    // next tap lands on. Typing and the hardware buttons go through here too, not just touches.
    if (isRecordingSelected()) testRecorder.invalidate();
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
      } catch (error) {
        if (error instanceof Error && "inputBusy" in error && error.inputBusy === true) {
          session.input?.clear();
          cancelPointer();
          notice(error.message);
          return;
        }
        throw error;
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
      const failure = Object.assign(error, { inputBlocked: result._meta?.inputBlocked === true, streamDisconnected: result._meta?.streamDisconnected === true, inputBusy: result._meta?.inputBusy === true });
      throw failure;
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
    if (simulator.kind === "physical" && simulator.platform === "ios") return { tree: [] };
    const screenWidth = annotations.getSnapshot().capture?.screen.width ?? points.width;
    const startedAt = performance.now();
    try {
      try {
        const result = await call("mobile_inspect_ui", { platform, deviceId: simulator.udid, deviceName: simulator.name, screenWidth }, { timeout: 10000 });
        const content = result.structuredContent;
        if (!content?.tree) throw new Error("Component inspection returned no tree.");
        const runtime = content.runtime;
        if (runtime && typeof runtime === "object" && "available" in runtime && runtime.available === true) countUiEvent("ui.annotations.runtime_available");
        if (runtime && typeof runtime === "object" && "truncated" in runtime && runtime.truncated === true) countUiEvent("ui.annotations.inspection_truncated");
        return { tree: content.tree, screen: screenSize(content.screen) };
      } catch {
        // Hosts with an older tool list and failed inspectors can still read AX.
        countUiEvent("ui.annotations.inspection_fallback");
        const result = await call(platform === "android" ? "mobile_android_describe_ui" : "mobile_describe_ui", platform === "android" ? { deviceId: simulator.udid } : { udid: simulator.udid }, { timeout: 5000 });
        const screen = screenSize(result.structuredContent?.screen);
        if (platform === "android" && screen) return { tree: screenComponents(result.structuredContent?.tree, screenWidth / screen.width) };
        return { tree: result.structuredContent?.tree, screen: accessibilityScreen(result.structuredContent?.tree) };
      }
    } finally { recordUiTiming("ui.annotations.inspection", performance.now() - startedAt); }
  };
  /**
   * The Testing Studio panel records from the device this panel shows, and this is how it reads it: not
   * the inspection path the annotation overlay uses, but the e2e runner's own element tree, so a
   * recorded selector resolves to the same element when the test runs. The Testing Studio panel installs
   * that source — it knows the project and the target — and this supplies the device and the
   * screen. Only iOS simulators and Android emulators are wired up; a physical device has no tree here at all.
   */
  const recorderReader = {
    readComponents: async () => {
      if (!selected) return [];
      const { tree, screen } = await testRecorder.readTree(selected.udid, recordablePlatform(selected));
      // `screen` is the space the runner measured in; `points` is the space the mirror maps
      // pointer events into. They agree on an iOS simulator and do not on Android, where scrcpy
      // caps the stream's longest edge while the tree stays in device pixels.
      return screen ? scaledComponents(tree, screen, points) : tree;
    },
    screen: () => points,
    release: () => testRecorder.releaseTree(),
    // Taking the step the menu recorded. `tap` and `type` are the panel's own input messages, so
    // the app advances exactly as a user's own tap would, and the next step is resolved against
    // the screen the test will be on.
    perform: (action:
      | { kind: "tap"; point: { x: number; y: number } }
      | { kind: "type"; text: string }
      | { kind: "swipe"; from: { x: number; y: number }; to: { x: number; y: number } }) => {
      if (action.kind === "tap") send({ type: "tap", x: action.point.x, y: action.point.y, ...points });
      // The stream carries a swipe of its own, so a recorded `swipe` is taken as the gesture it
      // emits rather than merely written down. `duration` is in seconds here, and a third of one
      // is a deliberate drag: fast enough not to be read as a long press, slow enough that the
      // app sees the intermediate touches rather than a jump.
      else if (action.kind === "swipe") {
        send({ type: "swipe", startX: action.from.x, startY: action.from.y, endX: action.to.x, endY: action.to.y, ...points, duration: 0.3 });
      }
      // The runner's `fill` replaces the field's contents; typing on the mirror appends to them, and
      // there is no input message that clears a field. So a `fill` recorded into a field that
      // already has text leaves the app showing something the test will not produce — the step is
      // still right, the screen behind it is not. Non-ASCII is refused by the input schema.
      else if (action.text) send({ type: "type", text: action.text });
    },
  };
  function isRecordingSelected() {
    return selected ? testRecorder.isRecording(selected.udid, recordablePlatform(selected)) : false;
  }
  function detachRecorder() {
    if (selected && isRecordableDevice(selected)) testRecorder.detach(selected.udid, recordablePlatform(selected));
  }

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
  resourceSaving.request = async enabled => {
    if (selected === undefined || selected.kind === "physical" || disposed) throw new Error("Select a simulator or emulator first.");
    const target = { platform, id: selected.udid };
    const args = enabled === undefined ? { target } : { target, enabled };
    const name = enabled === undefined ? "mobile_resource_saving" : "mobile_set_resource_saving";
    const result = await call(name, args, { timeout: 10000 });
    const content = result.structuredContent as { state: ResourceSavingState };
    return content.state;
  };
  resourceSaving.restart = async () => {
    if (selected === undefined || selected.kind === "physical" || disposed) throw new Error("Select a simulator or emulator first.");
    await stop();
    busy = true;
    controls();
    notice();
    try { await start(); }
    finally { busy = false; controls(); }
  };
  appTools.call = async (name, args) => {
    if (!selected || disposed) throw new Error("Select a running device first.");
    return (await call(name, args, { timeout: 60000 })).structuredContent;
  };

  async function action(callback: () => Promise<void>) {
    if (busy || disposed) return;
    screenshotAttachmentError = "";
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

  function acceptDevice(device?: SimulatorDevice) {
    if (disposed) return;
    const wasActive = isDeviceActive(selected);
    const changed = selected?.udid !== device?.udid;
    const active = isDeviceActive(device);
    if (reconnect.active && (changed || !active)) void disconnect();
    if (changed || (wasActive && !active)) detachRecorder();
    selected = device;
    if (selected && isRecordableDevice(selected) && (changed || !wasActive)) {
      testRecorder.attach(selected.udid, recordablePlatform(selected), recorderReader);
    }
    if (device === undefined) {
      empty("Device unavailable", "Reconnect this device or choose another with Add device.");
    } else if (device.kind === "physical" && !active) {
      const description = device.state === "unauthorized"
        ? "Unlock the device and allow USB debugging, or pair it for wireless debugging."
        : "Reconnect the device and check that ADB debugging is enabled.";
      empty(`${device.name} · ${device.state}`, description);
    } else if (!active) {
      element("empty").hidden = true;
      element("stopped").hidden = false;
    } else if (changed || !wasActive) {
      const connection = device.kind === "physical" ? physicalConnectionLabel(device.transportType) : "";
      empty(connection ? `${device.name} · ${connection}` : "Connecting…", "Opening the device screen.");
    }
    controls();
    if (inventory.error !== discoveryError) {
      discoveryError = inventory.error;
      notice();
    }
    if (!reconnect.active && active) void resume();
  }

  async function connect() {
    if (disposed || !visible || !toolsAvailable || !selected) return;
    const connected = selected.kind === "physical" && selected.platform === "ios" ? selected.state === "connected" : selected.state === "Booted";
    if (connected === false) return;
    await disconnect();
    if (!visible || document.visibilityState === "hidden" || disposed) return;
    if (frame.hidden) empty("Connecting…", "Opening the device screen.");
    const sessionEpoch = epoch;
    const udid = selected.udid;
    const showStreamError = (error: unknown) => {
      ready = false;
      const message = error instanceof Error ? error.message : String(error);
      if (selected?.kind === "physical" && selected.platform === "ios") empty("Screen unavailable", message);
      notice(message);
      controls();
    };
    reconnect.start(signal => openAndReceive(udid, sessionEpoch, signal), showStreamError, showStreamError);
    controls();
  }

  async function openAndReceive(udid: string, sessionEpoch: number, signal: AbortSignal) {
    const connectionStartedAt = performance.now();
    const streamPlatform = platform;
    const physicalIos = selected?.udid === udid && selected.kind === "physical" && selected.platform === "ios";
    const closeTool = physicalIos ? "mobile_ios_mirror_close" : streamPlatform === "android" ? "mobile_android_stream_close" : "mobile_stream_close";
    const openTool = physicalIos ? "mobile_ios_mirror_session" : streamPlatform === "android" ? "mobile_android_stream_session" : "mobile_stream_session";
    const arguments_ = physicalIos ? { udid } : streamPlatform === "android" ? { deviceId: udid } : { udid, fps: 60 };
    // Android can wait two minutes for boot before its 30-second backend startup.
    const timeout = streamPlatform === "android" ? 180000 : 45000;
    const result = await call(openTool, arguments_, { signal, timeout });
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

  const stopObservingFrames = platform === "ios" ? observeFrameArrivals() : undefined;

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
        const browserArrivedAt = frameArrivals.take(uri.href, result.serverPreparedAt) ?? performance.timeOrigin + performance.now();
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
    }
  }

  function drawFrame(image: CanvasImageSource, width: number, height: number) {
    const paintStartedAt = performance.now();
    const frozenSelection = annotations.getSnapshot().selecting;
    let resized = false;
    if (frozenSelection) {
      pausedFrame ??= document.createElement("canvas");
      if (pausedFrame.width !== width || pausedFrame.height !== height) { pausedFrame.width = width; pausedFrame.height = height; }
      pausedFrame.getContext("2d")?.drawImage(image, 0, 0);
    } else {
      element("stopped").hidden = true;
      resized = canvas.width !== width || canvas.height !== height;
      if (resized) { canvas.width = width; canvas.height = height; }
      context.drawImage(image, 0, 0);
    }
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
    if (!frozenSelection && (!seenFrames || resized)) fitScreen();
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

  async function start() {
    const device = selected;
    if (!device || disposed) return;
    if (device.kind !== "physical" && device.state !== "Booted") {
      empty("Starting device…", "The screen will appear when the device is ready.");
      await inventory.power(device, true);
    }
    await connect();
  }

  async function stop() {
    const device = selected;
    if (busy || disposed || !toolsAvailable || device?.state !== "Booted") throw new Error("This device is no longer running.");
    busy = true;
    controls();
    try {
      await disconnect();
      await inventory.power(device, false);
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
      await inventory.refresh();
      if (selectedDeviceConnected()) await connect();
      throw error;
    } finally { busy = false; controls(); }
  }

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
    // A click outside the element menu dismisses it rather than recording through it; the menu
    // stops its own pointer events from reaching the canvas at all.
    if (testRecorder.getSnapshot().menu) { testRecorder.closeMenu(); return; }
    // While an agent is recording, the mirror is its screen: a tap landing between the agent's
    // read and its step would resolve that step against a screen that has already moved. Two
    // drivers on one screen is solved by locking, not by hoping.
    if (testRecorder.isAgentRecording(selected?.udid)) return;
    if (!ready || inputBlocked || busy || event.button !== 0 || pointer) return;
    const position = mappedPoint(event);
    const edge: TouchInput["edge"] = position.y > points.height - 14 ? "bottom" : position.y < 14 ? "top" : undefined;
    const touch = { ...position, ...points, ...(edge ? { edge } : {}) };
    // A left click only drives the app, recording or not. Recording a step from it meant every
    // stray tap while finding the next screen became a step the user then had to delete, and it
    // made "tap to drive" and "tap to record" the same gesture. Steps come from the element menu.
    pointer = { id: event.pointerId, ...position, edge };
    canvas.setPointerCapture(event.pointerId); canvas.focus();
    send({ type: "touch1-down", ...touch });
  });
  canvas.addEventListener("pointermove", event => {
    if (annotations.getSnapshot().selecting) { if (annotationPointer === undefined || annotationPointer === event.pointerId) annotations.hover(mappedPoint(event)); return; }
    // While recording, the pointer previews what it would record. Not during a drag: the touch is
    // already going to the device, and the screen under it is no longer the one that was read.
    if (testRecorder.isAgentRecording(selected?.udid)) return;
    if (isRecordingSelected() && !pointer) { void testRecorder.hover(mappedPoint(event)); return; }
    if (!pointer || pointer.id !== event.pointerId) return;
    Object.assign(pointer, mappedPoint(event));
    send({ type: "touch1-move", x: pointer.x, y: pointer.y, ...points, ...(pointer.edge ? { edge: pointer.edge } : {}) });
  });
  canvas.addEventListener("pointerleave", () => {
    if (annotationPointer === undefined) annotations.hover();
    if (isRecordingSelected()) void testRecorder.hover();
  });
  // Right-click asks what can be done with the element the outline is on, instead of the browser's
  // own menu over a canvas that has nothing in it to copy. The menu itself is drawn by the
  // recorder overlay, which already has the outline's rectangle to anchor to.
  // Escape closes the element menu. On the window and in the capture phase, so it beats the
  // canvas's own key handling, which would otherwise forward the key to the device.
  function dismissRecorderMenu(event: KeyboardEvent) {
    if (!isRecordingSelected() || event.key !== "Escape" || !testRecorder.getSnapshot().menu) return;
    event.preventDefault();
    event.stopPropagation();
    testRecorder.closeMenu();
  }
  window.addEventListener("keydown", dismissRecorderMenu, true);
  canvas.addEventListener("contextmenu", event => {
    if (!isRecordingSelected() || annotations.getSnapshot().selecting) return;
    event.preventDefault();
    // The element menu records a step and takes it, which is exactly the second driver the lock
    // exists to stop. The browser's own menu is still suppressed, so the lock is not a regression
    // to a canvas context menu with nothing in it.
    if (testRecorder.isAgentRecording(selected?.udid)) return;
    void testRecorder.openMenu(mappedPoint(event));
  });
  // While recording, the wheel walks the outline out to the enclosing element and back in — the
  // label inside the row, the row inside the card. The mirror has no other use for the wheel.
  // A trackpad sends a burst of small deltas per flick, so steps are accumulated rather than
  // taken per event — otherwise one flick walks straight out to the root.
  let wheelTravel = 0;
  const WHEEL_STEP = 60;
  canvas.addEventListener("wheel", event => {
    if (!isRecordingSelected() || annotations.getSnapshot().selecting) return;
    event.preventDefault();
    if (testRecorder.isAgentRecording(selected?.udid)) return;
    if (wheelTravel !== 0 && Math.sign(event.deltaY) !== Math.sign(wheelTravel)) wheelTravel = 0;
    wheelTravel += event.deltaY;
    while (Math.abs(wheelTravel) >= WHEEL_STEP) {
      testRecorder.walkHover(wheelTravel > 0);
      wheelTravel -= Math.sign(wheelTravel) * WHEEL_STEP;
    }
  }, { passive: false });
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
  function paste(event: ClipboardEvent) {
    const annotationState = annotations.getSnapshot();
    if (annotationState.selecting || annotationState.draft) return;
    if (!ready || !stream || stream.physicalIos || inputBlocked || busy || !toolsAvailable || disposed) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length === 0) return;
    const message = inputSchema.safeParse({ type: "type", text });
    if (message.success === false) {
      notice("Paste supports up to 4,096 printable US-ASCII characters. Line breaks and other characters are not supported.");
      return;
    }
    notice();
    send(message.data);
  }
  canvas.addEventListener("paste", paste);
  element("start-device").addEventListener("click", () => { void action(start); });
  root.querySelectorAll<HTMLButtonElement>("[data-button]").forEach(button => {
    button.addEventListener("click", () => { send({ type: "button", button: button.dataset.button === "home" ? "home" : "app-switcher" }); });
  });
  screenshotButton.addEventListener("click", () => { void action(async () => {
    if (!selected || !selectedDeviceConnected() || !panelContext.canAttachScreenshots) return;
    const simulator = selected;
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
      try {
        const attachment = await encodeScreenshotAttachment(image.data);
        await panelContext.attachScreenshot({ id: crypto.randomUUID(), ...attachment, simulator });
      }
      catch (error) {
        captureUiError(error, "screenshot.attach");
        screenshotAttachmentError = "The screenshot could not be attached to chat.";
        notice();
        return;
      }
    } catch (error) {
      captureUiError(error, "screenshot.capture");
    }
  }); });
  root.addEventListener("pointerdown", activate, { capture: true });
  root.addEventListener("focusin", activate);
  function resume() {
    if (!visible || document.visibilityState === "hidden") return Promise.resolve();
    if (busy) { resumeRequested = true; return Promise.resolve(); }
    return action(connect);
  }
  function onVisibility() {
    const connected = selectedDeviceConnected();
    if (!visible || document.visibilityState === "hidden") void disconnect();
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
    acceptDevice,
    start: () => action(start),
    stop,
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      onVisibility();
    },
    setAvailable(value: boolean) { toolsAvailable = value; controls(); },
    dispose() {
      if (disposing) return disposing;
      disposed = true;
      detachRecorder();
      window.removeEventListener("keydown", dismissRecorderMenu, true);
      settings.dispose();
      resourceSaving.dispose();
      appTools.dispose();
      stopObservingAnnotations();
      annotations.dispose();
      toolsAvailable = false;
      resizeObserver.disconnect();
      window.removeEventListener("blur", releasePointer);
      window.removeEventListener("blur", cancelAnnotationPointer);
      canvas.removeEventListener("paste", paste);
      stopObservingFrames?.();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
      window.removeEventListener("focus", onVisibility);
      root.removeEventListener("pointerdown", activate, { capture: true });
      root.removeEventListener("focusin", activate);
      return disposing = disconnect();
    },
  };
}
