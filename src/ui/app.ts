import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import "@openai/mcp-extensions/app/styles.css";
import "./style.css";
import type { SimulatorDevice, Status } from "../shared/protocol.ts";
import { ReconnectLoop, StopReconnectError } from "./reconnect.ts";
import { PanelContext } from "./model-context.ts";
import { LogsPanel } from "./logs-panel.ts";

const app = new App({ name: "mobile-dev-ui", version: "0.1.7" }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const panelContext = new PanelContext(app, extensions);
const logsPanel = new LogsPanel(app, panelContext);
function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const devices = element<HTMLSelectElement>("devices");
const canvas = element<HTMLCanvasElement>("screen");
const context = canvas.getContext("2d")!;
const frame = element("device-frame");
const stage = element("stage");
const startButton = element<HTMLButtonElement>("start");
const refreshButton = element<HTMLButtonElement>("refresh");
const repairButton = element<HTMLButtonElement>("repair-input");
let status: Status | undefined;
let selected: SimulatorDevice | undefined;
type PanelStream = { id: string; frameUri: string; epoch: number; inputs: object[]; sending?: Promise<void>; closing?: Promise<void> };
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
  startButton.disabled = busy || !toolsAvailable || !status || (status.connected && !selected);
  startButton.textContent = busy ? "Working…" : reconnect.active ? "Pause" : status && !status.connected ? "Retry" : "Start";
  startButton.dataset.streaming = String(reconnect.active);
  document.querySelectorAll<HTMLButtonElement>("[data-button]").forEach(button => { button.disabled = !active; });
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
        await call("mobile_stream_input", { sessionId: session.id, messages: session.inputs.splice(0, 64) }, { timeout: 5000 });
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

function fitScreen() {
  if (frame.hidden || !canvas.width || !canvas.height) return;
  const style = getComputedStyle(stage);
  const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
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
  if (!reconnect.active) empty(selected ? "Press Start to open this simulator." : "No simulators. Add an iOS runtime in Xcode.");
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
  const result = await call("mobile_stream_session", { udid, fps: 30 }, { timeout: 30000 });
  const id = result._meta?.sessionId;
  const frameUri = result._meta?.frameUri;
  if (typeof id !== "string" || typeof frameUri !== "string") throw new StopReconnectError("The plugin did not return a stream session.");
  if (signal.aborted || sessionEpoch !== epoch) { await call("mobile_stream_close", { sessionId: id }, { timeout: 3000 }).catch(() => {}); return; }
  const data = result.structuredContent as { definition: { screen: { rect: { width: number; height: number } } }; inputStatus?: { state: string } };
  inputBlocked = data.inputStatus?.state === "blocked";
  notice();
  points = { width: data.definition.screen.rect.width, height: data.definition.screen.rect.height };
  stream = { id, frameUri, epoch: sessionEpoch, inputs: [] };
  ready = false;
  frames = 0; seenFrames = 0; frameWindow = performance.now();
  controls();
  const session = stream;
  try { await receiveFrames(session, signal); }
  finally { await closePanel(session); }
}

async function receiveFrames(session: PanelStream, signal: AbortSignal) {
  const uri = new URL(session.frameUri);
  let after = 0;
  while (!signal.aborted && session.epoch === epoch) {
    uri.searchParams.set("after", String(after));
    const result = await app.readServerResource({ uri: uri.href }, { signal, timeout: 15000 });
    if (signal.aborted || session.epoch !== epoch) return;
    const image = result.contents.find(item => item.mimeType === "image/jpeg" && "blob" in item);
    if (!image || !("blob" in image)) {
      const idle = result.contents.find(item => item.mimeType === "application/json" && "text" in item);
      if (idle && "text" in idle && JSON.parse(idle.text).state === "reconnecting") {
        ready = false; cancelPointer(); session.inputs.length = 0;
        element("frame-stats").textContent = "Reconnecting…";
        notice("Reconnecting…"); controls();
      }
      continue;
    }
    const sequence = Number(image._meta?.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= after) throw new StopReconnectError("The plugin returned an invalid frame sequence.");
    after = sequence;
    const bytes = Uint8Array.from(atob(image.blob), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    try {
      if (signal.aborted || session.epoch !== epoch) return;
      const resized = canvas.width !== bitmap.width || canvas.height !== bitmap.height;
      if (resized) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
      context.drawImage(bitmap, 0, 0);
      frame.hidden = false; element("empty").hidden = true;
      if (!ready) { ready = true; reconnect.connected(); notice(); controls(); }
      if (!seenFrames || resized) fitScreen();
      seenFrames++; frames++;
      const elapsed = performance.now() - frameWindow;
      if (elapsed >= 1000) {
        element("frame-stats").textContent = `${Math.round(frames * 1000 / elapsed)} fps`;
        frames = 0; frameWindow = performance.now();
      }
    } finally { bitmap.close(); }
  }
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
    if (!toolsAvailable) notice("This host cannot call the plugin's simulator tools.");
  } catch (error) {
    notice(error instanceof Error ? error.message : "Could not connect to Codex.");
  }
})();
