import type { StorageEntry, StorageStore } from "@mobile-dev/shared/app-storage.ts";

// Stores written by analytics, crash, and attribution SDKs rather than the app's own code.
const sdkStore = /^(?:APM|FIR|GUL|GDT|com\.(?:google|firebase|crashlytics|facebook|appsflyer|braze|segment|amplitude|mixpanel|onesignal|sentry|datadog|branch)|google[-_]|io\.branch|WebViewChromium|AppsFlyer|Branch|io\.sentry|com\.apple\.|expo\.modules\.)/i;
export const isSdkStore = (store: Pick<StorageStore, "name" | "path">) => sdkStore.test(store.name) || /\/(?:Google|com\.crashlytics|io\.sentry|com\.firebase)\//.test(store.path);

// The app's own preferences domain, MMKV's default instance, and AsyncStorage's Android database get plain names.
export function storeTitle(store: Pick<StorageStore, "kind" | "name">, bundleId: string) {
  if (store.kind === "user-defaults" && store.name === bundleId) return "Standard defaults";
  if (store.kind === "shared-preferences" && store.name === `${bundleId}_preferences`) return "Default preferences";
  if (store.kind === "mmkv" && store.name === "mmkv.default") return "Default instance";
  if (store.kind === "async-storage" && store.name === "RKStorage") return "default";
  return store.name;
}

// Plist and MMKV byte values often hold UTF-8 text such as JSON; show that text when every byte is printable.
export function bytesAsText(entry: StorageEntry): string | undefined {
  if (entry.type !== "data" || entry.value.length === 0 || entry.value.length % 2 !== 0) return undefined;
  const bytes = new Uint8Array(entry.value.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(entry.value.slice(index * 2, index * 2 + 2), 16);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]+$/.test(text) ? text : undefined;
  } catch { return undefined; }
}

export function parseJson(entry: StorageEntry): unknown {
  const text = entry.type === "data" ? bytesAsText(entry) : entry.value;
  if (text === undefined || entry.truncated || !/^\s*[[{]/.test(text)) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function relativeTime(iso: string, now = Date.now()) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return undefined;
  const seconds = (time - now) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return relative.format(Math.round(seconds), "second");
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// For JSON values, the fields that differ, so a change shows `count 30 → 31` instead of two whole objects.
export function changedFields(before: unknown, after: unknown): { path: string; before?: string; after?: string }[] | undefined {
  const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!object(before) || !object(after)) return undefined;
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ path: key, before: before[key] === undefined ? undefined : JSON.stringify(before[key]), after: after[key] === undefined ? undefined : JSON.stringify(after[key]) }));
  return fields.length > 0 && fields.length <= 3 ? fields : undefined;
}

export const clockTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

// An entry as a JSON value: parsed JSON, real booleans and numbers, and byte values as text when they are text.
export function plainValue(entry: StorageEntry): unknown {
  const parsed = parseJson(entry);
  if (parsed !== undefined) return parsed;
  if (entry.type === "boolean") return entry.value === "true";
  if (entry.type === "number" || entry.type === "integer") return Number(entry.value);
  if (entry.type === "data") return bytesAsText(entry) ?? entry.value;
  return entry.value;
}

export const storeJson = (store: Pick<StorageStore, "entries">) => JSON.stringify(Object.fromEntries(store.entries.map(entry => [entry.key, plainValue(entry)])), null, 2);
