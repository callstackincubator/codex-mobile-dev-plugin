import { canMessage, ChatDeliveryError, composerUnavailable, deliveryFailure, sendChat, withComposer } from "./chat-message.ts";
import type { HostAttachmentsSource, HostBridge } from "./host-bridge.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import { formatDeviceContext } from "@mobile-dev/shared/devices.ts";
import type { StackedLog } from "@mobile-dev/shared/logs.ts";
import { formatLogContext, logKey } from "@mobile-dev/shared/logs.ts";
import { ANNOTATION_EDIT_GUIDANCE, ANNOTATION_EDIT_PROMPT, formatAnnotationContext, formatAnnotationDraft } from "@mobile-dev/shared/screen-annotations.ts";
import type { ScreenAnnotation } from "@mobile-dev/shared/screen-annotations.ts";
import { captureUiError, countUiEvent, recordUiTiming } from "./telemetry.ts";
import type { EncodedScreenshotAttachment } from "./screenshot-attachment.ts";

export type ScreenshotAttachment = EncodedScreenshotAttachment & { id: string; simulator: SimulatorDevice };

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
  private readonly app: HostBridge;
  private readonly attachments: HostAttachmentsSource;
  private contextReady = false;

  constructor(app: HostBridge, attachments: HostAttachmentsSource = () => undefined) { this.app = app; this.attachments = attachments; }
  get usesHostAttachments() { return !!this.attachments(); }
  get canAttach() { return this.usesHostAttachments || !!this.app.getHostCapabilities()?.updateModelContext?.text; }
  get attachmentCount() { return Number(!!this.attached) + this.screenshots.length + this.annotations.length; }
  get canSendMessage() { return canMessage(this.app); }
  get canAttachScreenshots() { return this.canAttach && !!this.app.getHostCapabilities()?.updateModelContext?.image; }
  get attachedKey() { return this.attached ? logKey(this.attached) : undefined; }
  get screenAnnotations() { return this.annotations; }
  get annotationsPending() { return this.pendingAnnotations.size > 0; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { for (const listener of this.listeners) listener(); }

  /**
   * Changes the attachments and publishes them. A failed publish restores what `mutate`
   * replaced, unless a newer change replaced it again; with `deferred`, a chat whose
   * composer has not registered yet keeps the change for `resume` instead.
   */
  private async commit(mutate: () => void, deferred?: () => void) {
    const previous = { attached: this.attached, screenshots: this.screenshots, annotations: this.annotations };
    mutate();
    const revision = ++this.revision;
    try { await this.publish(); }
    catch (error) {
      if (deferred && composerUnavailable(error)) deferred();
      else { if (this.revision === revision) Object.assign(this, previous); throw error; }
    }
    finally { this.changed(); }
  }

  async attachAnnotation(annotation: ScreenAnnotation) {
    if (!this.canAttach) throw new Error("This host does not support screen annotations.");
    const attached = () => this.annotations.some(item => item.id === annotation.id);
    await this.commit(() => { this.annotations = [...this.annotations.filter(item => item.id !== annotation.id), annotation]; },
      () => { if (attached()) this.pendingAnnotations.add(annotation.id); });
    return attached();
  }

  async removeAnnotation(id: string) {
    await this.commit(() => { this.annotations = this.annotations.filter(item => item.id !== id); }, () => { this.pendingAnnotations.delete(id); });
  }

  async sendAnnotationsToChat(simulatorId?: string) {
    if (!this.canSendMessage) throw new Error("This host does not support chat messages.");
    const annotations = this.annotations.filter(item => !simulatorId || item.simulator.udid === simulatorId);
    if (!annotations.length) return;
    const startedAt = performance.now();
    const hostAttachments = this.usesHostAttachments;
    const text = hostAttachments ? ANNOTATION_EDIT_PROMPT : formatAnnotationDraft(annotations);
    const revision = this.revision;
    recordUiTiming("ui.annotations.message_build", performance.now() - startedAt);
    const removed = () => annotations.some(annotation => !this.annotations.some(item => item.id === annotation.id));
    if (removed()) throw new Error("Annotations were removed from chat before sending.");
    const sendStartedAt = performance.now();
    try {
      // Publish first so widget context, where a host exposes it, matches the draft.
      if (!hostAttachments || annotations.some(annotation => this.pendingAnnotations.has(annotation.id))) await this.publish();
      await sendChat(this.app, text, { check: () => {
        if (!hostAttachments && revision !== this.revision) throw new Error("Notes changed while preparing the draft. Add them to chat again.");
        if (removed()) throw new Error("Annotations were removed from chat before sending.");
      } });
      // Standard hosts can acknowledge a composer draft before the user sends
      // it. Keep its context and local notes until explicit removal/clearing.
      if (hostAttachments) {
        const sent = new Set(annotations.map(item => item.id));
        this.annotations = this.annotations.filter(item => !sent.has(item.id));
        for (const id of sent) this.pendingAnnotations.delete(id);
        this.revision++; this.changed();
      }
      countUiEvent("ui.annotations.send_success");
    } catch (error) {
      // The context write before sending can fail the same ways the message can.
      const failure = deliveryFailure(error);
      if (failure === "no-composer") {
        countUiEvent("ui.annotations.send_composer_unavailable");
        throw new Error("The host could not find this chat's input. Try reopening the chat, or copy the notes and paste them into chat.");
      }
      // A timeout does not prove delivery failed. Never retry it automatically.
      if (failure === "unconfirmed") {
        countUiEvent("ui.annotations.send_timeout");
        throw new Error("The host did not confirm delivery. Check the chat before retrying to avoid sending the notes twice.");
      }
      countUiEvent("ui.annotations.send_failure");
      captureUiError(new Error("Annotation chat send failed."), "annotations.send");
      throw failure === "rejected" ? new Error("Could not send these annotations to chat.") : error;
    } finally { recordUiTiming("ui.annotations.send", performance.now() - sendStartedAt); }
  }

  async sendLogToChat(log: StackedLog) {
    if (!this.canSendMessage) throw new Error("This host does not support chat messages.");
    const prompt = log.level === "error" || log.level === "warn"
      ? "Help me fix this log's underlying issue."
      : "Explain this log and whether I need to take any action.";
    const startedAt = performance.now();
    try {
      if (this.canAttach) {
        await this.attach(log);
        // Other context writes can supersede the attachment's queued update.
        let publishing: Promise<void>;
        do { publishing = this.queue; await publishing; } while (publishing !== this.queue);
      }
      const text = this.usesHostAttachments ? prompt : `${prompt}\n\n${formatLogContext(log)}`;
      try {
        await sendChat(this.app, text, { check: () => {
          if (this.canAttach && this.attached !== log) throw new Error("The selected log was removed or changed before sending.");
        } });
      } catch (error) {
        // The log view shows the host's own error for a missing composer or an unconfirmed send.
        if (!(error instanceof ChatDeliveryError)) throw error;
        throw error.reason === "rejected" ? new Error("Could not send this log to chat.") : error.cause;
      }
      if (this.attached === log) {
        this.attached = undefined;
        this.revision++; this.changed();
        await this.clearSentContext();
      }
    } finally { recordUiTiming("ui.logs.send", performance.now() - startedAt); }
  }

  selectSimulator(simulator?: SimulatorDevice) {
    this.selectSimulators(simulator ? [simulator] : [], simulator);
  }

  selectSimulators(simulators: SimulatorDevice[], active?: SimulatorDevice) {
    const devices = simulators.map(device => {
      const transport = device.kind === "physical" ? device.transportType : null;
      return [device.udid, device.name, device.runtime, device.state, device.platform, device.kind, transport];
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
    await this.commit(() => { this.attached = log; });
  }

  async attachScreenshot(screenshot: ScreenshotAttachment): Promise<boolean> {
    if (!this.canAttachScreenshots) throw new Error("This host does not support screenshot attachments.");
    await this.commit(() => { this.screenshots = [...this.screenshots, screenshot]; });
    return this.screenshots.some(item => item.id === screenshot.id);
  }

  async clearAttachments() {
    await this.commit(() => { this.attached = undefined; this.screenshots = []; this.annotations = []; });
  }

  private async clearSentContext() {
    if (this.usesHostAttachments) return;
    // Delivery already succeeded. A context cleanup failure must not invite a
    // duplicate send; retain the existing message timing and error boundaries.
    await this.publish().catch(() => captureUiError(new Error("Could not clear sent context."), "context.clear_sent"));
  }

  hostChanged() {
    if (!this.usesHostAttachments) {
      const ready = this.canAttach;
      if (ready && !this.contextReady) void this.publish().catch(() => {});
      this.contextReady = ready;
      return;
    }
    const current = this.attachments()?.getCurrent();
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
    if (!this.canAttach) return Promise.resolve();
    const revision = this.revision;
    const run = this.queue.catch(() => {}).then(async () => {
      if (revision !== this.revision) return;
      const selected = this.simulator;
      const log = this.attached;
      const devices = this.simulators.map(device => formatDeviceContext(device, device.udid === selected?.udid));
      const contextStartedAt = performance.now();
      const annotationContent = this.annotations.map(annotation => ({ type: "text" as const, text: `${this.usesHostAttachments ? "" : `Device: ${JSON.stringify(annotation.simulator.name)} (${annotation.simulator.udid})\n`}${formatAnnotationContext(annotation)}`, _meta: { "openai/title": `${annotation.component.name}: ${annotation.text.replace(/\s+/g, " ").trim()}`, "mobile-dev/annotationId": annotation.id } }));
      if (this.annotations.length) recordUiTiming("ui.annotations.context_build", performance.now() - contextStartedAt);
      const content = [{ type: "text" as const, annotations: { audience: ["assistant" as const] }, text: devices.length
        ? `Mobile Dev devices. Logs follow the active device.\n${devices.join("\n")}`
        : "Mobile Dev has no selected simulator." },
      ...(log ? [{ type: "text" as const, text: formatLogContext(log), _meta: { "openai/title": `${log.level}: ${log.message.replace(/\s+/g, " ").trim().slice(0, 70)}` } }] : []),
      ...this.screenshots.map(screenshot => ({
        type: "image" as const, mimeType: screenshot.mimeType, data: screenshot.data,
        _meta: { "openai/title": `Screenshot of ${screenshot.simulator.name} (${screenshot.simulator.udid})`, "mobile-dev/screenshotId": screenshot.id },
      })),
      ...(this.annotations.length ? [{ type: "text" as const, annotations: { audience: ["assistant" as const] }, text: ANNOTATION_EDIT_GUIDANCE }] : []),
      ...annotationContent];
      const params = { content, structuredContent: { selectedSimulator: selected ?? null, selectedSimulators: this.simulators, selectedLog: log ?? null, selectedLogKey: log ? logKey(log) : null, screenshotIds: this.screenshots.map(item => item.id), annotationIds: this.annotations.map(item => item.id) } };
      this.pending = true;
      try {
        await withComposer(async () => {
          if (revision !== this.revision) return;
          const host = this.attachments();
          if (host) this.updateId = (await host.update(params, { timeout: 5000 }))?.updateId;
          else {
            // Standard hosts own no composer pills. Local controls own selection
            // and removal; publish the complete replacement context each time.
            const content = params.content
              .filter(item => item.type !== "image" || this.canAttachScreenshots)
              .map(({ _meta, ...item }) => item);
            const structured = this.app.getHostCapabilities()?.updateModelContext?.structuredContent;
            await this.app.updateModelContext({ content, ...(structured ? { structuredContent: params.structuredContent } : {}) }, { timeout: 5000 });
          }
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
