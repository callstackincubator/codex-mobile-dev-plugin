import { useId, useSyncExternalStore } from "react";
import { LeafIcon, RotateCwIcon } from "lucide-react";
import type { ResourceSavingStore } from "../resource-saving";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";

export function ResourceSaving({ store }: { store: ResourceSavingStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const id = useId();
  if (!state.visible || state.value?.supported === false) return null;
  const disabled = state.disabled || state.loading || state.busy || state.value === undefined;
  const enabled = state.value?.enabled === true;
  const ramProfile = state.value?.profile === "ram";
  const label = ramProfile ? "Emulator RAM profile" : "Resource saving";
  const ramMiB = state.value?.ramMiB;
  const ramHint = ramMiB === undefined
    ? "This AVD will use its configured RAM on the next start. You can clear the saved preference."
    : `Requests ${ramMiB} MiB of guest RAM. Some system images require more.`;
  const restartHint = ramProfile
    ? "Restart this emulator from Mobile Dev to apply the RAM setting. Running apps will close."
    : "Restart this device to apply the saved setting. Running apps will close.";
  const timingHint = ramProfile ? "Applies the next time Mobile Dev starts this emulator."
    : state.value?.running ? "The saved setting was applied when this device started." : "Applies the next time this device starts.";
  return <Popover onOpenChange={open => { if (open) void store.load(); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" disabled={state.disabled || state.busy} aria-label={label} title={state.value ? `${label} ${enabled ? "on" : "off"}` : label} className={enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}><LeafIcon /></Button></PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-72 space-y-3 p-4 text-sm" aria-label={label}>
      <div className="flex items-center justify-between gap-3"><label htmlFor={id} className="font-medium">{ramProfile ? "Reduce emulator RAM" : "Save resources"}</label><Switch id={id} checked={enabled} disabled={disabled || (ramProfile && ramMiB === undefined && !enabled)} onCheckedChange={value => void store.change(value)} /></div>
      {state.value && <>
        <p className="text-xs text-muted-foreground">{ramProfile
          ? ramHint
          : "Reduce background services and memory use. Saved for this device and enabled by default."}</p>
        <p className="text-xs text-muted-foreground">{state.value.restartRequired ? restartHint : timingHint}</p>
      </>}
      {state.value?.restartRequired && <Button variant="outline" size="sm" disabled={disabled} onClick={() => void store.restartDevice()}><RotateCwIcon />Restart to apply</Button>}
      {state.busy && <p className="text-xs text-muted-foreground" role="status">Applying…</p>}
      {state.error && <p className="text-xs text-destructive" role="alert">{state.error}</p>}
    </PopoverContent>
  </Popover>;
}
