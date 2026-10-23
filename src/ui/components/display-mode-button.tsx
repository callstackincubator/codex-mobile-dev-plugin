import type { App } from "@modelcontextprotocol/ext-apps";
import { useState } from "react";
import { Button } from "./ui/button";
import { captureUiError, countUiEvent } from "../telemetry.ts";

export function DisplayModeButton({ app }: { app: App }) {
  const host = app.getHostContext();
  const [busy, setBusy] = useState(false);
  const mode = host?.displayMode === "fullscreen" ? "inline" : "fullscreen";
  if (!host?.availableDisplayModes?.includes(mode)) return null;
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
