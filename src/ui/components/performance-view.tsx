import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIcon, RefreshCwIcon, SlidersHorizontalIcon, SquareIcon } from "lucide-react";
import type { PerformancePanel } from "../performance-panel.ts";
import { SIDEBAR_WIDTH, TIMELINE_HEIGHT } from "../performance/constants";
import { useCursorTracking } from "../performance/useCursorTracking";
import { useTimelineViewport } from "../performance/useTimelineViewport";
import { CpuTrack } from "./performance/CpuTrack";
import { MemoryTrack } from "./performance/MemoryTrack";
import { DisplayFpsTrack } from "./performance/DisplayFpsTrack";
import { TimelineRuler } from "./performance/TimelineRuler";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Field, FieldLabel, FieldDescription } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";

export function PerformanceView({ panel }: { panel: PerformancePanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const container = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const { zoom, following, contentWidth, reset, change, handleScroll } = useTimelineViewport(state.samples, scrollElement, state.fpsSamples);
  const { cursorLabel, handleMouseMove, handleMouseLeave } = useCursorTracking(container, scrollElement, SIDEBAR_WIDTH, zoom);
  useEffect(() => { if (state.fpsMonitoring === false && (state.phase === "connecting" || state.phase === "idle")) reset(); }, [state.phase, state.fpsMonitoring, reset]);
  const selectedRunning = state.apps.some(app => app.bundleId === state.bundleId);
  const monitoring = state.monitoring || state.fpsMonitoring;
  let phase = state.phase;
  if (state.fpsPhase === "recording") phase = "recording";
  else if (state.fpsPhase === "connecting" && state.monitoring === false) phase = "connecting";
  else if (state.fpsPhase === "failed" && state.monitoring === false) phase = "failed";

  return <section id="performance-drawer" className="flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-labelledby="tool-performance">
    <header className="flex h-[49px] shrink-0 items-center gap-2 border-b px-2">
      <ActivityIcon className="size-4 text-blue-500" />
      <div className="mr-auto min-w-0 text-xs">
        <div className="truncate" title={state.bundleId}>{state.bundleId || "Performance"}</div>
        <div className="truncate text-[10px] text-muted-foreground">{state.selectedLabel}</div>
      </div>
      <span id="performance-status" role="status" className="shrink-0 text-[11px] text-muted-foreground capitalize">{phase === "recording" ? "Live" : phase}</span>
      {monitoring ? <Button variant="ghost" size="icon-sm" title="Stop performance monitoring" aria-label="Stop performance monitoring" onClick={() => void panel.disconnect()}><SquareIcon /></Button>
        : <Button variant="ghost" size="icon-sm" title="Start performance monitoring" aria-label="Start performance monitoring" disabled={state.available === false || (state.fpsSupported === false && selectedRunning === false)} onClick={() => panel.show()}><ActivityIcon /></Button>}
      <Popover>
        <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Performance settings" title="Performance settings"><SlidersHorizontalIcon /></Button></PopoverTrigger>
        <PopoverContent align="end" className="w-[min(340px,calc(100vw-24px))] p-3">
          <Field className="gap-2">
            <div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="performance-app" className="text-xs">{state.selectedLabel}</FieldLabel><Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={state.available === false || state.discovering} onClick={() => void panel.discover()}><RefreshCwIcon />Refresh</Button></div>
            <NativeSelect id="performance-app" className="w-full" value={state.bundleId} onChange={event => panel.selectApp(event.target.value)}>
              <NativeSelectOption value="">Choose an app</NativeSelectOption>
              {state.bundleId && selectedRunning === false && <NativeSelectOption value={state.bundleId}>{state.bundleId} · Waiting for app</NativeSelectOption>}
              {state.apps.map(app => <NativeSelectOption key={app.bundleId} value={app.bundleId}>{app.bundleId} · {app.pid}</NativeSelectOption>)}
            </NativeSelect>
            <FieldDescription className="text-[11px]">{state.platform === "android"
              ? "Open an app on this Android device. CPU and memory monitoring work with release builds too."
              : state.physical ? "Open a development build on this paired iPhone with Developer Mode enabled. Detach Xcode or LLDB before connecting."
              : "Open a development build in the iOS simulator. Detach Xcode or LLDB before connecting."}</FieldDescription>
          </Field>
          {state.sourceError && <p role="alert" className="mt-2 text-xs text-destructive">{state.sourceError}</p>}
        </PopoverContent>
      </Popover>
    </header>
    <div ref={setScrollElement} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto" data-performance-scroll>
      {state.sourceError && <Alert variant="destructive" className="rounded-none border-x-0 border-t-0"><AlertDescription>{state.sourceError}</AlertDescription></Alert>}
      <div ref={container} style={{ width: contentWidth, minWidth: "100%" }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} aria-label="Live CPU, memory and display FPS">
        <div className="flex border-b" style={{ height: TIMELINE_HEIGHT }}>
          <div className="sticky left-0 z-[60] flex shrink-0 items-center gap-2 border-r bg-background px-2 text-[10px] text-muted-foreground" style={{ width: SIDEBAR_WIDTH }}>
            <span>Live performance</span>
            {state.phase === "failed" && <button type="button" className="text-blue-500" onClick={() => panel.retry()}>Retry</button>}
            {following === false && <button type="button" className="text-blue-500" onClick={reset}>Follow live</button>}
          </div>
          <div className="min-w-0 flex-1"><TimelineRuler cursorLabel={cursorLabel} zoomState={zoom} onZoomOut={reset} /></div>
        </div>
        <DisplayFpsTrack samples={state.fpsSamples} phase={state.fpsPhase} error={state.fpsError} supported={state.fpsSupported}
          platform={state.platform} zoomState={zoom} onZoomChange={change} onZoomOut={reset} onRetry={() => panel.retryFps()} />
        <CpuTrack samples={state.samples} threadHistory={state.threadHistory} platform={state.platform}
          threadOrder={state.threadOrder} onThreadOrderChange={order => panel.setThreadOrder(order)}
          phase={state.phase} error={state.error || null} scrollElement={scrollElement}
          zoomState={zoom} onZoomChange={change} onZoomOut={reset} />
        <MemoryTrack samples={state.samples} platform={state.platform} phase={state.phase} error={state.error || null}
          zoomState={zoom} onZoomChange={change} onZoomOut={reset} />
      </div>
      {state.bundleId === "" && <p className="p-4 text-xs text-muted-foreground">Open an app to record CPU and memory. A single running app is selected automatically; choose one in performance settings when several are running.</p>}
    </div>
    <footer className="flex min-h-11 shrink-0 items-center border-t px-3 text-[11px] text-muted-foreground">100% = one CPU core · Display FPS includes system UI; quiet screens can show 0 · Last 150 seconds</footer>
  </section>;
}
