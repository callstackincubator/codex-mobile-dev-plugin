import { ArrowRightLeftIcon, BinaryIcon, BracesIcon, CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DatabaseIcon, FolderIcon, HashIcon, LayersIcon, LockIcon, MinusIcon, PlayIcon, PlusIcon, PuzzleIcon, RefreshCwIcon, RotateCcwIcon, SearchIcon, ToggleLeftIcon, TriangleAlertIcon, TypeIcon } from "lucide-react";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { storeKindLabels, storeKinds } from "../../shared/app-storage.ts";
import type { StorageEntry, StorageSnapshot, StorageStore, StoreKind } from "../../shared/app-storage.ts";
import { changesPollMs } from "../storage-panel.ts";
import { tablePageSize } from "../../shared/app-storage.ts";
import type { StorageChangeEvent, StoragePanel, StorageState, StorageTab } from "../storage-panel.ts";
import { bytesAsText, changedFields, formatBytes, isSdkStore, parseJson, relativeTime, storeTitle } from "../storage-labels.ts";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { ButtonGroup } from "./ui/button-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";
import { Tabs, TabsList, TabsTrigger } from "./ui/base-tabs";
import { AppAvatar } from "./app-avatar";
import { appIcons } from "../app-icons.ts";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";

export { formatBytes } from "../storage-labels.ts";

const FILES = "files";
const kindLook: Record<StoreKind, { tone: string; tint: string; icon: typeof LayersIcon }> = {
  "user-defaults": { tone: "text-sky-600 dark:text-sky-400", tint: "bg-sky-100 dark:bg-sky-500/15 ring-1 ring-inset ring-sky-500/25", icon: LayersIcon },
  "shared-preferences": { tone: "text-sky-600 dark:text-sky-400", tint: "bg-sky-100 dark:bg-sky-500/15 ring-1 ring-inset ring-sky-500/25", icon: LayersIcon },
  "datastore": { tone: "text-sky-600 dark:text-sky-400", tint: "bg-sky-100 dark:bg-sky-500/15 ring-1 ring-inset ring-sky-500/25", icon: LayersIcon },
  "mmkv": { tone: "text-amber-600 dark:text-amber-400", tint: "bg-amber-100 dark:bg-amber-500/15 ring-1 ring-inset ring-amber-500/25", icon: LayersIcon },
  "async-storage": { tone: "text-violet-600 dark:text-violet-400", tint: "bg-violet-100 dark:bg-violet-500/15 ring-1 ring-inset ring-violet-500/25", icon: BracesIcon },
  "sqlite": { tone: "text-emerald-600 dark:text-emerald-400", tint: "bg-emerald-100 dark:bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/25", icon: DatabaseIcon },
  "realm": { tone: "text-rose-600 dark:text-rose-400", tint: "bg-rose-100 dark:bg-rose-500/15 ring-1 ring-inset ring-rose-500/25", icon: DatabaseIcon },
};
const typeIcons: Record<StorageEntry["type"], typeof TypeIcon> = {
  string: TypeIcon, json: BracesIcon, object: BracesIcon, array: BracesIcon, number: HashIcon, integer: HashIcon,
  boolean: ToggleLeftIcon, date: CalendarIcon, data: BinaryIcon, table: DatabaseIcon, null: MinusIcon,
};
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

const kindIconSizes = { sm: { box: "size-5", glyph: "size-3" }, md: { box: "size-6", glyph: "size-3.5" }, lg: { box: "size-7", glyph: "size-4" } };
type ChipLook = { tone: string; tint: string; icon: typeof LayersIcon };
// Only the tint blends, so it takes on a hovered or selected row's grey while the icon keeps its color.
// The ring of the same hue keeps the chip's edge visible against grey rows.
// Multiply darkens a light row; screen lightens a dark one.
function IconChip({ look: { tone, tint, icon: Icon }, size = "sm", className = "" }: { look: ChipLook; size?: keyof typeof kindIconSizes; className?: string }) {
  return <span className={`relative inline-flex shrink-0 items-center justify-center ${tone} ${kindIconSizes[size].box} ${className}`} aria-hidden="true">
    <span className={`absolute inset-0 rounded-md mix-blend-multiply dark:mix-blend-screen ${tint}`} />
    <Icon className={`relative ${kindIconSizes[size].glyph}`} />
  </span>;
}
function KindIcon({ kind, size, className }: { kind: StoreKind; size?: keyof typeof kindIconSizes; className?: string }) {
  return <IconChip look={kindLook[kind]} size={size} className={className} />;
}
const filesLook: ChipLook = { tone: "text-neutral-600 dark:text-neutral-400", tint: "bg-neutral-100 dark:bg-neutral-500/15 ring-1 ring-inset ring-neutral-500/25", icon: FolderIcon };

function Highlight({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query) : -1;
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="rounded-sm bg-yellow-300/70 px-px text-foreground">{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}

function objectPreview(value: unknown) {
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  const parts = entries.slice(0, 3).map(([key, child]) => `${key}: ${typeof child === "object" && child !== null ? Array.isArray(child) ? "[…]" : "{…}" : JSON.stringify(child)}`);
  return `{ ${parts.join(", ")}${entries.length > 3 ? ", …" : ""} }`;
}

// Inline, single-line rendering of a value by its type.
function ValuePreview({ entry, query }: { entry: StorageEntry; query: string }) {
  if (entry.type === "boolean") {
    const on = entry.value === "true";
    return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[11px] ${on ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />{entry.value}</span>;
  }
  if (entry.type === "number" || entry.type === "integer") return <span className="text-blue-600 tabular-nums dark:text-blue-400"><Highlight text={entry.value} query={query} /></span>;
  if (entry.type === "date") return <span className="truncate">{relativeTime(entry.value) && <span className="mr-2 font-sans">{relativeTime(entry.value)}</span>}<span className="text-muted-foreground">{entry.value}</span></span>;
  if (entry.type === "null") return <span className="text-muted-foreground">null</span>;
  if (entry.type === "table") return <span className="truncate text-muted-foreground"><Highlight text={entry.value} query={query} /></span>;
  const parsed = parseJson(entry);
  if (parsed !== undefined && !query) return <span className="truncate text-muted-foreground">{objectPreview(parsed)}</span>;
  const text = entry.type === "data" ? bytesAsText(entry) : entry.value;
  if (text === undefined) return <span className="truncate text-muted-foreground">{entry.value.slice(0, 64).replace(/(..)(?!$)/g, "$1 ")}{entry.value.length > 64 ? " …" : ""}</span>;
  return <span className="truncate"><Highlight text={text} query={query} /></span>;
}

function JsonTree({ value }: { value: unknown }): ReactNode {
  if (value === null || typeof value !== "object") {
    const tone = typeof value === "boolean" ? value ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400" : typeof value === "number" ? "text-blue-600 dark:text-blue-400" : "text-amber-700 dark:text-amber-400";
    return <span className={`${tone} [overflow-wrap:anywhere]`}>{JSON.stringify(value)}</span>;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</span>;
  return <div>{entries.map(([key, child]) => <div key={key} className="leading-5">
    <span className="text-muted-foreground">{key}: </span>
    {typeof child === "object" && child !== null ? <div className="border-l pl-3"><JsonTree value={child} /></div> : <JsonTree value={child} />}
  </div>)}</div>;
}

function EntryRow({ entry, store, query, open, onToggle, copy }: { entry: StorageEntry; store: StorageStore; query: string; open: boolean; onToggle: () => void; copy: (text: string) => void }) {
  const Icon = typeIcons[entry.type];
  const parsed = open ? parseJson(entry) : undefined;
  const text = entry.type === "data" ? bytesAsText(entry) ?? entry.value.replace(/(..)(?!$)/g, "$1 ") : entry.value;
  return <div role="row" className={`border-b ${open ? "bg-muted/40" : ""}`}>
    <button type="button" aria-expanded={open} onClick={onToggle} className="grid w-full grid-cols-[16px_minmax(8rem,2fr)_minmax(0,3fr)] items-center gap-3 px-3 py-1.5 text-left hover:bg-muted/60">
      {open ? <ChevronDownIcon className="size-4 text-muted-foreground" /> : <Icon className="size-4 text-muted-foreground/70" aria-label={entry.type} />}
      <span role="cell" className="truncate" title={entry.key}><Highlight text={entry.key} query={query} /></span>
      <span role="cell" className="flex min-w-0"><ValuePreview entry={entry} query={query} /></span>
    </button>
    {open && <div className="border-t border-dashed px-3 py-2 pl-10" aria-label="Value">
      {parsed !== undefined ? <JsonTree value={parsed} /> : <pre className="max-h-64 overflow-auto font-mono break-all whitespace-pre-wrap">{text}</pre>}
      <div className="mt-2 flex items-center gap-2 font-sans text-[11px] text-muted-foreground">
        <span>{entry.type === "data" && bytesAsText(entry) ? "bytes, shown as text" : entry.type}{entry.guessed ? " (guessed; MMKV does not record types)" : ""} · {formatBytes(entry.bytes)}{entry.truncated ? " · cut short" : ""}</span>
        <span className="truncate font-mono">{store.path}</span>
        <Button variant="ghost" size="xs" className="ml-auto" onClick={() => copy(entry.type === "data" ? bytesAsText(entry) ?? entry.value : entry.value)}><CopyIcon />Copy</Button>
      </div>
    </div>}
  </div>;
}

function StoreButton({ store, title, count, selected, onSelect }: { store: StorageStore; title: string; count: number; selected: boolean; onSelect: () => void }) {
  return <button type="button" data-selected={selected} onClick={onSelect} title={store.path}
    className="my-0.5 flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-muted data-[selected=true]:bg-muted">
    <KindIcon kind={store.kind} size="md" className="mt-0.5" />
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{title}</span><span className="block truncate text-[11px] text-muted-foreground">{storeKindLabels[store.kind]}</span></span>
    {store.status === "encrypted" ? <LockIcon className="size-3.5 self-center text-muted-foreground" aria-label="Encrypted" />
      : store.status === "unreadable" ? <TriangleAlertIcon className="size-3.5 self-center text-amber-500" aria-label="Unreadable" />
      : <span className="self-center text-muted-foreground tabular-nums">{count}</span>}
  </button>;
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

function ConfirmButton({ children, title, description, action, disabled, onConfirm, className, variant = "ghost", size = "xs" }: { children: ReactNode; title: string; description: string; action: string; disabled?: boolean; onConfirm: () => void; className?: string; variant?: "ghost" | "outline"; size?: "xs" | "sm" }) {
  return <Popover>
    <PopoverTrigger asChild><Button variant={variant} size={size} aria-label={title} title={title} disabled={disabled} className={className}>{children}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(300px,calc(100vw-24px))] p-3 text-xs">
      <p className="mb-1 font-medium">{title}?</p>
      <p className="mb-3 text-muted-foreground">{description}</p>
      <div className="flex justify-end gap-2">
        <PopoverClose asChild><Button variant="ghost" size="xs">Cancel</Button></PopoverClose>
        <PopoverClose asChild><Button variant="destructive" size="xs" onClick={onConfirm}>{action}</Button></PopoverClose>
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

const entryMatches = (entry: StorageEntry, query: string) => entry.key.toLowerCase().includes(query)
  || (entry.type === "data" ? bytesAsText(entry) ?? "" : entry.value).toLowerCase().includes(query);

// One page of a SQLite table as a grid. Long cells are cut short and show in full on hover.
function TableGrid({ table }: { table: NonNullable<StorageState["table"]> }) {
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
          {row.map((cell, column) => <td key={column} title={cell === null ? "NULL" : String(cell)}
            className={`max-w-80 truncate border-b px-3 py-1.5 whitespace-nowrap ${typeof cell === "number" ? "text-blue-600 tabular-nums dark:text-blue-400" : cell === null || /^x'/.test(cell) ? "text-muted-foreground" : ""}`}>
            {cell === null ? <span className="italic">NULL</span> : String(cell)}
          </td>)}
        </tr>)}</tbody>
      </table>}
      {data && data.rows.length === 0 && <p className="p-4 font-sans text-xs text-muted-foreground">This table has no rows.</p>}
    </div>
  </div>;
}

function BrowseView({ panel, snapshot, query, copy }: { panel: StoragePanel; snapshot: StorageSnapshot; query: string; copy: (text: string) => void }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState<string | undefined>();
  const [showSdks, setShowSdks] = useState(false);
  const busy = state.busy !== null && state.busy !== "apps";
  const title = (store: StorageStore) => storeTitle(store, snapshot.bundleId);
  const own = snapshot.stores.filter(store => !isSdkStore(store)).sort((a, b) => storeKinds.indexOf(a.kind) - storeKinds.indexOf(b.kind));
  const sdks = snapshot.stores.filter(isSdkStore);
  const matches = useMemo(() => new Map(snapshot.stores.map(store => [store.id,
    !query ? store.entries : store.name.toLowerCase().includes(query) ? store.entries : store.entries.filter(entry => entryMatches(entry, query))])), [snapshot, query]);
  const store = snapshot.stores.find(item => item.id === selected) ?? (selected === FILES ? undefined : own[0] ?? sdks[0]);
  const toggle = (store: StorageStore, key: string) => { const id = `${store.id}\u0000${key}`; setOpen(open === id ? undefined : id); };
  const visible = (store: StorageStore) => !query || (matches.get(store.id)?.length ?? 0) > 0;
  const select = (id: string) => { setSelected(id); setOpen(undefined); panel.closeTable(); };

  const sidebar = <nav aria-label="Stores" className="h-full w-60 shrink-0 overflow-auto border-r p-1.5 text-[13px] @max-[640px]:hidden">
    <div className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Your app</div>
    {own.filter(visible).map(item => <StoreButton key={item.id} store={item} title={title(item)} count={query ? matches.get(item.id)?.length ?? 0 : item.entryCount} selected={!query && store?.id === item.id} onSelect={() => select(item.id)} />)}
    {own.length === 0 && <p className="px-2 py-1 text-muted-foreground">No storage written by the app yet.</p>}
    {sdks.length > 0 && <>
      <button type="button" aria-expanded={showSdks || Boolean(query)} onClick={() => setShowSdks(!showSdks)} className="mt-1 mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-muted">
        {showSdks || query ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}<PuzzleIcon className="size-4" /><span className="flex-1">SDKs & system</span><span className="tabular-nums">{sdks.length}</span>
      </button>
      {(showSdks || query) && sdks.filter(visible).map(item => <StoreButton key={item.id} store={item} title={title(item)} count={query ? matches.get(item.id)?.length ?? 0 : item.entryCount} selected={!query && store?.id === item.id} onSelect={() => select(item.id)} />)}
    </>}
    <div className="mx-2 my-1.5 border-t" />
    <button type="button" data-selected={selected === FILES && !query} onClick={() => select(FILES)} title="Every file in the app's data directory"
      className="my-0.5 flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-muted data-[selected=true]:bg-muted">
      <IconChip look={filesLook} size="md" className="mt-0.5" />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium">Files</span><span className="block truncate text-[11px] text-muted-foreground tabular-nums">{formatBytes(snapshot.totalBytes)}</span></span>
      <span className="self-center text-muted-foreground tabular-nums">{snapshot.fileCount}</span>
    </button>
  </nav>;

  let main: ReactNode;
  if (query) {
    const groups = [...own, ...sdks].map(item => ({ store: item, entries: matches.get(item.id) ?? [] })).filter(group => group.entries.length > 0);
    const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
    main = <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" role="table" aria-label="Search results">
      <p className="border-b px-3 py-1.5 font-sans text-[11px] text-muted-foreground" role="status">{total} match{total === 1 ? "" : "es"} in {groups.length} store{groups.length === 1 ? "" : "s"}</p>
      {groups.map(group => <section key={group.store.id}>
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-1.5 font-sans backdrop-blur">
          <KindIcon kind={group.store.kind} /><span className="font-medium">{title(group.store)}</span><span className="text-muted-foreground">{storeKindLabels[group.store.kind]}</span>
          <span className="ml-auto text-muted-foreground tabular-nums">{group.entries.length} of {group.store.entryCount}</span>
        </div>
        {group.entries.map(entry => <EntryRow key={entry.key} entry={entry} store={group.store} query={query} open={open === `${group.store.id}\u0000${entry.key}`} onToggle={() => toggle(group.store, entry.key)} copy={copy} />)}
      </section>)}
      {groups.length === 0 && <p className="p-4 font-sans text-muted-foreground">No keys or values match.</p>}
    </div>;
  } else if (store === undefined) {
    main = <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" role="table" aria-label="Largest files">
      <div className="flex items-center gap-3 border-b px-4 py-3 font-sans">
        <IconChip look={filesLook} size="lg" />
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Files</span><span className="block text-xs text-muted-foreground">{snapshot.fileCount} files · {formatBytes(snapshot.totalBytes)} in the app's data directory</span></span>
      </div>
      <div className="border-b px-4 py-3 font-sans" aria-label="Size by kind">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">{containerBreakdown(snapshot).map(([label, bytes, tone]) => <span key={label} className={tone} style={{ width: `${snapshot.totalBytes ? bytes / snapshot.totalBytes * 100 : 0}%` }} />)}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {containerBreakdown(snapshot).filter(([, bytes]) => bytes > 0).map(([label, bytes, tone]) => <span key={label} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${tone}`} />{label}<span className="text-foreground tabular-nums">{formatBytes(bytes)}</span></span>)}
        </div>
      </div>
      {snapshot.files.map(file => {
        const owner = file.store ? snapshot.stores.find(item => item.id === file.store) : undefined;
        return <div key={file.path} role="row" className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3 border-b px-4 py-1.5">
          <span role="cell" className="truncate" title={file.path}>{file.path}</span>
          <span role="cell">{owner && <span className="flex items-center gap-1.5 font-sans text-[11px] text-muted-foreground"><KindIcon kind={owner.kind} />{storeKindLabels[owner.kind]}</span>}</span>
          <span role="cell" className="text-right text-muted-foreground tabular-nums">{formatBytes(file.bytes)}</span>
        </div>;
      })}
      {snapshot.files.length < snapshot.fileCount && <p className="p-3 font-sans text-[11px] text-muted-foreground">Showing the {snapshot.files.length} largest files.</p>}
    </div>;
  } else {
    const json = () => JSON.stringify(Object.fromEntries(store.entries.map(entry => [entry.key, parseJson(entry) ?? (entry.type === "boolean" ? entry.value === "true" : entry.type === "number" || entry.type === "integer" ? Number(entry.value) : entry.type === "data" ? bytesAsText(entry) ?? entry.value : entry.value)])), null, 2);
    const openTable = state.table?.storeId === store.id ? state.table : undefined;
    const tableData = openTable?.data;
    main = <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        {openTable && <Button variant="outline" size="icon-xs" aria-label="Back to tables" title="Back to tables" onClick={() => panel.closeTable()}><ChevronLeftIcon className="size-4" /></Button>}
        <KindIcon kind={store.kind} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title(store)}{openTable && <><span className="mx-1.5 font-normal text-muted-foreground">/</span><span className="font-mono">{openTable.name}</span></>}</div>
          <div className="truncate text-xs text-muted-foreground">{openTable
            ? <>{tableData ? `${tableData.columns.length} columns · ${tableData.total} row${tableData.total === 1 ? "" : "s"}` : "Loading…"} · <span className="font-mono">{store.path}</span></>
            : <>{storeKindLabels[store.kind]} · {store.entryCount} {store.kind === "sqlite" ? "table" : "key"}{store.entryCount === 1 ? "" : "s"} · {formatBytes(store.bytes)} · <span className="font-mono">{store.path}</span></>}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {openTable?.loading && <RefreshCwIcon className="size-3.5 animate-spin text-muted-foreground" aria-label="Loading" />}
          {tableData && tableData.total > tableData.rows.length && <>
            <span className="mr-0.5 text-xs text-muted-foreground tabular-nums">{tableData.offset + 1}–{tableData.offset + tableData.rows.length} of {tableData.total}</span>
            <ButtonGroup>
              <Button variant="outline" size="icon-xs" aria-label="Previous rows" disabled={openTable?.loading || tableData.offset === 0} onClick={() => void panel.openTable(store.id, tableData.table, Math.max(0, tableData.offset - tablePageSize))}><ChevronLeftIcon className="size-4" /></Button>
              <Button variant="outline" size="icon-xs" aria-label="Next rows" disabled={openTable?.loading || tableData.offset + tableData.rows.length >= tableData.total} onClick={() => void panel.openTable(store.id, tableData.table, tableData.offset + tablePageSize)}><ChevronRightIcon className="size-4" /></Button>
            </ButtonGroup>
          </>}
          {store.status === "ok" && store.kind !== "sqlite" && <Button variant="outline" size="xs" onClick={() => copy(json())}><CopyIcon />Copy as JSON</Button>}
          <ConfirmButton title={`Clear ${title(store)}`} action="Clear" disabled={busy} description={`Stops the app and deletes ${store.path}. The app is not relaunched.`} onConfirm={() => void panel.clear(store.id)}
            variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive">Clear</ConfirmButton>
        </div>
      </div>
      {store.note && <p className="flex items-center gap-1.5 border-b px-4 py-1.5 text-[11px] text-muted-foreground">{store.status === "encrypted" ? <LockIcon className="size-3" /> : store.status === "unreadable" ? <TriangleAlertIcon className="size-3" /> : null}{store.note}</p>}
      {state.table?.storeId === store.id ? <TableGrid table={state.table} /> : <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" role="table" aria-label={`${title(store)} entries`}>
        {store.entries.map(entry => store.kind === "sqlite" && entry.type === "table"
          ? <button key={entry.key} type="button" role="row" onClick={() => void panel.openTable(store.id, entry.key)} className="grid w-full grid-cols-[16px_minmax(8rem,2fr)_minmax(0,3fr)_16px] items-center gap-3 border-b px-3 py-1.5 text-left hover:bg-muted/60">
            <DatabaseIcon className="size-4 text-muted-foreground/70" /><span role="cell" className="truncate">{entry.key}</span><span role="cell" className="truncate text-muted-foreground">{entry.value}</span><ChevronRightIcon className="size-4 text-muted-foreground" />
          </button>
          : <EntryRow key={entry.key} entry={entry} store={store} query="" open={open === `${store.id}\u0000${entry.key}`} onToggle={() => toggle(store, entry.key)} copy={copy} />)}
        {store.entries.length === 0 && store.status === "ok" && <p className="p-4 font-sans text-muted-foreground">Empty.</p>}
        {store.entries.length < store.entryCount && <p className="p-3 font-sans text-[11px] text-muted-foreground">Showing the first {store.entries.length} of {store.entryCount}.</p>}
      </div>}
    </div>;
  }
  // Narrow panels swap the sidebar for a picker.
  const choices = [...own, ...sdks].map(item => ({ value: item.id, label: `${title(item)} · ${storeKindLabels[item.kind]}${isSdkStore(item) ? " (SDK)" : ""}` }))
    .concat({ value: FILES, label: `Files · ${formatBytes(snapshot.totalBytes)}` });
  const picker = !query && <div className="hidden shrink-0 border-b p-2 @max-[640px]:block">
    <Select items={choices} value={store?.id ?? FILES} onValueChange={value => { if (value) select(value); }}>
      <SelectTrigger size="sm" aria-label="Store" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}><SelectGroup>{choices.map(choice => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </div>;
  return <div className="flex min-h-0 flex-1">{sidebar}<div className="flex min-h-0 min-w-0 flex-1 flex-col">{picker}{main}</div></div>;
}

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

function ChangesView({ panel, query }: { panel: StoragePanel; query: string }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const own = panel.visibleChanges();
  const sdkCount = state.changes.filter(event => event.sdk).length;
  const visible = query ? own.filter(event => event.key.toLowerCase().includes(query) || event.store.name.toLowerCase().includes(query)
    || [event.before, event.after].some(entry => entry && shown(entry).toLowerCase().includes(query))) : own;
  return <div className="flex min-h-0 flex-1 flex-col">
    {own.length === 0 ? <StorageEmpty title="No changes yet" description={`Use the app. Storage is read every ${changesPollMs / 1000} seconds while this tab is open, and every key it adds, changes, or removes appears here.`} />
      : <div className="min-h-0 flex-1 overflow-auto text-xs" role="table" aria-label="Storage changes">
        {visible.map(event => {
          const look = changeLook[event.change];
          return <div key={event.id} role="row" className="grid grid-cols-[16px_8ch_minmax(8rem,18rem)_minmax(0,1fr)] items-center gap-x-3 border-b px-3 py-2">
            <span role="cell" aria-label={look.label} title={look.label} className={`inline-flex items-center justify-center ${look.tone}`}><look.icon className="size-4" /></span>
            <span role="cell" className="font-mono text-muted-foreground tabular-nums">{timeFormat.format(event.at)}</span>
            <span role="cell" className="flex min-w-0 items-center gap-2" title={`${storeKindLabels[event.store.kind]} · ${event.store.name}`}><KindIcon kind={event.store.kind} /><span className={`truncate font-mono font-medium ${event.change === "removed" ? "text-muted-foreground line-through" : ""}`}>{event.key}</span>{event.sdk && <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">SDK</span>}</span>
            <span role="cell" className="flex min-w-0 font-mono"><ChangeDiff event={event} /></span>
          </div>;
        })}
        {visible.length === 0 && <p className="p-4 text-muted-foreground">No changes match.</p>}
      </div>}
    <footer className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
      <span role="status">{own.length} change{own.length === 1 ? "" : "s"}{state.watchingSince ? ` since ${timeFormat.format(state.watchingSince)}` : ""}</span>
      <label htmlFor="storage-sdk-changes" className="ml-auto flex cursor-pointer items-center gap-2" title="Changes written by analytics, crash reporting, and other SDKs">
        SDK changes{!state.showSdkChanges && sdkCount > 0 && <span className="tabular-nums">({sdkCount} hidden)</span>}
        <Switch id="storage-sdk-changes" checked={state.showSdkChanges} onCheckedChange={checked => panel.setShowSdkChanges(checked)} />
      </label>
      <Button variant="ghost" size="xs" disabled={state.changes.length === 0} onClick={() => panel.clearChanges()}>Clear</Button>
    </footer>
  </div>;
}

export const StorageView = memo(function StorageView({ panel }: { panel: StoragePanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  useSyncExternalStore(appIcons.subscribe, appIcons.getSnapshot);
  const icon = (bundleId: string) => appIcons.get(state.platform, state.deviceId, bundleId)?.icon;
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");
  const snapshot = state.snapshot;
  const busy = state.busy !== null && state.busy !== "apps";
  const search = query.trim().toLowerCase();
  const ownChanges = panel.visibleChanges().length;
  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => setCopied("Copied"), () => setCopied("Could not copy")); };

  let body: ReactNode;
  if (state.unsupported || !state.available) body = <StorageEmpty title="App storage unavailable" description={state.available ? state.unsupported : "This host cannot call the plugin's tools."} />;
  else if (!state.bundleId) body = <StorageEmpty title="Choose an app" description={state.busy === "apps" ? "Loading installed apps…" : "Pick an installed app to see what it has saved."} />;
  else if (!snapshot) body = state.error ? null : <StorageEmpty title="Reading app data…" description="MMKV, AsyncStorage, UserDefaults, SharedPreferences, databases, and files." />;
  else if (state.tab === "changes") body = <ChangesView panel={panel} query={search} />;
  else body = <BrowseView key={`${snapshot.platform}:${snapshot.bundleId}`} panel={panel} snapshot={snapshot} query={search} copy={copy} />;

  return <section id="storage-drawer" className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-label="Storage">
    <header className="flex h-[49px] shrink-0 items-center gap-2 border-b px-2">
      <Select items={state.apps.map(app => ({ value: app.bundleId, label: app.name }))} value={state.bundleId || null} disabled={!state.available || state.unsupported !== ""} onValueChange={value => { if (value) panel.selectApp(value); }}>
        <SelectTrigger id="storage-app" size="sm" aria-label="App" className="w-64 min-w-28 shrink">
          <SelectValue>{(value: string | null) => {
            const app = state.apps.find(item => item.bundleId === value);
            if (!app) return value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">{state.busy === "apps" ? "Loading apps…" : "Choose an app"}</span>;
            return <><AppAvatar name={app.name} icon={icon(app.bundleId)} size="xs" /><span className="max-w-40 shrink-0 truncate">{app.name}</span>{app.name !== app.bundleId && <span className="min-w-0 truncate text-xs text-muted-foreground">{app.bundleId}</span>}</>;
          }}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="w-auto max-w-[min(30rem,calc(100vw-16px))] min-w-(--anchor-width)"><SelectGroup>
          {state.apps.map(app => <SelectItem key={app.bundleId} value={app.bundleId} className="py-1.5">
            <AppAvatar name={app.name} icon={icon(app.bundleId)} size="sm" className="mt-0.5 self-start" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate leading-5">{app.name}</span>
              {app.name !== app.bundleId && <span className="truncate text-xs leading-4 text-muted-foreground">{app.bundleId}</span>}
            </span>
          </SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
      <Tabs value={state.tab} onValueChange={value => panel.setTab(value as StorageTab)} className="shrink-0">
        <TabsList size="sm" aria-label="Storage view">
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="changes">Changes{ownChanges > 0 && <span className="font-normal text-muted-foreground tabular-nums">{ownChanges}</span>}</TabsTrigger>
        </TabsList>
      </Tabs>
      <InputGroup size="sm" className="min-w-16 flex-1"><InputGroupInput aria-label={state.tab === "browse" ? "Filter keys and values" : "Filter changes"} type="search" placeholder={state.tab === "browse" ? "Filter keys and values…" : "Filter changes…"} maxLength={256} autoComplete="off" spellCheck={false} value={query} onChange={event => setQuery(event.target.value)} /><InputGroupAddon><SearchIcon /></InputGroupAddon></InputGroup>
      <ButtonGroup className="shrink-0">
        <Button variant="outline" size="icon-sm" aria-label="Refresh" title={snapshot ? `Read again · last read ${timeFormat.format(snapshot.readAt)}` : "Read again"} disabled={!state.bundleId || busy} onClick={() => void panel.refresh()}>
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
