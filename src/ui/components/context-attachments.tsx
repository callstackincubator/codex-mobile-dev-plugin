import { useState, useSyncExternalStore } from "react";
import type { PanelContext } from "../model-context.ts";
import { Button } from "./ui/button";
import { captureUiError } from "../telemetry.ts";

export function ContextAttachments({ context }: { context: PanelContext }) {
  const count = useSyncExternalStore(context.subscribe, () => context.attachmentCount);
  const notes = useSyncExternalStore(context.subscribe, () => context.screenAnnotations);
  const [busy, setBusy] = useState<"add" | "clear" | "remove">();
  const [error, setError] = useState("");
  const [addedNotes, setAddedNotes] = useState<typeof notes>();
  if (context.usesHostAttachments || !count) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1" aria-label="Chat attachments">
    {!!notes.length && <details className="min-w-0 max-w-full text-sm">
      <summary className="cursor-pointer">{notes.length} {notes.length === 1 ? "note" : "notes"}</summary>
      <ul className="max-h-48 space-y-2 overflow-y-auto py-2">
        {notes.map(note => <li key={note.id} className="break-words">
          <span className="font-medium">{note.simulator.name} · #{note.number} {note.component.label ?? note.component.name}</span>
          <p className="whitespace-pre-wrap">{note.text}</p>
          <Button variant="ghost" size="sm" disabled={!!busy} aria-label={`Remove note ${note.number} on ${note.simulator.name}`} onClick={async () => {
            setBusy("remove"); setError("");
            try { await context.removeAnnotation(note.id); }
            catch { setError("Could not remove this note. Try again."); captureUiError(new Error("Could not remove annotation context."), "context.remove"); }
            finally { setBusy(undefined); }
          }}>Remove</Button>
        </li>)}
      </ul>
    </details>}
    {!!notes.length && context.canSendMessage && <Button size="sm" disabled={!!busy} onClick={async () => {
      setBusy("add"); setError(""); setAddedNotes(undefined);
      try { await context.sendAnnotationsToChat(); setAddedNotes(notes); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not add notes to chat."); }
      finally { setBusy(undefined); }
    }}>{busy === "add" ? "Adding…" : "Add notes to chat"}</Button>}
    <Button variant="outline" size="sm" disabled={!!busy} onClick={async () => {
      setBusy("clear"); setError("");
      try { await context.clearAttachments(); setAddedNotes(undefined); }
      catch (error) { setError("Could not clear attachments. Try again."); captureUiError(error, "context.clear"); }
      finally { setBusy(undefined); }
    }}>Clear attachments ({count})</Button>
    {addedNotes === notes && <span role="status" className="text-sm text-muted-foreground">Added to chat input. Review and send there before clearing these notes.</span>}
    {error && <span role="alert" className="text-sm">{error}</span>}
  </div>;
}
