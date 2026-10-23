import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DatabaseIcon, LockIcon, PuzzleIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { appleDate, storageLimits, storeKindLabels, storeKinds } from "../../shared/app-storage.ts";
import type { StorageEntry, StorageFilePreview, StorageSnapshot, StorageStore } from "../../shared/app-storage.ts";
import { isWorking } from "../storage-panel.ts";
import type { StorageFileView, StoragePanel, StorageTableView } from "../storage-panel.ts";
import { formatBytes, isSdkStore, storeJson, storeTitle } from "../storage-labels.ts";
import { EntryRow, JsonTree, entryMatches } from "./storage-entries";
import { ConfirmButton, FilesIcon, KindIcon, SidebarRow } from "./storage-parts";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";

const FILES = "files";
type Expansion = { expanded?: string; toggle: (store: StorageStore, key: string) => void; copy: (text: string) => void };
const entryId = (store: StorageStore, key: string) => `${store.id}\u0000${key}`;

// The header above a store or the file list. Opening a table or file swaps the icon for a back button of the
// same size and adds the item's name to the title.
function DetailHeader({ icon, title, child, subtitle, path, back, loading, children }: { icon?: ReactNode; title: string; child?: string; subtitle: string; path?: string; back?: { label: string; onBack: () => void }; loading?: boolean; children?: ReactNode }) {
  return <div className="flex items-center gap-3 border-b px-4 py-3 font-sans">
    {back ? <Button variant="outline" size="icon-sm" className="shrink-0" aria-label={back.label} title={back.label} onClick={back.onBack}><ChevronLeftIcon className="size-4" /></Button> : icon}
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-semibold">{title}{child && <><span className="mx-1.5 font-normal text-muted-foreground">/</span><span className="font-mono">{child}</span></>}</div>
      <div className="truncate text-xs text-muted-foreground">{subtitle}{path && <> · <span className="font-mono">{path}</span></>}</div>
    </div>
    <div className="flex shrink-0 items-center gap-1.5">
      {loading && <RefreshCwIcon className="size-3.5 animate-spin text-muted-foreground" aria-label="Loading" />}
      {children}
    </div>
  </div>;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const formatLabels: Record<StorageFilePreview["format"], string> = { json: "JSON", plist: "Property list", archive: "NSKeyedArchiver archive", text: "Text", binary: "Binary", "too-large": "Too large to preview" };
const parseJsonText = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

// A file's contents: structured formats as a JSON tree and text as is. Values the server redacted read [REDACTED].
function FilePreview({ file }: { file: StorageFileView }) {
  const data = file.data;
  let body: ReactNode = null;
  let note = "";
  if (data?.format === "binary") {
    note = "Binary data isn't shown, because it could hold credentials.";
  } else if (data && data.format !== "too-large") {
    // Structured formats arrive as JSON text; a cut-short one no longer parses and shows as text.
    const parsed = data.format === "text" ? undefined : parseJsonText(data.content);
    body = parsed !== undefined ? <JsonTree value={parsed} /> : <pre className="font-mono break-all whitespace-pre-wrap">{data.content}</pre>;
    if (data.truncated) note = "Cut short; the file is longer.";
  }
  return <div className="flex min-h-0 flex-1 flex-col">
    {file.error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="text-xs">{file.error}</AlertDescription></Alert>}
    {note && <p className="border-b px-4 py-1.5 font-sans text-[11px] text-muted-foreground">{note}</p>}
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs" role="region" aria-label={`${file.path} contents`}>{body}</div>
  </div>;
}

// Approximate split of the data directory by what owns each listed file.
function containerBreakdown(snapshot: StorageSnapshot) {
  const owners = new Map(snapshot.stores.map(store => [store.id, store.kind]));
  const parts = { Databases: 0, Preferences: 0, Caches: 0 };
  for (const file of snapshot.files) {
    const kind = file.store ? owners.get(file.store) : undefined;
    if (kind === "sqlite" || kind === "realm" || kind === "async-storage") parts.Databases += file.bytes;
    else if (kind) parts.Preferences += file.bytes;
    else if (/^(?:Library\/Caches|tmp|cache|code_cache)\//.test(file.path)) parts.Caches += file.bytes;
  }
  const other = Math.max(0, snapshot.totalBytes - parts.Databases - parts.Preferences - parts.Caches);
  return [["Caches", parts.Caches, "bg-neutral-400"], ["Databases", parts.Databases, "bg-emerald-500"], ["Preferences", parts.Preferences, "bg-sky-500"], ["Other", other, "bg-muted-foreground/30"]] as const;
}

function FilesView({ panel, snapshot, file }: { panel: StoragePanel; snapshot: StorageSnapshot; file?: StorageFileView }) {
  if (file) {
    const listed = snapshot.files.find(item => item.path === file.path);
    const subtitle = file.data ? `${formatLabels[file.data.format]} · ${formatBytes(file.data.bytes)}` : listed ? formatBytes(listed.bytes) : "Loading…";
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DetailHeader title="Files" child={file.path.slice(file.path.lastIndexOf("/") + 1)} subtitle={subtitle} path={file.path} back={{ label: "Back to files", onBack: () => panel.closeDetail() }} loading={file.loading} />
      <FilePreview file={file} />
    </div>;
  }
  const breakdown = containerBreakdown(snapshot);
  return <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" role="table" aria-label="Largest files">
    <DetailHeader icon={<FilesIcon size="lg" />} title="Files" subtitle={`${plural(snapshot.fileCount, "file")} · ${formatBytes(snapshot.totalBytes)} in the app's data directory`} />
    <div className="border-b px-4 py-3 font-sans" aria-label="Size by kind">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">{breakdown.map(([label, bytes, tone]) => <span key={label} className={tone} style={{ width: `${snapshot.totalBytes ? bytes / snapshot.totalBytes * 100 : 0}%` }} />)}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {breakdown.filter(([, bytes]) => bytes > 0).map(([label, bytes, tone]) => <span key={label} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${tone}`} />{label}<span className="text-foreground tabular-nums">{formatBytes(bytes)}</span></span>)}
      </div>
    </div>
    {snapshot.files.map(item => {
      const owner = item.store ? snapshot.stores.find(store => store.id === item.store) : undefined;
      return <button key={item.path} type="button" role="row" onClick={() => void panel.openFile(item.path)} title={`Open ${item.path}`}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto_4.5rem_16px] items-center gap-3 border-b px-4 py-1.5 text-left hover:bg-muted/60">
        <span role="cell" className="truncate">{item.path}</span>
        <span role="cell">{owner && <span className="flex items-center gap-1.5 font-sans text-[11px] text-muted-foreground"><KindIcon kind={owner.kind} />{storeKindLabels[owner.kind]}</span>}</span>
        <span role="cell" className="text-right text-muted-foreground tabular-nums">{formatBytes(item.bytes)}</span>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </button>;
    })}
    {snapshot.files.length < snapshot.fileCount && <p className="p-3 font-sans text-[11px] text-muted-foreground">Showing the {snapshot.files.length} largest files.</p>}
  </div>;
}

function SearchResults({ groups, query, title, expansion }: { groups: { store: StorageStore; entries: StorageEntry[] }[]; query: string; title: (store: StorageStore) => string; expansion: Expansion }) {
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
  return <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" role="table" aria-label="Search results">
    <p className="border-b px-3 py-1.5 font-sans text-[11px] text-muted-foreground" role="status">{total} match{total === 1 ? "" : "es"} in {groups.length} store{groups.length === 1 ? "" : "s"}</p>
    {groups.map(({ store, entries }) => <section key={store.id}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-1.5 font-sans backdrop-blur">
        <KindIcon kind={store.kind} /><span className="font-medium">{title(store)}</span><span className="text-muted-foreground">{storeKindLabels[store.kind]}</span>
        <span className="ml-auto text-muted-foreground tabular-nums">{entries.length} of {store.entryCount}</span>
      </div>
      {entries.map(entry => <EntryRow key={entry.key} entry={entry} store={store} query={query} open={expansion.expanded === entryId(store, entry.key)} onToggle={() => expansion.toggle(store, entry.key)} copy={expansion.copy} />)}
    </section>)}
    {groups.length === 0 && <p className="p-4 font-sans text-muted-foreground">No keys or values match.</p>}
  </div>;
}

// Core Data and SwiftData keep dates in TIMESTAMP columns as seconds since 2001-01-01.
const timestamp = (type: string, cell: string | number) => typeof cell === "number" && /^timestamp$/i.test(type) ? appleDate(cell) : undefined;

// One page of a SQLite table as a grid. Long cells are cut short and show in full on hover.
function TableGrid({ table }: { table: StorageTableView }) {
  const data = table.data;
  return <div className="flex min-h-0 flex-1 flex-col">
    {table.error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="text-xs">{table.error}</AlertDescription></Alert>}
    <div className="min-h-0 flex-1 overflow-auto" role="region" aria-label={`${table.name} rows`}>
      {data && <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-background">
          <tr>{data.columns.map(column => <th key={column.name} scope="col" className="border-b px-3 py-1.5 text-left font-sans font-medium whitespace-nowrap">
            {column.name}{column.type && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{column.type.toLowerCase()}</span>}
          </th>)}</tr>
        </thead>
        <tbody>{data.rows.map((row, index) => <tr key={data.offset + index} className="hover:bg-muted/50">
          {row.map((cell, column) => {
            const date = cell === null ? undefined : timestamp(data.columns[column].type, cell);
            const tone = date ? "" : typeof cell === "number" ? "text-blue-600 tabular-nums dark:text-blue-400" : cell === null || /^x'/.test(cell) ? "text-muted-foreground" : "";
            return <td key={column} title={cell === null ? "NULL" : date ? `${date} (${cell} seconds since 2001)` : String(cell)} className={`max-w-80 truncate border-b px-3 py-1.5 whitespace-nowrap ${tone}`}>
              {cell === null ? <span className="italic">NULL</span> : date ?? String(cell)}
            </td>;
          })}
        </tr>)}</tbody>
      </table>}
      {data && data.rows.length === 0 && <p className="p-4 font-sans text-xs text-muted-foreground">This table has no rows.</p>}
    </div>
  </div>;
}

function TablePager({ panel, store, table }: { panel: StoragePanel; store: StorageStore; table: StorageTableView }) {
  const data = table.data;
  if (!data || data.total <= data.rows.length) return null;
  const last = data.offset + data.rows.length;
  const page = (offset: number) => void panel.openTable(store.id, table.name, offset);
  return <>
    <span className="mr-0.5 text-xs text-muted-foreground tabular-nums">{data.offset + 1}–{last} of {data.total}</span>
    <ButtonGroup>
      <Button variant="outline" size="icon-xs" aria-label="Previous rows" disabled={table.loading || data.offset === 0} onClick={() => page(Math.max(0, data.offset - storageLimits.tableRows))}><ChevronLeftIcon className="size-4" /></Button>
      <Button variant="outline" size="icon-xs" aria-label="Next rows" disabled={table.loading || last >= data.total} onClick={() => page(data.offset + storageLimits.tableRows)}><ChevronRightIcon className="size-4" /></Button>
    </ButtonGroup>
  </>;
}

// A store's header and entries. A database lists its tables; opening one shows it in place, with a back button
// where the store icon was.
function StoreDetail({ panel, store, title, table, busy, expansion }: { panel: StoragePanel; store: StorageStore; title: string; table?: StorageTableView; busy: boolean; expansion: Expansion }) {
  const subtitle = table ? table.data ? `${plural(table.data.columns.length, "column")} · ${plural(table.data.total, "row")}` : "Loading…"
    : `${storeKindLabels[store.kind]} · ${plural(store.entryCount, store.kind === "sqlite" ? "table" : "key")} · ${formatBytes(store.bytes)}`;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <DetailHeader icon={<KindIcon kind={store.kind} size="lg" />} title={title} child={table?.name} subtitle={subtitle} path={store.path}
      back={table && { label: "Back to tables", onBack: () => panel.closeDetail() }} loading={table?.loading}>
        {table && <TablePager panel={panel} store={store} table={table} />}
        {store.status === "ok" && store.kind !== "sqlite" && <Button variant="outline" size="xs" onClick={() => expansion.copy(storeJson(store))}><CopyIcon />Copy as JSON</Button>}
        <ConfirmButton title={`Clear ${title}`} action="Clear" disabled={busy} description={`Stops the app and deletes ${store.path}. The app is not relaunched.`} onConfirm={() => void panel.clear(store.id)}
          variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive">Clear</ConfirmButton>
    </DetailHeader>
    {store.note && <p className="flex items-center gap-1.5 border-b px-4 py-1.5 text-[11px] text-muted-foreground">{store.status === "encrypted" ? <LockIcon className="size-3" /> : store.status === "unreadable" ? <TriangleAlertIcon className="size-3" /> : null}{store.note}</p>}
    {table ? <TableGrid table={table} /> : <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" role="table" aria-label={`${title} entries`}>
      {store.entries.map(entry => store.kind === "sqlite" && entry.type === "table"
        ? <button key={entry.key} type="button" role="row" onClick={() => void panel.openTable(store.id, entry.key)} className="grid w-full grid-cols-[16px_minmax(8rem,2fr)_minmax(0,3fr)_16px] items-center gap-3 border-b px-3 py-1.5 text-left hover:bg-muted/60">
          <DatabaseIcon className="size-4 text-muted-foreground/70" /><span role="cell" className="truncate">{entry.key}</span><span role="cell" className="truncate text-muted-foreground">{entry.value}</span><ChevronRightIcon className="size-4 text-muted-foreground" />
        </button>
        : <EntryRow key={entry.key} entry={entry} store={store} query="" open={expansion.expanded === entryId(store, entry.key)} onToggle={() => expansion.toggle(store, entry.key)} copy={expansion.copy} />)}
      {store.entries.length === 0 && store.status === "ok" && <p className="p-4 font-sans text-muted-foreground">Empty.</p>}
      {store.entries.length < store.entryCount && <p className="p-3 font-sans text-[11px] text-muted-foreground">Showing the first {store.entries.length} of {store.entryCount}.</p>}
    </div>}
  </div>;
}

export function BrowseView({ panel, snapshot, query, copy }: { panel: StoragePanel; snapshot: StorageSnapshot; query: string; copy: (text: string) => void }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState<string | undefined>();
  const [showSdks, setShowSdks] = useState(false);
  const title = (store: StorageStore) => storeTitle(store, snapshot.bundleId);
  const own = snapshot.stores.filter(store => !isSdkStore(store)).sort((a, b) => storeKinds.indexOf(a.kind) - storeKinds.indexOf(b.kind));
  const sdks = snapshot.stores.filter(isSdkStore);
  const matches = useMemo(() => new Map(snapshot.stores.map(store => [store.id,
    !query || store.name.toLowerCase().includes(query) ? store.entries : store.entries.filter(entry => entryMatches(entry, query))])), [snapshot, query]);
  const store = snapshot.stores.find(item => item.id === selected) ?? (selected === FILES ? undefined : own[0] ?? sdks[0]);
  const expansion: Expansion = { expanded, copy, toggle: (item, key) => setExpanded(expanded === entryId(item, key) ? undefined : entryId(item, key)) };
  const visible = (item: StorageStore) => !query || (matches.get(item.id)?.length ?? 0) > 0;
  const select = (id: string) => { setSelected(id); setExpanded(undefined); panel.closeDetail(); };

  const storeRow = (item: StorageStore) => <SidebarRow key={item.id} icon={<KindIcon kind={item.kind} size="md" className="mt-0.5" />} title={title(item)} subtitle={storeKindLabels[item.kind]} tooltip={item.path}
    selected={!query && store?.id === item.id} onSelect={() => select(item.id)}
    trailing={item.status === "encrypted" ? <LockIcon className="size-3.5" aria-label="Encrypted" />
      : item.status === "unreadable" ? <TriangleAlertIcon className="size-3.5 text-amber-500" aria-label="Unreadable" />
      : query ? matches.get(item.id)?.length ?? 0 : item.entryCount} />;
  const sidebar = <nav aria-label="Stores" className="h-full w-60 shrink-0 overflow-auto border-r p-1.5 text-[13px] @max-[640px]:hidden">
    {own.filter(visible).map(storeRow)}
    {own.length === 0 && <p className="px-2 py-1 text-muted-foreground">No storage written by the app yet.</p>}
    {sdks.length > 0 && <>
      <button type="button" aria-expanded={showSdks || Boolean(query)} onClick={() => setShowSdks(!showSdks)} className="mt-1 mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-muted">
        {showSdks || query ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}<PuzzleIcon className="size-4" /><span className="flex-1">SDKs & system</span><span className="tabular-nums">{sdks.length}</span>
      </button>
      {(showSdks || query) && sdks.filter(visible).map(storeRow)}
    </>}
    <div className="mx-2 my-1.5 border-t" />
    <SidebarRow icon={<FilesIcon size="md" className="mt-0.5" />} title="Files" subtitle={formatBytes(snapshot.totalBytes)} trailing={snapshot.fileCount} tooltip="Every file in the app's data directory"
      selected={selected === FILES && !query} onSelect={() => select(FILES)} />
  </nav>;

  // Narrow panels swap the sidebar for a picker.
  const choices = [...own, ...sdks].map(item => ({ value: item.id, label: `${title(item)} · ${storeKindLabels[item.kind]}${isSdkStore(item) ? " (SDK)" : ""}` }))
    .concat({ value: FILES, label: `Files · ${formatBytes(snapshot.totalBytes)}` });
  const picker = !query && <div className="hidden shrink-0 border-b p-2 @max-[640px]:block">
    <Select items={choices} value={store?.id ?? FILES} onValueChange={value => { if (value) select(value); }}>
      <SelectTrigger size="sm" aria-label="Store" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}><SelectGroup>{choices.map(choice => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </div>;

  const main = query ? <SearchResults groups={[...own, ...sdks].map(item => ({ store: item, entries: matches.get(item.id) ?? [] })).filter(group => group.entries.length > 0)} query={query} title={title} expansion={expansion} />
    : store ? <StoreDetail panel={panel} store={store} title={title(store)} table={state.detail?.kind === "table" && state.detail.storeId === store.id ? state.detail : undefined} busy={isWorking(state)} expansion={expansion} />
    : <FilesView panel={panel} snapshot={snapshot} file={state.detail?.kind === "file" ? state.detail : undefined} />;
  return <div className="flex min-h-0 flex-1">{sidebar}<div className="flex min-h-0 min-w-0 flex-1 flex-col">{picker}{main}</div></div>;
}
