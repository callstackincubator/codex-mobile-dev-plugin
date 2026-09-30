import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { StackedLog } from "../shared/logs.ts";
import { formatLogContext, logKey } from "../shared/logs.ts";

export type ScreenshotAttachment = { id: string; data: string; simulator: SimulatorDevice };

export class PanelContext {
  private simulator?: SimulatorDevice;
  private attached?: StackedLog;
  private screenshots: ScreenshotAttachment[] = [];
  private queue: Promise<void> = Promise.resolve();
  private updateId?: string;
  private revision = 0;
  private pending = false;
  private readonly app: App;
  private readonly extensions: OpenAIExtensions;
  onChange = () => {};

  constructor(app: App, extensions: OpenAIExtensions) { this.app = app; this.extensions = extensions; }
  get canAttach() { return !!this.extensions.modelContext; }
  get canAttachScreenshots() { return this.canAttach && !!this.app.getHostCapabilities()?.updateModelContext?.image; }
  get attachedKey() { return this.attached ? logKey(this.attached) : undefined; }

  selectSimulator(simulator?: SimulatorDevice) {
    this.simulator = simulator;
    void this.publish().catch(() => {});
  }

  async attach(log?: StackedLog) {
    if (!this.canAttach) throw new Error("This host does not support log attachments.");
    const previous = this.attached;
    this.attached = log;
    const revision = ++this.revision;
    try { await this.publish(); }
    catch (error) { if (this.revision === revision) this.attached = previous; throw error; }
    finally { this.onChange(); }
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
    if (current !== null && current.updateId === this.updateId && (!this.attached || logPresent) && remaining.length === this.screenshots.length) return;
    // A clear from the host wins over a pending panel update.
    if (current === null || (!this.pending && ((this.attached && !logPresent) || remaining.length !== this.screenshots.length))) {
      if (!logPresent) this.attached = undefined;
      this.screenshots = remaining;
      this.revision++; this.onChange();
    }
  }

  private publish(): Promise<void> {
    const revision = this.revision;
    const run = this.queue.catch(() => {}).then(async () => {
      if (revision !== this.revision) return;
      const selected = this.simulator;
      const log = this.attached;
      const content = [{ type: "text" as const, annotations: { audience: ["assistant" as const] }, text: selected
        ? `Mobile Dev selected simulator: ${selected.name}. Device ID: ${selected.udid}. State: ${selected.state}. Use this ${selected.platform === "android" ? "serial" : "UDID"} with the plugin's agent-device tools and platform ${selected.platform ?? "ios"} when controlling this device.`
        : "Mobile Dev has no selected simulator." },
      ...(log ? [{ type: "text" as const, text: formatLogContext(log), _meta: { "openai/title": `${log.level}: ${log.message.slice(0, 70)}` } }] : []),
      ...this.screenshots.map(screenshot => ({
        type: "image" as const, mimeType: "image/png", data: screenshot.data,
        _meta: { "openai/title": `Screenshot of ${screenshot.simulator.name} (${screenshot.simulator.udid})`, "mobile-dev/screenshotId": screenshot.id },
      }))];
      const params = { content, structuredContent: { selectedSimulator: selected ?? null, selectedLog: log ?? null, selectedLogKey: log ? logKey(log) : null, screenshotIds: this.screenshots.map(item => item.id) } };
      this.pending = true;
      try {
        if (this.extensions.modelContext) this.updateId = (await this.extensions.modelContext.update(params))?.updateId;
        else await this.app.updateModelContext(params);
      } finally { this.pending = false; }
      if (revision !== this.revision) void this.publish().catch(() => {});
    });
    this.queue = run;
    return run;
  }
}
