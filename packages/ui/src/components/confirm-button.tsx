import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * A button that asks before it acts, in a popover anchored to itself. Shared by every panel with
 * a destructive control, so "clear this" reads and behaves the same wherever it appears.
 */
export function ConfirmButton({ children, title, description, action, disabled, onConfirm, className, variant = "ghost", size = "xs", id }: {
  children: ReactNode; title: string; description: string; action: string; disabled?: boolean;
  onConfirm: () => void; className?: string; variant?: "ghost" | "outline"; size?: "xs" | "sm"; id?: string;
}) {
  return <Popover>
    <PopoverTrigger asChild><Button id={id} variant={variant} size={size} aria-label={title} title={title} disabled={disabled} className={className}>{children}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(300px,calc(100vw-24px))] p-3 text-xs">
      <p className="mb-1 font-medium">{title}?</p>
      <p className="mb-3 text-muted-foreground">{description}</p>
      <div className="flex justify-end gap-2">
        <PopoverClose asChild><Button variant="ghost" size="xs">Cancel</Button></PopoverClose>
        <PopoverClose asChild><Button data-confirm variant="destructive" size="xs" onClick={onConfirm}>{action}</Button></PopoverClose>
      </div>
    </PopoverContent>
  </Popover>;
}
