import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, PanelsLeftRightIcon, SmartphoneIcon, SquareIcon, TabletIcon } from "lucide-react";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { platforms, type Platform } from "../device-inventory";
import type { DeviceWorkspace } from "../device-workspace";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function DevicePicker({ workspace, side = "bottom" }: { workspace: DeviceWorkspace; side?: "top" | "bottom" }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    workspace.setPickerOpen(open);
    return () => workspace.setPickerOpen(false);
  }, [workspace, open]);

  function column(platform: Platform) {
    const { items, status, error: discoveryError } = workspace.inventory[platform];
    const label = platform === "ios" ? "iOS" : "Android";
    const missing = state.panes.filter(pane => pane.platform === platform && !pane.device);
    return <section key={platform} aria-label={label} className="min-w-0 p-2">
      <h3 className="px-2 pt-1 text-sm font-semibold">{label}</h3>
      {items.map((item, index) => {
        const selected = state.panes.some(pane => pane.platform === platform && pane.device?.udid === item.value);
        const Icon = item.tablet ? TabletIcon : SmartphoneIcon;
        return <Fragment key={item.value}>
          {items[index - 1]?.group !== item.group && <p className="px-2 pb-1 pt-3 text-xs text-muted-foreground">{item.group}</p>}
          <div className="flex items-center rounded-md hover:bg-accent has-[[aria-pressed=true]]:bg-accent">
            <Button variant="ghost" data-device-option={item.value} aria-pressed={selected} className="h-auto min-h-9 min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left" onClick={() => workspace.toggle(platform, item.device)}>
              <span className="relative shrink-0 text-muted-foreground"><Icon />{item.running && <span role="img" aria-label={item.statusLabel} className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-green-500 ring-2 ring-popover" />}</span>
              <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{item.device.name}{item.detail && <span className="block text-xs font-normal text-muted-foreground">{item.detail}</span>}</span>
              {selected && <CheckIcon className="size-3.5 shrink-0" />}
            </Button>
            {item.canStop && <Button variant="ghost" size="icon" className="mr-1 size-6 shrink-0 text-muted-foreground" disabled={!!state.stopping} aria-label={`Stop ${item.label}`} title={`Stop ${item.label}`} onClick={async () => {
              setError("");
              try { await workspace.stop(platform, item.device); }
              catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
            }}>{state.stopping === item.value ? <LoaderCircleIcon className="size-3 animate-spin" /> : <SquareIcon className="size-3 fill-current" />}</Button>}
          </div>
        </Fragment>;
      })}
      {missing.map(pane => <Button key={pane.key} variant="ghost" aria-pressed="true" className="w-full justify-between" onClick={() => workspace.remove(pane.key)}>{pane.last.name} · Offline<CheckIcon /></Button>)}
      {!items.length && !missing.length && <p className="px-2 py-3 text-xs text-muted-foreground">{status ? "No devices found" : "Finding devices…"}</p>}
      {discoveryError && <details className="mt-1 px-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Discovery details</summary><p className="mt-1 break-words">{discoveryError}</p></details>}
    </section>;
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button id="device-select" variant="outline" size="sm" disabled={!state.available} aria-label="Choose devices">
      <PanelsLeftRightIcon />Devices{state.panes.length > 0 && <span className="rounded-sm bg-muted px-1 text-xs tabular-nums">{state.panes.length}</span>}<ChevronDownIcon className="size-3 text-muted-foreground" />
    </Button></PopoverTrigger>
    <PopoverContent align="end" side={side} collisionPadding={8} aria-label="Choose devices" className="max-h-(--radix-popover-content-available-height) w-[min(32rem,var(--radix-popover-content-available-width))] overflow-y-auto p-0">
      <div className="grid grid-cols-2 divide-x max-[340px]:grid-cols-1 max-[340px]:divide-x-0 max-[340px]:divide-y">{platforms.map(column)}</div>
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
