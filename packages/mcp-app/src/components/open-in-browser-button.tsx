import type { App } from "@modelcontextprotocol/ext-apps";
import { BROWSER_PANEL_CAPABILITY } from "@mobile-dev/shared/panel-target.ts";
import type { PanelTarget } from "@mobile-dev/shared/panel-target.ts";
import { Button } from "@mobile-dev/ui/components/ui/button.tsx";
import { captureUiError, countUiEvent } from "@mobile-dev/ui/telemetry.ts";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";

export type BrowserPanelOpen = PanelTarget & { tool: "mobile_open_simulator" | "mobile_open_workspace" | "mobile_open_app_intel" };

export function OpenInBrowserButton({ app, target, onError }: { app: App; target: () => BrowserPanelOpen; onError?: (message: string) => void }) {
  const subscribe = useCallback((onChange: () => void) => {
    app.addEventListener("hostcontextchanged", onChange);
    return () => app.removeEventListener("hostcontextchanged", onChange);
  }, [app]);
  const shown = useSyncExternalStore(subscribe, () => {
    const capabilities = app.getHostCapabilities();
    if (!capabilities?.serverTools) return false;
    return capabilities.experimental?.[BROWSER_PANEL_CAPABILITY] === undefined;
  });
  const [busy, setBusy] = useState(false);
  if (!shown) return null;
  return <Button variant="outline" size="sm" disabled={busy} aria-label="Open in browser" onClick={async () => {
    setBusy(true);
    try {
      const result = await app.callServerTool({ name: "mobile_open_browser_panel", arguments: target() });
      if (result.isError) throw new Error(result.content.filter(item => item.type === "text" && "text" in item).map(item => item.text).join("\n") || "Could not open Mobile Dev in a browser.");
      const url = (result.structuredContent as { url?: string } | undefined)?.url;
      if (typeof url !== "string" || url.length === 0) throw new Error("Mobile Dev did not return a browser link.");
      const opened = await app.openLink({ url });
      if (opened.isError) throw new Error("Could not open Mobile Dev in a browser.");
      countUiEvent("ui.workspace.open_in_browser");
    } catch (error) {
      captureUiError(error, "workspace.open_in_browser");
      onError?.(error instanceof Error ? error.message : "Could not open Mobile Dev in a browser.");
    } finally { setBusy(false); }
  }}><ExternalLinkIcon /><span className="@max-[600px]:sr-only">Open in browser</span></Button>;
}
