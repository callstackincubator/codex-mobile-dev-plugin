import { CameraIcon, HouseIcon, CopyIcon, PowerIcon, SmartphoneIcon, type LucideIcon } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { DevicePicker } from "./device-picker";
import { DeviceSettings } from "./device-settings";
import { bindScreenAnnotations, ScreenAnnotationsStore } from "../screen-annotations";
import { ScreenAnnotationOverlay, ScreenSelectButton } from "./screen-annotations";

const deviceButtons: { action: string; icon: LucideIcon; label: string }[] = [
  { action: "home", icon: HouseIcon, label: "Home" },
  { action: "app-switcher", icon: CopyIcon, label: "App switcher" },
];

// The stream controller owns canvas pixels and device control state after mount.
// Keep this subtree stable so log batches never reset a live device.
export const SimulatorView = memo(function SimulatorView({ platform }: { platform: "ios" | "android" }) {
  const [annotations] = useState(() => new ScreenAnnotationsStore());
  const label = platform === "ios" ? "iOS" : "Android";
  const id = (name: string) => `${platform}-${name}`;
  return <section hidden={platform === "android"} id={`${platform}-panel`} className="simulator-panel group/simulator @container flex h-full min-w-0 flex-1 flex-col" data-platform={platform} aria-label={`${label} simulator`}>
    <header className="flex h-[49px] shrink-0 items-center border-b px-2">
      <div className="flex w-full min-w-0 items-center gap-1" role="toolbar" aria-label={`${label} controls`}>
        <DevicePicker id={id("devices")} label={`${label} device`} />
        {deviceButtons.map(({ action, icon: Icon, label }) => <Button key={action} variant="ghost" size="icon" className="shrink-0" data-button={action} title={label} aria-label={label} disabled><Icon /></Button>)}
        <Button variant="ghost" size="icon" className="shrink-0" data-element="screenshot" title="Screenshot to chat and clipboard" aria-label="Screenshot to chat and clipboard" disabled><CameraIcon /></Button>
        <ScreenSelectButton store={annotations} />
      </div>
    </header>
    <section ref={element => { if (element) bindScreenAnnotations(element, annotations); }} data-element="stage" className="group/stage relative grid min-h-0 flex-1 place-items-center overflow-hidden p-6 @max-[280px]:p-3" aria-label="Live simulator screen">
      <Empty className="absolute inset-0 group-has-[[data-element=empty][hidden]]/stage:hidden"><EmptyHeader><EmptyMedia variant="icon"><SmartphoneIcon /></EmptyMedia><EmptyTitle data-element="empty" role="status">Loading devices...</EmptyTitle><EmptyDescription data-element="empty-description">Finding available {platform === "ios" ? "iOS devices" : "Android devices"}.</EmptyDescription></EmptyHeader></Empty>
      <div data-element="device-frame" hidden>
        <img data-element="device-bezel" className="pointer-events-none absolute inset-0 z-1 size-full select-none" alt="" draggable={false} hidden />
        <div data-element="device-nine-patch" className="pointer-events-none absolute inset-0 z-3" hidden />
        <canvas data-element="screen" className="block size-full touch-none bg-black focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ring" tabIndex={0} aria-label={`${label} screen. Click or drag to interact. Focus to type.`} />
      </div>
      <div data-element="stopped" className="absolute inset-0 z-10 bg-background/70" hidden><Empty><EmptyHeader><EmptyMedia variant="icon"><PowerIcon /></EmptyMedia><EmptyTitle>Device stopped</EmptyTitle></EmptyHeader><EmptyContent><Button data-element="start-device" size="sm">Start device</Button></EmptyContent></Empty></div>
      <ScreenAnnotationOverlay store={annotations} />
    </section>
    <footer className="flex h-11 shrink-0 items-center gap-x-3 border-t px-2 text-[10px] text-muted-foreground">
      <span data-element="notice" className="sr-only" hidden><span data-element="notice-message" /></span>
      <span data-element="screenshot-status" className="sr-only" hidden />
      <DeviceSettings platform={platform} />
    </footer>
  </section>;
});
