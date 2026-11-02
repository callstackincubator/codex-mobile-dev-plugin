import { ArrowUpCircleIcon, CheckCircleIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { PluginUpdateController } from "./plugin-updates.ts";
import { Button } from "@mobile-dev/ui/components/ui/button.tsx";

export function PluginUpdateBanner({ controller }: { controller: PluginUpdateController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const update = state.update;
  if (update === undefined || update.status !== "available" && update.status !== "migration" && update.status !== "migrated" || update.latestVersion === state.dismissedVersion) return null;
  const migrated = update.status === "migrated";
  const migration = update.status === "migration";
  const finishMigration = migration && (update.storeInstalled === true || state.storeOpened === true);
  return <aside className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-accent/50 px-3 py-2 text-sm" aria-label="Mobile Dev update" aria-busy={state.busy}>
    <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
      {state.busy ? <LoaderCircleIcon className="size-4 shrink-0 animate-spin" aria-hidden /> : migrated ? <CheckCircleIcon className="size-4 shrink-0" aria-hidden /> : <ArrowUpCircleIcon className="size-4 shrink-0" aria-hidden />}
      <div className="min-w-0" role="status">
        <p>{migrated ? "Mobile Dev now uses the plugin store." : migration ? "Move Mobile Dev to the plugin store." : `Mobile Dev ${update.latestVersion} is available in the plugin store.`}</p>
        {migration && <p className="text-muted-foreground">{finishMigration ? "After installing the store version, finish migration to remove the GitHub installation." : "Install the store version first. Your recordings and saved data stay on this computer."}</p>}
        {migrated && <p className="text-muted-foreground">Quit and reopen Codex to use the store version.</p>}
        {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {finishMigration && <Button size="sm" disabled={state.busy} onClick={() => { void controller.migrate(); }}>{state.busy ? "Finishing…" : "Finish migration"}</Button>}
      {migrated === false && <Button size="sm" variant={finishMigration ? "ghost" : "default"} disabled={state.busy} onClick={() => { void controller.openStore(); }}>{migration && finishMigration === false ? "Install from plugin store" : "Open plugin store"}</Button>}
      <Button size="icon-sm" variant="ghost" disabled={state.busy} aria-label="Dismiss update notice" onClick={() => controller.dismiss()}><XIcon /></Button>
    </div>
  </aside>;
}
