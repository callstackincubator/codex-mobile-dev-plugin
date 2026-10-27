import type { App } from "@modelcontextprotocol/ext-apps";
import { PLUGIN_STORE_URL, pluginUpdateSchema } from "../shared/plugin-updates.ts";
import type { PluginUpdate } from "../shared/plugin-updates.ts";
import { captureUiError, countUiEvent } from "./telemetry.ts";

export type UpdateSnapshot = { update?: PluginUpdate; busy: boolean; error: string; dismissedVersion?: string; storeOpened?: boolean };

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
    if (this.snapshot.update?.status === "disabled" || this.snapshot.update?.status === "migrated") return;
    void this.check();
    this.timer = setInterval(() => { void this.check(); }, 15 * 60 * 1000);
  };

  async check() {
    if (this.disposed || this.checking || this.snapshot.busy || this.snapshot.update?.status === "migrated") return;
    this.checking = true;
    try {
      const result = await this.app.callServerTool({ name: "mobile_check_plugin_update", arguments: {} }, { signal: this.abort.signal });
      if (result.isError) return;
      const update = pluginUpdateSchema.parse(result.structuredContent?.update);
      this.publish({ update });
      if (update.status === "disabled" || update.status === "migrated") clearInterval(this.timer);
    } catch {
      // Update checks must not block or replace the device workspace.
    } finally { this.checking = false; }
  }

  async migrate() {
    if (this.disposed || this.snapshot.busy || this.snapshot.update?.status !== "migration") return;
    this.publish({ busy: true, error: "" });
    try {
      const result = await this.app.callServerTool({ name: "mobile_migrate_plugin_to_store", arguments: {} }, { signal: this.abort.signal, timeout: 180000 });
      if (result.isError) {
        const texts = result.content.filter(item => item.type === "text");
        const messages = texts.map(item => item.text);
        const message = messages.join("\n");
        this.publish({ error: message || "Could not finish migration. Try again." });
        return;
      }
      const update = pluginUpdateSchema.parse(result.structuredContent?.update);
      if (update.status !== "migrated") throw new Error("The store migration did not finish.");
      clearInterval(this.timer);
      this.publish({ update });
      countUiEvent("ui.plugin_update.migrated");
    } catch {
      if (this.abort.signal.aborted) return;
      this.publish({ error: "Could not confirm the migration. Try again." });
      const error = new Error("The store migration request failed.");
      captureUiError(error, "plugin.update.migrate");
    } finally {
      this.publish({ busy: false });
    }
  }

  dismiss() {
    if (this.snapshot.busy) return;
    this.publish({ dismissedVersion: this.snapshot.update?.latestVersion });
    countUiEvent("ui.plugin_update.dismissed");
  }

  async openStore() {
    if (this.disposed || this.snapshot.busy) return;
    this.publish({ busy: true, error: "" });
    try {
      const result = await this.app.openLink({ url: PLUGIN_STORE_URL }, { signal: this.abort.signal });
      if (result.isError) throw new Error("Could not open the plugin store.");
      this.publish({ storeOpened: true });
      countUiEvent("ui.plugin_update.store_opened");
    } catch {
      if (this.abort.signal.aborted) return;
      this.publish({ error: "Could not open the plugin store. Try again." });
      const error = new Error("Could not open the plugin store.");
      captureUiError(error, "plugin.update.store");
    } finally { this.publish({ busy: false }); }
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    clearInterval(this.timer);
    this.visibility.removeEventListener("visibilitychange", this.visibilityChanged);
    this.listeners.clear();
  }
}
