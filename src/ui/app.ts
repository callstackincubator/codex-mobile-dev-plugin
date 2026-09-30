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
import { FrameStream, decodeJpeg } from "./frame-stream.ts";
import { readFrame } from "./read-frame.ts";
import { StreamInput } from "./stream-input.ts";
import { FrameArrivals } from "./frame-arrivals.ts";
import { BrowserProfile } from "./browser-profile.ts";
import { LOG_RENDERING_ENABLED } from "./log-list.ts";
import { epochNow } from "../shared/stream.ts";
import type { StreamMessage } from "./stream-input.ts";

const app = new App({ name: "mobile-dev-ui", version: "0.1.24" }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const frameArrivals = new FrameArrivals();
window.addEventListener("message", event => {
  if (event.source !== window.parent) return;
  const arrivedAt = epochNow();
  frameArrivals.record(event.data, arrivedAt);
});
const panelContext = new PanelContext(app, extensions);
const logsPanel = new LogsPanel(app, panelContext);
logsPanel.setLayout(document.documentElement.dataset.view === "workspace");
document.getElementById("tool-logs")!.addEventListener("click", () => logsPanel.show());
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
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
type PanelStream = { id: string; frameUri: string; epoch: number; reader?: FrameStream<ImageBitmap>; input?: StreamInput; closing?: Promise<void> };
const reconnect = new ReconnectLoop();
let stream: PanelStream | undefined;
let ready = false;
let inputBlocked = false;
let epoch = 0;
let points = { width: 0, height: 0 };
let pointer: { id: number; x: number; y: number; edge?: string } | undefined;
let seenFrames = 0;
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
  startButton.disabled = busy || !toolsAvailable || !status || (status.connected && !selected);
  startButton.textContent = busy ? "Working…" : reconnect.active ? "Pause" : status && !status.connected ? "Retry" : "Start";
  startButton.dataset.streaming = String(reconnect.active);
  document.querySelectorAll<HTMLButtonElement>("[data-button]").forEach(button => { button.disabled = !active; });
}

function send(message: StreamMessage) {
  if (!ready || !stream || inputBlocked) return;
  stream.input?.send(message);
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

function closePanel(session: PanelStream, drainInput = false): Promise<void> {
  if (session.closing) return session.closing;
  session.closing = (async () => {
    session.reader?.close();
    if (drainInput) await session.input?.finish();
    session.input?.close();
    if (stream === session) { cancelPointer(); stream = undefined; ready = false; controls(); }
    try { await call("mobile_stream_close", { sessionId: session.id }, { timeout: 3000 }); }
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
  if (inputBlocked) { inputBlocked = false; notice(); }
  element("frame-stats").textContent = "0 fps";
  element("stream-timings").textContent = "";
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
  if (reconnect.active === false) empty(selected ? "Press Start to open this simulator." : "No simulators. Add an iOS runtime in Xcode.");
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
  const frameUri = result._meta?.frameUri;
  if (typeof id !== "string" || typeof frameUri !== "string") throw new StopReconnectError("The plugin did not return a stream session.");
  if (signal.aborted || sessionEpoch !== epoch) { await call("mobile_stream_close", { sessionId: id }, { timeout: 3000 }).catch(() => {}); return; }
  const data = result.structuredContent as { definition: { screen: { rect: { width: number; height: number } } }; inputStatus?: { state: string } };
  const candidate = result._meta?.bezel as Bezel | undefined;
  const geometry = bezelGeometrySchema.safeParse(candidate);
  const validImage = (value: unknown): value is string => typeof value === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
  setBezel(geometry.success && validImage(candidate?.image)
    ? { ...geometry.data, image: candidate.image, ...(validImage(candidate.mask) ? { mask: candidate.mask } : {}) } : undefined);
  inputBlocked = data.inputStatus?.state === "blocked";
  notice();
  points = { width: data.definition.screen.rect.width, height: data.definition.screen.rect.height };
  stream = { id, frameUri, epoch: sessionEpoch };
  ready = false;
  seenFrames = 0;
  controls();
  const session = stream;
  try { await receiveFrames(session, signal); }
  finally { await closePanel(session); }
}

async function receiveFrames(session: PanelStream, signal: AbortSignal) {
  const browserProfile = new BrowserProfile();
  const reader = new FrameStream<ImageBitmap>({
    read: async (after, readSignal) => {
      const uri = `${session.frameUri}?after=${after}`;
      const result = await app.readServerResource({ uri }, { signal: readSignal, timeout: 15000 });
      const read = readFrame(result);
      const browserArrivedAt = frameArrivals.take(uri, read.serverPreparedAt);
      browserProfile.response(read.serverPreparedAt, browserArrivedAt, read.frame?.sequence ?? null);
      return { ...read, browserArrivedAt };
    },
    decode: data => decodeJpeg(data, (phase, elapsed, startedAt) => {
      reader.decodeTiming(phase, elapsed);
      browserProfile.decode(phase, startedAt, elapsed);
    }),
    requestPaint: callback => requestAnimationFrame(callback),
    cancelPaint: id => cancelAnimationFrame(id),
    paint: bitmap => {
      if (signal.aborted || session.epoch !== epoch) return;
      const resized = canvas.width !== bitmap.width || canvas.height !== bitmap.height;
      if (resized) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
      context.drawImage(bitmap, 0, 0);
      frame.hidden = false;
      element("empty").hidden = true;
      if (!ready) { ready = true; reconnect.connected(); notice(); controls(); }
      if (seenFrames === 0 || resized) fitScreen();
      seenFrames++;
    },
  });
  browserProfile.start();
  session.reader = reader;
  session.input = new StreamInput(async messages => {
    const started = performance.now();
    await call("mobile_stream_input", { sessionId: session.id, messages }, { timeout: 5000 });
    reader.inputTiming(performance.now() - started);
  }, error => {
    if (session.epoch !== epoch || stream !== session) return;
    if (error instanceof Error && "inputBlocked" in error && error.inputBlocked === true) {
      inputBlocked = true;
      cancelPointer();
      notice(error.message);
      controls();
      return;
    }
    reader.fail(error);
  });
  const stats = setInterval(() => {
    const report = reader.stats();
    element("frame-stats").textContent = `${Math.round(report.fps)} fps`;
    element("stream-timings").textContent = `Transfer ${report.bridge.average.toFixed(1)} ms · decode ${report.decode.average.toFixed(1)} ms · frame age ${Math.round(report.receivedToPaint.average)} ms`;
    const details = `Read round trip ${report.read.average.toFixed(1)} ms; server wait ${report.serverWait.average.toFixed(1)} ms; transfer p95 ${report.bridge.p95.toFixed(1)} ms; paint ${report.paint.average.toFixed(1)} ms; input round trip ${report.input.average.toFixed(1)} ms. Frame age starts when the plugin receives the encoded frame.`;
    element("stream-timings").title = details;
    const browser = browserProfile.stats(document.visibilityState);
    const diagnostics = JSON.stringify({ ...report, browser, logRenderingEnabled: LOG_RENDERING_ENABLED });
    console.info("[mobile-dev] Stream timings", diagnostics);
  }, 1000);
  try { await reader.run(signal); }
  finally { clearInterval(stats); browserProfile.stop(); }
}

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
    if (toolsAvailable === false) notice("This host cannot call the plugin's simulator tools.");
  } catch (error) {
    notice(error instanceof Error ? error.message : "Could not connect to Codex.");
  }
})();
