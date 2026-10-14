import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { ManualSnapshotNode } from "../../shared/app-flow.ts";
import type { AppFlowRecordingStore } from "../app-flow-recording.ts";
import { isTextInput, layoutWireframe, type WireframeBox } from "./manual-wireframe.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

const PANEL_WIDTH = 320;
const WIREFRAME_MAX_HEIGHT = 520;

export function ManualRecorderPanel({ projectPath, title, store }: { projectPath: string; title: string; store: AppFlowRecordingStore }) {
  const recording = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fillValue, setFillValue] = useState("");
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
  const busy = recording.status === "starting" || recording.status === "saving";
  const finished = recording.outcome !== null;
  return <div role="dialog" aria-label={`Recording a path to ${title}`} className="absolute z-30 flex flex-col rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur"
    style={{ left: position.x, top: position.y, width: PANEL_WIDTH + 24 }}>
    <div className="flex cursor-grab items-center justify-between gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="min-w-0"><div className="truncate text-xs font-medium">Recording · {title}</div>
        <div className="truncate text-[10px] text-muted-foreground">{recording.statusMessage ?? statusCopy(recording.status)}</div></div>
      <Button variant="ghost" size="icon-xs" aria-label="Discard recording" onClick={() => void (finished ? store.dismiss() : store.cancel(projectPath))}>×</Button>
    </div>
    {recording.error && <div className="border-b border-border px-3 py-2 text-[10px] text-amber-600 dark:text-amber-400">{recording.error}</div>}
    {finished ? <div className="flex flex-col gap-2 px-3 py-3">
      <div className="text-xs font-medium">{recording.outcome?.replayVerified ? "Saved as a verified replay" : "Saved as a command list"}</div>
      {recording.outcome?.fallbackReason && <div className="text-[10px] text-muted-foreground">{recording.outcome.fallbackReason}</div>}
      <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-[10px] leading-relaxed">{recording.outcome?.pathToReach.join("\n")}</pre>
      <Button variant="outline" size="sm" onClick={() => store.dismiss()}>Done</Button>
    </div> : <>
      <div className="relative m-3 overflow-auto rounded-lg border border-border bg-muted/40" style={{ width: PANEL_WIDTH, maxHeight: WIREFRAME_MAX_HEIGHT }}>
        <div className="relative" style={{ width: PANEL_WIDTH, height }}>
          {boxes.map((box, index) => <button key={`${box.node.ref}:${index}`} type="button" disabled={busy} title={box.caption || box.node.ref}
            onClick={() => { if (isTextInput(box.node)) { setSelectedKey(elementKey(box.node)); setFillValue(""); }
              else { setSelectedKey(null); void store.act(projectPath, { type: "tap", target: box.node }); } }}
            className={`absolute overflow-hidden rounded-sm border px-1 text-left text-[9px] leading-tight hover:bg-primary/20 ${box.addressable ? "border-border/70 text-foreground" : "border-dashed border-amber-500/60 text-muted-foreground"} ${selectedKey !== null && elementKey(box.node) === selectedKey ? "bg-primary/30" : ""}`}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>{box.caption}</button>)}
          {boxes.length === 0 && <div className="p-4 text-center text-[10px] text-muted-foreground">{busy ? "Waiting for the app…" : "No elements reported on this screen."}</div>}
        </div>
      </div>
      {selected && <div className="flex items-center gap-2 px-3 pb-2"><Input className="min-w-0 flex-1" placeholder={`Type into ${selected.label ?? selected.identifier ?? "field"}`}
        value={fillValue} onChange={event => setFillValue(event.target.value)} /><Button variant="outline" size="sm" disabled={busy || !fillValue}
          onClick={() => { setSelectedKey(null); void store.act(projectPath, { type: "fill", target: selected, value: fillValue }); }}>Type</Button></div>}
      <div className="flex items-center gap-1 px-3 pb-2">{(["up", "down", "left", "right"] as const).map(direction => <Button key={direction} variant="outline" size="xs" disabled={busy}
        className="capitalize" onClick={() => void store.act(projectPath, { type: "scroll", direction })}>{direction}</Button>)}</div>
      <div className="max-h-24 overflow-auto border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        {recording.steps.length === 0 ? <span>The app launch is already recorded. Tap an element to add a step.</span>
          : recording.steps.map((step, index) => <div key={index} className="truncate" title={step.command}>{step.portable ? "· " : "! "}{step.command}</div>)}
      </div>
      <div className="border-t border-border px-3 py-2"><Button className="w-full" size="sm" disabled={busy} onClick={() => void store.stop(projectPath)}>
        {recording.status === "saving" ? "Saving…" : "Stop and save"}</Button></div>
    </>}
  </div>;
}

function elementKey(node: ManualSnapshotNode): string { return node.identifier?.trim() || node.label?.trim() || node.value?.trim() || node.ref; }
function statusCopy(status: string | null): string {
  switch (status) { case "starting": return "Starting the simulator…"; case "acting": return "Sending the command…"; case "saving": return "Saving the recording…";
    case "error": return "Recording failed"; default: return "Tap an element to record a step"; }
}
