import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { storageLimits } from "@mobile-dev/shared/app-storage.ts";
import type { StorageEntry, StorageFile, StorageSnapshot, StorageStore, StorageTable, StoreKind } from "@mobile-dev/shared/app-storage.ts";
import { withTemporaryDirectory } from "../app-control/commands.ts";
import type { CommandRunner } from "../app-control/commands.ts";
import type { AppContainer, ContainerFile } from "./container.ts";
import { basename, classifyFiles, nullEntry, parseDataStorePreferences, parsePlistXml, parseSharedPreferences, plistEntries, storeId, textEntry } from "./formats.ts";
import type { ParsedEntry, StoreCandidate } from "./formats.ts";
import { decodeMmkv, guessMmkvValue } from "./mmkv.ts";
import { REDACTED, redactStorageEntry, redactStorageValue, sensitiveStorageName, sensitiveStorageText, sensitiveStoragePath } from "./redaction.ts";

export type ReadOptions = { entries: number; valueLength: number; bundleId: string; run: CommandRunner; store?: string; keys?: string[] };
// AsyncStorage databases are SQLite files recognized by their tables, so reading one can change its kind.
type StoreContent = { status: StorageStore["status"]; note?: string; entries: ParsedEntry[]; kind?: StoreKind };

const sqlite3 = process.platform === "darwin" ? "/usr/bin/sqlite3" : "sqlite3";
const quoteIdentifier = (name: string) => `"${name.replaceAll("\"", "\"\"")}"`;

async function sqlite(run: CommandRunner, file: string, sql: string): Promise<Record<string, unknown>[]> {
  const output = await run(sqlite3, ["-json", file, sql], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
  return output.trim() ? JSON.parse(output) : [];
}

const listTables = async (run: CommandRunner, file: string) =>
  (await sqlite(run, file, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map(row => String(row.name));

// sqlite3 reads a local copy that includes the write-ahead log, so writes SQLite has not checkpointed are read too.
function withDatabase<T>(container: AppContainer, candidate: StoreCandidate, work: (file: string) => Promise<T>): Promise<T> {
  return withTemporaryDirectory(async directory => {
    await Promise.all(candidate.files.map(async path => writeFile(join(directory, basename(path)), await container.read(path))));
    return work(join(directory, candidate.name));
  });
}

// AsyncStorage tables are recognized by name: v1/v2 use catalystLocalStorage, v2's next storage a Room
// table named Storage, and v3 an `entries` table under async-storage/databases/.
async function readSqlite(container: AppContainer, candidate: StoreCandidate, run: CommandRunner): Promise<StoreContent> {
  return withDatabase(container, candidate, async file => {
    let tables: string[];
    try { tables = await listTables(run, file); }
    catch { return { status: "unreadable", note: "Not a readable SQLite database.", entries: [] }; }
    const keyValueTable = tables.includes("catalystLocalStorage") ? "catalystLocalStorage"
      : tables.includes("entries") && candidate.path.includes("async-storage/") ? "entries"
      : tables.includes("Storage") && /^AsyncStorage/.test(candidate.name) ? "Storage" : undefined;
    if (keyValueTable) {
      const rows = await sqlite(run, file, `SELECT key, value FROM ${quoteIdentifier(keyValueTable)}`);
      const entries = rows.map(row => row.value === null || row.value === undefined ? nullEntry(String(row.key)) : textEntry(String(row.key), String(row.value)));
      return { status: "ok", kind: "async-storage", entries };
    }
    const entries = await Promise.all(tables.map(async (table): Promise<ParsedEntry> => {
      const [count] = await sqlite(run, file, `SELECT count(*) AS rows FROM ${quoteIdentifier(table)}`).catch(() => [{ rows: "?" }]);
      const columns = (await sqlite(run, file, `PRAGMA table_info(${quoteIdentifier(table)})`).catch(() => [])).map(column => String(column.name));
      const value = `${count?.rows ?? "?"} rows · ${columns.join(", ")}`;
      return { key: table, type: "table", value, bytes: 0 };
    }));
    return { status: "ok", entries };
  });
}

async function readAsyncManifest(container: AppContainer, candidate: StoreCandidate): Promise<StoreContent> {
  const manifest: unknown = JSON.parse((await container.read(candidate.path)).toString("utf8"));
  if (typeof manifest !== "object" || manifest === null) return { status: "unreadable", note: "The AsyncStorage manifest is not an object.", entries: [] };
  const directory = candidate.path.slice(0, candidate.path.lastIndexOf("/"));
  // Values over 1 KB live in a file named after the MD5 of their key; the manifest stores null for them.
  const entries = await Promise.all(Object.entries(manifest).map(async ([key, stored]): Promise<ParsedEntry> => {
    const value = typeof stored === "string" ? stored
      : await container.read(`${directory}/${createHash("md5").update(key).digest("hex")}`).then(buffer => buffer.toString("utf8"), () => null);
    return value === null ? nullEntry(key) : textEntry(key, value);
  }));
  return { status: "ok", entries };
}

async function readStore(container: AppContainer, candidate: StoreCandidate, run: CommandRunner): Promise<StoreContent> {
  switch (candidate.kind) {
    case "mmkv": {
      const [data, meta] = await Promise.all(candidate.files.map(file => container.read(file)));
      let decoded = decodeMmkv(data, meta);
      // The app may be writing while the files are read; a CRC mismatch is retried once.
      if (decoded.status === "ok" && decoded.crcValid === false) {
        const [again, againMeta] = await Promise.all(candidate.files.map(file => container.read(file)));
        decoded = decodeMmkv(again, againMeta);
      }
      if (decoded.status === "encrypted") return { status: "encrypted", note: "Encrypted with a key only the app knows.", entries: [] };
      if (decoded.status === "unreadable") return { status: "unreadable", note: decoded.reason, entries: [] };
      const note = decoded.crcValid === false ? "The checksum does not match; the app may be writing. Refresh to read again." : undefined;
      return { status: "ok", note, entries: decoded.records.map(record => ({ key: record.key, ...guessMmkvValue(record.value), bytes: record.value.length, guessed: true })) };
    }
    case "user-defaults": {
      const xml = container.preferences ? await container.preferences(candidate.path) : (await container.read(candidate.path)).toString("utf8");
      return { status: "ok", entries: plistEntries(parsePlistXml(xml)) };
    }
    case "shared-preferences":
      return { status: "ok", entries: parseSharedPreferences((await container.read(candidate.path)).toString("utf8")) };
    case "datastore":
      return { status: "ok", entries: parseDataStorePreferences(await container.read(candidate.path)) };
    case "async-storage":
      return readAsyncManifest(container, candidate);
    case "sqlite":
      return readSqlite(container, candidate, run);
    case "realm":
      return { status: "ok", note: "Realm files are listed but not decoded.", entries: [] };
  }
}

function limitEntry(entry: ParsedEntry, valueLength: number): StorageEntry {
  if (entry.value.length <= valueLength) return entry;
  return { ...entry, value: entry.value.slice(0, valueLength), truncated: true };
}

async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]); }
  }));
  return results;
}

export async function readStorage(container: AppContainer, { entries: entryLimit, valueLength, bundleId, run, store, keys }: ReadOptions): Promise<StorageSnapshot> {
  const files = await container.list();
  const sizes = new Map(files.map(file => [file.path, file.bytes]));
  const allCandidates = classifyFiles(files.map(file => file.path), container.platform).filter(candidate => !sensitiveStoragePath(candidate.path));
  const candidates = store === undefined ? allCandidates : allCandidates.filter(candidate => storeId(candidate) === store);
  if (store !== undefined && candidates.length === 0) throw new ExpectedOperationError("invalid_input", "That storage no longer exists. Refresh and try again.");
  const selectedKeys = keys === undefined ? undefined : new Set(keys);
  const owner = new Map<string, string>();
  const stores = await mapLimited(candidates, 4, async (candidate): Promise<StorageStore> => {
    const id = storeId(candidate);
    for (const file of candidate.files) owner.set(file, id);
    let content: StoreContent;
    try { content = await readStore(container, candidate, run); }
    catch (error) {
      if (error instanceof ExpectedOperationError) throw error;
      content = { status: "unreadable", note: "This file could not be read or parsed.", entries: [] };
    }
    return {
      id, kind: content.kind ?? candidate.kind, name: candidate.name, path: candidate.path, status: content.status, ...content.note ? { note: content.note } : {},
      bytes: candidate.files.reduce((total, file) => total + (sizes.get(file) ?? 0), 0),
      entryCount: content.entries.length,
      entries: content.entries.filter(entry => selectedKeys === undefined || selectedKeys.has(entry.key)).slice(0, entryLimit)
        .map(entry => limitEntry(redactStorageEntry(entry, candidate.name), valueLength)),
    };
  });
  // A scoped request must not expose other stores' paths, sizes, or values.
  const scopedFiles = files.filter(file => !sensitiveStoragePath(file.path) && (store === undefined || owner.has(file.path)));
  const sorted = [...scopedFiles].sort((a, b) => b.bytes - a.bytes).slice(0, storageLimits.files);
  return {
    platform: container.platform, bundleId, readAt: Date.now(), stores,
    files: sorted.map((file: ContainerFile): StorageFile => ({ ...file, ...owner.has(file.path) ? { store: owner.get(file.path) } : {} })),
    fileCount: scopedFiles.length,
    totalBytes: scopedFiles.reduce((total, file) => total + file.bytes, 0),
  };
}

// Store IDs are matched against a fresh listing, so callers can only reach files that belong to a found store.
async function findStore(container: AppContainer, id: string, kind?: StoreKind) {
  const files = await container.list();
  const candidate = classifyFiles(files.map(file => file.path), container.platform).find(store => storeId(store) === id && (kind === undefined || store.kind === kind));
  if (candidate === undefined) throw new ExpectedOperationError("invalid_input", "That storage no longer exists. Refresh and try again.");
  return candidate;
}

export async function clearStore(container: AppContainer, id: string) {
  const candidate = await findStore(container, id);
  if (candidate.kind === "user-defaults" && container.forgetPreferences) await container.forgetPreferences(candidate.path);
  await container.remove(candidate.files);
  return candidate;
}

// One page of a table. The table must be in the database's own list, so callers cannot inject SQL.
export async function readTable(container: AppContainer, id: string, table: string, { offset, limit, valueLength, run, columns: requestedColumns }: { offset: number; limit: number; valueLength: number; run: CommandRunner; columns?: string[] }): Promise<StorageTable> {
  const candidate = await findStore(container, id, "sqlite");
  if (sensitiveStoragePath(candidate.path) || sensitiveStorageText(table)) throw new ExpectedOperationError("invalid_input", "Sensitive storage identifiers cannot be returned.");
  return withDatabase(container, candidate, async file => {
    if (!(await listTables(run, file)).includes(table)) throw new ExpectedOperationError("invalid_input", "That table no longer exists. Refresh and try again.");
    const name = quoteIdentifier(table);
    const [info, [count]] = await Promise.all([sqlite(run, file, `PRAGMA table_info(${name})`), sqlite(run, file, `SELECT count(*) AS total FROM ${name}`)]);
    const allColumns = info.map(column => ({ name: String(column.name), type: String(column.type ?? "") })).filter(column => !sensitiveStorageText(column.name) && !sensitiveStorageText(column.type));
    if (requestedColumns?.some(name => !allColumns.some(column => column.name === name))) {
      throw new ExpectedOperationError("invalid_input", "A requested column no longer exists. Refresh and try again.");
    }
    const columns = requestedColumns === undefined ? allColumns : allColumns.filter(column => requestedColumns.includes(column.name));
    // Key/value tables often store credentials in a generically named value column.
    // Read their key/name label even when it is outside the requested projection;
    // it is only used locally to decide whether the whole row must be redacted.
    const labels = allColumns.filter(column => /^(key|name|k|(?:setting|preference|property|attribute)[_-]?(?:key|name))$/i.test(column.name));
    const select = columns.map((column, index) => {
      const quoted = quoteIdentifier(column.name);
      if (sensitiveStorageName(`${table}.${column.name}`)) return `'${REDACTED}' AS c${index}`;
      return `CASE typeof(${quoted}) WHEN 'blob' THEN '${REDACTED}' ELSE ${quoted} END AS c${index}`;
    });
    select.push(...labels.map((column, index) => `${quoteIdentifier(column.name)} AS k${index}`));
    const rows = await sqlite(run, file, `SELECT ${select.join(", ") || "NULL AS c0"} FROM ${name} LIMIT ${limit} OFFSET ${offset}`);
    return {
      table, columns, offset, total: Number(count?.total ?? 0),
      rows: rows.map(row => columns.map((column, index) => {
        const sensitiveRow = labels.some((_, label) => sensitiveStorageName(String(row[`k${label}`] ?? "")));
        const cell = sensitiveRow ? REDACTED : redactStorageValue(`${table}.${column.name}`, row[`c${index}`]);
        if (cell === null || cell === undefined || typeof cell === "number") return cell ?? null;
        const text = String(cell);
        return text.length > valueLength ? `${text.slice(0, valueLength)}…` : text;
      })),
    };
  });
}
