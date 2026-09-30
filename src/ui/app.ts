import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import "@openai/mcp-extensions/app/styles.css";
import "./style.css";
import { bezelGeometrySchema } from "../shared/bezel.ts";
import type { Bezel } from "../shared/bezel.ts";
import type { SimulatorDevice, Status } from "../shared/protocol.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import { PanelContext } from "./model-context.ts";
import { LogsPanel } from "./logs-panel.ts";
import { VideoStream } from "./video-stream.ts";
import { assertStreamPolicy } from "./stream-policy.ts";

const app = new App({ name: "mobile-dev-ui", version: "0.1.18" }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const panelContext = new PanelContext(app, extensions);
const logsPanel = new LogsPanel(app, panelContext);
logsPanel.setLayout(document.documentElement.dataset.view === "workspace");
document.getElementById("tool-logs")!.addEventListener("click", () => logsPanel.show());
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const streamOrigin = element<HTMLMetaElement>("stream-origin").content;
const devices = element<HTMLSelectElement>("devices");
const canvas = element<HTMLCanvasElement>("screen");
const context = canvas.getContext("2d")!;
const frame = element("device-frame");
const stage = element("stage");
const bezelImage = element<HTMLImageElement>("device-bezel");
let bezel: Bezel | undefined;
bezelImage.addEventListener("error", () => { setBezel(); fitScreen(); });
const startButton = element<HTMLButtonElement>("start");
const refreshButton = element<HTMLButtonElement>("refresh");
const repairButton = element<HTMLButtonElement>("repair-input");
let status: Status | undefined;
let selected: SimulatorDevice | undefined;
type PanelStream = { id: string; url: string; epoch: number; video?: VideoStream; pending?: VideoFrame; paint?: number; closing?: Promise<void> };
const setupPanel = element("stream-setup");
const setupButton = element<HTMLButtonElement>("setup-certificate");
const checkCertificateButton = element<HTMLButtonElement>("check-certificate");
let certificateReady = false;
const reconnect = new ReconnectLoop();
let stream: PanelStream | undefined;
let ready = false;
let inputBlocked = false;
let epoch = 0;
let points = { width: 0, height: 0 };
let pointer: { id: number; x: number; y: number; edge?: string } | undefined;
let seenFrames = 0;
let frames = 0;
let frameWindow = performance.now();
let busy = false;
let toolsAvailable = true;

function notice(message = "") {
  if (!message && inputBlocked) message = "Device Hub blocks input. Repairing it closes running simulator apps.";
  element("notice-message").textContent = message;
  element("notice").hidden = !message;
}

function controls() {
  const active = ready && stream != null && !inputBlocked && !busy;
  repairButton.hidden = !inputBlocked;
  repairButton.disabled = busy || !selected || !toolsAvailable;
  devices.disabled = busy || !toolsAvailable || !status?.connected || !status.devices.length;
  refreshButton.disabled = busy || !toolsAvailable;
  startButton.disabled = busy || !toolsAvailable || !certificateReady || !status || (status.connected && !selected);
  setupButton.disabled = busy || !toolsAvailable;
  checkCertificateButton.disabled = busy || !toolsAvailable;
  startButton.textContent = busy ? "Working…" : reconnect.active ? "Pause" : status && !status.connected ? "Retry" : "Start";
  startButton.dataset.streaming = String(reconnect.active);
  document.querySelectorAll<HTMLButtonElement>("[data-button]").forEach(button => { button.disabled = !active; });
}

function send(message: object) {
  if (!ready || !stream || inputBlocked) return;
  stream.video?.send(message);
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

function closePanel(session: PanelStream): Promise<void> {
  if (session.closing) return session.closing;
  session.closing = (async () => {
    session.video?.close();
    if (session.paint != null) cancelAnimationFrame(session.paint);
    session.pending?.close();
    session.pending = undefined;
    if (stream === session) { cancelPointer(); stream = undefined; ready = false; controls(); }
    try { await call("mobile_stream_close", { sessionId: session.id }, { timeout: 3000 }); }
    catch { /* Idle streams also expire on the server. */ }
  })();
  return session.closing;
}

async function disconnect() {
  releasePointer();
  const previous = stream;
  const closing = previous ? closePanel(previous) : Promise.resolve();
  reconnect.stop();
  epoch++;
  stream = undefined;
  ready = false;
  if (inputBlocked) { inputBlocked = false; notice(); }
  element("frame-stats").textContent = "0 fps";
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

async function action(callback: () => Promise<void>) {
  if (busy) return;
  busy = true; controls(); notice();
  try { await callback(); } catch (error) { notice(error instanceof Error ? error.message : String(error)); }
  finally { busy = false; controls(); }
}

function empty(message: string) {
  frame.hidden = true;
  element("empty").hidden = false;
  element("empty").textContent = message;
}

function setBezel(value?: Bezel) {
  bezel = value;
  frame.dataset.bezel = String(!!value);
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
  if (bezel) {
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
new ResizeObserver(fitScreen).observe(stage);

function runtimeLabel(runtime: string) {
  return runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "").replace(/^(iOS|tvOS|watchOS|visionOS)-/, "$1 ").replace(/-/g, ".");
}

function selectDevice() {
  selected = status?.devices.find(device => device.udid === devices.value);
  panelContext.selectSimulator(selected);
  logsPanel.selectSimulator(selected);
  if (certificateReady && !reconnect.active) empty(selected ? "Press Start to open this simulator." : "No simulators. Add an iOS runtime in Xcode.");
  controls();
}

function renderStatus(next: Status) {
  status = next;
  const previous = selected?.udid;
  const oldDevice = next.devices.find(device => device.udid === previous);
  if (reconnect.active && (!next.connected || oldDevice?.state !== "Booted")) void disconnect();
  devices.replaceChildren();
  for (const device of next.devices) {
    const option = document.createElement("option");
    option.value = device.udid;
    option.textContent = `${device.name}${device.runtime ? ` · ${runtimeLabel(device.runtime)}` : ""}${device.state === "Booted" ? " · Running" : ""}`;
    devices.append(option);
  }
  if (previous && oldDevice) devices.value = previous;
  if (!next.devices.length) devices.append(new Option(next.connected ? "No simulators" : "Simulator unavailable"));
  selectDevice();
  if (!next.connected) {
    empty("Could not start the simulator backend.");
    notice(next.error);
  }
}

async function connect() {
  if (!selected || selected.state !== "Booted") return;
  if (!await checkCertificate()) return;
  await disconnect();
  if (frame.hidden) empty("Connecting…");
  const sessionEpoch = epoch;
  const udid = selected.udid;
  reconnect.start(signal => openAndReceive(udid, sessionEpoch, signal), () => {
    ready = false;
    element("frame-stats").textContent = "Reconnecting…";
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
  const result = await call("mobile_stream_session", { udid, fps: 60 }, { timeout: 30000 });
  const id = result._meta?.sessionId;
  const url = result._meta?.streamUrl;
  if (typeof id !== "string" || typeof url !== "string") throw new StopReconnectError("The plugin did not return a stream session.");
  if (signal.aborted || sessionEpoch !== epoch) { await call("mobile_stream_close", { sessionId: id }, { timeout: 3000 }).catch(() => {}); return; }
  try {
    const capabilities = app.getHostCapabilities();
    assertStreamPolicy(url, streamOrigin, capabilities?.sandbox?.csp?.connectDomains);
  } catch (error) {
    await call("mobile_stream_close", { sessionId: id }, { timeout: 3000 }).catch(() => {});
    throw error;
  }
  const data = result.structuredContent as { definition: { screen: { rect: { width: number; height: number } } }; inputStatus?: { state: string } };
  const candidate = result._meta?.bezel as Bezel | undefined;
  const geometry = bezelGeometrySchema.safeParse(candidate);
  const validImage = (value: unknown): value is string => typeof value === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
  setBezel(geometry.success && validImage(candidate?.image)
    ? { ...geometry.data, image: candidate.image, ...(validImage(candidate.mask) ? { mask: candidate.mask } : {}) } : undefined);
  inputBlocked = data.inputStatus?.state === "blocked";
  notice();
  points = { width: data.definition.screen.rect.width, height: data.definition.screen.rect.height };
  stream = { id, url, epoch: sessionEpoch };
  ready = false;
  frames = 0; seenFrames = 0; frameWindow = performance.now();
  controls();
  const session = stream;
  try { await receiveFrames(session, signal); }
  finally { await closePanel(session); }
}

async function receiveFrames(session: PanelStream, signal: AbortSignal) {
  const paint = () => {
    session.paint = undefined;
    const videoFrame = session.pending;
    session.pending = undefined;
    if (videoFrame == null) return;
    try {
      if (signal.aborted || session.epoch !== epoch) return;
      const width = videoFrame.displayWidth;
      const height = videoFrame.displayHeight;
      const resized = canvas.width !== width || canvas.height !== height;
      if (resized) { canvas.width = width; canvas.height = height; }
      context.drawImage(videoFrame, 0, 0);
      frame.hidden = false; element("empty").hidden = true;
      if (!ready) { ready = true; reconnect.connected(); notice(); controls(); }
      if (seenFrames === 0 || resized) fitScreen();
      seenFrames++; frames++;
    } finally { videoFrame.close(); }
  };
  session.video = new VideoStream(session.url, 60, {
    frame: videoFrame => {
      session.pending?.close();
      session.pending = videoFrame;
      if (session.paint == null) session.paint = requestAnimationFrame(paint);
    },
    inputBlocked: message => { inputBlocked = true; cancelPointer(); notice(message); controls(); },
  });
  const stats = setInterval(() => {
    const now = performance.now();
    const elapsed = now - frameWindow;
    const fps = Math.round(frames * 1000 / elapsed);
    element("frame-stats").textContent = `${fps} fps`;
    frames = 0;
    frameWindow = now;
  }, 1000);
  const abort = () => { session.video?.close(); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try { await session.video.finished; }
  finally { clearInterval(stats); signal.removeEventListener("abort", abort); }
}

async function checkCertificate(): Promise<boolean> {
  const result = await call("mobile_certificate_status", {});
  const data = result.structuredContent as { state: string };
  certificateReady = data.state === "ready";
  setupPanel.hidden = certificateReady;
  if (certificateReady) {
    element("stream-setup-status").textContent = "";
  } else {
    frame.hidden = true;
    element("empty").hidden = true;
    element("stream-setup-status").textContent = data.state === "expired"
      ? "Your certificate has expired. Create a new one to continue."
      : data.state === "untrusted" ? "Your certificate needs browser-compatible trust. Press the button to update its macOS Keychain trust." : "";
    setupButton.textContent = data.state === "untrusted" ? "Update certificate trust & enable streaming" : "Create certificate & enable streaming";
  }
  controls();
  return certificateReady;
}

setupButton.addEventListener("click", () => {
  void action(async () => {
    element("stream-setup-status").textContent = "Setting up certificate trust. Approve the macOS Keychain request when it appears…";
    try {
      await call("mobile_setup_certificate", {}, { timeout: 180000 });
      if (await checkCertificate()) await connect();
    } catch (error) {
      element("stream-setup-status").textContent = error instanceof Error ? error.message : String(error);
    }
  });
});
checkCertificateButton.addEventListener("click", () => {
  void action(async () => { if (await checkCertificate()) await connect(); });
});

async function start() {
  const listed = await call("mobile_list_simulators");
  renderStatus(listed.structuredContent as Status);
  if (!selected) return;
  if (selected.state !== "Booted") {
    empty("Starting simulator…");
    const result = await call("mobile_boot_simulator", { udid: selected.udid });
    renderStatus(result.structuredContent as Status);
  }
  await connect();
}

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
devices.addEventListener("change", () => { void action(async () => { await disconnect(); selectDevice(); await connect(); }); });
startButton.addEventListener("click", () => {
  if (reconnect.active) { void action(async () => { await disconnect(); notice(); if (frame.hidden) empty("Stream paused."); }); }
  else void action(start);
});
document.querySelectorAll<HTMLButtonElement>("[data-button]").forEach(button => {
  button.addEventListener("click", () => { send({ type: "button", button: button.dataset.button }); });
});
refreshButton.addEventListener("click", () => { void action(async () => {
  const result = await call("mobile_list_simulators"); renderStatus(result.structuredContent as Status);
  if (!reconnect.active) await connect();
}); });
repairButton.addEventListener("click", () => { void action(async () => {
  if (!selected) return;
  const udid = selected.udid;
  await disconnect();
  empty("Repairing simulator input…");
  await call("mobile_repair_input", { udid });
  await connect();
}); });
window.addEventListener("pagehide", () => { void disconnect(); void logsPanel.dispose(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && reconnect.active && !ready && !busy) void action(connect);
});
app.onteardown = async () => { await Promise.all([disconnect(), logsPanel.dispose()]); return {}; };

function hostContext() {
  const host = app.getHostContext();
  if (host?.theme) applyDocumentTheme(host.theme);
  if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
  const bottomInset = host?.safeAreaInsets?.bottom ?? 0;
  document.documentElement.style.setProperty("--host-safe-bottom", `${Math.max(0, bottomInset)}px`);
  fitScreen();
  panelContext.hostChanged();
}
app.ontoolinput = () => { empty("Loading simulators…"); };
app.ontoolresult = result => {
  if (result.isError) { notice(result.content.filter(item => item.type === "text").map(item => item.text).join("\n")); return; }
  if (result.structuredContent && "devices" in result.structuredContent) {
    renderStatus(result.structuredContent as Status);
    void action(connect);
  }
};
app.addEventListener("hostcontextchanged", hostContext);
void (async () => {
  try {
    await app.connect();
    hostContext();
    const capabilities = app.getHostCapabilities();
    toolsAvailable = !!capabilities?.serverTools && !!capabilities?.serverResources;
    logsPanel.setAvailable(toolsAvailable);
    controls();
    if (toolsAvailable) await checkCertificate();
    else notice("This host cannot call the plugin's simulator tools.");
  } catch (error) {
    notice(error instanceof Error ? error.message : "Could not connect to Codex.");
  }
})();
