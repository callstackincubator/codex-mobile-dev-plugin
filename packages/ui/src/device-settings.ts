import type { DeviceSetting, DeviceSettings } from "@mobile-dev/shared/device-settings.ts";
import { measureUiOperation } from "./telemetry.ts";
import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { Store } from "./store.ts";

type PendingChange = { change: DeviceSetting; resolve: () => void };
export type DeviceSettingsState = { deviceId: string; disabled: boolean; loading: boolean; busy: boolean; error: string; frame: boolean; settings?: DeviceSettings };

/** How the panel reads and changes the selected device's settings, and shows or hides its frame. */
export type DeviceSettingsSource = {
  /** Reads every setting, or applies `change` and returns the settings it touched. */
  request(change?: DeviceSetting): Promise<Partial<DeviceSettings>>;
  setFrame(visible: boolean): void;
};

export class DeviceSettingsStore extends Store<DeviceSettingsState> {
  private readonly source: DeviceSettingsSource;
  private disposed = false;
  private revision = 0;
  private mutation = 0;
  private confirmed?: DeviceSettings;
  private pending: PendingChange[] = [];
  private drainingRevision?: number;
  private loading?: Promise<void>;
  private loadAttempted = false;

  constructor(source: DeviceSettingsSource) {
    super({ deviceId: "", disabled: true, loading: false, busy: false, error: "", frame: true });
    this.source = source;
  }

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
    if (this.disposed || this.state.disabled || this.pending.length) return Promise.resolve();
    const revision = this.revision;
    const mutation = this.mutation;
    this.loadAttempted = true;
    this.update({ loading: true });
    const request = (change?: DeviceSetting) => this.source.request(change);
    let response: Promise<Partial<DeviceSettings>>;
    try { response = request(); } catch (error) { response = Promise.reject(error); }
    this.loading = response.then(patch => {
      if (this.revision !== revision || this.mutation !== mutation) return;
      const settings = patch as DeviceSettings;
      this.confirmed = settings;
      this.publish({ error: settings.errors?.join("\n") ?? "" });
    }, error => {
      if (this.revision === revision && this.mutation === mutation) this.update({ error: errorMessage(error) });
    }).finally(() => {
      if (this.revision === revision) { this.loading = undefined; this.update({ loading: false }); }
    });
    return this.loading;
  }
  change(change: DeviceSetting): Promise<void> {
    if (this.disposed || this.state.disabled || !this.confirmed) return Promise.resolve();
    this.mutation++;
    const saved = new Promise<void>(resolve => { this.pending.push({ change, resolve }); });
    this.publish({ error: "" });
    void this.drain();
    return saved;
  }
  private publish(patch: Partial<DeviceSettingsState> = {}) {
    const settings = this.confirmed ? { ...this.confirmed } : undefined;
    if (settings) for (const { change } of this.pending) Object.assign(settings, { [change.setting]: change.value });
    this.update({ settings, busy: this.pending.length > 0, ...patch });
  }
  private async drain() {
    const revision = this.revision;
    if (this.drainingRevision === revision || this.disposed) return;
    this.drainingRevision = revision;
    const request = (change?: DeviceSetting) => this.source.request(change);
    try {
      while (this.revision === revision && this.pending.length) {
        const current = this.pending[0];
        try {
          const patch = await measureUiOperation("ui.device_settings.change", "ui.device_settings.failure", () => request(current.change));
          if (this.revision !== revision) return;
          this.confirmed = { ...this.confirmed!, ...patch };
        } catch (error) {
          if (this.revision !== revision) return;
          this.update({ error: errorMessage(error) });
        } finally { current.resolve(); }
        this.pending.shift();
        this.publish();
      }
    } finally { if (this.drainingRevision === revision) this.drainingRevision = undefined; }
  }
  toggleFrame(visible: boolean) { this.update({ frame: visible }); if (!this.disposed) this.source.setFrame(visible); }
  dispose() { this.disposed = true; this.configure("", true); this.close(); }
}
