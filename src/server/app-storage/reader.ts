import { createHash } from "node:crypto";
import { join } from "node:path";
import { ExpectedOperationError } from "../../shared/error-reporting.ts";
import { storageLimits } from "../../shared/app-storage.ts";
import type { StorageEntry, StorageFile, StorageSnapshot, StorageStore } from "../../shared/app-storage.ts";
import { withTemporaryDirectory } from "../app-control/commands.ts";
import type { CommandRunner } from "../app-control/commands.ts";
import type { AppContainer, ContainerFile } from "./container.ts";
import { classifyFiles, parseDataStorePreferences, parsePlistXml, parseSharedPreferences, plistEntries, storeId } from "./formats.ts";
import type { ParsedEntry, StoreCandidate } from "./formats.ts";
import { decodeMmkv, guessMmkvValue, jsonType } from "./mmkv.ts";

export type ReadOptions = { entries: number; valueLength: number; bundleId: string; run: CommandRunner };
type StoreContent = { status: StorageStore["status"]; note?: string; entries: ParsedEntry[] };

const sqlite3 = process.platform === "darwin" ? "/usr/bin/sqlite3" : "sqlite3";
const quoteIdentifier = (name: string) => `"${name.replaceAll("\"", "\"\"")}"`;

async function sqlite(run: CommandRunner, file: string, sql: string): Promise<Record<string, unknown>[]> {
  const output = await run(sqlite3, ["-json", file, sql], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
  return output.trim() ? JSON.parse(output) : [];
}

function keyValueEntries(rows: Record<string, unknown>[]): ParsedEntry[] {
  return rows.map(row => {
    const value = row.value === null || row.value === undefined ? null : String(row.value);
    if (value === null) return { key: String(row.key), type: "null", value: "null", bytes: 0 };
    return { key: String(row.key), type: jsonType(value) ?? "string", value, bytes: Buffer.byteLength(value) };
  });
}

// AsyncStorage tables are recognized by name: v1/v2 use catalystLocalStorage, v2's next storage a Room
// table named Storage, and v3 an `entries` table under async-storage/databases/.
async function readSqlite(container: AppContainer, candidate: StoreCandidate, run: CommandRunner): Promise<StoreContent & { asyncStorage?: boolean }> {
  return withTemporaryDirectory(async directory => {
    // The copy includes the write-ahead log, so recent writes that SQLite has not checkpointed are read too.
    await container.copy(candidate.files, directory);
    const file = join(directory, candidate.name);
    let tables: string[];
    try { tables = (await sqlite(run, file, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map(row => String(row.name)); }
    catch { return { status: "unreadable", note: "Not a readable SQLite database.", entries: [] }; }
    const keyValueTable = tables.includes("catalystLocalStorage") ? "catalystLocalStorage"
      : tables.includes("entries") && candidate.path.includes("async-storage/") ? "entries"
      : tables.includes("Storage") && /^AsyncStorage/.test(candidate.name) ? "Storage" : undefined;
    if (keyValueTable) {
      const rows = await sqlite(run, file, `SELECT key, value FROM ${quoteIdentifier(keyValueTable)}`);
      return { status: "ok", entries: keyValueEntries(rows), asyncStorage: true };
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
    if (value === null) return { key, type: "null", value: "null", bytes: 0 };
    return { key, type: jsonType(value) ?? "string", value, bytes: Buffer.byteLength(value) };
  }));
  return { status: "ok", entries };
}

async function readStore(container: AppContainer, candidate: StoreCandidate, run: CommandRunner): Promise<StoreContent & { asyncStorage?: boolean }> {
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

export async function readStorage(container: AppContainer, { entries: entryLimit, valueLength, bundleId, run }: ReadOptions): Promise<StorageSnapshot> {
  const files = await container.list();
  const sizes = new Map(files.map(file => [file.path, file.bytes]));
  const candidates = classifyFiles(files.map(file => file.path), container.platform);
  const owner = new Map<string, string>();
  const stores = await mapLimited(candidates, 4, async (candidate): Promise<StorageStore> => {
    const id = storeId(candidate);
    for (const file of candidate.files) owner.set(file, id);
    let content: StoreContent & { asyncStorage?: boolean };
    try { content = await readStore(container, candidate, run); }
    catch (error) {
      if (error instanceof ExpectedOperationError) throw error;
      content = { status: "unreadable", note: "This file could not be read or parsed.", entries: [] };
    }
    const kind = content.asyncStorage ? "async-storage" : candidate.kind;
    return {
      id, kind, name: candidate.name, path: candidate.path, status: content.status, ...content.note ? { note: content.note } : {},
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

// Store IDs are matched against a fresh listing, so a caller can only remove files that belong to a found store.
export async function clearStore(container: AppContainer, id: string) {
  const files = await container.list();
  const candidate = classifyFiles(files.map(file => file.path), container.platform).find(store => storeId(store) === id);
  if (candidate === undefined) throw new ExpectedOperationError("invalid_input", "That storage no longer exists. Refresh and try again.");
  if (candidate.kind === "user-defaults" && container.forgetPreferences) await container.forgetPreferences(candidate.path);
  await container.remove(candidate.files);
  return candidate;
}
