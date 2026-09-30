import { ArrowLeftIcon, BotIcon, CameraIcon, HouseIcon, LockKeyholeIcon, PanelsTopLeftIcon, RefreshCwIcon, SmartphoneIcon, type LucideIcon } from "lucide-react";
import { memo } from "react";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyDescription } from "./ui/empty";
import { FieldLabel } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Separator } from "./ui/separator";

const deviceButtons: { action: string; icon: LucideIcon; label: string }[] = [
  { action: "back", icon: ArrowLeftIcon, label: "Back" },
  { action: "home", icon: HouseIcon, label: "Home" },
  { action: "power", icon: LockKeyholeIcon, label: "Lock" },
  { action: "app-switcher", icon: PanelsTopLeftIcon, label: "App switcher" },
];

// The stream controller owns canvas pixels and device control state after mount.
// Keep this subtree stable so log batches never reset a live device.
export const SimulatorView = memo(function SimulatorView({ platform }: { platform: "ios" | "android" }) {
  const label = platform === "ios" ? "iOS" : "Android";
  const id = (name: string) => `${platform}-${name}`;
  return <section id={`${platform}-panel`} className="simulator-panel group/simulator @container flex min-w-0 flex-1 flex-col bg-muted" data-platform={platform} aria-label={`${label} simulator`}>
    <header className="shrink-0 border-b bg-background px-3 pt-3 pb-1.5 @max-[280px]:px-2">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold">{platform === "ios" ? <SmartphoneIcon className="size-4" /> : <BotIcon className="size-4" />}<span data-element="platform-label">{label}</span><span aria-hidden="true" className="ml-0.5 size-1.5 rounded-full group-data-[active=true]/simulator:bg-foreground" /></div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums"><span data-element="frame-stats" className="@max-[280px]:hidden">0 fps</span><Badge variant="secondary" data-element="stream-format">{platform === "ios" ? "MJPEG" : "H.264"}</Badge></div>
      </div>
      <div className="flex items-center gap-1.5">
        <FieldLabel htmlFor={id("devices")} className="sr-only">{label} device</FieldLabel>
        <NativeSelect className="w-0 min-w-0 flex-1 [&_select]:text-ellipsis" id={id("devices")} data-element="devices" disabled defaultValue="loading"><NativeSelectOption value="loading">Loading devices...</NativeSelectOption></NativeSelect>
        <Button data-element="start" disabled className="min-w-12 data-[streaming=true]:bg-secondary data-[streaming=true]:text-secondary-foreground">Start</Button>
      </div>
      <div className="mt-1.5 flex items-center gap-0.5 @max-[280px]:gap-0 @max-[280px]:[&_button]:w-6" role="toolbar" aria-label={`${label} controls`}>
        {deviceButtons.map(({ action, icon: Icon, label }) => <Button key={action} variant="ghost" size="icon" data-button={action} title={label} aria-label={label} hidden={action === "back" && platform === "ios"} disabled><Icon /></Button>)}
        <Separator orientation="vertical" className="mx-1 h-4" />
        <Button variant="ghost" size="icon" data-element="screenshot" title="Screenshot to chat and clipboard" aria-label="Screenshot to chat and clipboard" hidden={platform === "android"} disabled><CameraIcon /></Button>
        <Button variant="ghost" size="icon" data-element="refresh" title="Refresh devices" aria-label="Refresh devices"><RefreshCwIcon /></Button>
        <span className="ml-auto text-[10px] whitespace-nowrap text-muted-foreground @max-[460px]:hidden">Click screen to interact</span>
      </div>
      <Alert data-element="notice" role="status" variant="destructive" className="mt-2" hidden><AlertDescription className="flex flex-wrap items-center gap-1.5 wrap-anywhere"><span data-element="notice-message" /><Button data-element="repair-input" variant="outline" size="sm" title="Restarts SpringBoard and closes running simulator apps" hidden>Repair input</Button></AlertDescription></Alert>
      <Alert data-element="screenshot-status" role="status" className="mt-2 wrap-anywhere" hidden />
    </header>
    <section data-element="stage" className="group/stage relative grid min-h-0 flex-1 place-items-center overflow-hidden p-6 @max-[280px]:p-3" aria-label="Live simulator screen">
      <Empty className="group-has-[[data-element=empty][hidden]]/stage:hidden"><EmptyHeader><EmptyMedia variant="icon"><SmartphoneIcon /></EmptyMedia><EmptyDescription data-element="empty" role="status">Loading devices...</EmptyDescription></EmptyHeader></Empty>
      <div data-element="device-frame" hidden>
        <img data-element="device-bezel" className="pointer-events-none absolute inset-0 z-1 size-full select-none" alt="" draggable={false} hidden />
        <canvas data-element="screen" className="block size-full touch-none bg-black focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ring" tabIndex={0} aria-label={`${label} screen. Click or drag to interact. Focus to type.`} />
      </div>
    </section>
  </section>;
});
