import type { App } from "@modelcontextprotocol/ext-apps";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Button } from "@mobile-dev/ui/components/ui/button.tsx";
import { captureUiError, countUiEvent } from "@mobile-dev/ui/telemetry.ts";

// Shown only when the host advertises the other display mode, so hosts that own
// their own fullscreen chrome or offer a single mode get no extra control.
export function DisplayModeButton({ app }: { app: App }) {
  const subscribe = useCallback((onChange: () => void) => {
    app.addEventListener("hostcontextchanged", onChange);
    return () => app.removeEventListener("hostcontextchanged", onChange);
  }, [app]);
  const mode = useSyncExternalStore(subscribe, () => {
    const host = app.getHostContext();
    const next = host?.displayMode === "fullscreen" ? "inline" : "fullscreen";
    return host?.availableDisplayModes?.includes(next) ? next : undefined;
  });
  const [busy, setBusy] = useState(false);
  if (!mode) return null;
  return <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      await app.requestDisplayMode({ mode });
      countUiEvent("ui.workspace.display_mode_changed");
    } catch (error) {
      captureUiError(error, "workspace.display_mode");
    } finally { setBusy(false); }
  }}>{mode === "fullscreen" ? "Expand" : "Back to chat"}</Button>;
}
