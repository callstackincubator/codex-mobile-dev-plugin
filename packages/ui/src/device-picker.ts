import { errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { Store } from "./store.ts";

export type DeviceOption = { value: string; label: string; group?: string; kind?: "phone" | "tablet"; running?: boolean; statusLabel?: string; canStop?: boolean };
export type DevicePickerState = { items: DeviceOption[]; value: string; disabled: boolean; placeholder: string; stoppingId: string; stopError: string };

/** What the panel does when the user picks, stops or refreshes devices. */
export type DevicePickerActions = {
  /** The user picked a device; picking the selected one again retries it. */
  select(value: string): void;
  stop(id: string): Promise<void>;
  refresh(): Promise<void>;
};

export class DevicePickerStore extends Store<DevicePickerState> {
  private readonly actions: DevicePickerActions;

  constructor(actions: DevicePickerActions) {
    super({ items: [], value: "", disabled: true, placeholder: "Loading devices...", stoppingId: "", stopError: "" });
    this.actions = actions;
  }

  get value() { return this.state.value; }
  /** Moves the selection without announcing a pick, as when an emulator boots under a new serial. */
  set value(value: string) { this.update({ value }); }
  set disabled(disabled: boolean) { if (disabled !== this.state.disabled) this.update({ disabled }); }

  /** Lists the panel's devices and the one selected. */
  show(listing: Pick<DevicePickerState, "items" | "value" | "placeholder">) { this.update(listing); }

  select(value: string) {
    this.update({ value });
    this.actions.select(value);
  }

  /** Lists the devices again, as when the picker opens; a failure shows in the picker. */
  async refresh() {
    try { await this.actions.refresh(); }
    catch (error) { this.update({ stopError: errorMessage(error) }); }
  }

  async stopDevice(id: string) {
    if (this.state.disabled || this.state.stoppingId || !this.state.items.some(item => item.value === id && item.canStop)) return;
    this.update({ stoppingId: id, stopError: "" });
    try { await this.actions.stop(id); }
    catch (error) { this.update({ stopError: errorMessage(error) }); }
    finally { this.update({ stoppingId: "" }); }
  }
}
