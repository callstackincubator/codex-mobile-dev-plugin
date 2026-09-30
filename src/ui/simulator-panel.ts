import { androidNinePatchSkin } from "./android-nine-patch.ts";
import { androidFrameGeometry, androidChromeScale } from "./android-frame-geometry.ts";
import { getDevicePicker } from "./device-picker.ts";
import { getDeviceSettings } from "./device-settings.ts";
import type { DeviceSettings } from "../shared/device-settings.ts";
import { bezelGeometrySchema } from "../shared/bezel.ts";
import type { Bezel } from "../shared/bezel.ts";
import type { SimulatorDevice, Status } from "../shared/protocol.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import type { PanelContext } from "./model-context.ts";
import { AndroidVideo } from "./android-video.ts";
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
  const bezelImage = element<HTMLImageElement>("device-bezel");
  let bezel: Bezel | undefined;
  let sourceBezel: Bezel | undefined;
  let showFrame = true;
  let stoppedDisplay = false;
  let useAndroidNinePatch = false;
  bezelImage.addEventListener("error", () => { setBezel(); fitScreen(); });
  const screenshotButton = element<HTMLButtonElement>("screenshot");
  let status: Status | undefined;
  let selected: SimulatorDevice | undefined;
  type PanelStream = { id: string; frameUri: string; epoch: number; platform: "ios" | "android"; inputs: object[]; sending?: Promise<void>; closing?: Promise<void> };
  const reconnect = new ReconnectLoop();
  let stream: PanelStream | undefined;
  let ready = false;
  let inputBlocked = false;
  let inputRepairMessage = "";
  let epoch = 0;
  let points = { width: 0, height: 0 };
  let pointer: { id: number; x: number; y: number; edge?: string } | undefined;
  let seenFrames = 0;
  let busy = false;
  let toolsAvailable = false;
  let disposed = false;
  let disposing: Promise<void> | undefined;

  function notice(message = "") {
    if (!message) message = inputRepairMessage || (inputBlocked ? "Simulator input is blocked. Ask Codex to repair it." : "");
    element("notice-message").textContent = message;
    element("notice").title = message;
    element("notice").classList?.toggle("text-destructive", inputBlocked);
    element("notice").hidden = !message;
  }

  function controls() {
    const active = ready && stream != null && !inputBlocked && !busy && toolsAvailable;
    settings.configure(selected?.udid ?? "", busy || !toolsAvailable || selected?.state !== "Booted" || disposed);
    settings.prefetch();
    element<HTMLButtonElement>("start-device").disabled = busy || !toolsAvailable || !selected || selected.state === "Booted" || disposed;
    devices.disabled = busy || !toolsAvailable || !status?.connected || !status.devices.length;
    screenshotButton.disabled = busy || !toolsAvailable || !status?.connected || selected?.state !== "Booted" || !panelContext.canAttachScreenshots;
    screenshotButton.title = panelContext.canAttachScreenshots ? "Screenshot to chat and clipboard" : "This host does not support screenshot attachments";
    root.querySelectorAll<HTMLButtonElement>("[data-button]").forEach(button => { button.disabled = !active; });
  }

  function send(message: object) {
    if (!ready || !stream || inputBlocked) return;
    const previous = stream.inputs.at(-1) as { type?: string } | undefined;
    if ((message as { type?: string }).type === "touch1-move" && previous?.type === "touch1-move") stream.inputs.pop();
    stream.inputs.push(message);
    void flushInput(stream);
  }

  function flushInput(session: PanelStream): Promise<void> {
    if (session.sending) return session.sending;
    if (!session.inputs.length) return Promise.resolve();
    session.sending = (async () => {
      try {
        while (session.inputs.length) {
          await call(session.platform === "android" ? "mobile_android_stream_input" : "mobile_stream_input", { sessionId: session.id, messages: session.inputs.splice(0, 64) }, { timeout: 5000 });
        }
      } catch (error) {
        session.inputs.length = 0;
        if (session.epoch === epoch) {
          const failure = error as Error & { inputBlocked?: boolean; streamDisconnected?: boolean };
          if (failure.inputBlocked) inputBlocked = true;
          if (failure.streamDisconnected) { ready = false; cancelPointer(); }
          notice(failure.streamDisconnected ? "Reconnecting…" : failure.message ?? "Simulator input failed.");
          controls();
        }
      } finally { session.sending = undefined; }
    })();
    return session.sending;
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
      else session.inputs.length = 0;
      if (stream === session) { cancelPointer(); stream = undefined; ready = false; controls(); }
      try { await call(session.platform === "android" ? "mobile_android_stream_close" : "mobile_stream_close", { sessionId: session.id }, { timeout: 3000 }); }
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
    finally { busy = false; controls(); }
  }

  function empty(message: string) {
    stoppedDisplay = false;
    element("stopped").hidden = true;
    frame.hidden = true;
    element("empty").hidden = false;
    element("empty").textContent = message;
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

  function runtimeLabel(runtime: string) {
    return runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "").replace(/^(iOS|tvOS|watchOS|visionOS)-/, "$1 ").replace(/-/g, ".");
  }

  function selectDevice() {
    selected = status?.devices.find(device => device.udid === devices.value);
    selectionChanged(selected);
    if (!reconnect.active && !stoppedDisplay) empty(selected ? "Select a device to open its screen." : (platform === "android" ? "No Android devices. Create an AVD in Android Studio or connect a device." : "No simulators. Add an iOS runtime in Xcode."));
    controls();
  }

  function renderStatus(next: Status, previous = selected?.udid) {
    status = next;
    const oldDevice = next.devices.find(device => device.udid === previous);
    if (reconnect.active && (!next.connected || oldDevice?.state !== "Booted")) void disconnect();
    const running = next.devices.find(device => device.state === "Booted");
    devices.update({
      items: next.devices.map(device => ({ value: device.udid, label: `${device.name}${device.runtime ? ` · ${runtimeLabel(device.runtime)}` : ""}`, kind: /ipad|tablet|pixel.*tab/i.test(device.name) ? "tablet" : "phone", running: device.state === "Booted", canStop: device.state === "Booted" && (platform === "ios" || /^emulator-\d+$/.test(device.udid)) })),
      value: previous && oldDevice ? previous : running?.udid ?? "",
      placeholder: next.devices.length ? "Select a device" : next.connected ? "No simulators" : "Simulator unavailable",
    });
    selectDevice();
    if (!next.connected) {
      empty("Could not start the simulator backend.");
      notice(next.error);
    }
  }

  async function connect() {
    if (disposed || !toolsAvailable || !selected || selected.state !== "Booted") return;
    await disconnect();
    if (frame.hidden) empty("Connecting…");
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
    const streamPlatform = platform;
    const closeTool = streamPlatform === "android" ? "mobile_android_stream_close" : "mobile_stream_close";
    const result = await call(streamPlatform === "android" ? "mobile_android_stream_session" : "mobile_stream_session", streamPlatform === "android" ? { deviceId: udid } : { udid, fps: 30 }, { timeout: 45000 });
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
    points = { width: data.definition.screen.rect.width, height: data.definition.screen.rect.height };
    stream = { id, frameUri, epoch: sessionEpoch, platform: streamPlatform, inputs: [] };
    ready = false;
    seenFrames = 0;
    controls();
    const session = stream;
    try { if (session.platform === "android") await receiveAndroidFrames(session, signal); else await receiveFrames(session, signal); }
    finally { await closePanel(session); }
  }

  async function receiveFrames(session: PanelStream, signal: AbortSignal) {
    const uri = new URL(session.frameUri);
    let after = 0;
    const decoder = new IosVideo(bitmap => {
      if (signal.aborted || session.epoch !== epoch) return;
      drawFrame(bitmap, bitmap.width, bitmap.height);
    }, async () => {
      if (signal.aborted || session.epoch !== epoch) return;
      session.inputs.length = 0;
      releasePointer(); ready = false;
      notice("Recovering iOS video…"); controls();
      await flushInput(session);
      if (signal.aborted || session.epoch !== epoch) return;
      await call("mobile_stream_reset", { sessionId: session.id }, { signal, timeout: 5000 });
    }, signal);
    try {
      while (!signal.aborted && session.epoch === epoch) {
        uri.searchParams.set("after", String(after));
        const result = await app.readServerResource({ uri: uri.href }, { signal, timeout: 15000 });
        if (signal.aborted || session.epoch !== epoch) return;
        const image = result.contents.find(item => item.mimeType === "image/jpeg" && "blob" in item);
        if (!image || !("blob" in image)) {
          const idle = result.contents.find(item => item.mimeType === "application/json" && "text" in item);
          if (idle && "text" in idle && JSON.parse(idle.text).state === "reconnecting") {
            ready = false; cancelPointer(); session.inputs.length = 0;
            notice("Reconnecting…"); controls();
          }
          continue;
        }
        const sequence = Number(image._meta?.sequence);
        if (!Number.isSafeInteger(sequence) || sequence <= after) throw new StopReconnectError("The plugin returned an invalid frame sequence.");
        after = sequence;
        await decoder.accept(image.blob);
      }
    } finally { decoder.close(); }
  }

  function drawFrame(image: CanvasImageSource, width: number, height: number) {
    stoppedDisplay = false;
    element("stopped").hidden = true;
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) { canvas.width = width; canvas.height = height; }
    context.drawImage(image, 0, 0);
    frame.hidden = false; element("empty").hidden = true;
    if (!ready) { ready = true; reconnect.connected(); notice(); controls(); }
    if (!seenFrames || resized) fitScreen();
    seenFrames++;
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
      session.inputs.length = 0;
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
        if (generation !== batch.generation) { generation = batch.generation; session.inputs.length = 0; releasePointer(); ready = false; controls(); }
        await decoder.accept(batch);
        if (seenFrames !== previousFrames) { lastFrame = performance.now(); previousFrames = seenFrames; }
        if (performance.now() - lastFrame > 15000) throw new Error("Android video stopped producing frames. Reconnecting.");
      }
    } finally { decoder.close(); }
  }

  async function listDevices() {
    const result = await call(platform === "android" ? "mobile_list_android_devices" : "mobile_list_simulators");
    renderStatus(result.structuredContent as Status);
  }

  async function start() {
    await listDevices();
    if (!selected) return;
    if (selected.state !== "Booted") {
      empty("Starting simulator…");
      const before = selected;
      const result = await call(platform === "android" ? "mobile_boot_android_emulator" : "mobile_boot_simulator",
        platform === "android" ? { deviceId: before.udid } : { udid: before.udid }, { timeout: 150000 });
      renderStatus(result.structuredContent as Status);
      if (platform === "android") {
        const booted = status?.devices.find(device => device.name === before.name && device.state === "Booted");
        if (booted) { devices.value = booted.udid; selectDevice(); }
      }
    }
    await connect();
  }

  devices.stop = async id => {
    const device = status?.devices.find(device => device.udid === id);
    if (busy || disposed || !toolsAvailable || device?.state !== "Booted") throw new Error("This device is no longer running.");
    const wasSelected = selected?.udid === id;
    busy = true;
    controls();
    try {
      if (wasSelected) await disconnect();
      const result = await call(platform === "android" ? "mobile_shutdown_android_emulator" : "mobile_shutdown_simulator", platform === "android" ? { deviceId: id } : { udid: id }, { timeout: 30000 });
      const next = result.structuredContent as Status;
      const selectedId = wasSelected && platform === "android" ? next.devices.find(item => item.name === device.name)?.udid : selected?.udid;
      if (wasSelected && next.connected) stoppedDisplay = true;
      renderStatus(next, selectedId);
      if (wasSelected && stoppedDisplay) {
        element("empty").hidden = true;
        element("stopped").hidden = false;
        fitScreen();
      }
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
      if (wasSelected) await connect().catch(() => {});
      throw error;
    } finally { busy = false; controls(); }
  };

  function mappedPoint(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(points.width, (event.clientX - rect.left) / rect.width * points.width)),
      y: Math.max(0, Math.min(points.height, (event.clientY - rect.top) / rect.height * points.height)),
    };
  }

  canvas.addEventListener("pointerdown", event => {
    if (!ready || inputBlocked || busy || event.button !== 0 || pointer) return;
    const position = mappedPoint(event);
    const edge = position.y > points.height - 14 ? "bottom" : position.y < 14 ? "top" : undefined;
    pointer = { id: event.pointerId, ...position, edge };
    canvas.setPointerCapture(event.pointerId); canvas.focus();
    send({ type: "touch1-down", ...position, ...points, ...(edge ? { edge } : {}) });
  });
  canvas.addEventListener("pointermove", event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    Object.assign(pointer, mappedPoint(event));
    send({ type: "touch1-move", x: pointer.x, y: pointer.y, ...points, ...(pointer.edge ? { edge: pointer.edge } : {}) });
  });
  canvas.addEventListener("pointerup", event => { if (pointer?.id === event.pointerId) releasePointer(); });
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);
  window.addEventListener("blur", releasePointer);
  canvas.addEventListener("keydown", event => {
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
    button.addEventListener("click", () => { send({ type: "button", button: button.dataset.button }); });
  });
  screenshotButton.addEventListener("click", () => { void action(async () => {
    if (!selected || selected.state !== "Booted" || !panelContext.canAttachScreenshots) return;
    const simulator = selected;
    const screenshotStatus = element("screenshot-status");
    screenshotStatus.hidden = false;
    function screenshotMessage(message: string) {
      screenshotStatus.textContent = message;
      screenshotStatus.title = message;
    }
    screenshotMessage("Taking screenshot…");
    try {
      const result = await call(platform === "android" ? "mobile_android_capture_screenshot" : "mobile_capture_screenshot", platform === "android" ? { deviceId: simulator.udid } : { udid: simulator.udid }, { timeout: 30000 });
      const image = result.content.find(item => item.type === "image" && item.mimeType === "image/png");
      if (!image || image.type !== "image") throw new Error("The plugin did not return a PNG screenshot.");
      const clipboard = result.structuredContent as { copied: boolean; clipboardError?: string };
      const clipboardStatus = clipboard.copied ? "Copied to clipboard." : `Clipboard copy failed: ${clipboard.clipboardError ?? "Unknown error"}.`;
      let attached = false;
      try { attached = await panelContext.attachScreenshot({ id: crypto.randomUUID(), data: image.data, simulator }); }
      catch (error) {
        screenshotMessage(`${clipboardStatus} Chat attachment failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      screenshotMessage(`${attached ? "Screenshot attached to chat." : "Screenshot removed from chat."} ${clipboardStatus}`);
    } catch (error) { screenshotMessage(error instanceof Error ? error.message : String(error)); }
  }); });
  root.addEventListener("pointerdown", activate, { capture: true });
  root.addEventListener("focusin", activate);
  function activate() { selectionChanged(selected, true); }
  function resume() { return action(connect); }
  function onVisibility() {
    if (document.visibilityState === "visible" && reconnect.active && !ready && !busy) void resume();
  }
  document.addEventListener("visibilitychange", onVisibility);

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
    load: () => action(async () => { await listDevices(); await connect(); }),
    acceptStatus(next: Status) { renderStatus(next); if (toolsAvailable) void resume(); },
    setAvailable(value: boolean) { toolsAvailable = value; controls(); },
    dispose() {
      if (disposing) return disposing;
      disposed = true;
      devices.stop = undefined;
      settings.dispose();
      toolsAvailable = false;
      resizeObserver.disconnect();
      window.removeEventListener("blur", releasePointer);
      document.removeEventListener("visibilitychange", onVisibility);
      root.removeEventListener("pointerdown", activate, { capture: true });
      root.removeEventListener("focusin", activate);
      return disposing = disconnect();
    },
  };
}
