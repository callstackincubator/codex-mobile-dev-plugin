import { BinaryIcon, BracesIcon, CalendarIcon, ChevronDownIcon, CopyIcon, DatabaseIcon, HashIcon, MinusIcon, ToggleLeftIcon, TypeIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { StorageEntry, StorageStore } from "../../shared/app-storage.ts";
import { bytesAsText, formatBytes, parseJson, relativeTime } from "../storage-labels.ts";
import { Highlight } from "./storage-parts";
import { Button } from "./ui/button";

const typeIcons: Record<StorageEntry["type"], LucideIcon> = {
  string: TypeIcon, json: BracesIcon, object: BracesIcon, array: BracesIcon, number: HashIcon, integer: HashIcon,
  boolean: ToggleLeftIcon, date: CalendarIcon, data: BinaryIcon, table: DatabaseIcon, null: MinusIcon,
};

export const entryMatches = (entry: StorageEntry, query: string) => entry.key.toLowerCase().includes(query)
  || (entry.type === "data" ? bytesAsText(entry) ?? "" : entry.value).toLowerCase().includes(query);

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

// A key and its value; expanding it shows the whole value as a JSON tree or text.
export function EntryRow({ entry, store, query, open, onToggle, copy }: { entry: StorageEntry; store: StorageStore; query: string; open: boolean; onToggle: () => void; copy: (text: string) => void }) {
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
