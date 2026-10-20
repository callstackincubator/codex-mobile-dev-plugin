import { CopyIcon, DatabaseIcon, FolderIcon, LockIcon, PlayIcon, RefreshCwIcon, RotateCcwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { storeKindLabels, storeKinds } from "../../shared/app-storage.ts";
import type { StorageEntry, StorageStore } from "../../shared/app-storage.ts";
import type { StoragePanel } from "../storage-panel.ts";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { Toggle } from "./ui/toggle";
import { useMediaQuery } from "./use-media-query";

const FILES = "files";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatAge(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

export function displayValue(entry: StorageEntry) {
  if (entry.type === "data") return entry.value.replace(/(..)(?!$)/g, "$1 ");
  if ((entry.type === "json" || entry.type === "array" || entry.type === "object") && !entry.truncated) {
    try { return JSON.stringify(JSON.parse(entry.value), null, 2); } catch { return entry.value; }
  }
  return entry.value;
}

const typeLabel = (entry: StorageEntry) => `${entry.type === "data" ? "bytes" : entry.type}${entry.guessed ? "?" : ""}`;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") setNow(Date.now()); }, 5000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export const StorageView = memo(function StorageView({ panel }: { panel: StoragePanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const wide = useMediaQuery("(min-width: 600px)");
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [copied, setCopied] = useState("");
  const now = useNow(state.open && state.snapshot !== undefined);
  const snapshot = state.snapshot;
  const busy = state.busy !== null && state.busy !== "apps";
  const search = query.trim().toLowerCase();

  const matches = useMemo(() => {
    const result = new Map<string, StorageEntry[]>();
    for (const store of snapshot?.stores ?? []) {
      const changes = state.changes.get(store.id);
      result.set(store.id, store.entries.filter(entry => (!changedOnly || changes?.has(entry.key))
        && (!search || entry.key.toLowerCase().includes(search) || entry.value.toLowerCase().includes(search))));
    }
    return result;
  }, [snapshot, state.changes, search, changedOnly]);

  const filtering = search !== "" || changedOnly;
  const visibleStores = (snapshot?.stores ?? []).filter(store => !filtering || (matches.get(store.id)?.length ?? 0) > 0);
  const store = snapshot?.stores.find(item => item.id === selectedStore);
  const activeStore = selectedStore === FILES ? undefined : store ?? visibleStores[0];
  const showFiles = selectedStore === FILES || (activeStore === undefined && snapshot !== undefined);
  const entries = activeStore ? matches.get(activeStore.id) ?? [] : [];
  const entry = entries.find(item => item.key === selectedKey);
  const changes = activeStore ? state.changes.get(activeStore.id) : undefined;
  const changedCount = [...state.changes.values()].reduce((total, marks) => total + marks.size, 0);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied("Copied"); }
    catch { setCopied("Could not copy"); }
  };

  const tree = <nav aria-label="Stores" className="h-full min-h-0 overflow-auto py-1 text-xs">
    {storeKinds.map(kind => {
      const stores = visibleStores.filter(item => item.kind === kind);
      if (stores.length === 0) return null;
      return <div key={kind} className="mb-1">
        <div className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{storeKindLabels[kind]}</div>
        {stores.map(item => <StoreButton key={item.id} store={item} count={filtering ? matches.get(item.id)?.length ?? 0 : item.entryCount}
          changed={(state.changes.get(item.id)?.size ?? 0) > 0} selected={activeStore?.id === item.id && !showFiles}
          onSelect={() => { setSelectedStore(item.id); setSelectedKey(undefined); }} />)}
      </div>;
    })}
    {snapshot && <button type="button" data-selected={showFiles} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted data-[selected=true]:bg-muted" onClick={() => { setSelectedStore(FILES); setSelectedKey(undefined); }}>
      <FolderIcon className="size-3.5 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">Files</span><span className="text-muted-foreground tabular-nums">{formatBytes(snapshot.totalBytes)}</span>
    </button>}
  </nav>;

  const detail = entry && activeStore && <div className="flex max-h-[45%] min-h-24 shrink-0 flex-col border-t" aria-label="Value">
    <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate font-mono text-foreground" title={entry.key}>{entry.key}</span>
      <span>{typeLabel(entry)} · {formatBytes(entry.bytes)}</span>
      <Button variant="ghost" size="icon-xs" aria-label="Copy value" title="Copy value" onClick={() => void copy(entry.value)}><CopyIcon /></Button>
    </div>
    <pre className="min-h-0 flex-1 overflow-auto px-2 pb-2 font-mono text-xs break-all whitespace-pre-wrap">{displayValue(entry)}</pre>
    <div className="border-t px-2 py-1 text-[10px] text-muted-foreground">
      {entry.guessed && "Type guessed from the stored bytes; MMKV does not record types. "}
      {entry.truncated && "Value cut short; copy the full value with the mobile_app_storage tool. "}
      <span className="font-mono">{activeStore.path}</span>
    </div>
  </div>;

  const storeView = activeStore && <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
      <span className="min-w-0 flex-1 truncate"><span className="text-muted-foreground">{storeKindLabels[activeStore.kind]} › </span>{activeStore.name}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{activeStore.entryCount} {activeStore.kind === "sqlite" ? "table" : "key"}{activeStore.entryCount === 1 ? "" : "s"} · {formatBytes(activeStore.bytes)}</span>
      <ConfirmButton label="Clear" title={`Clear ${activeStore.name}`} disabled={busy} description={`Stops the app and deletes ${activeStore.name}. The app is not relaunched.`} onConfirm={() => void panel.clear(activeStore.id)} />
    </div>
    {activeStore.note && <p className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1 text-[11px] text-muted-foreground">{activeStore.status !== "ok" && (activeStore.status === "encrypted" ? <LockIcon className="size-3" /> : <TriangleAlertIcon className="size-3" />)}{activeStore.note}</p>}
    <div role="table" aria-label={`${activeStore.name} entries`} className="min-h-0 flex-1 overflow-auto font-mono text-xs">
      {entries.map(item => {
        const change = changes?.get(item.key);
        return <button key={item.key} type="button" role="row" data-selected={item.key === selectedKey} onClick={() => setSelectedKey(item.key === selectedKey ? undefined : item.key)}
          className="grid w-full grid-cols-[minmax(6rem,2fr)_5rem_minmax(0,3fr)] items-center gap-2 border-b px-2 py-1 text-left hover:bg-muted data-[selected=true]:bg-muted">
          <span role="cell" className="truncate" title={item.key}>{change && <span className="mr-1 inline-block size-1.5 rounded-full bg-blue-500 align-middle" aria-label={change} title={change === "new" ? "New since first read" : "Changed since first read"} />}{item.key}</span>
          <span role="cell" className="truncate font-sans text-[11px] text-muted-foreground">{typeLabel(item)}</span>
          <span role="cell" className="truncate">{item.type === "data" ? `${item.value.slice(0, 48).replace(/(..)(?!$)/g, "$1 ")}${item.value.length > 48 ? " …" : ""}` : item.value}</span>
        </button>;
      })}
      {entries.length === 0 && activeStore.status === "ok" && <p className="p-3 font-sans text-muted-foreground">{filtering ? "No matching keys." : "Empty."}</p>}
      {activeStore.entries.length < activeStore.entryCount && !filtering && <p className="p-2 font-sans text-[11px] text-muted-foreground">Showing the first {activeStore.entries.length} of {activeStore.entryCount}.</p>}
    </div>
    {detail}
  </div>;

  const filesView = snapshot && <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs">
      <span className="min-w-0 flex-1 truncate">Files</span>
      <span className="text-muted-foreground tabular-nums">{snapshot.fileCount} files · {formatBytes(snapshot.totalBytes)}</span>
    </div>
    <div role="table" aria-label="Largest files" className="min-h-0 flex-1 overflow-auto font-mono text-xs">
      {snapshot.files.filter(file => !search || file.path.toLowerCase().includes(search)).map(file => {
        const owner = file.store ? snapshot.stores.find(item => item.id === file.store) : undefined;
        return <div key={file.path} role="row" className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-2 border-b px-2 py-1">
          <span role="cell" className="truncate" title={file.path}>{file.path}</span>
          <span role="cell">{owner && <Badge variant="outline" className="h-4 px-1.5 font-sans text-[10px]">{storeKindLabels[owner.kind]}</Badge>}</span>
          <span role="cell" className="text-right text-muted-foreground tabular-nums">{formatBytes(file.bytes)}</span>
        </div>;
      })}
      {snapshot.files.length < snapshot.fileCount && <p className="p-2 font-sans text-[11px] text-muted-foreground">Showing the {snapshot.files.length} largest files.</p>}
    </div>
  </div>;

  let body;
  if (state.unsupported || !state.available) {
    body = <StorageEmpty title="App storage unavailable" description={state.available ? state.unsupported : "This host cannot call the plugin's tools."} />;
  } else if (!state.bundleId) {
    body = <StorageEmpty title="Choose an app" description={state.busy === "apps" ? "Loading installed apps…" : "Pick an installed app to see what it has saved."} />;
  } else if (!snapshot) {
    body = state.error ? null : <StorageEmpty title="Reading app data…" description="MMKV, AsyncStorage, UserDefaults, SharedPreferences, databases, and files." />;
  } else if (snapshot.stores.length === 0 && !showFiles) {
    body = <StorageEmpty title="No saved data found" description="This app has no recognized storage yet. Check Files for anything else it wrote." />;
  } else {
    body = <ResizablePanelGroup id="storage-panels" orientation={wide ? "horizontal" : "vertical"} className="min-h-0 flex-1">
      <ResizablePanel id="storage-tree" defaultSize={wide ? "30%" : "35%"} minSize="15%">{tree}</ResizablePanel>
      <ResizableHandle aria-label="Resize stores and entries" />
      <ResizablePanel id="storage-entries" minSize="30%">{showFiles ? filesView : storeView}</ResizablePanel>
    </ResizablePanelGroup>;
  }

  return <section id="storage-drawer" className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-label="Storage">
    <header className="flex h-[49px] shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
      <DatabaseIcon className="size-4 shrink-0 text-blue-500" />
      <NativeSelect id="storage-app" aria-label="App" className="w-44 min-w-24 shrink" size="sm" value={state.bundleId} disabled={!state.available || state.unsupported !== ""} onChange={event => panel.selectApp(event.target.value)}>
        <NativeSelectOption value="">{state.busy === "apps" ? "Loading apps…" : "Choose an app"}</NativeSelectOption>
        {state.apps.map(app => <NativeSelectOption key={app.bundleId} value={app.bundleId}>{app.name === app.bundleId ? app.bundleId : `${app.name} · ${app.bundleId}`}</NativeSelectOption>)}
      </NativeSelect>
      <InputGroup className="h-7 min-w-16 flex-1"><InputGroupInput className="text-xs" aria-label="Filter keys and values" type="search" placeholder="Filter keys and values…" maxLength={256} autoComplete="off" spellCheck={false} value={query} onChange={event => setQuery(event.target.value)} /><InputGroupAddon className="pl-2"><SearchIcon className="size-3.5" /></InputGroupAddon></InputGroup>
      <Toggle size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" pressed={changedOnly} onPressedChange={setChangedOnly} title="Only keys added or changed since the first read" disabled={!snapshot}>Changed{changedCount > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{changedCount}</Badge>}</Toggle>
      {snapshot && <span className="shrink-0 px-1 text-[11px] text-muted-foreground tabular-nums" role="status">{state.busy === "read" ? "Reading…" : formatAge(now - snapshot.readAt)}</span>}
      <Button variant="ghost" size="icon-sm" aria-label="Refresh" title="Read again" disabled={!state.bundleId || busy} onClick={() => void panel.refresh()}><RefreshCwIcon className={state.busy === "read" ? "animate-spin" : undefined} /></Button>
      <ConfirmButton label="Reset" title="Reset app data" disabled={!state.bundleId || busy || state.unsupported !== ""}
        description={state.platform === "android" ? "Stops the app and clears all its data with pm clear, like Settings › Clear storage. The app stays installed." : "Stops the app and deletes everything in its data container, including UserDefaults. The app stays installed."}
        onConfirm={() => void panel.clear()} />
    </header>
    <span className="sr-only" role="status">{copied}</span>
    {state.error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="text-xs">{state.error}</AlertDescription></Alert>}
    {state.status && <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1 text-xs" role="status">
      <span className="min-w-0 flex-1 truncate">{state.status}</span>
      <Button variant="outline" size="xs" disabled={busy} onClick={() => void panel.launch()}><PlayIcon />Launch app</Button>
    </div>}
    {body}
  </section>;
});

function StoreButton({ store, count, changed, selected, onSelect }: { store: StorageStore; count: number; changed: boolean; selected: boolean; onSelect: () => void }) {
  return <button type="button" data-selected={selected} onClick={onSelect} title={store.path}
    className="flex w-full items-center gap-1.5 py-1 pr-2 pl-4 text-left hover:bg-muted data-[selected=true]:bg-muted">
    {store.status === "encrypted" ? <LockIcon className="size-3 shrink-0 text-muted-foreground" aria-label="Encrypted" />
      : store.status === "unreadable" ? <TriangleAlertIcon className="size-3 shrink-0 text-amber-500" aria-label="Unreadable" /> : null}
    <span className="min-w-0 flex-1 truncate">{store.name}</span>
    {changed && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" aria-label="Changed" />}
    <span className="shrink-0 text-muted-foreground tabular-nums">{store.status === "ok" ? count : "—"}</span>
  </button>;
}

function ConfirmButton({ label, title, description, disabled, onConfirm }: { label: string; title: string; description: string; disabled?: boolean; onConfirm: () => void }) {
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="xs" className="shrink-0" aria-label={title} title={title} disabled={disabled}>{label === "Reset" && <RotateCcwIcon />}{label}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(300px,calc(100vw-24px))] p-3 text-xs">
      <p className="mb-1 font-medium">{title}?</p>
      <p className="mb-3 text-muted-foreground">{description}</p>
      <div className="flex justify-end gap-2">
        <PopoverClose asChild><Button variant="ghost" size="xs">Cancel</Button></PopoverClose>
        <PopoverClose asChild><Button variant="destructive" size="xs" onClick={onConfirm}>{label === "Reset" ? "Reset app data" : label}</Button></PopoverClose>
      </div>
    </PopoverContent>
  </Popover>;
}

function StorageEmpty({ title, description }: { title: string; description: string }) {
  return <Empty className="min-h-0 flex-1 border-0">
    <EmptyHeader>
      <EmptyMedia variant="icon"><DatabaseIcon /></EmptyMedia>
      <EmptyTitle className="text-sm">{title}</EmptyTitle>
      <EmptyDescription className="text-xs">{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>;
}
