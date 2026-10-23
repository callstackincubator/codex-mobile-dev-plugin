import { useState, useSyncExternalStore } from "react";
import type { PanelContext } from "../model-context.ts";
import { Button } from "./ui/button";
import { captureUiError } from "../telemetry.ts";

export function ContextAttachments({ context }: { context: PanelContext }) {
  const count = useSyncExternalStore(context.subscribe, () => context.attachmentCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (context.usesHostAttachments || !count) return null;
  return <div className="flex items-center gap-2">
    <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
      setBusy(true); setError(false);
      try { await context.clearAttachments(); }
      catch (error) { setError(true); captureUiError(error, "context.clear"); }
      finally { setBusy(false); }
    }}>Clear attachments ({count})</Button>
    {error && <span role="alert">Could not clear attachments. Try again.</span>}
  </div>;
}
