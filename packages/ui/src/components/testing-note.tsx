import type { ReactNode } from "react";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";

/**
 * A short note in the Testing Studio panel: "info" explains how something works, "warning" says why
 * something cannot run as it is. Both are boxed with an icon so they do not read as body text, and
 * the one thing to do about it, if there is one, sits inside the note as its `action`.
 */
export function TestingNote({ tone = "info", icon, action, children, ...attributes }: {
  tone?: "info" | "warning"; icon?: ReactNode; action?: ReactNode; children: ReactNode;
} & Record<`data-${string}`, string | boolean | number | undefined>) {
  const warning = tone === "warning";
  const Icon = warning ? TriangleAlertIcon : InfoIcon;
  return <div role="note" {...attributes}
    className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border px-2.5 py-2 text-xs leading-4 ${warning
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "border-border bg-muted/40 text-muted-foreground"}`}>
    <span className="flex min-w-0 flex-1 basis-48 items-start gap-2">
      {icon ?? <Icon className="mt-px size-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0">{children}</span>
    </span>
    {action && <span className="ml-auto flex shrink-0 items-center gap-1.5">{action}</span>}
  </div>;
}
