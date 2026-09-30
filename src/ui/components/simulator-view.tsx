import { CameraIcon, HouseIcon, PanelsTopLeftIcon, SmartphoneIcon, type LucideIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "./ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { DevicePicker } from "./device-picker";

const deviceButtons: { action: string; icon: LucideIcon; label: string }[] = [
  { action: "home", icon: HouseIcon, label: "Home" },
  { action: "app-switcher", icon: PanelsTopLeftIcon, label: "App switcher" },
];

// The stream controller owns canvas pixels and device control state after mount.
// Keep this subtree stable so log batches never reset a live device.
export const SimulatorView = memo(function SimulatorView({ platform }: { platform: "ios" | "android" }) {
  const label = platform === "ios" ? "iOS" : "Android";
  const id = (name: string) => `${platform}-${name}`;
  return <section id={`${platform}-panel`} className="simulator-panel group/simulator @container flex h-full min-w-0 flex-1 flex-col" data-platform={platform} aria-label={`${label} simulator`}>
    <header className="flex h-[49px] shrink-0 items-center border-b px-2">
      <div className="flex w-full min-w-0 items-center gap-1" role="toolbar" aria-label={`${label} controls`}>
        <DevicePicker id={id("devices")} label={`${label} device`} />
        {deviceButtons.map(({ action, icon: Icon, label }) => <Button key={action} variant="ghost" size="icon" className="shrink-0" data-button={action} title={label} aria-label={label} disabled><Icon /></Button>)}
        <Button variant="ghost" size="icon" className="shrink-0" data-element="screenshot" title="Screenshot to chat and clipboard" aria-label="Screenshot to chat and clipboard" disabled><CameraIcon /></Button>
      </div>
    </header>
    <section data-element="stage" className="group/stage relative grid min-h-0 flex-1 place-items-center overflow-hidden p-6 @max-[280px]:p-3" aria-label="Live simulator screen">
      <Empty className="absolute inset-0 group-has-[[data-element=empty][hidden]]/stage:hidden"><EmptyHeader><EmptyMedia variant="icon"><SmartphoneIcon /></EmptyMedia><EmptyTitle data-element="empty" role="status">Loading devices...</EmptyTitle></EmptyHeader></Empty>
      <div data-element="device-frame" hidden>
        <img data-element="device-bezel" className="pointer-events-none absolute inset-0 z-1 size-full select-none" alt="" draggable={false} hidden />
        <canvas data-element="screen" className="block size-full touch-none bg-black focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ring" tabIndex={0} aria-label={`${label} screen. Click or drag to interact. Focus to type.`} />
      </div>
    </section>
    <footer className="flex h-11 shrink-0 items-center gap-x-3 border-t px-3 text-[10px] text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
      <span data-element="notice" className="min-w-0 flex-1 truncate" hidden><span data-element="notice-message" /></span>
      <span data-element="screenshot-status" className="min-w-0 flex-1 truncate" hidden />
    </footer>
  </section>;
});
