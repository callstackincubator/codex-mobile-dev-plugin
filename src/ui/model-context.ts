import type { App } from "@modelcontextprotocol/ext-apps";
import type { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type { SimulatorDevice } from "../shared/protocol.ts";
import type { StackedLog } from "../shared/logs.ts";
import { formatLogContext, logKey } from "../shared/logs.ts";

export type ScreenshotAttachment = { id: string; data: string; simulator: SimulatorDevice };

export class PanelContext {
  private simulator?: SimulatorDevice;
  private simulators: SimulatorDevice[] = [];
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
  get canSendMessage() { return !!this.app.getHostCapabilities()?.message?.text; }
  get canAttachScreenshots() { return this.canAttach && !!this.app.getHostCapabilities()?.updateModelContext?.image; }
  get attachedKey() { return this.attached ? logKey(this.attached) : undefined; }

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
      const devices = this.simulators.map(device => {
        const role = device.udid === selected?.udid ? "Active" : "Visible";
        if (device.kind === "physical" && device.platform === "ios") return `${role} physical iOS device: ${device.name}. UDID: ${device.udid}. State: ${device.state}. Transport: ${device.transportType}. The panel mirrors this device through a view-only HEVC stream. Native unified logs use mobile_logs_session with platform ios, kind physical, and this hardware UDID. They do not require launching the app; ordinary print output is unavailable and private values may be redacted. Physical iOS input and screenshots are not implemented yet.`;
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
      }))];
      const params = { content, structuredContent: { selectedSimulator: selected ?? null, selectedSimulators: this.simulators, selectedLog: log ?? null, selectedLogKey: log ? logKey(log) : null, screenshotIds: this.screenshots.map(item => item.id) } };
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
