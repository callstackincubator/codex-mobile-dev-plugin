import { ArrowUpCircleIcon, CheckCircleIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { PluginUpdateController } from "../plugin-updates.ts";
import { Button } from "./ui/button";

export function PluginUpdateBanner({ controller }: { controller: PluginUpdateController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const update = state.update;
  if (update === undefined || update.status !== "available" && update.status !== "updated" || update.latestVersion === state.dismissedVersion) return null;
  const installed = update.status === "updated";
  return <aside className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-accent/50 px-3 py-2 text-sm" aria-label="Mobile Dev update" aria-busy={state.busy}>
    <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
      {state.busy ? <LoaderCircleIcon className="size-4 shrink-0 animate-spin" aria-hidden /> : installed ? <CheckCircleIcon className="size-4 shrink-0" aria-hidden /> : <ArrowUpCircleIcon className="size-4 shrink-0" aria-hidden />}
      <div className="min-w-0" role="status">
        <p>{installed ? `Mobile Dev ${update.latestVersion} installed.` : state.busy ? "Updating Mobile Dev…" : `Mobile Dev ${update.latestVersion} is available.`}</p>
        {installed && <p className="text-muted-foreground">Quit and reopen Codex to use the new version.</p>}
        {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {installed === false && <Button size="sm" disabled={state.busy} onClick={() => { void controller.install(); }}>{state.busy ? "Updating…" : state.error ? "Retry update" : "Update"}</Button>}
      <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => { void controller.openReleaseNotes(); }}>Release notes</Button>
      <Button size="icon-sm" variant="ghost" disabled={state.busy} aria-label="Dismiss update notice" onClick={() => controller.dismiss()}><XIcon /></Button>
    </div>
  </aside>;
}
