import { execText } from "./exec.ts";
import type {
  AccessibilityNode,
  AccessibilitySelector,
  AccessibilitySnapshot,
} from "./shared/api-contracts.ts";

export type {
  AccessibilityNode,
  AccessibilitySelector,
  AccessibilitySnapshot,
} from "./shared/api-contracts.ts";

const SELECTOR_STRING_FIELDS = [
  "id",
  "text",
  "textContains",
  "contentDescription",
  "contentDescriptionContains",
  "resourceId",
  "resourceIdContains",
  "className",
  "packageName",
] as const;
const MAX_SELECTOR_TEXT_BYTES = 512;
const DUMP_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectorString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty`);
  if (Buffer.byteLength(trimmed, "utf8") > MAX_SELECTOR_TEXT_BYTES) {
    throw new Error(`${name} is too long`);
  }
  return trimmed;
}

function selectorBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function selectorIndex(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("index must be a non-negative integer");
  }
  return value;
}

export function parseAccessibilitySelector(value: unknown): AccessibilitySelector {
  if (!isRecord(value)) throw new Error("selector must be an object");
  const selector: AccessibilitySelector = {};
  const strings = {
    id: selectorString(value.id, "id"),
    text: selectorString(value.text, "text"),
    textContains: selectorString(value.textContains, "textContains"),
    contentDescription: selectorString(value.contentDescription, "contentDescription"),
    contentDescriptionContains: selectorString(
      value.contentDescriptionContains,
      "contentDescriptionContains",
    ),
    resourceId: selectorString(value.resourceId, "resourceId"),
    resourceIdContains: selectorString(value.resourceIdContains, "resourceIdContains"),
    className: selectorString(value.className, "className"),
    packageName: selectorString(value.packageName, "packageName"),
  };
  for (const field of SELECTOR_STRING_FIELDS) {
    if (strings[field] !== undefined) selector[field] = strings[field];
  }
  const clickable = selectorBoolean(value.clickable, "clickable");
  const enabled = selectorBoolean(value.enabled, "enabled");
  const index = selectorIndex(value.index);
  if (clickable !== undefined) selector.clickable = clickable;
  if (enabled !== undefined) selector.enabled = enabled;
  if (index !== undefined) selector.index = index;
  const hasMatcher =
    SELECTOR_STRING_FIELDS.some((field) => selector[field] !== undefined) ||
    selector.clickable !== undefined ||
    selector.enabled !== undefined;
  if (!hasMatcher) throw new Error("selector must include at least one matcher");
  return selector;
}

function matchesSelector(node: AccessibilityNode, selector: AccessibilitySelector): boolean {
  if (selector.id !== undefined && node.id !== selector.id) return false;
  if (selector.text !== undefined && node.text !== selector.text) return false;
  if (selector.textContains !== undefined && !node.text.includes(selector.textContains)) return false;
  if (
    selector.contentDescription !== undefined &&
    node.contentDescription !== selector.contentDescription
  ) {
    return false;
  }
  if (
    selector.contentDescriptionContains !== undefined &&
    !node.contentDescription.includes(selector.contentDescriptionContains)
  ) {
    return false;
  }
  if (selector.resourceId !== undefined && node.resourceId !== selector.resourceId) return false;
  if (
    selector.resourceIdContains !== undefined &&
    !node.resourceId.includes(selector.resourceIdContains)
  ) {
    return false;
  }
  if (selector.className !== undefined && node.className !== selector.className) return false;
  if (selector.packageName !== undefined && node.packageName !== selector.packageName) return false;
  if (selector.clickable !== undefined && node.clickable !== selector.clickable) return false;
  if (selector.enabled !== undefined && node.enabled !== selector.enabled) return false;
  return true;
}

export function findAccessibilityNode(
  nodes: AccessibilityNode[],
  selector: AccessibilitySelector,
): AccessibilityNode {
  const matches = nodes.filter((node) => matchesSelector(node, selector));
  if (matches.length === 0) throw new Error("no accessibility node matched selector");
  if (selector.index !== undefined) {
    const node = matches[selector.index];
    if (!node) throw new Error(`selector matched ${matches.length} nodes, index is out of range`);
    return node;
  }
  if (matches.length > 1) {
    throw new Error(`selector matched ${matches.length} nodes; provide index to disambiguate`);
  }
  return matches[0]!;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrsFor(node: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of node.matchAll(/\s([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
    attrs[match[1]!] = decodeXml(match[2] ?? "");
  }
  return attrs;
}

function parseBounds(value: string | undefined) {
  const match = value?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

function boolAttr(value: string | undefined): boolean {
  return value === "true";
}

async function dumpXml(serial: string, signal?: AbortSignal): Promise<string> {
  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("accessibility request aborted");
  };
  throwIfAborted();
  const path = `/sdcard/window-${Date.now()}.xml`;
  let lastError = "uiautomator dump failed";
  for (let attempt = 1; attempt <= DUMP_ATTEMPTS; attempt++) {
    const dump = await execText("adb", ["-s", serial, "shell", "uiautomator", "dump", path], {
      timeout: 8_000,
      signal,
      lane: "interactive",
    });
    throwIfAborted();
    if (dump.status !== 0 || dump.error) {
      lastError = (
        dump.stderr ||
        dump.error?.message ||
        dump.stdout ||
        `uiautomator dump failed with status ${dump.status}`
      ).trim();
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      continue;
    }
    const result = await execText("adb", ["-s", serial, "shell", "cat", path], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 8_000,
      signal,
      lane: "interactive",
    });
    throwIfAborted();
    void execText("adb", ["-s", serial, "shell", "rm", path], { timeout: 2_000 });
    if (result.status === 0 && !result.error) return result.stdout;
    lastError = (
      result.stderr ||
      result.error?.message ||
      result.stdout ||
      "uiautomator dump read failed"
    ).trim();
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
  }
  void execText("adb", ["-s", serial, "shell", "rm", path], { timeout: 2_000 });
  throw new Error(lastError);
}

export async function getAccessibilitySnapshot(
  serial: string,
  signal?: AbortSignal,
): Promise<AccessibilitySnapshot> {
  const xml = await dumpXml(serial, signal);
  return {
    ok: true,
    capturedAt: new Date().toISOString(),
    nodes: parseAccessibilityXml(xml),
  };
}

/** Parse a uiautomator XML dump without requiring a live Android device. */
export function parseAccessibilityXml(xml: string): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];
  let index = 0;
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const attrs = attrsFor(match[0]);
    const bounds = parseBounds(attrs.bounds);
    if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) continue;
    nodes.push({
      id: `${index++}`,
      text: attrs.text ?? "",
      contentDescription: attrs["content-desc"] ?? "",
      resourceId: attrs["resource-id"] ?? "",
      className: attrs.class ?? "",
      packageName: attrs.package ?? "",
      clickable: boolAttr(attrs.clickable),
      enabled: boolAttr(attrs.enabled),
      bounds,
    });
  }
  return nodes;
}
