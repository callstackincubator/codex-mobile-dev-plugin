import type { App } from "@modelcontextprotocol/ext-apps";
import { pluginReleaseUrl, pluginUpdateSchema } from "../shared/plugin-updates.ts";
import type { PluginUpdate } from "../shared/plugin-updates.ts";
import { captureUiError, countUiEvent } from "./telemetry.ts";

export type UpdateSnapshot = { update?: PluginUpdate; busy: boolean; error: string; dismissedVersion?: string };

export class PluginUpdateController {
  private readonly app: Pick<App, "callServerTool" | "openLink">;
  private readonly visibility: Document;
  private snapshot: UpdateSnapshot = { busy: false, error: "" };
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private timer?: ReturnType<typeof setInterval>;
  private available = false;
  private disposed = false;
  private checking = false;

  constructor(app: Pick<App, "callServerTool" | "openLink">, visibility = document) {
    this.app = app;
    this.visibility = visibility;
    visibility.addEventListener("visibilitychange", this.visibilityChanged);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;

  private publish(fields: Partial<UpdateSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...fields };
    for (const listener of this.listeners) listener();
  }

  setAvailable(available: boolean) {
    this.available = available;
    this.visibilityChanged();
  }

  private visibilityChanged = () => {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.disposed || this.available === false || this.visibility.visibilityState === "hidden") return;
    if (this.snapshot.update?.status === "disabled" || this.snapshot.update?.status === "updated") return;
    void this.check();
    this.timer = setInterval(() => { void this.check(); }, 15 * 60 * 1000);
  };

  async check() {
    if (this.disposed || this.checking || this.snapshot.busy || this.snapshot.update?.status === "updated") return;
    this.checking = true;
    try {
      const result = await this.app.callServerTool({ name: "mobile_check_plugin_update", arguments: {} }, { signal: this.abort.signal });
      if (result.isError) return;
      const update = pluginUpdateSchema.parse(result.structuredContent?.update);
      this.publish({ update });
      if (update.status === "disabled" || update.status === "updated") clearInterval(this.timer);
    } catch {
      // Update checks must not block or replace the device workspace.
    } finally { this.checking = false; }
  }

  async install() {
    if (this.disposed || this.snapshot.busy || this.snapshot.update?.status !== "available") return;
    this.publish({ busy: true, error: "" });
    try {
      const result = await this.app.callServerTool({ name: "mobile_install_plugin_update", arguments: {} }, { signal: this.abort.signal, timeout: 180000 });
      if (result.isError) {
        const texts = result.content.filter(item => item.type === "text");
        const messages = texts.map(item => item.text);
        const message = messages.join("\n");
        this.publish({ error: message || "Could not update Mobile Dev. Try again." });
        return;
      }
      const update = pluginUpdateSchema.parse(result.structuredContent?.update);
      if (update.status !== "updated") throw new Error("The plugin update did not finish.");
      clearInterval(this.timer);
      this.publish({ update });
      countUiEvent("ui.plugin_update.installed");
    } catch {
      if (this.abort.signal.aborted) return;
      this.publish({ error: "Could not confirm the update. Try again." });
      const error = new Error("The plugin update request failed.");
      captureUiError(error, "plugin.update.install");
    } finally {
      this.publish({ busy: false });
    }
  }

  dismiss() {
    if (this.snapshot.busy) return;
    this.publish({ dismissedVersion: this.snapshot.update?.latestVersion });
    countUiEvent("ui.plugin_update.dismissed");
  }

  async openReleaseNotes() {
    const version = this.snapshot.update?.latestVersion;
    if (version === undefined) return;
    try {
      const url = pluginReleaseUrl(version);
      const result = await this.app.openLink({ url }, { signal: this.abort.signal });
      if (result.isError) throw new Error("Could not open the release notes.");
    } catch {
      if (this.abort.signal.aborted) return;
      this.publish({ error: "Could not open release notes. Try again." });
      const error = new Error("Could not open plugin release notes.");
      captureUiError(error, "plugin.update.release_notes");
    }
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    clearInterval(this.timer);
    this.visibility.removeEventListener("visibilitychange", this.visibilityChanged);
    this.listeners.clear();
  }
}
