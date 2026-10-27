import { useState, useSyncExternalStore } from "react";
import { ChevronRightIcon, GlassesIcon, LoaderCircleIcon, MessageCircleIcon, PlayIcon, SmartphoneIcon, SquareIcon, TabletIcon } from "lucide-react";
import { isRunningDevice } from "@mobile-dev/shared/device-choice.ts";
import type { DeviceChoice } from "@mobile-dev/shared/device-choice.ts";
import { physicalConnectionLabel } from "@mobile-dev/shared/ios-devices.ts";
import { canBootDevice, canStopDevice, deviceKey, deviceKindLabel } from "../devices-controller.ts";
import type { DevicesController } from "../devices-controller.ts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const FILTER_THRESHOLD = 8;

function stateLabel(device: DeviceChoice) {
  if (device.state === "Booted") return device.kind === "physical" ? "Connected" : "Running";
  if (device.state === "Shutdown") return "Stopped";
  return device.state.charAt(0).toUpperCase() + device.state.slice(1);
}

function DeviceIcon({ device }: { device: DeviceChoice }) {
  const Icon = /vision/i.test(device.runtime) ? GlassesIcon : /ipad|tablet|pixel.*tab/i.test(device.name) ? TabletIcon : SmartphoneIcon;
  return <span className="relative flex shrink-0"><Icon className="size-4 text-muted-foreground" />{isRunningDevice(device) && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-green-500 ring-2 ring-background" role="img" aria-label={stateLabel(device)} />}</span>;
}

function DeviceRow({ controller, device, showRuntime }: { controller: DevicesController; device: DeviceChoice; showRuntime: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const key = deviceKey(device);
  const view = state.view;
  const single = view !== undefined && "mode" in view && view.selectionMode === "single";
  const selectable = state.canMessage && controller.canSelect(device);
  const details = [deviceKindLabel(device)];
  if (showRuntime && device.runtime && device.runtime !== "Android") details.push(device.runtime);
  if (device.kind === "physical") details.push(physicalConnectionLabel(device.transportType));
  if (device.appName) details.push(device.appName);
  details.push(stateLabel(device));
  const pending = state.pendingKey === key;
  const busy = state.pendingKey !== "" || state.sending;
  const control = selectable && <input type={single ? "radio" : "checkbox"} name="device" className="size-3.5 shrink-0 accent-primary" checked={state.selected.has(key)} onChange={() => controller.toggle(device)} aria-label={`Select ${device.name}`} />;
  return <li data-device={key} className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
    <label className={`flex min-w-0 flex-1 items-center gap-2 ${selectable ? "cursor-pointer" : ""}`}>
      {control}
      <DeviceIcon device={device} />
      <span className="min-w-0">
        <span className="block truncate text-foreground">{device.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{details.join(" · ")}</span>
      </span>
    </label>
    {canBootDevice(device) && <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => void controller.boot(device)} aria-label={`Boot ${device.name}`}>{pending ? <LoaderCircleIcon className="size-3 animate-spin" /> : <PlayIcon className="size-3 fill-current" />}Boot</Button>}
    {canStopDevice(device) && <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => void controller.stop(device)} aria-label={`Stop ${device.name}`}>{pending ? <LoaderCircleIcon className="size-3 animate-spin" /> : <SquareIcon className="size-3 fill-current" />}Stop</Button>}
  </li>;
}

function Section({ title, children, collapsible = false, defaultOpen = true }: { title: string; children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (collapsible === false) return <section className="grid gap-0.5"><h3 className="px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">{title}</h3><ul className="grid gap-0.5">{children}</ul></section>;
  return <section className="grid gap-0.5">
    <button type="button" className="flex items-center gap-1 rounded-md px-2 pb-0.5 pt-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
      <ChevronRightIcon className="size-3 transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />{title}
    </button>
    {open && <ul className="grid gap-0.5">{children}</ul>}
  </section>;
}

export function DevicesCard({ controller }: { controller: DevicesController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [filter, setFilter] = useState("");
  const view = state.view;
  if (view === undefined) return <div className="p-3 text-sm text-muted-foreground" role={state.error ? "alert" : undefined}>{state.error || "Loading devices…"}</div>;
  if ("action" in view) {
    const text = view.action === "accept" ? `Selected ${view.devices.map(device => device.name).join(", ")}` : "No device selected";
    return <div className="flex items-center gap-2 p-3 text-sm text-foreground"><SmartphoneIcon className="size-4 text-muted-foreground" />{text}</div>;
  }
  const query = filter.trim().toLowerCase();
  const visible = query ? state.devices.filter(device => `${device.name} ${device.runtime}`.toLowerCase().includes(query)) : state.devices;
  const running = visible.filter(isRunningDevice);
  const offline = visible.filter(device => device.kind === "physical" && !isRunningDevice(device));
  const stopped = visible.filter(device => device.kind !== "physical" && !isRunningDevice(device));
  const runtimes = new Map<string, DeviceChoice[]>();
  for (const device of stopped) runtimes.set(device.runtime || "Other", [...runtimes.get(device.runtime || "Other") ?? [], device]);
  // iOS first, then other Apple runtimes, then Android; newest version first within each.
  const rank = (runtime: string) => runtime.startsWith("iOS") ? 0 : runtime === "Android" ? 2 : 1;
  const groups = [...runtimes].sort(([a], [b]) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
  const expanded = query !== "" || stopped.length <= FILTER_THRESHOLD;
  const choosing = view.mode === "choose";
  const count = state.selected.size;
  return <div className="grid gap-2 p-3 text-sm text-foreground">
    <header className="grid gap-0.5">
      <h2 className="font-medium">{view.message ?? "Devices"}</h2>
      {view.context && <p className="text-xs text-muted-foreground">{view.context}</p>}
    </header>
    {state.devices.length > FILTER_THRESHOLD && <Input type="search" placeholder="Filter devices" value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter devices" className="h-8" />}
    {visible.length === 0 && <p className="px-2 text-muted-foreground">{query ? "No devices match this filter." : "No devices found."}</p>}
    {running.length > 0 && <Section title="Running">{running.map(device => <DeviceRow key={deviceKey(device)} controller={controller} device={device} showRuntime />)}</Section>}
    {offline.length > 0 && <Section title="Physical devices">{offline.map(device => <DeviceRow key={deviceKey(device)} controller={controller} device={device} showRuntime />)}</Section>}
    {groups.map(([runtime, devices]) => <Section key={`${runtime}:${expanded}`} title={`${runtime} · ${devices.length} stopped`} collapsible defaultOpen={expanded}>{devices.map(device => <DeviceRow key={deviceKey(device)} controller={controller} device={device} showRuntime={false} />)}</Section>)}
    {view.errors.map(error => <p key={error} className="px-2 text-xs text-muted-foreground">{error}</p>)}
    {state.error && <p className="px-2 text-xs text-destructive" role="alert">{state.error}</p>}
    {state.sent && <p className="px-2 text-xs text-muted-foreground">Choice sent to chat.</p>}
    {state.canMessage === false && choosing && <p className="px-2 text-xs text-muted-foreground">Reply in chat with the device to use.</p>}
    {state.canMessage && state.sent === false && (choosing || count > 0) && <footer className="flex justify-end pt-1">
      <Button size="sm" disabled={count === 0 || state.sending} onClick={() => void controller.send()}>{state.sending ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <MessageCircleIcon className="size-3.5" />}{count > 1 ? `Use ${count} devices` : "Use device"}</Button>
    </footer>}
  </div>;
}
