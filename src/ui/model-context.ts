import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { StackedLog } from "../shared/logs.ts";
import { formatLogContext, logKey } from "../shared/logs.ts";
import { ANNOTATION_EDIT_PROMPT, annotationDetails, formatAnnotationContext, formatAnnotationMessage } from "../shared/screen-annotations.ts";
import type { ScreenAnnotation } from "../shared/screen-annotations.ts";
import { captureUiError, countUiEvent, recordUiTiming } from "./telemetry.ts";

export type ScreenshotAttachment = { id: string; data: string; simulator: SimulatorDevice };

function composerUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no (?:active |available )?composer|composer.*(?:unavailable|not available|not active)|requires? an (?:active|available) composer|MCP app messages are disabled for this view)/i.test(message);
}

// A cached panel can become visible before its chat's composer registers again.
async function withComposer<T>(request: () => Promise<T>): Promise<T> {
  const delays = [100, 250, 500, 1000];
  for (let attempt = 0; ; attempt++) {
    try { return await request(); }
    catch (error) {
      if (!composerUnavailable(error) || attempt >= delays.length) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
}

export class PanelContext {
  private simulator?: SimulatorDevice;
  private simulators: SimulatorDevice[] = [];
  private attached?: StackedLog;
  private screenshots: ScreenshotAttachment[] = [];
  private annotations: ScreenAnnotation[] = [];
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private updateId?: string;
  private revision = 0;
  private pending = false;
  private deferred = false;
  private pendingAnnotations = new Set<string>();
  private resuming?: Promise<void>;
  private selectionKey?: string;
  private readonly app: App;
  private readonly extensions: OpenAIExtensions;
  onChange = () => {};

  constructor(app: App, extensions: OpenAIExtensions) { this.app = app; this.extensions = extensions; }
  get canAttach() { return !!this.extensions.modelContext; }
  get canSendMessage() { return !!this.app.getHostCapabilities()?.message?.text; }
  get canAttachScreenshots() { return this.canAttach && !!this.app.getHostCapabilities()?.updateModelContext?.image; }
  get attachedKey() { return this.attached ? logKey(this.attached) : undefined; }
  get screenAnnotations() { return this.annotations; }
  get annotationsPending() { return this.pendingAnnotations.size > 0; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { this.onChange(); for (const listener of this.listeners) listener(); }

  async attachAnnotation(annotation: ScreenAnnotation) {
    if (!this.canAttach) throw new Error("This host does not support screen annotations.");
    const previous = this.annotations;
    this.annotations = [...previous.filter(item => item.id !== annotation.id), annotation];
    const revision = ++this.revision;
    try { await this.publish(); }
    catch (error) {
      if (composerUnavailable(error)) { if (this.annotations.some(item => item.id === annotation.id)) this.pendingAnnotations.add(annotation.id); }
      else { if (this.revision === revision) this.annotations = previous; throw error; }
    }
    finally { this.changed(); }
    return this.annotations.some(item => item.id === annotation.id);
  }

  async removeAnnotation(id: string) {
    const previous = this.annotations;
    this.annotations = previous.filter(item => item.id !== id);
    const revision = ++this.revision;
    try { await this.publish(); }
    catch (error) {
      if (composerUnavailable(error)) this.pendingAnnotations.delete(id);
      else { if (this.revision === revision) this.annotations = previous; throw error; }
    }
    finally { this.changed(); }
  }

  async sendAnnotationsToChat(simulatorId: string) {
    if (!this.canSendMessage) throw new Error("This host does not support chat messages.");
    const annotations = this.annotations.filter(item => item.simulator.udid === simulatorId);
    if (!annotations.length) return;
    const startedAt = performance.now();
    const text = this.canAttach ? ANNOTATION_EDIT_PROMPT : formatAnnotationMessage(annotations);
    recordUiTiming("ui.annotations.message_build", performance.now() - startedAt);
    if (annotations.some(annotation => !this.annotations.some(item => item.id === annotation.id))) throw new Error("Annotations were removed from chat before sending.");
    const sendStartedAt = performance.now();
    try {
      // Deferred notes need confirmed attachments before sending the short prompt.
      if (this.canAttach && annotations.some(annotation => this.pendingAnnotations.has(annotation.id))) await this.publish();
      const result = await withComposer(() => {
        if (annotations.some(annotation => !this.annotations.some(item => item.id === annotation.id))) throw new Error("Annotations were removed from chat before sending.");
        return this.app.sendMessage({ role: "user", content: [
          { type: "text", text },
        ], _meta: { "openai/message": { target: "active", send: true } } }, { timeout: 5000, maxTotalTimeout: 5000 });
      });
      if (result.isError) throw new Error("Could not send these annotations to chat.");
      const sent = new Set(annotations.map(item => item.id));
      this.annotations = this.annotations.filter(item => !sent.has(item.id));
      for (const id of sent) this.pendingAnnotations.delete(id);
      this.revision++; this.changed();
      countUiEvent("ui.annotations.send_success");
    } catch (error) {
      if (composerUnavailable(error)) {
        countUiEvent("ui.annotations.send_composer_unavailable");
        throw new Error("Codex could not find this chat's input. Try reopening the chat, or copy the notes and paste them into chat.");
      }
      // A timeout does not prove delivery failed. Never retry it automatically.
      if (typeof error === "object" && error !== null && "code" in error && error.code === -32001) {
        countUiEvent("ui.annotations.send_timeout");
        throw new Error("Codex did not confirm delivery. Check the chat before retrying to avoid sending the notes twice.");
      }
      countUiEvent("ui.annotations.send_failure");
      captureUiError(new Error("Annotation chat send failed."), "annotations.send");
      throw error;
    } finally { recordUiTiming("ui.annotations.send", performance.now() - sendStartedAt); }
  }

  async sendLogToChat(log: StackedLog) {
    if (!this.canSendMessage) throw new Error("This host does not support chat messages.");
    const prompt = log.level === "error" || log.level === "warn"
      ? "Help me fix this log's underlying issue."
      : "Explain this log and whether I need to take any action.";
    const result = await this.app.sendMessage({ role: "user", content: [{ type: "text", text: `${prompt}\n\n${formatLogContext(log)}` }] });
    if (result.isError) throw new Error("Could not send this log to chat.");
  }

  selectSimulator(simulator?: SimulatorDevice) {
    this.selectSimulators(simulator ? [simulator] : [], simulator);
  }

  selectSimulators(simulators: SimulatorDevice[], active?: SimulatorDevice) {
    const devices = simulators.map(device => {
      const transport = device.kind === "physical" ? device.transportType : null;
      return [device.udid, device.name, device.runtime, device.state, device.platform ?? "ios", device.kind, transport];
    });
    const key = JSON.stringify([active?.udid, devices]);
    if (key === this.selectionKey) return;
    this.selectionKey = key;
    this.simulators = simulators;
    this.simulator = active;
    void this.publish().catch(() => {});
  }

  async attach(log?: StackedLog) {
    if (!this.canAttach) throw new Error("This host does not support log attachments.");
    const previous = this.attached;
    this.attached = log;
    const revision = ++this.revision;
    try { await this.publish(); }
    catch (error) { if (this.revision === revision) this.attached = previous; throw error; }
    finally { this.changed(); }
  }

  async attachScreenshot(screenshot: ScreenshotAttachment): Promise<boolean> {
    if (!this.canAttachScreenshots) throw new Error("This host does not support screenshot attachments.");
    const previous = this.screenshots;
    this.screenshots = [...previous, screenshot];
    const revision = ++this.revision;
    try { await this.publish(); }
    catch (error) { if (this.revision === revision) this.screenshots = previous; throw error; }
    return this.screenshots.some(item => item.id === screenshot.id);
  }

  hostChanged() {
    const current = this.extensions.modelContext?.getCurrent();
    if (current === undefined) return;
    const logPresent = this.attached && (current?.content
      ? current.content.some(item => item.type === "text" && item.text === formatLogContext(this.attached!))
      : current?.structuredContent?.selectedLogKey === this.attachedKey);
    const remaining = this.screenshots.filter(screenshot => current?.content
      ? current.content.some(item => item.type === "image" && item.data === screenshot.data && item._meta?.["mobile-dev/screenshotId"] === screenshot.id)
      : Array.isArray(current?.structuredContent?.screenshotIds) && current.structuredContent.screenshotIds.includes(screenshot.id));
    const annotations = this.annotations.filter(annotation => this.pendingAnnotations.has(annotation.id) || (current?.content
      ? current.content.some(item => item.type === "text" && item.text === formatAnnotationContext(annotation))
      : Array.isArray(current?.structuredContent?.annotationIds) && current.structuredContent.annotationIds.includes(annotation.id)));
    if (current !== null && current.updateId === this.updateId && (!this.attached || logPresent) && remaining.length === this.screenshots.length && annotations.length === this.annotations.length) return;
    // A clear from the host wins over a pending panel update.
    const removed = (this.attached && !logPresent) || remaining.length !== this.screenshots.length || annotations.length !== this.annotations.length;
    if (removed && (current === null || !this.pending)) {
      if (!logPresent) this.attached = undefined;
      this.screenshots = remaining;
      this.annotations = annotations;
      this.revision++; this.changed();
    }
  }

  resume() {
    if (!this.deferred || this.pending || this.resuming) return;
    this.resuming = this.publish().catch(() => {}).finally(() => { this.resuming = undefined; this.changed(); });
  }

  private publish(): Promise<void> {
    const revision = this.revision;
    const run = this.queue.catch(() => {}).then(async () => {
      if (revision !== this.revision) return;
      const selected = this.simulator;
      const log = this.attached;
      const devices = this.simulators.map(device => {
        const role = device.udid === selected?.udid ? "Active" : "Visible";
        if (device.kind === "physical" && device.platform === "ios") return `${role} physical iOS device: ${device.name}. UDID: ${device.udid}. State: ${device.state}. Transport: ${device.transportType}. The panel mirrors this device through an interactive HEVC stream with pointer taps and drags. Native unified logs use mobile_logs_session with platform ios, kind physical, and this hardware UDID. They do not require launching the app; ordinary print output is unavailable and private values may be redacted. Physical iOS keyboard input, hardware buttons, screenshots, and agent-device control are not implemented yet.`;
        if (device.kind === "physical" && device.platform === "android") return `${role} physical Android device: ${device.name}. Serial: ${device.udid}. State: ${device.state}. Transport: ${device.transportType}. Use this serial with the plugin's agent-device tools and platform android when controlling this device.`;
        return `${role} ${device.platform === "android" ? "Android" : "iOS"} simulator: ${device.name}. Device ID: ${device.udid}. State: ${device.state}. Use this ${device.platform === "android" ? "serial" : "UDID"} with the plugin's agent-device tools and platform ${device.platform ?? "ios"} when controlling this device.`;
      });
      const content = [{ type: "text" as const, annotations: { audience: ["assistant" as const] }, text: devices.length
        ? `Mobile Dev devices. Logs follow the active device.\n${devices.join("\n")}`
        : "Mobile Dev has no selected simulator." },
      ...(log ? [{ type: "text" as const, text: formatLogContext(log), _meta: { "openai/title": `${log.level}: ${log.message.slice(0, 70)}` } }] : []),
      ...this.screenshots.map(screenshot => ({
        type: "image" as const, mimeType: "image/png", data: screenshot.data,
        _meta: { "openai/title": `Screenshot of ${screenshot.simulator.name} (${screenshot.simulator.udid})`, "mobile-dev/screenshotId": screenshot.id },
      })),
      ...this.annotations.map(annotation => ({ type: "text" as const, text: formatAnnotationContext(annotation), _meta: { "openai/title": `${annotation.component.name}: ${annotation.text.replace(/\s+/g, " ").trim()}`, "mobile-dev/annotationId": annotation.id } }))];
      const params = { content, structuredContent: { selectedSimulator: selected ?? null, selectedSimulators: this.simulators, selectedLog: log ?? null, selectedLogKey: log ? logKey(log) : null, screenshotIds: this.screenshots.map(item => item.id), annotationIds: this.annotations.map(item => item.id), screenAnnotations: this.annotations.map(annotationDetails) } };
      this.pending = true;
      try {
        await withComposer(async () => {
          if (revision !== this.revision) return;
          if (this.extensions.modelContext) this.updateId = (await this.extensions.modelContext.update(params, { timeout: 5000 }))?.updateId;
          else await this.app.updateModelContext(params, { timeout: 5000 });
        });
        if (revision === this.revision) { this.deferred = false; this.pendingAnnotations.clear(); }
      } catch (error) {
        if (composerUnavailable(error)) this.deferred = true;
        throw error;
      } finally { this.pending = false; }
      if (revision !== this.revision) void this.publish().catch(() => {});
    });
    this.queue = run;
    return run;
  }
}
