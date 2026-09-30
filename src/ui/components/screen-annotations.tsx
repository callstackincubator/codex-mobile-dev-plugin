import { useSyncExternalStore } from "react";
import { ArrowUpIcon, MessageCircleIcon, MousePointer2Icon, SendIcon, Trash2Icon } from "lucide-react";
import type { ScreenAnnotationsStore } from "../screen-annotations";
import type { ScreenBounds } from "../../shared/screen-annotations";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function ScreenSelectButton({ store }: { store: ScreenAnnotationsStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <Button variant="ghost" size="icon" className="shrink-0 aria-pressed:bg-blue-500/15 aria-pressed:text-blue-500" data-element="select-mode" title="Select and annotate components" aria-label="Select and annotate components" aria-pressed={state.selecting} disabled={state.disabled || state.busy} onClick={() => void store.toggle()}><MousePointer2Icon /></Button>;
}

export function ScreenAnnotationOverlay({ store }: { store: ScreenAnnotationsStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { viewport: v, draft } = state;
  const capture = draft ?? state.capture;
  const screen = capture?.screen;
  const rect = (bounds: ScreenBounds) => screen ? {
    left: v.x + bounds.x / screen.width * v.width,
    top: v.y + bounds.y / screen.height * v.height,
    width: bounds.width / screen.width * v.width,
    height: bounds.height / screen.height * v.height,
  } : {};
  const highlighted = draft?.component ?? state.hovered;
  const popupWidth = Math.max(0, Math.min(360, v.stageWidth - 16));
  const anchor = draft ? rect(draft.component.bounds) : undefined;
  const left = Math.max(8, Math.min((anchor?.left ?? 0) + (anchor?.width ?? 0) + 12, v.stageWidth - popupWidth - 8));
  const top = Math.max(8, Math.min((anchor?.top ?? 0) + (anchor?.height ?? 0) - 22, v.stageHeight - 52));
  return <div className="pointer-events-none absolute inset-0 z-20" data-element="annotations">
    {draft && (!state.selecting || draft.screenshot.id !== state.capture?.screenshot.id) && <img src={`data:image/png;base64,${draft.screenshot.data}`} alt="Captured simulator screen" className="absolute" style={{ left: v.x, top: v.y, width: v.width, height: v.height }} />}
    {highlighted && <div data-element="component-highlight" data-component-source={highlighted.source ?? "accessibility"} className="absolute border border-dashed border-blue-500 bg-blue-500/10" style={rect(highlighted.bounds)}><span className="absolute bottom-full left-0 max-w-64 truncate rounded-t bg-blue-500 px-1.5 py-0.5 text-[10px] text-white">{highlighted.name}</span></div>}
    {state.annotations.filter(item => item.screenshot.id === capture?.screenshot.id).map(annotation => {
      const b = rect(annotation.component.bounds);
      return <button key={annotation.id} type="button" className="annotation-marker pointer-events-auto absolute flex size-6 items-center justify-center rounded-full border-2 border-white bg-blue-500 text-[11px] font-semibold text-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500" style={{ left: Math.max(v.x, Math.min((b.left ?? 0) + (b.width ?? 0) - 12, v.x + v.width - 24)), top: Math.max(v.y, Math.min((b.top ?? 0) + (b.height ?? 0) - 12, v.y + v.height - 24)) }} title={`#${annotation.number} ${annotation.component.name}: ${annotation.text}`} aria-label={`Edit annotation ${annotation.number}: ${annotation.component.name}`} disabled={state.busy} onClick={() => store.edit(annotation)}>{annotation.number}</button>;
    })}
    {state.selecting && !draft && <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-lg border bg-popover/95 px-2.5 py-1.5 text-xs shadow-sm"><MousePointer2Icon className="size-3.5 shrink-0 text-blue-500" /><span>{state.loading ? "Reading components..." : "Select a component to add a note. Screen paused."}</span></div>}
    {draft && <form key={draft.id} aria-label={`Annotation ${draft.number} for ${draft.component.name}`} className="pointer-events-auto absolute flex h-11 items-center rounded-full border border-border/50 bg-muted p-1.5 text-foreground shadow-lg focus-within:ring-1 focus-within:ring-blue-500/50" style={{ left, top, width: popupWidth }} onSubmit={event => { event.preventDefault(); void store.save(); }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); store.closeDraft(); }
      if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void store.save(); }
    }}>
      <input autoFocus type="text" aria-label="Annotation note" placeholder="Add a note..." className="h-8 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50" value={draft.text} maxLength={8000} disabled={state.busy} onChange={event => store.setText(event.target.value)} />
      <Button type="submit" size="icon" className="rounded-full bg-foreground text-background hover:bg-foreground/85" title="Attach note to chat" aria-label="Save annotation" disabled={!draft.text.trim() || state.busy}><ArrowUpIcon /></Button>
    </form>}
    {!!state.annotations.length && !draft && <div className="pointer-events-auto absolute bottom-2 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-full border bg-popover/95 p-1 shadow-sm">
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="rounded-full"><MessageCircleIcon className="text-blue-500" />{state.annotations.length} {state.annotations.length === 1 ? "note" : "notes"}</Button></PopoverTrigger><PopoverContent className="max-h-64 w-64 overflow-y-auto p-1" side="top">{state.annotations.map(annotation => <div key={annotation.id} className="flex items-center"><button type="button" className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-muted" disabled={state.busy} onClick={() => store.edit(annotation)}><p className="truncate text-xs font-medium">#{annotation.number} {annotation.component.name}</p><p className="truncate text-xs text-muted-foreground">{annotation.text}</p></button><Button variant="ghost" size="icon-xs" aria-label={`Remove annotation ${annotation.number}`} disabled={state.busy} onClick={() => void store.remove(annotation.id)}><Trash2Icon /></Button></div>)}</PopoverContent></Popover>
      {state.canSend && <Button size="sm" className="rounded-full" disabled={state.busy || state.disabled} onClick={() => void store.send()}><SendIcon />Send to chat</Button>}
    </div>}
    {(state.error || state.status) && <p className={`pointer-events-auto absolute bottom-12 left-2 right-2 rounded-lg border bg-popover/95 p-2 text-xs shadow-sm ${state.error ? "text-destructive" : "text-muted-foreground"}`} role={state.error ? "alert" : "status"}>{state.error || state.status}</p>}
  </div>;
}
