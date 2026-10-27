import { ChevronDownIcon, LoaderCircleIcon, SmartphoneIcon, SquareIcon, TabletIcon } from "lucide-react";
import type { DeviceOption } from "../device-picker";
import { Fragment, useState, useSyncExternalStore, useRef } from "react";
import { bindDevicePicker, DevicePickerStore } from "../device-picker";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

function DeviceLabel({ item, wrap = false }: { item: DeviceOption; wrap?: boolean }) {
  const Icon = item.kind === "tablet" ? TabletIcon : SmartphoneIcon;
  return <span className="flex min-w-0 items-center gap-2">
    <span className="relative flex shrink-0"><Icon className="size-4 text-muted-foreground" />{item.running && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-green-500 ring-2 ring-popover" role="img" aria-label={item.statusLabel ?? "Running"} />}</span>
    <span className={wrap ? "whitespace-normal [overflow-wrap:anywhere]" : "truncate"}>{item.label}</span>
  </span>;
}

export function DevicePicker({ id, label }: { id: string; label: string }) {
  const [store] = useState(() => new DevicePickerStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [open, setOpen] = useState(false);
  const selected = state.items.find(item => item.value === state.value);
  const container = useRef<HTMLDivElement | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  return <div data-element="devices" className="min-w-0 flex-1" ref={element => { container.current = element; if (element) bindDevicePicker(element, store); }}>
    <Popover open={open} onOpenChange={open => { setOpen(open); if (open) void store.refresh?.().catch(error => store.update({ stopError: error instanceof Error ? error.message : String(error) })); }}>
      <PopoverTrigger asChild><Button id={id} data-slot="select-trigger" variant="outline" disabled={state.disabled} className="w-full min-w-0 justify-between gap-1.5 px-2.5 font-normal" aria-label={label}><span className="min-w-0 truncate">{selected ? <DeviceLabel item={selected} /> : state.placeholder}</span><ChevronDownIcon className="shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} /></Button></PopoverTrigger>
      <PopoverContent align="start" className="max-h-(--radix-popover-content-available-height) w-max min-w-[min(var(--radix-popover-trigger-width),var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) overflow-y-auto p-1" aria-label={label} onOpenAutoFocus={event => { if (selectedButton.current) { event.preventDefault(); selectedButton.current.focus(); } }}>
        {state.items.map((item, index) => <Fragment key={item.value}>
          {item.group && (index === 0 || state.items[index - 1].group !== item.group) && <p data-device-group={item.group} className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{item.group}</p>}
          <div className={`flex min-w-0 items-center rounded-md ${item.value === state.value ? "bg-accent" : ""}`}>
            <Button variant="ghost" data-device-option={item.value} aria-pressed={item.value === state.value} disabled={state.disabled || !!state.stoppingId} className="h-auto min-h-7 min-w-0 flex-1 justify-start rounded-md px-1.5 py-1 text-left font-normal" ref={item.value === state.value ? selectedButton : undefined} onClick={() => {
              setOpen(false);
              store.value = item.value;
              container.current?.dispatchEvent(new Event("change"));
            }}><DeviceLabel item={item} wrap /></Button>
            {item.canStop && <Button variant="ghost" size="icon" className="mr-1 size-6 shrink-0 text-muted-foreground hover:text-foreground" disabled={state.disabled || !!state.stoppingId} title={`Stop ${item.label}`} aria-label={`Stop ${item.label}`} onClick={() => void store.stopDevice(item.value)}>{state.stoppingId === item.value ? <LoaderCircleIcon className="size-3 animate-spin" /> : <SquareIcon className="size-3 fill-current" />}</Button>}
          </div>
        </Fragment>)}
        {state.stopError && <p className="max-w-80 px-2 py-1 text-xs text-destructive" role="alert">{state.stopError}</p>}
      </PopoverContent>
    </Popover>
  </div>;
}
