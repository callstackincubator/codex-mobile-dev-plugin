export type DeviceOption = { value: string; label: string };
export class DevicePickerStore {
  private state = { items: [] as DeviceOption[], value: "", disabled: true, placeholder: "Loading devices..." };
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
}
const stores = new WeakMap<HTMLElement, DevicePickerStore>();
export function bindDevicePicker(element: HTMLElement, store: DevicePickerStore) { stores.set(element, store); }
export function getDevicePicker(element: HTMLElement) {
  let store = stores.get(element);
  if (!store) { store = new DevicePickerStore(); stores.set(element, store); }
  return store;
}
