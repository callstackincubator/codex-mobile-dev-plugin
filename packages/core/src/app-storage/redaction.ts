import type { StorageEntry } from "@mobile-dev/shared/app-storage.ts";
import type { ParsedEntry } from "./formats.ts";

export const REDACTED = "[REDACTED]";
const maxText = 1_000_000;
const maxDepth = 16;
const maxNodes = 10_000;

// Conservative field-name matching, including common personal-data fields. This
// is defense in depth, not a guarantee that arbitrary app data is non-sensitive.
export function sensitiveStorageName(name: string): boolean {
  const normalized = name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
  return /password|passwd|passphrase|pwd|secret|token|credential|auth|cookie|session|apikey|privatekey|signingkey|encryptionkey|accesskey|clientkey|email|phone|address|birth|socialsecurity|ssn|creditcard|cardnumber|cvv|medical|health/.test(normalized);
}

export function sensitiveStorageText(text: string): boolean {
  return /\b(?:bearer|basic)\s+\S+/i.test(text)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
    || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/.test(text)
    || /\b(?:gh[pousr]_|github_pat_|sk-(?:proj-|live_|test_)?|AKIA|ASIA)[A-Za-z0-9_-]{8,}/.test(text)
    || /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i.test(text)
    || /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\b\s*[=:]/i.test(text)
    || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)
    // Opaque hex/base64/URL-safe strings can be encoded credentials. Do not decode
    // them for display, and do not expose a partial token through truncation.
    || /[A-Za-z0-9+/_=-]{32,}/.test(text);
}

export function sensitiveStoragePath(path: string): boolean {
  return path.split(/[\\/]/).some(part => sensitiveStorageText(part));
}

/** Sanitize the complete value before applying any display-length limit. */
export function redactStorageValue(name: string, value: unknown, binary = false): string | number | boolean | null {
  if (binary || sensitiveStorageName(name)) return REDACTED;
  let nodes = 0;
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > maxDepth) throw new Error("Storage value exceeds redaction limits");
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.length > maxText) throw new Error("Storage value exceeds redaction limits");
      const trimmed = value.trim();
      if (/^[{[\"]/.test(trimmed)) {
        let parsed: unknown;
        try { parsed = JSON.parse(trimmed); }
        catch { return REDACTED; } // Never inspect only a prefix of malformed/nested JSON.
        const safe = visit(parsed, depth + 1);
        return typeof safe === "string" ? safe : JSON.stringify(safe);
      }
      return sensitiveStorageText(value) ? REDACTED : value;
    }
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      sensitiveStorageText(key) ? REDACTED : key,
      sensitiveStorageName(key) || sensitiveStorageText(key) ? REDACTED : visit(item, depth + 1),
    ]));
    return REDACTED;
  }
  try {
    const safe = visit(value, 0);
    return typeof safe === "object" && safe !== null ? JSON.stringify(safe) : safe as string | number | boolean | null;
  } catch { return REDACTED; }
}

export function redactStorageEntry(entry: ParsedEntry, context = ""): StorageEntry {
  // Table entries are schema summaries, not cell values. Actual rows use the same
  // value filter in readTable. Keep table names so they remain selectable.
  const value = sensitiveStorageText(entry.key) ? REDACTED : entry.type === "table" ? (sensitiveStorageText(entry.value) ? REDACTED : entry.value)
    : String(redactStorageValue(`${context}.${entry.key}`, entry.value, entry.type === "data"));
  return { ...entry, key: sensitiveStorageText(entry.key) ? REDACTED : entry.key, value, ...(value === REDACTED ? { type: "string" as const } : {}) };
}
