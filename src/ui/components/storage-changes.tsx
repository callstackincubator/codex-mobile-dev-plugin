import { ArrowRightLeftIcon, MinusIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { storeKindLabels } from "../../shared/app-storage.ts";
import type { StorageEntry } from "../../shared/app-storage.ts";
import { changesPollMs, shownChanges } from "../storage-panel.ts";
import type { StorageChangeEvent, StoragePanel } from "../storage-panel.ts";
import { bytesAsText, changedFields, clockTime, parseJson } from "../storage-labels.ts";
import { KindIcon, StorageEmpty } from "./storage-parts";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

const changeLook = {
  added: { label: "Added", icon: PlusIcon, tone: "text-emerald-600 dark:text-emerald-400" },
  changed: { label: "Changed", icon: ArrowRightLeftIcon, tone: "text-amber-600 dark:text-amber-400" },
  removed: { label: "Removed", icon: MinusIcon, tone: "text-rose-600 dark:text-rose-400" },
};
function Old({ children }: { children: ReactNode }) { return <span className="truncate rounded bg-rose-500/10 px-1 text-rose-700 line-through decoration-rose-400/70 dark:text-rose-300">{children}</span>; }
function New({ children }: { children: ReactNode }) { return <span className="truncate rounded bg-emerald-500/12 px-1 text-emerald-800 dark:text-emerald-300">{children}</span>; }
const shown = (entry: StorageEntry) => entry.type === "data" ? bytesAsText(entry) ?? `${entry.bytes} bytes` : entry.value;

function ChangeDiff({ event }: { event: StorageChangeEvent }) {
  const { before, after } = event;
  if (event.change === "added" && after) return <New>{shown(after)}</New>;
  if (event.change === "removed" && before) return <Old>{shown(before)}</Old>;
  if (!before || !after) return null;
  const fields = changedFields(parseJson(before), parseJson(after));
  const arrow = <span className="shrink-0 text-muted-foreground/60">→</span>;
  if (fields) return <span className="flex min-w-0 items-center gap-1.5">{fields.map(field => <span key={field.path} className="flex min-w-0 items-center gap-1.5">
    <span className="text-muted-foreground">{field.path}</span>{field.before !== undefined && <Old>{field.before}</Old>}{arrow}{field.after !== undefined ? <New>{field.after}</New> : <span className="text-muted-foreground">removed</span>}
  </span>)}</span>;
  return <span className="flex min-w-0 items-center gap-1.5"><Old>{shown(before)}</Old>{arrow}<New>{shown(after)}</New></span>;
}

const changeMatches = (event: StorageChangeEvent, query: string) => event.key.toLowerCase().includes(query) || event.store.name.toLowerCase().includes(query)
  || [event.before, event.after].some(entry => entry && shown(entry).toLowerCase().includes(query));

export function ChangesView({ panel, query }: { panel: StoragePanel; query: string }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const changes = shownChanges(state);
  const hiddenSdk = state.showSdkChanges ? 0 : state.changes.length - changes.length;
  const visible = query ? changes.filter(event => changeMatches(event, query)) : changes;
  return <div className="flex min-h-0 flex-1 flex-col">
    {changes.length === 0 ? <StorageEmpty title="No changes yet" description={`Use the app. Storage is read every ${changesPollMs / 1000} seconds while this tab is open, and every key it adds, changes, or removes appears here.`} />
      : <div className="min-h-0 flex-1 overflow-auto text-xs" role="table" aria-label="Storage changes">
        {visible.map(event => {
          const look = changeLook[event.change];
          return <div key={event.id} role="row" className="grid grid-cols-[16px_8ch_minmax(8rem,18rem)_minmax(0,1fr)] items-center gap-x-3 border-b px-3 py-2">
            <span role="cell" aria-label={look.label} title={look.label} className={`inline-flex items-center justify-center ${look.tone}`}><look.icon className="size-4" /></span>
            <span role="cell" className="font-mono text-muted-foreground tabular-nums">{clockTime.format(event.at)}</span>
            <span role="cell" className="flex min-w-0 items-center gap-2" title={`${storeKindLabels[event.store.kind]} · ${event.store.name}`}><KindIcon kind={event.store.kind} /><span className={`truncate font-mono font-medium ${event.change === "removed" ? "text-muted-foreground line-through" : ""}`}>{event.key}</span>{event.sdk && <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">SDK</span>}</span>
            <span role="cell" className="flex min-w-0 font-mono"><ChangeDiff event={event} /></span>
          </div>;
        })}
        {visible.length === 0 && <p className="p-4 text-muted-foreground">No changes match.</p>}
      </div>}
    <footer className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
      <span role="status">{changes.length} change{changes.length === 1 ? "" : "s"}{state.watchingSince ? ` since ${clockTime.format(state.watchingSince)}` : ""}</span>
      <label htmlFor="storage-sdk-changes" className="ml-auto flex cursor-pointer items-center gap-2" title="Changes written by analytics, crash reporting, and other SDKs">
        SDK changes{hiddenSdk > 0 && <span className="tabular-nums">({hiddenSdk} hidden)</span>}
        <Switch id="storage-sdk-changes" checked={state.showSdkChanges} onCheckedChange={checked => panel.setShowSdkChanges(checked)} />
      </label>
      <Button variant="ghost" size="xs" disabled={state.changes.length === 0} onClick={() => panel.clearChanges()}>Clear</Button>
    </footer>
  </div>;
}
