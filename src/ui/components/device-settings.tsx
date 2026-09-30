import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon, Settings2Icon } from "lucide-react";
import { contentSizes } from "../../shared/device-settings";
import { bindDeviceSettings, DeviceSettingsStore } from "../device-settings";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Tabs, TabsList, TabsTrigger } from "./ui/base-tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const textSizeLabels = ["Extra small", "Small", "Medium", "Large", "Extra large", "2× large", "3× large", "Accessibility medium", "Accessibility large", "Accessibility extra large", "Accessibility 2× large", "Accessibility 3× large"];
const contentSizeOptions = contentSizes.map((value, index) => ({ value, label: textSizeLabels[index] }));
const rotationOptions = [{ value: "auto", label: "Auto" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }];

function SettingsSelect({ id, value, items, disabled, onChange }: { id: string; value: string; items: { value: string; label: string }[]; disabled: boolean; onChange: (value: string) => void }) {
  return <Select items={items} value={value} disabled={disabled} onValueChange={next => { if (next !== null) onChange(next); }}>
    <SelectTrigger id={id} className="w-48 min-w-0"><SelectValue /></SelectTrigger>
    <SelectContent align="start" alignItemWithTrigger={false} className="w-max min-w-(--anchor-width) max-w-(--available-width)"><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}

export function DeviceSettings({ platform }: { platform: "ios" | "android" }) {
  const [store] = useState(() => new DeviceSettingsStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [open, setOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const id = useId();
  const settings = state.settings;
  const disabled = state.disabled;
  useEffect(() => {
    setLatitude(settings?.location ? String(settings.location.latitude) : "");
    setLongitude(settings?.location ? String(settings.location.longitude) : "");
  }, [state.deviceId, settings?.location?.latitude, settings?.location?.longitude]);
  useEffect(() => { if (state.disabled) setOpen(false); }, [state.disabled]);
  useEffect(() => { setOpen(false); setLocationOpen(false); }, [state.deviceId]);
  return <div data-element="settings" className="ml-auto" ref={element => { if (element) bindDeviceSettings(element, store); }}>
    <Popover open={open} onOpenChange={value => {
      if (!value) { setOpen(false); return; }
      const deviceId = store.getSnapshot().deviceId;
      if (store.getSnapshot().settings) { setOpen(true); void store.load(); }
      else void store.load().then(() => { if (store.getSnapshot().deviceId === deviceId && !store.getSnapshot().disabled) setOpen(true); });
    }}>
      <PopoverTrigger asChild><Button variant="ghost" size="icon" disabled={state.disabled} aria-label={`${platform === "ios" ? "iOS" : "Android"} device settings`} title="Device settings"><Settings2Icon /></Button></PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-h-(--radix-popover-content-available-height) w-[360px] max-w-[calc(100vw-16px)] space-y-4 overflow-y-auto p-4 text-sm" aria-label="Device settings" onInteractOutside={event => { if (event.target instanceof Element && event.target.closest('[data-slot="select-content"]')) event.preventDefault(); }}>
        {settings && <fieldset disabled={disabled} className="space-y-4">
          {settings.appearance !== undefined && <div className="flex items-center justify-between gap-3"><span id={`${id}-appearance`}>Appearance</span><Tabs value={settings.appearance} onValueChange={value => { if (value) void store.change({ setting: "appearance", value: value as "light" | "dark" | "auto" }); }}>
            <TabsList aria-labelledby={`${id}-appearance`}><TabsTrigger value="light" disabled={disabled}>Light</TabsTrigger><TabsTrigger value="dark" disabled={disabled}>Dark</TabsTrigger>{platform === "android" && <TabsTrigger value="auto" disabled={disabled}>Auto</TabsTrigger>}</TabsList>
          </Tabs></div>}
          {settings.contentSize !== undefined && <div className="flex items-center justify-between gap-3"><label htmlFor={`${id}-text-size`} className="shrink-0">Text size</label><SettingsSelect id={`${id}-text-size`} value={settings.contentSize} items={contentSizeOptions} disabled={disabled} onChange={value => void store.change({ setting: "contentSize", value: value as typeof contentSizes[number] })} /></div>}
          {settings.fontScale !== undefined && <div className="flex items-center justify-between gap-3"><label htmlFor={`${id}-text-size`}>Text size</label><SettingsSelect id={`${id}-text-size`} value={String(settings.fontScale)} disabled={disabled} items={[...new Set([0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, settings.fontScale])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${Math.round(value * 100)}%${value === 1 ? " (Default)" : ""}` }))} onChange={value => void store.change({ setting: "fontScale", value: Number(value) })} /></div>}
          {settings.increaseContrast !== undefined && <div className="flex items-center justify-between"><label htmlFor={`${id}-contrast`}>Increase contrast</label><Switch id={`${id}-contrast`} checked={settings.increaseContrast} onCheckedChange={value => void store.change({ setting: "increaseContrast", value })} /></div>}
          {settings.orientation !== undefined && <div className="flex items-center justify-between gap-3"><label htmlFor={`${id}-rotation`}>Rotation</label><SettingsSelect id={`${id}-rotation`} value={settings.orientation} items={rotationOptions} disabled={disabled} onChange={value => void store.change({ setting: "orientation", value: value as "auto" | "portrait" | "landscape" })} /></div>}
          {settings.locationSupported && <Collapsible open={locationOpen} onOpenChange={setLocationOpen} className="border-t pt-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={disabled}>Location<ChevronDownIcon className={`size-4 text-muted-foreground ${locationOpen ? "rotate-180" : ""}`} /></CollapsibleTrigger>
            <CollapsibleContent className="pt-3"><form className="space-y-3" onSubmit={event => { event.preventDefault(); if (latitude.trim() && longitude.trim()) void store.change({ setting: "location", value: { latitude: Number(latitude), longitude: Number(longitude) } }); }}>
            <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><label htmlFor={`${id}-latitude`} className="text-xs text-muted-foreground">Latitude</label><Input id={`${id}-latitude`} type="number" step="any" min={-90} max={90} required value={latitude} placeholder="37.3318" onChange={event => setLatitude(event.target.value)} /></div><div className="space-y-1"><label htmlFor={`${id}-longitude`} className="text-xs text-muted-foreground">Longitude</label><Input id={`${id}-longitude`} type="number" step="any" min={-180} max={180} required value={longitude} placeholder="-122.0312" onChange={event => setLongitude(event.target.value)} /></div></div>
            <div className="flex gap-2"><Button type="submit" size="sm" variant="secondary" className="flex-1" disabled={!latitude.trim() || !longitude.trim()}>Set location</Button>{platform === "ios" && <Button type="button" size="sm" variant="outline" onClick={() => void store.change({ setting: "location", value: null })}>Clear</Button>}</div>
          </form></CollapsibleContent></Collapsible>}
        </fieldset>}
        <div className="flex items-center justify-between border-t pt-3"><label htmlFor={`${id}-frame`}>Show device frame</label><Switch id={`${id}-frame`} checked={state.frame} onCheckedChange={value => store.toggleFrame(value)} /></div>
        {state.error && <p className="whitespace-pre-wrap text-xs text-destructive" role="alert">{state.error}</p>}
      </PopoverContent>
    </Popover>
  </div>;
}
