import type { EntryType, StoreKind } from "../../shared/app-storage.ts";
import { jsonType, readVarint } from "./mmkv.ts";

export type ParsedEntry = { key: string; type: EntryType; value: string; bytes: number; guessed?: boolean };

// Text that parses as a JSON object or array is typed json, so the panel can show it as a tree.
export const textEntry = (key: string, value: string, bytes = Buffer.byteLength(value)): ParsedEntry => ({ key, type: jsonType(value) ?? "string", value, bytes });
export const nullEntry = (key: string): ParsedEntry => ({ key, type: "null", value: "null", bytes: 0 });

// ---- Property lists (UserDefaults), parsed from the XML that `defaults export` and `plutil -convert xml1` print.

class PlistData { readonly bytes: Buffer; constructor(bytes: Buffer) { this.bytes = bytes; } }
class PlistDate { readonly iso: string; constructor(iso: string) { this.iso = iso; } }
type PlistValue = string | number | bigint | boolean | PlistData | PlistDate | PlistValue[] | { [key: string]: PlistValue };

const entities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
function unescapeXml(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (match, name: string) => {
    if (name[0] !== "#") return entities[name.toLowerCase()] ?? match;
    const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

type Token = { tag: string; close: boolean; empty: boolean } | { text: string };
function tokens(xml: string): Token[] {
  const body = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, "");
  const result: Token[] = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z]+)(?:\s[^>]*?)?(\/?)>|([^<]+)/g)) {
    if (match[4] !== undefined) result.push({ text: match[4] });
    else result.push({ tag: match[2], close: match[1] === "/", empty: match[3] === "/" });
  }
  return result;
}

export function parsePlistXml(xml: string): Record<string, PlistValue> {
  const list = tokens(xml);
  let index = 0;
  const next = () => list[index++];
  const skipText = () => { while (index < list.length && "text" in list[index] && /^\s*$/.test((list[index] as { text: string }).text)) index++; };
  const textUntil = (tag: string) => {
    let text = "";
    for (let token = next(); token !== undefined; token = next()) {
      if ("text" in token) text += token.text;
      else if (token.close && token.tag === tag) return unescapeXml(text);
    }
    throw new Error(`Unclosed <${tag}>.`);
  };
  const value = (): PlistValue => {
    skipText();
    const token = next();
    if (token === undefined || "text" in token || token.close) throw new Error("Expected a plist value.");
    const { tag, empty } = token;
    if (tag === "true" || tag === "false") return tag === "true";
    if (tag === "dict") {
      const dict: Record<string, PlistValue> = {};
      if (empty) return dict;
      for (;;) {
        skipText();
        const key = next();
        if (key === undefined || "text" in key) throw new Error("Expected a dict key.");
        if (key.close && key.tag === "dict") return dict;
        dict[key.empty ? "" : textUntil("key")] = value();
      }
    }
    if (tag === "array") {
      const array: PlistValue[] = [];
      if (empty) return array;
      for (;;) {
        skipText();
        const peek = list[index];
        if (peek && !("text" in peek) && peek.close && peek.tag === "array") { index++; return array; }
        array.push(value());
      }
    }
    const text = empty ? "" : textUntil(tag);
    if (tag === "string") return text;
    if (tag === "integer") return Number.isSafeInteger(Number(text)) ? Number(text) : BigInt(text.trim());
    if (tag === "real") return Number(text);
    if (tag === "date") return new PlistDate(text.trim());
    if (tag === "data") return new PlistData(Buffer.from(text.replace(/\s+/g, ""), "base64"));
    throw new Error(`Unsupported plist element <${tag}>.`);
  };
  skipText();
  const root = next();
  if (root === undefined || "text" in root || root.tag !== "plist") throw new Error("Not a property list.");
  if (root.empty) return {};
  const top = value();
  if (typeof top !== "object" || top === null || Array.isArray(top) || top instanceof PlistData || top instanceof PlistDate || typeof top === "bigint") throw new Error("The property list root is not a dictionary.");
  return top;
}

function plainPlist(value: PlistValue): unknown {
  if (value instanceof PlistData) return `<${value.bytes.length} bytes>`;
  if (value instanceof PlistDate) return value.iso;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plainPlist);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainPlist(child)]));
  return value;
}

export function plistEntries(dict: Record<string, PlistValue>): ParsedEntry[] {
  return Object.entries(dict).map(([key, value]) => {
    if (value instanceof PlistData) return { key, type: "data", value: value.bytes.toString("hex"), bytes: value.bytes.length };
    if (value instanceof PlistDate) return { key, type: "date", value: value.iso, bytes: value.iso.length };
    if (typeof value === "boolean") return { key, type: "boolean", value: String(value), bytes: 1 };
    if (typeof value === "bigint") return { key, type: "integer", value: value.toString(), bytes: 8 };
    if (typeof value === "number") return { key, type: Number.isInteger(value) ? "integer" : "number", value: String(value), bytes: 8 };
    if (typeof value === "string") return textEntry(key, value);
    const json = JSON.stringify(plainPlist(value));
    return { key, type: Array.isArray(value) ? "array" : "object", value: json, bytes: Buffer.byteLength(json) };
  });
}

// ---- Android SharedPreferences XML.

export function parseSharedPreferences(xml: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const body = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, "");
  const element = /<(string|boolean|int|long|float|null|set)\s+name="([^"]*)"(?:\s+value="([^"]*)")?\s*(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const match of body.matchAll(element)) {
    const [, tag, rawName, rawValue, content = ""] = match;
    const key = unescapeXml(rawName);
    if (tag === "string") entries.push(textEntry(key, unescapeXml(content)));
    else if (tag === "set") {
      const items = [...content.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(item => unescapeXml(item[1]));
      const value = JSON.stringify(items);
      entries.push({ key, type: "array", value, bytes: Buffer.byteLength(value) });
    } else if (tag === "null") entries.push(nullEntry(key));
    else {
      const value = unescapeXml(rawValue ?? "");
      const type: EntryType = tag === "boolean" ? "boolean" : tag === "float" ? "number" : "integer";
      entries.push({ key, type, value, bytes: tag === "long" ? 8 : tag === "boolean" ? 1 : 4 });
    }
  }
  return entries;
}

// ---- Jetpack DataStore Preferences: protobuf PreferenceMap { map<string, Value> preferences = 1; }.

type Field = { number: number; wire: number; varint?: bigint; bytes?: Buffer };
function fields(buffer: Buffer): Field[] {
  const result: Field[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    if (tag === undefined) throw new Error("Truncated protobuf tag.");
    offset = tag.next;
    const number = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (wire === 0) {
      const value = readVarint(buffer, offset);
      if (value === undefined) throw new Error("Truncated protobuf varint.");
      result.push({ number, wire, varint: value.value });
      offset = value.next;
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      if (length === undefined) throw new Error("Truncated protobuf length.");
      const end = length.next + Number(length.value);
      if (end > buffer.length) throw new Error("Protobuf field runs past the end.");
      result.push({ number, wire, bytes: buffer.subarray(length.next, end) });
      offset = end;
    } else if (wire === 5 || wire === 1) {
      const size = wire === 5 ? 4 : 8;
      if (offset + size > buffer.length) throw new Error("Truncated protobuf fixed field.");
      result.push({ number, wire, bytes: buffer.subarray(offset, offset + size) });
      offset += size;
    } else throw new Error(`Unsupported protobuf wire type ${wire}.`);
  }
  return result;
}

export function parseDataStorePreferences(buffer: Buffer): ParsedEntry[] {
  return fields(buffer).filter(field => field.number === 1 && field.bytes).flatMap(field => {
    const pair = fields(field.bytes!);
    const key = pair.find(item => item.number === 1)?.bytes?.toString("utf8");
    const value = pair.find(item => item.number === 2)?.bytes;
    if (key === undefined || value === undefined) return [];
    const [inner] = fields(value);
    if (inner === undefined) return [nullEntry(key)];
    const entry = (type: EntryType, text: string, bytes: number): ParsedEntry => ({ key, type, value: text, bytes });
    switch (inner.number) {
      case 1: return [entry("boolean", String(inner.varint === 1n), 1)];
      case 2: return [entry("number", String(inner.bytes!.readFloatLE(0)), 4)];
      case 3: return [entry("integer", BigInt.asIntN(32, inner.varint!).toString(), 4)];
      case 4: return [entry("integer", BigInt.asIntN(64, inner.varint!).toString(), 8)];
      case 5: return [textEntry(key, inner.bytes!.toString("utf8"), inner.bytes!.length)];
      case 6: { const json = JSON.stringify(fields(inner.bytes!).map(item => item.bytes?.toString("utf8") ?? "")); return [entry("array", json, Buffer.byteLength(json))]; }
      case 7: return [entry("number", String(inner.bytes!.readDoubleLE(0)), 8)];
      case 8: return [entry("data", inner.bytes!.toString("hex"), inner.bytes!.length)];
      default: return [];
    }
  });
}

// ---- Classifying files in the data directory.

export type StoreCandidate = { kind: StoreKind; name: string; path: string; files: string[] };

// System caches the app does not write itself; they stay in the file list but are not shown as databases.
const systemPaths = /^(?:Library\/(?:Caches|HTTPStorages|WebKit|Cookies|SplashBoard|Saved Application State)\/|SystemData\/|cache\/|code_cache\/|app_webview\/|no_backup\/androidx\.work)/;
const sqliteSuffix = /-(?:wal|shm|journal)$/;

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export function classifyFiles(paths: readonly string[], platform: "ios" | "android"): StoreCandidate[] {
  const all = new Set(paths);
  const stores: StoreCandidate[] = [];
  for (const path of paths) {
    const name = basename(path);
    const directory = dirname(path);
    // An MMKV instance is a data file with a `.crc` file next to it, wherever the app placed it.
    if (name.endsWith(".crc") && all.has(path.slice(0, -4))) {
      stores.push({ kind: "mmkv", name: name.slice(0, -4), path: path.slice(0, -4), files: [path.slice(0, -4), path] });
      continue;
    }
    if (platform === "ios" && directory === "Library/Preferences" && name.endsWith(".plist")) {
      stores.push({ kind: "user-defaults", name: name.slice(0, -6), path, files: [path] });
      continue;
    }
    if (name === "manifest.json" && /^RCTAsyncLocalStorage/.test(basename(directory))) {
      stores.push({ kind: "async-storage", name: directory.includes("ExponentExperienceData/") ? directory.split("/").at(-2) ?? "default" : "default", path, files: paths.filter(file => dirname(file) === directory) });
      continue;
    }
    if (directory.endsWith("shared_prefs") && name.endsWith(".xml")) {
      stores.push({ kind: "shared-preferences", name: name.slice(0, -4), path, files: [path, ...all.has(`${path}.bak`) ? [`${path}.bak`] : []] });
      continue;
    }
    if (name.endsWith(".preferences_pb")) {
      stores.push({ kind: "datastore", name: name.slice(0, -".preferences_pb".length), path, files: [path] });
      continue;
    }
    if (name.endsWith(".realm")) {
      const related = paths.filter(file => file !== path && (file.startsWith(`${path}.`) || file.startsWith(`${path}.management/`)));
      stores.push({ kind: "realm", name: name.slice(0, -6), path, files: [path, ...related] });
      continue;
    }
    const sqliteName = platform === "android" ? directory === "databases" && !sqliteSuffix.test(name) && !name.endsWith(".bak") : /\.(?:db|sqlite3?|sql)$/i.test(name);
    if ((sqliteName || /\.(?:db|sqlite3?)$/i.test(name)) && !systemPaths.test(path)) {
      stores.push({ kind: "sqlite", name, path, files: [path, ...["-wal", "-shm", "-journal"].map(suffix => path + suffix).filter(file => all.has(file))] });
    }
  }
  return stores;
}

export function storeId(candidate: Pick<StoreCandidate, "kind" | "path">) { return `${candidate.kind}:${candidate.path}`; }
