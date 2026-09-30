import type { DeviceSetting, DeviceSettings } from "../shared/device-settings.ts";

type PendingChange = { change: DeviceSetting; resolve: () => void };

export class DeviceSettingsStore {
  private state = { deviceId: "", disabled: true, loading: false, busy: false, error: "", frame: true, settings: undefined as DeviceSettings | undefined };
  private listeners = new Set<() => void>();
  private revision = 0;
  private mutation = 0;
  private confirmed?: DeviceSettings;
  private pending: PendingChange[] = [];
  private drainingRevision?: number;
  private loading?: Promise<void>;
  private loadAttempted = false;
  request?: (change?: DeviceSetting) => Promise<Partial<DeviceSettings>>;
  setFrame?: (visible: boolean) => void;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  configure(deviceId: string, disabled: boolean) {
    if (deviceId !== this.state.deviceId) {
      this.revision++;
      for (const pending of this.pending) pending.resolve();
      this.pending = [];
      this.confirmed = undefined;
      this.loading = undefined;
      this.loadAttempted = false;
      this.update({ deviceId, disabled, settings: undefined, loading: false, busy: false, error: "" });
    } else if (disabled !== this.state.disabled) this.update({ disabled });
  }
  prefetch() { if (!this.loadAttempted) void this.load(); }
  load(): Promise<void> {
    if (this.loading) return this.loading;
    if (!this.request || this.state.disabled || this.pending.length) return Promise.resolve();
    const revision = this.revision;
    const mutation = this.mutation;
    this.loadAttempted = true;
    this.update({ loading: true });
    const request = this.request;
    let response: Promise<Partial<DeviceSettings>>;
    try { response = request(); } catch (error) { response = Promise.reject(error); }
    this.loading = response.then(patch => {
      if (this.revision !== revision || this.mutation !== mutation) return;
      const settings = patch as DeviceSettings;
      this.confirmed = settings;
      this.publish({ error: settings.errors?.join("\n") ?? "" });
    }, error => {
      if (this.revision === revision && this.mutation === mutation) this.update({ error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      if (this.revision === revision) { this.loading = undefined; this.update({ loading: false }); }
    });
    return this.loading;
  }
  change(change: DeviceSetting): Promise<void> {
    if (!this.request || this.state.disabled || !this.confirmed) return Promise.resolve();
    this.mutation++;
    const saved = new Promise<void>(resolve => { this.pending.push({ change, resolve }); });
    this.publish({ error: "" });
    void this.drain();
    return saved;
  }
  private publish(patch: Partial<typeof this.state> = {}) {
    const settings = this.confirmed ? { ...this.confirmed } : undefined;
    if (settings) for (const { change } of this.pending) Object.assign(settings, { [change.setting]: change.value });
    this.update({ settings, busy: this.pending.length > 0, ...patch });
  }
  private async drain() {
    const revision = this.revision;
    if (this.drainingRevision === revision || !this.request) return;
    this.drainingRevision = revision;
    const request = this.request;
    try {
      while (this.revision === revision && this.pending.length) {
        const current = this.pending[0];
        try {
          const patch = await request(current.change);
          if (this.revision !== revision) return;
          this.confirmed = { ...this.confirmed!, ...patch };
        } catch (error) {
          if (this.revision !== revision) return;
          this.update({ error: error instanceof Error ? error.message : String(error) });
        } finally { current.resolve(); }
        this.pending.shift();
        this.publish();
      }
    } finally { if (this.drainingRevision === revision) this.drainingRevision = undefined; }
  }
  toggleFrame(visible: boolean) { this.update({ frame: visible }); this.setFrame?.(visible); }
  dispose() { this.request = undefined; this.setFrame = undefined; this.configure("", true); }
}

const stores = new WeakMap<HTMLElement, DeviceSettingsStore>();
export function bindDeviceSettings(element: HTMLElement, store: DeviceSettingsStore) { stores.set(element, store); }
export function getDeviceSettings(element: HTMLElement) {
  let store = stores.get(element);
  if (!store) { store = new DeviceSettingsStore(); stores.set(element, store); }
  return store;
}
