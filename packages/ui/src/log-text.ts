import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { LogRecord } from "@mobile-dev/shared/logs.ts";

/** A log as one line of text: its tag or process, then `message` (the log's own by default). */
export function logLine(log: Pick<LogRecord, "tag" | "process" | "message">, message = log.message) {
  const prefix = log.tag || log.process;
  return `${prefix ? `${prefix}: ` : ""}${message}`;
}

export function levelIcon(level: LogRecord["level"]) {
  return level === "error" ? CircleAlertIcon : level === "warn" ? TriangleAlertIcon : InfoIcon;
}

/** Errors and warnings ask chat for a fix; other logs ask about them. */
export function chatActionLabel(level: LogRecord["level"]) {
  return level === "error" || level === "warn" ? "Fix in chat" : "Ask in chat";
}

const frame = /^[ \t]*at (?:.+? \()?(?:[^\d\s:]\S*:\d+(?::\d+)?|native|<anonymous>)\)?[ \t]*$/;
const namedFrame = /^[ \t]*at [^\r\n]+$/;
const frameLocation = /^[ \t]*\(\S+:\d+(?::\d+)?\)[ \t]*$/;
const jscFrame = /^[ \t]*[^@\s]*@\S+:\d+(?::\d+)?[ \t]*$/;

// Error descriptions may include their own stack as well as Metro's call site.
// Split only the displayed text; the original log still drives search and actions.
export function logText(log: Pick<LogRecord, "message" | "stack">) {
  if (!log.message.includes("\n")) return { message: log.message, stack: log.stack };
  const lines = log.message.split("\n");
  const start = lines.findIndex((line, index) => {
    if (index === 0) return false;
    const text = line.trimEnd();
    return frame.test(text) || jscFrame.test(text)
      || (namedFrame.test(text) && frameLocation.test(lines[index + 1]?.trimEnd() ?? ""));
  });
  if (start === -1) return { message: log.message, stack: log.stack };
  const message = lines.slice(0, start).join("\n").trimEnd();
  const embedded = lines.slice(start).join("\n");
  const stack = log.stack && log.stack.trim() !== embedded.trim() ? `${embedded}\n${log.stack}` : embedded;
  return { message, stack };
}
