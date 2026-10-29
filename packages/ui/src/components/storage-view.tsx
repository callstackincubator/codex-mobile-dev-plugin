import { PlayIcon, RefreshCwIcon, RotateCcwIcon, SearchIcon } from "lucide-react";
import { memo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { isWorking, shownChanges } from "../storage-panel.ts";
import type { StoragePanel, StorageState, StorageTab } from "../storage-panel.ts";
import { appIcons } from "../app-icons.ts";
import { clockTime } from "../storage-labels.ts";
import { AppAvatar } from "./app-avatar";
import { BrowseView } from "./storage-browse";
import { ChangesView } from "./storage-changes";
import { ConfirmButton, StorageEmpty } from "./storage-parts";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";
import { Tabs, TabsList, TabsTrigger } from "./ui/base-tabs";

// Installed apps with their icons: one line in the trigger, name over bundle ID in the list.
// Android lists apps by package name; their labels arrive with the icons.
function AppPicker({ panel, state }: { panel: StoragePanel; state: StorageState }) {
  useSyncExternalStore(appIcons.subscribe, appIcons.getSnapshot);
  const apps = state.apps.map(app => ({ ...app, ...appIcons.get(state.platform, state.deviceId, app.bundleId) }));
  return <Select items={apps.map(app => ({ value: app.bundleId, label: app.name }))} value={state.bundleId || null} disabled={!state.available || state.unsupported !== ""} onValueChange={value => { if (value) panel.selectApp(value); }}>
    <SelectTrigger id="storage-app" size="sm" aria-label="App" className="w-64 min-w-28 shrink">
      <SelectValue>{(value: string | null) => {
        const app = apps.find(item => item.bundleId === value);
        if (!app) return value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">{state.busy === "apps" ? "Loading apps…" : "Choose an app"}</span>;
        return <><AppAvatar name={app.name} icon={app.icon} size="xs" /><span className="max-w-40 shrink-0 truncate">{app.name}</span>{app.name !== app.bundleId && <span className="min-w-0 truncate text-xs text-muted-foreground">{app.bundleId}</span>}</>;
      }}</SelectValue>
    </SelectTrigger>
    <SelectContent align="start" alignItemWithTrigger={false} className="w-auto max-w-[min(30rem,calc(100vw-16px))] min-w-(--anchor-width)"><SelectGroup>
      {apps.map(app => <SelectItem key={app.bundleId} value={app.bundleId} className="py-1.5">
        <AppAvatar name={app.name} icon={app.icon} size="sm" className="mt-0.5 self-start" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate leading-5">{app.name}</span>
          {app.name !== app.bundleId && <span className="truncate text-xs leading-4 text-muted-foreground">{app.bundleId}</span>}
        </span>
      </SelectItem>)}
    </SelectGroup></SelectContent>
  </Select>;
}

export const StorageView = memo(function StorageView({ panel }: { panel: StoragePanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");
  const snapshot = state.snapshot;
  const busy = isWorking(state);
  const search = query.trim().toLowerCase();
  const changeCount = shownChanges(state).length;
  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => setCopied("Copied"), () => setCopied("Could not copy")); };

  let body: ReactNode;
  if (state.unsupported || !state.available) body = <StorageEmpty title="App storage unavailable" description={state.available ? state.unsupported : "This host cannot call the plugin's tools."} />;
  else if (!state.bundleId) body = <StorageEmpty title="Choose an app" description={state.busy === "apps" ? "Loading installed apps…" : "Pick an installed app to see what it has saved."} />;
  else if (!snapshot) body = state.error ? null : <StorageEmpty title="Reading app data…" description="MMKV, AsyncStorage, UserDefaults, SharedPreferences, databases, and files." />;
  else if (state.tab === "changes") body = <ChangesView panel={panel} query={search} />;
  else body = <BrowseView key={`${snapshot.platform}:${snapshot.bundleId}`} panel={panel} snapshot={snapshot} query={search} copy={copy} />;

  return <section id="storage-drawer" className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-label="Storage">
    <header className="panel-toolbar flex h-[49px] shrink-0 items-center gap-2 border-b px-2">
      <AppPicker panel={panel} state={state} />
      <Tabs value={state.tab} onValueChange={value => panel.setTab(value as StorageTab)} className="shrink-0">
        <TabsList size="sm" aria-label="Storage view">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="changes">Changes{changeCount > 0 && <span className="font-normal text-muted-foreground tabular-nums">{changeCount}</span>}</TabsTrigger>
        </TabsList>
      </Tabs>
      <InputGroup size="sm" className="min-w-16 flex-1"><InputGroupInput aria-label={state.tab === "browse" ? "Filter keys and values" : "Filter changes"} type="search" placeholder={state.tab === "browse" ? "Filter keys and values…" : "Filter changes…"} maxLength={256} autoComplete="off" spellCheck={false} value={query} onChange={event => setQuery(event.target.value)} /><InputGroupAddon><SearchIcon /></InputGroupAddon></InputGroup>
      <ButtonGroup className="shrink-0">
        <Button variant="outline" size="icon-sm" aria-label="Refresh" title={snapshot ? `Read again · last read ${clockTime.format(snapshot.readAt)}` : "Read again"} disabled={busy || !state.available || state.unsupported !== ""} onClick={() => void panel.reload()}>
          <RefreshCwIcon className={state.busy === "read" ? "animate-spin" : undefined} />
        </Button>
        <ConfirmButton variant="outline" size="sm" title="Reset app data" action="Reset app data" disabled={!state.bundleId || busy || state.unsupported !== ""}
          description={state.platform === "android" ? "Stops the app and clears all its data with pm clear, like Settings › Clear storage. The app stays installed." : "Stops the app and deletes everything in its data container, including UserDefaults. The app stays installed."}
          onConfirm={() => void panel.clear()}><RotateCcwIcon />Reset</ConfirmButton>
      </ButtonGroup>
    </header>
    <span className="sr-only" role="status">{copied}</span>
    {state.error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="text-xs">{state.error}</AlertDescription></Alert>}
    {state.status && <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs" role="status">
      <span className="min-w-0 flex-1 truncate">{state.status}</span>
      <Button variant="outline" size="xs" disabled={busy} onClick={() => void panel.launch()}><PlayIcon />Launch app</Button>
    </div>}
    {body}
  </section>;
});
