import { SmartphoneIcon, TabletIcon } from "lucide-react";
import type { DeviceOption } from "../device-picker";
import { useState, useSyncExternalStore, useRef } from "react";
import { bindDevicePicker, DevicePickerStore } from "../device-picker";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";

function DeviceLabel({ item }: { item: DeviceOption }) {
  const Icon = item.kind === "tablet" ? TabletIcon : SmartphoneIcon;
  return <span className="flex min-w-0 items-center gap-2">
    <span className="relative flex shrink-0"><Icon className="size-4 text-muted-foreground" />{item.running && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-green-500 ring-2 ring-popover" role="img" aria-label="Running" />}</span>
    <span className="truncate">{item.label}</span>
  </span>;
}

export function DevicePicker({ id, label }: { id: string; label: string }) {
  const [store] = useState(() => new DevicePickerStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const selected = state.items.find(item => item.value === state.value);
  const container = useRef<HTMLDivElement | null>(null);
  return <div data-element="devices" className="min-w-0 flex-1" ref={element => { container.current = element; if (element) bindDevicePicker(element, store); }}>
    <Select items={state.items} value={state.value || null} disabled={state.disabled} onValueChange={value => {
      if (!value || value === store.value) return;
      store.value = value;
      container.current?.dispatchEvent(new Event("change"));
    }}>
      <SelectTrigger id={id} className="w-full min-w-0" aria-label={label}><SelectValue className="min-w-0 truncate" placeholder={state.placeholder}>{selected ? <DeviceLabel item={selected} /> : state.placeholder}</SelectValue></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}><SelectGroup>{state.items.map(item => <SelectItem key={item.value} value={item.value}><DeviceLabel item={item} /></SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </div>;
}
