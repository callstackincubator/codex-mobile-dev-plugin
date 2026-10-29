import { CameraIcon, HouseIcon, CopyIcon, PowerIcon, SmartphoneIcon, type LucideIcon } from "lucide-react";
import { memo, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { DevicePicker } from "./device-picker";
import { DeviceSettings } from "./device-settings";
import type { SimulatorPanelView } from "../simulator-panel";
import type { DeviceButton } from "../simulator-state";
import { ScreenAnnotationOverlay, ScreenSelectButton } from "./screen-annotations";

const buttonIcons: Record<DeviceButton, LucideIcon> = { home: HouseIcon, "app-switcher": CopyIcon };

// The panel draws on the canvas after mount; keep this subtree stable so log batches never reset a live device.
export const SimulatorView = memo(function SimulatorView({ panel, visible, fullscreen }: { panel: SimulatorPanelView; visible: boolean; fullscreen: boolean }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLElement>(null);
  useLayoutEffect(() => panel.attach(canvas.current!, stage.current!), [panel]);
  const { platform, annotations } = panel;
  const { display, layout, notice } = state;
  const label = platform === "ios" ? "iOS" : "Android";
  const sidebar = !fullscreen;
  const id = (name: string) => `${platform}-${name}`;
  const description = display.kind === "message" ? display.description : "";
  return <section hidden={!visible} id={`${platform}-panel`} className="simulator-panel group/simulator @container relative flex h-full min-w-0 flex-1 flex-col" data-platform={platform} data-active={String(state.active)} aria-label={`${label} simulator`} onPointerDownCapture={panel.activate} onFocus={panel.activate}>
    <header className="panel-toolbar flex h-[49px] shrink-0 items-center border-b px-2">
      <div className="flex w-full min-w-0 items-center gap-1" role="toolbar" aria-label={`${label} controls`}>
        <DevicePicker id={id("devices")} label={`${label} device`} store={panel.picker} />
        {state.buttons.map(button => {
          const Icon = buttonIcons[button.action];
          return <Button key={button.action} variant="ghost" size="icon" className="shrink-0 data-[unsupported=true]:text-muted-foreground data-[unsupported=true]:cursor-not-allowed data-[unsupported=true]:disabled:pointer-events-auto data-[unsupported=true]:hover:bg-transparent data-[unsupported=true]:hover:text-muted-foreground" data-button={button.action} data-unsupported={String(button.unsupported)} title={button.title} aria-label={button.label} disabled={button.disabled} onClick={() => panel.press(button.action)}><Icon /></Button>;
        })}
        <Button variant="ghost" size="icon" className="shrink-0" data-element="screenshot" title={state.screenshot.title} aria-label="Screenshot to chat and clipboard" disabled={state.screenshot.disabled} onClick={panel.screenshot}><CameraIcon /></Button>
        <ScreenSelectButton store={annotations} />
      </div>
    </header>
    <section ref={stage} data-element="stage" className="group/stage relative grid min-h-0 flex-1 place-items-center overflow-hidden p-6 @max-[280px]:p-3" aria-label="Live simulator screen">
      <Empty className="absolute inset-0 group-has-[[data-element=empty][hidden]]/stage:hidden"><EmptyHeader><EmptyMedia variant="icon"><SmartphoneIcon /></EmptyMedia><EmptyTitle data-element="empty" role="status" hidden={display.kind !== "message"}>{display.kind === "message" ? display.title : ""}</EmptyTitle><EmptyDescription data-element="empty-description" hidden={!description}>{description}</EmptyDescription></EmptyHeader></Empty>
      <div data-element="device-frame" data-bezel={String(layout.chrome !== "plain")} style={layout.frame} hidden={display.kind === "message"}>
        <img data-element="device-bezel" className="pointer-events-none absolute inset-0 z-1 size-full select-none" alt="" draggable={false} src={layout.bezelImage} hidden={!layout.bezelImage} />
        <div data-element="device-nine-patch" className="pointer-events-none absolute inset-0 z-3" style={layout.ninePatch?.style} hidden={!layout.ninePatch}>{layout.ninePatch?.buttons.map((style, index) => <span key={index} style={style} />)}</div>
        <canvas ref={canvas} data-element="screen" data-selecting={String(state.selecting)} style={layout.screen} className="block size-full touch-none bg-black outline-none" tabIndex={0} aria-label={`${label} screen. Click or drag to interact. Focus to type.`} />
      </div>
      <div data-element="stopped" className="absolute inset-0 z-10 bg-background/70" hidden={display.kind !== "stopped"}><Empty><EmptyHeader><EmptyMedia variant="icon"><PowerIcon /></EmptyMedia><EmptyTitle>Device stopped</EmptyTitle></EmptyHeader><EmptyContent><Button data-element="start-device" size="sm" disabled={state.start.disabled} onClick={panel.startDevice}>Start device</Button></EmptyContent></Empty></div>
      <ScreenAnnotationOverlay store={annotations} />
    </section>
    <footer className={sidebar ? "absolute bottom-2 right-2 z-30 flex items-center text-[10px] text-muted-foreground" : "flex h-11 shrink-0 items-center gap-x-3 border-t px-2 text-[10px] text-muted-foreground"}>
      <span data-element="notice" className={notice.destructive ? "sr-only text-destructive" : "sr-only"} title={notice.message} hidden={!notice.message}><span data-element="notice-message">{notice.message}</span></span>
      <span data-element="screenshot-status" className="sr-only" hidden />
      <DeviceSettings platform={platform} store={panel.settings} appTools={panel.appTools} />
    </footer>
  </section>;
});
