import type { ResourceSavingState } from "@mobile-dev/shared/resource-saving.ts";
import { elementStores } from "./element-store.ts";
import { measureUiOperation } from "./telemetry.ts";

export class ResourceSavingStore {
  private state = { deviceId: "", visible: false, disabled: true, loading: false, busy: false, error: "", value: undefined as ResourceSavingState | undefined };
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private loaded = false;
  request?: (enabled?: boolean) => Promise<ResourceSavingState>;
  restart?: () => Promise<void>;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;

  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  configure(deviceId: string, visible: boolean, disabled: boolean) {
    if (deviceId !== this.state.deviceId) {
      this.revision++;
      this.loaded = false;
      this.update({ deviceId, visible, disabled, loading: false, busy: false, value: undefined, error: "" });
    } else if (visible !== this.state.visible || disabled !== this.state.disabled) this.update({ visible, disabled });
    if (visible && disabled === false && this.loaded === false) void this.load();
  }

  async load() {
    if (this.request === undefined || this.state.loading || this.state.busy || this.state.disabled) return;
    this.loaded = true;
    const revision = this.revision;
    this.update({ loading: true });
    try {
      const value = await this.request();
      if (this.revision === revision) this.update({ value, error: "" });
    } catch (error) {
      if (this.revision === revision) this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally { if (this.revision === revision) this.update({ loading: false }); }
  }

  async change(enabled: boolean) {
    if (this.request === undefined || this.state.disabled || this.state.busy || this.state.loading) return;
    const revision = this.revision;
    const request = this.request;
    this.update({ busy: true, error: "" });
    try {
      const value = await measureUiOperation("ui.resource_saving.change", "ui.resource_saving.failure", () => request(enabled));
      if (this.revision === revision) this.update({ value });
    } catch (error) {
      if (this.revision === revision) this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally { if (this.revision === revision) this.update({ busy: false }); }
  }

  async restartDevice() {
    if (this.restart === undefined || this.state.disabled || this.state.busy) return;
    const revision = this.revision;
    this.update({ busy: true, error: "" });
    try { await this.restart(); }
    catch (error) {
      if (this.revision === revision) this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.revision === revision) { this.update({ busy: false }); await this.load(); }
    }
  }

  dispose() {
    this.request = undefined;
    this.restart = undefined;
    this.revision++;
  }
}

const stores = elementStores(() => new ResourceSavingStore());
export const bindResourceSaving = stores.bind;
export const getResourceSaving = stores.get;
