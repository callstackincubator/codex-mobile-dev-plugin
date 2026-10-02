import type { LogRecord } from "../shared/logs.ts";
import { shouldExcludeIOSLog } from "./ios-log-filter.ts";

function level(value: unknown): LogRecord["level"] {
  switch (String(value).toLowerCase()) {
    case "e": case "f": case "error": case "err": case "fault": case "fatal": case "assert": return "error";
    case "w": case "warn": case "warning": return "warn";
    case "d": case "v": case "debug": case "trace": case "default": return "debug";
    default: return "info";
  }
}

function timestamp(value: unknown): string {
  const date = new Date(typeof value === "number" ? value : String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function parseIOSLog(line: string, hideSystemLogs = true): LogRecord | undefined {
  try {
    const data = JSON.parse(line);
    const message = data.eventMessage ?? data.message ?? data.composedMessage;
    if (typeof message !== "string" || !message) return;
    const messageType = data.messageType ?? data.logType;
    if (hideSystemLogs && shouldExcludeIOSLog(messageType, data.subsystem, data.senderImagePath)) return;
    const category = typeof data.category === "string" ? data.category : undefined;
    return {
      timestamp: timestamp(data.timestamp ?? data.time), level: level(messageType),
      source: category?.toLowerCase() === "javascript" ? "js" : "native", origin: "ios", message,
      process: typeof data.process === "string" ? data.process : typeof data.processImagePath === "string" ? data.processImagePath.split("/").at(-1) : undefined,
      pid: Number.isSafeInteger(data.processID) ? data.processID : undefined,
      subsystem: typeof data.subsystem === "string" ? data.subsystem : undefined, category,
    };
  } catch { return; }
}

export function parseLogcat(line: string): LogRecord | undefined {
  const match = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.+?):\s?(.*)$/);
  if (!match) return;
  const [, time, pid, , priority, tag, message] = match;
  const [month, day, hour, minute, second, millisecond] = time.split(/[-\s:.]/).map(Number);
  const now = new Date();
  const date = new Date(now.getFullYear(), month - 1, day, hour, minute, second, millisecond);
  if (date.getTime() - now.getTime() > 86400000) date.setFullYear(date.getFullYear() - 1);
  return { timestamp: date.toISOString(), level: level(priority), source: tag.trim() === "ReactNativeJS" ? "js" : "native", origin: "android", pid: Number(pid), tag: tag.trim(), message };
}

function remoteValue(value: Record<string, unknown>): string {
  if (value.value !== undefined) return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
  if (typeof value.unserializableValue === "string") return value.unserializableValue;
  if (typeof value.description === "string") return value.description;
  if (value.type === "undefined") return "undefined";
  return String(value.type ?? "object");
}

function stackTrace(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== "object" || depth > 8) return;
  const trace = value as { callFrames?: { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }[]; parent?: unknown };
  const frames = Array.isArray(trace.callFrames) ? trace.callFrames.slice(0, 60).map(frame =>
    `at ${frame.functionName || "<anonymous>"} (${frame.url || "<unknown>"}:${(frame.lineNumber ?? 0) + 1}:${(frame.columnNumber ?? 0) + 1})`) : [];
  if (trace.parent) frames.push(stackTrace(trace.parent, depth + 1) ?? "");
  return frames.join("\n") || undefined;
}

export function parseMetroEvent(event: { method?: string; params?: Record<string, any> }): LogRecord | undefined {
  const params = event.params;
  if (!params) return;
  if (event.method === "Runtime.consoleAPICalled") {
    return { timestamp: timestamp(params.timestamp), level: level(params.type), source: "js", origin: "metro",
      message: Array.isArray(params.args) ? params.args.map(remoteValue).join(" ") : "", stack: stackTrace(params.stackTrace) };
  }
  if (event.method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails;
    if (!details) return;
    return { timestamp: timestamp(params.timestamp), level: "error", source: "js", origin: "metro",
      message: details.exception ? remoteValue(details.exception) : String(details.text ?? "JavaScript exception"), stack: stackTrace(details.stackTrace) };
  }
}
