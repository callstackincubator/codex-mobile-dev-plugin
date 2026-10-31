import type { ReactNode } from "react";
import { Alert, AlertDescription } from "./ui/alert";

/** An error across the full width of a panel, under its toolbar. `textClassName` styles the message. */
export function BannerAlert({ id, textClassName, children }: { id?: string; textClassName?: string; children: ReactNode }) {
  return <Alert id={id} variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className={textClassName}>{children}</AlertDescription></Alert>;
}
