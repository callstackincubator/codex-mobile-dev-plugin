import { useState, useSyncExternalStore, useRef } from "react";
import { bindDevicePicker, DevicePickerStore } from "../device-picker";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";

export function DevicePicker({ id, label }: { id: string; label: string }) {
  const [store] = useState(() => new DevicePickerStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const container = useRef<HTMLDivElement | null>(null);
  return <div data-element="devices" className="min-w-0 flex-1" ref={element => { container.current = element; if (element) bindDevicePicker(element, store); }}>
    <Select items={state.items} value={state.value || null} disabled={state.disabled} onValueChange={value => {
      if (!value || value === store.value) return;
      store.value = value;
      container.current?.dispatchEvent(new Event("change"));
    }}>
      <SelectTrigger id={id} className="w-full min-w-0" aria-label={label}><SelectValue className="min-w-0 truncate" placeholder={state.placeholder} /></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}><SelectGroup>{state.items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </div>;
}
