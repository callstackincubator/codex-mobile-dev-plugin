import { elementStores } from "./element-store.ts";
export type DeviceOption = { value: string; label: string; group?: string; kind?: "phone" | "tablet"; running?: boolean; statusLabel?: string; canStop?: boolean };
export class DevicePickerStore {
  private state = { items: [] as DeviceOption[], value: "", disabled: true, placeholder: "Loading devices...", stoppingId: "", stopError: "" };
  stop?: (id: string) => Promise<void>;
  refresh?: () => Promise<void>;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  get value() { return this.state.value; }
  set value(value: string) { this.update({ value }); }
  set disabled(disabled: boolean) { if (disabled !== this.state.disabled) this.update({ disabled }); }
  async stopDevice(id: string) {
    if (!this.stop || this.state.disabled || this.state.stoppingId || !this.state.items.some(item => item.value === id && item.canStop)) return;
    this.update({ stoppingId: id, stopError: "" });
    try { await this.stop(id); }
    catch (error) { this.update({ stopError: error instanceof Error ? error.message : String(error) }); }
    finally { this.update({ stoppingId: "" }); }
  }
}
const stores = elementStores(() => new DevicePickerStore());
export const bindDevicePicker = stores.bind;
export const getDevicePicker = stores.get;
