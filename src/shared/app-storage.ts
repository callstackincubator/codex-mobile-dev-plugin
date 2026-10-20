import { z } from "zod";

// Storage the panel recognizes from files in the app's data directory, without code in the app.
export const storeKinds = ["mmkv", "async-storage", "user-defaults", "shared-preferences", "datastore", "sqlite", "realm"] as const;
export type StoreKind = typeof storeKinds[number];
export const storeKindLabels: Record<StoreKind, string> = {
  "mmkv": "MMKV", "async-storage": "AsyncStorage", "user-defaults": "UserDefaults", "shared-preferences": "SharedPreferences",
  "datastore": "DataStore", "sqlite": "SQLite", "realm": "Realm",
};

export const entryTypes = ["string", "json", "number", "integer", "boolean", "date", "data", "array", "object", "null", "table"] as const;
export type EntryType = typeof entryTypes[number];

// Values arrive as display text: JSON for json, arrays and objects, hex for data. `guessed` marks a type
// inferred from bytes, because MMKV files do not record value types.
const entry = z.object({
  key: z.string(),
  type: z.enum(entryTypes),
  value: z.string(),
  bytes: z.number().int().nonnegative(),
  guessed: z.boolean().optional(),
  truncated: z.boolean().optional(),
});
export type StorageEntry = z.infer<typeof entry>;

// `encrypted` stores are found but cannot be read without the app's key; `unreadable` ones failed to parse.
export const storeStatuses = ["ok", "encrypted", "unreadable"] as const;
const store = z.object({
  id: z.string(),
  kind: z.enum(storeKinds),
  name: z.string(),
  path: z.string(),
  status: z.enum(storeStatuses),
  note: z.string().optional(),
  bytes: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  entries: z.array(entry),
});
export type StorageStore = z.infer<typeof store>;

const file = z.object({ path: z.string(), bytes: z.number().int().nonnegative(), store: z.string().optional() });
export type StorageFile = z.infer<typeof file>;

export const storageSnapshotSchema = z.object({
  platform: z.enum(["ios", "android"]),
  bundleId: z.string(),
  readAt: z.number(),
  stores: z.array(store),
  // Largest files first, capped; fileCount and totalBytes cover the whole data directory.
  files: z.array(file),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});
export type StorageSnapshot = z.infer<typeof storageSnapshotSchema>;

export const storageClearSchema = z.object({ cleared: z.string(), stopped: z.boolean() });

// Defaults keep model-visible results small; the panel asks for more.
export const storageLimits = { entries: 200, maxEntries: 2000, valueLength: 300, maxValueLength: 16000, files: 400 };

// One page of rows from a SQLite table. Cells are text, numbers, or null; blobs arrive as x'…' hex.
const tableCell = z.union([z.string(), z.number(), z.null()]);
export const storageTableSchema = z.object({
  table: z.string(),
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.array(tableCell)),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});
export type StorageTable = z.infer<typeof storageTableSchema>;
export const tablePageSize = 100;
