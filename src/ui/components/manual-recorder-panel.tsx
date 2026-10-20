import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ManualSnapshotNode } from "../../shared/app-flow.ts";
import type { AppFlowRecordingStore } from "../app-flow-recording.ts";
import { isTextInput, layoutWireframe, type WireframeBox } from "./manual-wireframe.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

const PANEL_WIDTH = 360;
const WIREFRAME_MAX_HEIGHT = 520;

type Mode = "preview" | "list";

export function ManualRecorderPanel({ projectPath, title, store }: { projectPath: string; title: string; store: AppFlowRecordingStore }) {
  const recording = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fillValue, setFillValue] = useState("");
  const [mode, setMode] = useState<Mode>("preview");
  const [showSteps, setShowSteps] = useState(true);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, x: position.x, y: position.y };
  }, [position]);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current; if (!origin) return;
    setPosition({ x: Math.max(0, origin.x + event.clientX - origin.pointerX), y: Math.max(0, origin.y + event.clientY - origin.pointerY) });
  }, []);
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragOrigin.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  if (!recording.nodeId) return null;
  const selected = recording.snapshot.find(node => elementKey(node) === selectedKey) ?? null;
  const { boxes, height } = recording.bounds ? layoutWireframe(recording.snapshot, recording.bounds, PANEL_WIDTH) : { boxes: [] as WireframeBox[], height: 0 };
  // Every device call is exclusive — one in flight owns the agent-device session — so anything
  // that would issue a second one is locked out rather than queued behind it. `acting` is part of
  // this now: a tap sent into a busy session used to look accepted and then silently time out.
  const starting = recording.status === "starting", saving = recording.status === "saving";
  const acting = recording.status === "acting" || recording.pending !== null;
  const locked = starting || saving || acting;
  const finished = recording.outcome !== null;
  const act = (action: Parameters<AppFlowRecordingStore["act"]>[1]) => { if (!locked) void store.act(projectPath, action); };
  return <div role="dialog" aria-label={`Recording a path to ${title}`} className="absolute z-30 flex flex-col rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur"
    style={{ left: position.x, top: position.y, width: PANEL_WIDTH + 24 }}>
    <div className="flex cursor-grab items-start justify-between gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <StatusDot status={recording.status} />
          <div className="truncate text-xs font-medium">Record path · {title}</div>
        </div>
        <StatusLine recording={recording} />
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={finished ? "Close" : "Discard recording"} title={finished ? "Close" : "Discard this recording"}
        onClick={() => void (finished ? store.dismiss() : store.cancel(projectPath))}>×</Button>
    </div>
    {recording.error && <div className="flex items-start gap-2 border-b border-border bg-amber-500/10 px-3 py-2 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
      <span aria-hidden>!</span><span className="min-w-0 flex-1">{recording.error}<div className="mt-0.5 opacity-80">The recording is still live — try another element, or scroll and try again.</div></span>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss this error" onClick={() => store.clearError()}>×</Button></div>}
    {finished ? <div className="flex flex-col gap-2 px-3 py-3">
      <div className="text-xs font-medium">{recording.outcome?.replayVerified ? "Saved as a verified replay" : "Saved as a command list"}</div>
      {recording.outcome?.fallbackReason && <div className="text-[10px] leading-snug text-muted-foreground">{recording.outcome.fallbackReason}</div>}
      <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-[10px] leading-relaxed">{recording.outcome?.pathToReach.join("\n")}</pre>
      <div className="text-[10px] text-muted-foreground">The app stays up, so recording a path to the next screen starts straight away.</div>
      <Button variant="outline" size="sm" onClick={() => store.dismiss()}>Done</Button>
    </div> : <>
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="How to choose an element">
          {(["preview", "list"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
            className={`rounded-[5px] px-2 py-0.5 text-[10px] font-medium capitalize ${mode === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setMode(value)}>{value}</button>)}
        </div>
        <div className="text-[10px] text-muted-foreground" title="Wrappers are drawn as outlines and only clickable by their corner chip, so the controls inside them stay reachable. The list reaches every element.">
          {boxes.length} element{boxes.length === 1 ? "" : "s"}{boxes.some(box => box.container) ? ` · ${boxes.filter(box => box.container).length} wrappers` : ""}</div>
      </div>
      <div className="relative m-3 mt-2 overflow-auto rounded-lg border border-border bg-muted/40" style={{ width: PANEL_WIDTH, maxHeight: WIREFRAME_MAX_HEIGHT }}>
        {mode === "preview"
          ? <div className="relative" style={{ width: PANEL_WIDTH, height }}>
            {boxes.map((box, index) => {
              const chosen = selectedKey !== null && elementKey(box.node) === selectedKey;
              const frame = `absolute overflow-hidden rounded-sm border text-left text-[9px] leading-tight ${box.addressable ? "border-border/70 text-foreground" : "border-dashed border-amber-500/60 text-muted-foreground"}`;
              const place = { left: box.left, top: box.top, width: box.width, height: box.height, zIndex: box.z };
              // A wrapper is drawn but takes no clicks: on this screen the feed, the tab bar's own
              // container and the compose overlay each span most of the device, and whichever one
              // the browser hit-tested first swallowed every tap aimed at a control inside it.
              // Its own tap target survives as the chip, when it has a name worth showing.
              if (box.container) return <div key={`${box.node.ref}:${index}`} aria-hidden className={`${frame} pointer-events-none opacity-60`} style={place} />;
              return <button key={`${box.node.ref}:${index}`} type="button" disabled={locked} title={describe(box.node)}
                onClick={() => choose(box.node)}
                className={`${frame} px-1 transition-colors hover:border-primary hover:bg-primary/25 ${chosen ? "bg-primary/30" : ""}`}
                style={place}>{box.caption}</button>;
            })}
            {boxes.map((box, index) => box.container && box.caption ? <button key={`chip:${box.node.ref}:${index}`} type="button" disabled={locked}
              title={`${describe(box.node)}\nThis element wraps others — the outline is its edge.`} onClick={() => choose(box.node)}
              className="absolute truncate rounded-[3px] border border-border/70 bg-background/85 px-1 text-[8px] leading-[12px] text-muted-foreground hover:border-primary hover:bg-primary/25 hover:text-foreground"
              style={{ left: box.left + 1, top: box.top + 1, maxWidth: Math.max(0, Math.min(box.width - 2, 110)), zIndex: box.z + boxes.length }}>{box.caption}</button> : null)}
            {boxes.length === 0 && <div className="p-4 text-center text-[10px] text-muted-foreground">{starting ? "Waiting for the app…" : "No elements reported on this screen."}</div>}
          </div>
          // The preview draws elements where the device puts them, which on a dense screen means
          // captions that overlap and small controls buried under big ones. The list is the same
          // elements, one per row, in the same order — the way out of that without a second layout.
          : <div className="flex flex-col divide-y divide-border/60">
            {boxes.map((box, index) => <button key={`${box.node.ref}:${index}`} type="button" disabled={locked} title={describe(box.node)}
              onClick={() => choose(box.node)}
              className={`flex items-center gap-2 px-2 py-1.5 text-left text-[10px] hover:bg-primary/15 disabled:opacity-50 ${selectedKey !== null && elementKey(box.node) === selectedKey ? "bg-primary/20" : ""}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${box.addressable ? "bg-emerald-400" : "bg-amber-400"}`} title={box.addressable ? "Has an id or label — replays reliably" : "Position only — this step will not survive a layout change"} />
              <span className="min-w-0 flex-1 truncate">{box.caption || box.node.ref}</span>
              <span className="shrink-0 text-[9px] text-muted-foreground">{isTextInput(box.node) ? "field" : box.container ? "group" : "tap"}</span></button>)}
            {boxes.length === 0 && <div className="p-4 text-center text-[10px] text-muted-foreground">{starting ? "Waiting for the app…" : "No elements reported on this screen."}</div>}
          </div>}
        {locked && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 text-[10px] font-medium text-muted-foreground">
          {saving ? "Saving…" : starting ? "Starting the app…" : "Waiting for the device…"}</div>}
      </div>
      {selected && <div className="flex items-center gap-2 px-3 pb-2">
        <Input className="min-w-0 flex-1" autoFocus placeholder={`Type into ${selected.label ?? selected.identifier ?? "field"}`}
          value={fillValue} onChange={event => setFillValue(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && fillValue && !locked) { setSelectedKey(null); act({ type: "fill", target: selected, value: fillValue }); } }} />
        <Button variant="outline" size="sm" disabled={locked || !fillValue}
          onClick={() => { setSelectedKey(null); act({ type: "fill", target: selected, value: fillValue }); }}>Type</Button>
        <Button variant="ghost" size="sm" onClick={() => setSelectedKey(null)}>Cancel</Button></div>}
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="text-[10px] text-muted-foreground">Scroll</span>
        {SCROLLS.map(([direction, glyph]) => <Button key={direction} variant="outline" size="xs" disabled={locked}
          aria-label={`Scroll ${direction}`} title={`Scroll ${direction}`} onClick={() => act({ type: "scroll", direction })}>{glyph}</Button>)}
      </div>
      <button type="button" aria-expanded={showSteps} className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/50"
        onClick={() => setShowSteps(value => !value)}>
        <span aria-hidden>{showSteps ? "▾" : "▸"}</span>Steps
        <span className="ml-auto rounded-full bg-muted px-1.5 tabular-nums">{recording.steps.length}</span></button>
      {showSteps && <div className="max-h-28 overflow-auto px-3 pb-2 text-[10px] text-muted-foreground">
        {recording.steps.length === 0 ? <span>The app launch is already recorded. Pick an element above to add the first step.</span>
          : recording.steps.map((step, index) => <div key={index} className="flex items-start gap-1.5 py-0.5" title={step.portable ? step.command : `${step.command} — recorded by position, so it will not survive a layout or device-size change`}>
            <span className="w-4 shrink-0 text-right tabular-nums opacity-60">{index + 1}</span>
            <span className={`shrink-0 ${step.portable ? "opacity-60" : "text-amber-600 dark:text-amber-400"}`} aria-hidden>{step.portable ? "·" : "!"}</span>
            <span className="min-w-0 flex-1 truncate">{step.command}</span></div>)}</div>}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button className="flex-1" size="sm" disabled={locked} onClick={() => void store.stop(projectPath)}>
          {saving ? "Saving…" : "Stop and save"}</Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={() => void store.cancel(projectPath)}>Discard</Button></div>
    </>}
  </div>;

  function choose(node: ManualSnapshotNode) {
    if (locked) return;
    if (isTextInput(node)) { setSelectedKey(elementKey(node)); setFillValue(""); return; }
    setSelectedKey(null);
    act({ type: "tap", target: node });
  }
}

const SCROLLS = [["up", "↑"], ["down", "↓"], ["left", "←"], ["right", "→"]] as const;

/** Reads the live status out loud, and counts the seconds while a device call is in flight. */
function StatusLine({ recording }: { recording: ReturnType<AppFlowRecordingStore["getSnapshot"]> }) {
  const startedAt = recording.pending?.startedAt ?? null;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null) { setElapsed(0); return; }
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const pending = recording.pending;
  if (pending) return <div className="truncate text-[10px] text-muted-foreground">
    {pending.label}{elapsed >= 2 ? ` · ${elapsed}s` : ""}{elapsed >= 15 ? " · still waiting on the device" : "…"}</div>;
  return <div className="truncate text-[10px] text-muted-foreground">{recording.statusMessage ?? statusCopy(recording.status)}</div>;
}

function StatusDot({ status }: { status: string | null }) {
  const tone = status === "error" ? "bg-destructive" : status === "saving" || status === "starting" || status === "acting" ? "animate-pulse bg-amber-400" : "animate-pulse bg-rose-500";
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />;
}

function describe(node: ManualSnapshotNode): string {
  const name = node.label?.trim() || node.value?.trim() || node.identifier?.trim() || node.ref;
  const kind = isTextInput(node) ? "text field — pick it to type into it" : "tap to record a step";
  const weak = node.identifier?.trim() || node.label?.trim() || node.value?.trim()
    ? "" : "\nNo id or label: this step is recorded by position and will not survive a layout change.";
  return `${name}\n${kind}${weak}`;
}

function elementKey(node: ManualSnapshotNode): string { return node.identifier?.trim() || node.label?.trim() || node.value?.trim() || node.ref; }
function statusCopy(status: string | null): string {
  switch (status) { case "starting": return "Starting the app…"; case "acting": return "Sending the command…"; case "saving": return "Saving and verifying the replay…";
    case "error": return "Recording failed"; default: return "Pick an element to record a step"; }
}
