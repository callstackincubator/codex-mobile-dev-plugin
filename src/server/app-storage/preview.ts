import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExpectedOperationError } from "../../shared/error-reporting.ts";
import { appleDate } from "../../shared/app-storage.ts";
import type { StorageFilePreview } from "../../shared/app-storage.ts";
import { withTemporaryDirectory } from "../app-control/commands.ts";
import type { CommandRunner } from "../app-control/commands.ts";
import type { AppContainer } from "./container.ts";
import { parsePlistValue, plainPlist } from "./formats.ts";
import { utf8Text } from "./encoding.ts";

type PreviewOptions = { maxBytes: number; maxLength: number; hexBytes: number; run: CommandRunner };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uid = (value: unknown) => isRecord(value) && Object.keys(value).length === 1 && typeof value["CF$UID"] === "number" ? value["CF$UID"] : undefined;

// NSKeyedArchiver flattens objects into $objects and links them by UID. Following the links from $top gives back the
// archived dictionaries, arrays, strings, and dates.
export function unarchive(archive: Record<string, unknown>): unknown {
  const objects = Array.isArray(archive.$objects) ? archive.$objects : [];
  const resolve = (value: unknown, path: ReadonlySet<number>): unknown => {
    const index = uid(value);
    if (index !== undefined) {
      if (path.has(index)) return "<cycle>";
      const target = objects[index];
      return target === "$null" ? null : resolve(target, new Set(path).add(index));
    }
    if (Array.isArray(value)) return value.map(item => resolve(item, path));
    if (!isRecord(value)) return value;
    const { "NS.keys": keys, "NS.objects": values, "NS.string": string, "NS.time": time, "NS.data": data } = value;
    if (Array.isArray(keys) && Array.isArray(values)) return Object.fromEntries(keys.map((key, index) => [String(resolve(key, path)), resolve(values[index], path)]));
    if (Array.isArray(values)) return resolve(values, path);
    if (typeof string === "string") return string;
    if (typeof time === "number") return appleDate(time);
    if (data !== undefined) return data;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$class").map(([key, child]) => [key, resolve(child, path)]));
  };
  const top = isRecord(archive.$top) ? archive.$top : {};
  return resolve("root" in top ? top.root : top, new Set());
}

// A property list as plain JSON. Binary plists need plutil, which only macOS has.
async function plistJson(bytes: Buffer, run: CommandRunner): Promise<unknown> {
  const binary = bytes.subarray(0, 6).toString("latin1") === "bplist";
  if (binary && process.platform !== "darwin") return undefined;
  try {
    const xml = binary ? await withTemporaryDirectory(async directory => {
      const file = join(directory, "preview.plist");
      await writeFile(file, bytes);
      return run("plutil", ["-convert", "xml1", "-o", "-", file], { timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
    }) : bytes.toString("utf8");
    return plainPlist(parsePlistValue(xml));
  } catch { return undefined; }
}

// A file from the app's data directory, decoded by its contents rather than its name.
export async function previewFile(container: AppContainer, path: string, { maxBytes, maxLength, hexBytes, run }: PreviewOptions): Promise<StorageFilePreview> {
  const file = (await container.list()).find(item => item.path === path);
  if (file === undefined) throw new ExpectedOperationError("invalid_input", "That file no longer exists. Refresh and try again.");
  const result = (format: StorageFilePreview["format"], content: string, truncated = content.length > maxLength): StorageFilePreview =>
    ({ path, bytes: file.bytes, format, content: content.slice(0, maxLength), truncated });
  if (file.bytes > maxBytes) return result("too-large", "", true);
  const bytes = await container.read(path);
  const head = bytes.subarray(0, 64).toString("latin1");
  if (head.startsWith("bplist") || (head.startsWith("<?xml") && bytes.includes("<plist"))) {
    const value = await plistJson(bytes, run);
    if (isRecord(value) && value.$archiver === "NSKeyedArchiver") return result("archive", JSON.stringify(unarchive(value), null, 2));
    if (value !== undefined) return result("plist", JSON.stringify(value, null, 2));
  }
  const content = utf8Text(bytes);
  if (content !== undefined) {
    try { return result("json", JSON.stringify(JSON.parse(content), null, 2)); }
    catch { return result("text", content); }
  }
  return result("binary", bytes.subarray(0, hexBytes).toString("hex"), bytes.length > hexBytes);
}
