import { CheckIcon, LoaderCircleIcon, PlusIcon, SmartphoneIcon, SquareIcon, TabletIcon } from "lucide-react";
import { createContext, Fragment, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { platforms, type Platform } from "../device-inventory";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";
import type { DeviceWorkspace } from "../device-workspace";
import { Button } from "./ui/button";
import { Popover, PopoverAnchor, PopoverClose, PopoverContent } from "./ui/popover";

type PickerAnchor = { button: HTMLButtonElement; reference: () => number | undefined };
type PickerState = { anchor: PickerAnchor | null; setAnchor: (value: PickerAnchor | null) => void; available: boolean; id: string };
const PickerContext = createContext<PickerState | null>(null);
const firstDevice = () => undefined;

export function AddDeviceButton({ reference = firstDevice }: { reference?: PickerAnchor["reference"] }) {
  const { anchor, setAnchor, available, id } = useContext(PickerContext)!;
  const button = useRef<HTMLButtonElement>(null);
  const expanded = !!anchor && anchor.button === button.current;
  return <Button ref={button} data-device-add={id} variant="ghost" size="sm" disabled={!available}
    className="mx-1 h-7 shrink-0 gap-1 px-2 text-xs font-normal text-muted-foreground"
    aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
    onClick={event => {
      if (expanded) setAnchor(null);
      else setAnchor({ button: event.currentTarget, reference });
    }}><PlusIcon aria-hidden="true" className="size-3.5" />Add device</Button>;
}

export function EmptyDeviceTabBar() {
  return <div className="flex h-[34px] shrink-0 items-center border-b bg-muted"><AddDeviceButton /></div>;
}

export function DevicePicker({ workspace, children }: { workspace: DeviceWorkspace; children: ReactNode }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [anchor, changeAnchor] = useState<PickerAnchor | null>(null);
  const lastButton = useRef<HTMLButtonElement>(null);
  const setAnchor = useCallback((value: PickerAnchor | null) => {
    if (value) lastButton.current = value.button;
    changeAnchor(value);
  }, []);
  const [error, setError] = useState("");
  const id = useId();
  const open = anchor !== null;
  const context = useMemo(() => ({ anchor, setAnchor, available: state.available, id }), [anchor, state.available, id]);
  const virtualRef = useMemo(() => ({ current: anchor?.button ?? null }), [anchor]);
  useEffect(() => {
    workspace.setPickerOpen(open);
    return () => workspace.setPickerOpen(false);
  }, [workspace, open]);
  function toggle(platform: Platform, device: SimulatorDevice) {
    const reference = anchor?.reference();
    workspace.toggle(platform, device, reference);
  }

  function column(platform: Platform) {
    const { items, status, error: discoveryError } = workspace.inventory[platform];
    const setupHint = status?.setupHint || (platform === "android" ? status?.error : undefined);
    const emptyMessage = status?.localIosSupported === false ? "Local iOS devices require macOS." : setupHint || (status ? "No devices found" : "Finding devices…");
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
            <PopoverClose asChild><Button variant="ghost" data-device-option={item.value} aria-pressed={selected} className="h-auto min-h-9 min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left" onClick={() => toggle(platform, item.device)}>
              <span className="relative shrink-0 text-muted-foreground"><Icon />{item.running && <span role="img" aria-label={item.statusLabel} className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-green-500 ring-2 ring-popover" />}</span>
              <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{item.title}{item.detail && <span className="block text-xs font-normal text-muted-foreground">{item.detail}</span>}</span>
              {selected && <CheckIcon className="size-3.5 shrink-0" />}
            </Button></PopoverClose>
            {item.canStop && <Button variant="ghost" size="icon" className="mr-1 size-6 shrink-0 text-muted-foreground" disabled={!!state.stopping} aria-label={`Stop ${item.label}`} title={`Stop ${item.label}`} onClick={async () => {
              setError("");
              try { await workspace.stop(platform, item.device); }
              catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
            }}>{state.stopping === item.value ? <LoaderCircleIcon className="size-3 animate-spin" /> : <SquareIcon className="size-3 fill-current" />}</Button>}
          </div>
        </Fragment>;
      })}
      {missing.map(pane => <PopoverClose asChild key={pane.key}><Button variant="ghost" aria-pressed="true" className="w-full justify-between" onClick={() => workspace.remove(pane.key)}>{pane.last.name} · Offline<CheckIcon /></Button></PopoverClose>)}
      {!items.length && !missing.length && <p className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</p>}
      {discoveryError && discoveryError !== emptyMessage && <details className="mt-1 px-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Discovery details</summary><p className="mt-1 break-words">{discoveryError}</p></details>}
    </section>;
  }

  return <PickerContext.Provider value={context}>
    {children}
    <Popover open={open} onOpenChange={value => { if (!value) setAnchor(null); }}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent id={id} align="start" side="bottom" collisionPadding={8} aria-label="Choose devices"
        onInteractOutside={event => {
          const target = event.target;
          if (target instanceof Element && target.closest("[data-device-add]")) event.preventDefault();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const trigger = lastButton.current;
          if (trigger?.isConnected) trigger.focus();
          else {
            // Selecting the first or removing the last device replaces the tab strip.
            const next = document.querySelector<HTMLButtonElement>(`[data-device-add="${id}"]`);
            next?.focus();
          }
        }}
        className="max-h-(--radix-popover-content-available-height) w-[min(32rem,var(--radix-popover-content-available-width))] overflow-y-auto p-0">
        <div className="grid grid-cols-2 divide-x max-[340px]:grid-cols-1 max-[340px]:divide-x-0 max-[340px]:divide-y">{platforms.map(column)}</div>
        {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  </PickerContext.Provider>;
}
