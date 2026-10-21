import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExpectedOperationError } from "../../shared/error-reporting.ts";
import type { StorageFilePreview } from "../../shared/app-storage.ts";
import { withTemporaryDirectory } from "../app-control/commands.ts";
import type { CommandRunner } from "../app-control/commands.ts";
import type { AppContainer } from "./container.ts";
import { parsePlistValue, plainPlist } from "./formats.ts";

type PreviewOptions = { maxBytes: number; maxLength: number; hexBytes: number; run: CommandRunner };

const utf8 = new TextDecoder("utf-8", { fatal: true });
function text(bytes: Buffer) {
  try {
    const value = utf8.decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? undefined : value;
  } catch { return undefined; }
}

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
    if (Array.isArray(value["NS.keys"]) && Array.isArray(value["NS.objects"])) {
      const values = value["NS.objects"];
      return Object.fromEntries((value["NS.keys"] as unknown[]).map((key, index) => [String(resolve(key, path)), resolve(values[index], path)]));
    }
    if (Array.isArray(value["NS.objects"])) return resolve(value["NS.objects"], path);
    if (typeof value["NS.string"] === "string") return value["NS.string"];
    // NSDate stores seconds since 2001-01-01.
    if (typeof value["NS.time"] === "number") return new Date((value["NS.time"] + 978307200) * 1000).toISOString();
    if (value["NS.data"] !== undefined) return value["NS.data"];
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$class").map(([key, child]) => [key, resolve(child, path)]));
  };
  const top = isRecord(archive.$top) ? archive.$top : {};
  return resolve("root" in top ? top.root : top, new Set());
}

async function plistXml(bytes: Buffer, run: CommandRunner) {
  if (bytes.subarray(0, 6).toString("latin1") !== "bplist") return bytes.toString("utf8");
  if (process.platform !== "darwin") return undefined;
  return withTemporaryDirectory(async directory => {
    const file = join(directory, "preview.plist");
    await writeFile(file, bytes);
    return run("plutil", ["-convert", "xml1", "-o", "-", file], { timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
  });
}

// A file from the app's data directory, decoded by its contents rather than its name.
export async function previewFile(container: AppContainer, path: string, { maxBytes, maxLength, hexBytes, run }: PreviewOptions): Promise<StorageFilePreview> {
  const file = (await container.list()).find(item => item.path === path);
  if (file === undefined) throw new ExpectedOperationError("invalid_input", "That file no longer exists. Refresh and try again.");
  const shown = (format: StorageFilePreview["format"], content: string): StorageFilePreview => ({
    path, bytes: file.bytes, format, content: content.length > maxLength ? content.slice(0, maxLength) : content, truncated: content.length > maxLength,
  });
  if (file.bytes > maxBytes) return { path, bytes: file.bytes, format: "binary", content: "", truncated: true };
  const bytes = await container.read(path);
  const head = bytes.subarray(0, 64).toString("latin1");
  if (head.startsWith("bplist") || (head.startsWith("<?xml") && bytes.includes("<plist"))) {
    const xml = await plistXml(bytes, run).catch(() => undefined);
    const value = xml === undefined ? undefined : (() => { try { return plainPlist(parsePlistValue(xml)); } catch { return undefined; } })();
    if (isRecord(value) && value.$archiver === "NSKeyedArchiver") return shown("archive", JSON.stringify(unarchive(value), null, 2));
    if (value !== undefined) return shown("plist", JSON.stringify(value, null, 2));
  }
  const content = text(bytes);
  if (content !== undefined) {
    try { return shown("json", JSON.stringify(JSON.parse(content), null, 2)); }
    catch { return shown("text", content); }
  }
  const hex = bytes.subarray(0, hexBytes).toString("hex");
  return { ...shown("binary", hex), truncated: bytes.length > hexBytes };
}
