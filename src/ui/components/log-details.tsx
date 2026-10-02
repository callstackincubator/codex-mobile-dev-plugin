import { CheckIcon, CircleAlertIcon, CopyIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { StackedLog } from "../../shared/logs";
import { logText } from "../log-text.ts";
import { Button } from "./ui/button";

function CopyField({ label, value }: { label: string; value: string }) {
  const [status, setStatus] = useState("");
  return <div className="flex items-center justify-between gap-2">
    <h3 className="font-mono text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title={status || `Copy ${label.toLowerCase()}`} aria-label={status || `Copy ${label.toLowerCase()}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setStatus("Copied"); }
      catch { setStatus("Could not copy"); }
    }}>{status === "Copied" ? <CheckIcon /> : <CopyIcon />}</Button>
    <span className="sr-only" role="status">{status}</span>
  </div>;
}

export function LogDetails({ log, onClose, children }: { log: StackedLog; onClose: () => void; children: React.ReactNode }) {
  const Icon = log.level === "error" ? CircleAlertIcon : log.level === "warn" ? TriangleAlertIcon : InfoIcon;
  const time = new Date(log.lastTimestamp).toLocaleTimeString(undefined, { hour12: false });
  const prefix = log.tag || log.process;
  const text = logText(log);
  const message = `${prefix ? `${prefix}: ` : ""}${text.message}`;
  return <aside id="log-detail" data-level={log.level} className="log-detail flex h-full min-w-0 flex-col overflow-hidden bg-card" aria-label="Selected log">
    <header className="log-detail-heading flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <Icon className="log-severity size-4" />
      <h2 className="text-sm font-semibold capitalize">{log.level === "warn" ? "Warning" : log.level}</h2>
      <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" onClick={onClose} aria-label="Close log details"><XIcon /></Button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <section className="flex flex-col gap-1"><CopyField label="Time" value={time} /><p className="font-mono text-xs tabular-nums select-text">{time}</p></section>
      <section className="flex flex-col gap-1"><CopyField label="Message" value={message} /><pre className="log-detail-message rounded-lg border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] select-text">{message}</pre></section>
      {text.stack && <section className="flex flex-col gap-1"><CopyField label="Stack trace" value={text.stack} /><pre className="log-detail-message rounded-lg border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] select-text">{text.stack}</pre></section>}
      <div className="mt-auto pt-1">{children}</div>
    </div>
  </aside>;
}
