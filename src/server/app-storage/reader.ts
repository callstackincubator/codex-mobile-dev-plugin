import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExpectedOperationError } from "../../shared/error-reporting.ts";
import { storageLimits } from "../../shared/app-storage.ts";
import type { StorageEntry, StorageFile, StorageSnapshot, StorageStore, StorageTable, StoreKind } from "../../shared/app-storage.ts";
import { withTemporaryDirectory } from "../app-control/commands.ts";
import type { CommandRunner } from "../app-control/commands.ts";
import type { AppContainer, ContainerFile } from "./container.ts";
import { basename, classifyFiles, nullEntry, parseDataStorePreferences, parsePlistXml, parseSharedPreferences, plistEntries, protobufEntries, storeId, textEntry } from "./formats.ts";
import type { ParsedEntry, StoreCandidate } from "./formats.ts";
import { decodeMmkv, guessMmkvValue } from "./mmkv.ts";

export type ReadOptions = { entries: number; valueLength: number; bundleId: string; run: CommandRunner };
// AsyncStorage databases are SQLite files recognized by their tables, so reading one can change its kind.
type StoreContent = { status: StorageStore["status"]; note?: string; entries: ParsedEntry[]; kind?: StoreKind };

const sqlite3 = process.platform === "darwin" ? "/usr/bin/sqlite3" : "sqlite3";
const quoteIdentifier = (name: string) => `"${name.replaceAll("\"", "\"\"")}"`;
const sqlString = (text: string) => `'${text.replaceAll("'", "''")}'`;

async function sqlite(run: CommandRunner, file: string, sql: string): Promise<Record<string, unknown>[]> {
  const output = await run(sqlite3, ["-json", file, sql], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
  return output.trim() ? JSON.parse(output) : [];
}

type Column = StorageTable["columns"][number];
// Every table's columns in one query, by table name. A SQLite table always has a column, so this lists every table.
async function describeTables(run: CommandRunner, file: string): Promise<Map<string, Column[]>> {
  const tables = new Map<string, Column[]>();
  for (const row of await sqlite(run, file, "SELECT m.name AS tbl, p.name AS col, p.type AS type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid")) {
    let columns = tables.get(String(row.tbl));
    if (columns === undefined) tables.set(String(row.tbl), columns = []);
    columns.push({ name: String(row.col), type: String(row.type ?? "") });
  }
  return tables;
}

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
    let tables: Map<string, Column[]>;
    try { tables = await describeTables(run, file); }
    catch { return { status: "unreadable", note: "Not a readable SQLite database.", entries: [] }; }
    const keyValueTable = tables.has("catalystLocalStorage") ? "catalystLocalStorage"
      : tables.has("entries") && candidate.path.includes("async-storage/") ? "entries"
      : tables.has("Storage") && /^AsyncStorage/.test(candidate.name) ? "Storage" : undefined;
    if (keyValueTable) {
      const rows = await sqlite(run, file, `SELECT key, value FROM ${quoteIdentifier(keyValueTable)}`);
      const entries = rows.map(row => row.value === null || row.value === undefined ? nullEntry(String(row.key)) : textEntry(String(row.key), String(row.value)));
      return { status: "ok", kind: "async-storage", entries };
    }
    if (tables.size === 0) return { status: "ok", entries: [] };
    // One query counts every table. Running one sqlite3 per table in parallel let the first process recover the
    // write-ahead log while the others failed on its lock.
    const counts = new Map((await sqlite(run, file, [...tables.keys()].map(table => `SELECT ${sqlString(table)} AS name, count(*) AS total FROM ${quoteIdentifier(table)}`).join(" UNION ALL ")))
      .map(row => [String(row.name), Number(row.total)]));
    return { status: "ok", entries: [...tables].map(([table, columns]) => ({ key: table, type: "table", value: `${counts.get(table) ?? "?"} rows · ${columns.map(column => column.name).join(", ")}`, bytes: 0 })) };
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
    case "shared-preferences": {
      const entries = parseSharedPreferences((await container.read(candidate.path)).toString("utf8"));
      // EncryptedSharedPreferences stores its keysets beside encrypted keys and values, which would read as noise.
      if (entries.some(entry => entry.key.startsWith("__androidx_security_crypto_encrypted_prefs_"))) {
        return { status: "encrypted", note: "EncryptedSharedPreferences: keys and values are encrypted with a key in the Android Keystore.", entries: [] };
      }
      return { status: "ok", entries };
    }
    case "datastore":
      return { status: "ok", entries: parseDataStorePreferences(await container.read(candidate.path)) };
    case "proto-datastore":
      return { status: "ok", note: "The file has no schema, so keys are field numbers and types are guessed.", entries: protobufEntries(await container.read(candidate.path)) };
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

export async function readStorage(container: AppContainer, { entries: entryLimit, valueLength, bundleId, run }: ReadOptions): Promise<StorageSnapshot> {
  const files = await container.list();
  const sizes = new Map(files.map(file => [file.path, file.bytes]));
  const candidates = classifyFiles(files.map(file => file.path), container.platform);
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
      entries: content.entries.slice(0, entryLimit).map(entry => limitEntry(entry, valueLength)),
    };
  });
  const sorted = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, storageLimits.files);
  return {
    platform: container.platform, bundleId, readAt: Date.now(), stores,
    files: sorted.map((file: ContainerFile): StorageFile => ({ ...file, ...owner.has(file.path) ? { store: owner.get(file.path) } : {} })),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
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
export async function readTable(container: AppContainer, id: string, table: string, { offset, limit, valueLength, run }: { offset: number; limit: number; valueLength: number; run: CommandRunner }): Promise<StorageTable> {
  const candidate = await findStore(container, id, "sqlite");
  return withDatabase(container, candidate, async file => {
    const columns = (await describeTables(run, file)).get(table);
    if (columns === undefined) throw new ExpectedOperationError("invalid_input", `The table ${table} no longer exists. Refresh and try again.`);
    const name = quoteIdentifier(table);
    const [count] = await sqlite(run, file, `SELECT count(*) AS total FROM ${name}`);
    // Blobs cannot travel as JSON, so they become a hex preview no longer than the value limit.
    const select = columns.map((column, index) => {
      const quoted = quoteIdentifier(column.name);
      return `CASE typeof(${quoted}) WHEN 'blob' THEN 'x''' || substr(hex(${quoted}), 1, ${valueLength}) || '''' ELSE ${quoted} END AS c${index}`;
    }).join(", ");
    const rows = await sqlite(run, file, `SELECT ${select} FROM ${name} LIMIT ${limit} OFFSET ${offset}`);
    return {
      table, columns, offset, total: Number(count?.total ?? 0),
      rows: rows.map(row => columns.map((_, index) => {
        const cell = row[`c${index}`];
        if (cell === null || cell === undefined || typeof cell === "number") return cell ?? null;
        const text = String(cell);
        return text.length > valueLength ? `${text.slice(0, valueLength)}…` : text;
      })),
    };
  });
}
