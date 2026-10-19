import { CheckIcon, ChevronDownIcon, CircleXIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { CrashMonitor } from "../crash-monitor.ts";
import { Button } from "./ui/button";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function CrashToast({ monitor }: { monitor: CrashMonitor }) {
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const { crash } = state;
  if (!crash) return null;
  const app = crash.process ?? crash.appId ?? "App";
  const reason = crash.reason ?? crash.message;
  const time = timeFormat.format(new Date(crash.lastTimestamp));
  return <div className="pointer-events-none absolute inset-x-3 top-3 z-40">
    <div id={`crash-toast-${crash.origin}`} role="alert" data-element="crash-notice"
      className="group/toast pointer-events-auto relative animate-in fade-in-0 slide-in-from-top-2 duration-300">
      <div className="relative overflow-hidden rounded-xl border border-border text-popover-foreground shadow-[0_4px_16px_-4px_rgb(0_0_0/0.12)]">
        <div className="relative flex items-center gap-3 bg-popover py-2.5 pr-2.5 pl-3">
          {/* Diagonal stripes fade in toward the actions. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[min(60%,420px)] bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--destructive)_6%,transparent))] [mask-image:linear-gradient(90deg,transparent,black_85%)]">
            <div className="size-full bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--destructive)_8%,transparent)_0_8px,transparent_8px_16px)]" />
          </div>
          <button type="button" className="relative min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none disabled:cursor-default" disabled={!crash.stack}
            aria-expanded={crash.stack ? state.expanded : undefined} title={crash.stack ? (state.expanded ? "Hide stack trace" : "Show stack trace") : undefined} onClick={() => monitor.toggleDetails()}>
            <span className="flex items-center gap-2">
              {/* Same --destructive as the stripes, at full strength. */}
              <CircleXIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span className="truncate text-[13px] leading-5 font-semibold" title={crash.appId}>{app} crashed</span>
              {crash.count > 1 && <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-label={`${crash.count} crashes`}>×{crash.count}</span>}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1 pl-6 text-xs leading-4 text-muted-foreground">
              <span className="truncate" title={reason}>{reason}</span>
              <span className="shrink-0 tabular-nums">· {time}</span>
              {!crash.stack && state.reportPending && <LoaderCircleIcon className="size-3 shrink-0 animate-spin" aria-label="Collecting stack trace" />}
              {crash.stack && <ChevronDownIcon className={`size-3.5 shrink-0 transition-transform duration-200 ${state.expanded ? "rotate-180" : ""}`} aria-hidden="true" />}
            </span>
          </button>
          <div className="relative flex shrink-0 items-center gap-1.5">
            {state.canSendMessage && <Button variant="outline" size="xs" className="shadow-xs" disabled={state.sending} onClick={() => void monitor.sendToChat()} title="Send this crash to chat and ask for a fix">Fix in chat</Button>}
            {state.canAttach && <Button variant="outline" size="xs" className="shadow-xs" disabled={state.attaching || state.attached} onClick={() => void monitor.attach()} title="Attach this crash and its stack trace to your next chat message">
              {state.attached && <CheckIcon data-icon="inline-start" />}{state.attached ? "Attached" : "Attach"}
            </Button>}
          </div>
        </div>
        {state.expanded && crash.stack && <pre className="relative max-h-56 overflow-auto border-t border-border rounded-b-[11px] bg-popover/90 backdrop-blur-2xl backdrop-saturate-150 px-3 py-2 font-mono text-[10px] leading-[1.45] text-foreground/80 whitespace-pre select-text animate-in fade-in-0 duration-200">{`${crash.message}\n\n${crash.stack}`}</pre>}
        {state.error && <p className="relative border-t border-border bg-popover px-3 py-1.5 text-xs text-destructive wrap-anywhere">{state.error}</p>}
      </div>
      <Button variant="outline" size="icon-xs" aria-label="Dismiss crash" title="Dismiss" onClick={() => monitor.dismiss()}
        className="absolute -top-2.5 -left-2.5 rounded-full text-muted-foreground opacity-0 shadow-xs transition-opacity group-hover/toast:opacity-100 focus-visible:opacity-100">
        <XIcon />
      </Button>
    </div>
  </div>;
}
