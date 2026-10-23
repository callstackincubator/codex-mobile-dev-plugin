import { BracesIcon, DatabaseIcon, FolderIcon, LayersIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { StoreKind } from "../../shared/app-storage.ts";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./ui/popover";

// Class names stay literal so Tailwind finds them. A ring of the same hue keeps a chip's edge visible on grey rows.
const chipColors = {
  sky: { tone: "text-sky-600 dark:text-sky-400", tint: "bg-sky-100 dark:bg-sky-500/15 ring-1 ring-inset ring-sky-500/25" },
  amber: { tone: "text-amber-600 dark:text-amber-400", tint: "bg-amber-100 dark:bg-amber-500/15 ring-1 ring-inset ring-amber-500/25" },
  violet: { tone: "text-violet-600 dark:text-violet-400", tint: "bg-violet-100 dark:bg-violet-500/15 ring-1 ring-inset ring-violet-500/25" },
  emerald: { tone: "text-emerald-600 dark:text-emerald-400", tint: "bg-emerald-100 dark:bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/25" },
  rose: { tone: "text-rose-600 dark:text-rose-400", tint: "bg-rose-100 dark:bg-rose-500/15 ring-1 ring-inset ring-rose-500/25" },
  neutral: { tone: "text-neutral-600 dark:text-neutral-400", tint: "bg-neutral-100 dark:bg-neutral-500/15 ring-1 ring-inset ring-neutral-500/25" },
};
type ChipLook = { tone: string; tint: string; icon: LucideIcon };
const kindLook: Record<StoreKind, ChipLook> = {
  "user-defaults": { ...chipColors.sky, icon: LayersIcon },
  "shared-preferences": { ...chipColors.sky, icon: LayersIcon },
  "datastore": { ...chipColors.sky, icon: LayersIcon },
  "proto-datastore": { ...chipColors.sky, icon: LayersIcon },
  "mmkv": { ...chipColors.amber, icon: LayersIcon },
  "async-storage": { ...chipColors.violet, icon: BracesIcon },
  "sqlite": { ...chipColors.emerald, icon: DatabaseIcon },
  "realm": { ...chipColors.rose, icon: DatabaseIcon },
};
const filesLook: ChipLook = { ...chipColors.neutral, icon: FolderIcon };

const chipSizes = { sm: { box: "size-5", glyph: "size-3" }, md: { box: "size-6", glyph: "size-3.5" }, lg: { box: "size-7", glyph: "size-4" } };
type ChipProps = { size?: keyof typeof chipSizes; className?: string };

// Only the tint blends, so it takes on a hovered or selected row's grey while the icon keeps its color.
// Multiply darkens a light row; screen lightens a dark one.
function IconChip({ look: { tone, tint, icon: Icon }, size = "sm", className = "" }: ChipProps & { look: ChipLook }) {
  return <span className={`relative inline-flex shrink-0 items-center justify-center ${tone} ${chipSizes[size].box} ${className}`} aria-hidden="true">
    <span className={`absolute inset-0 rounded-md mix-blend-multiply dark:mix-blend-screen ${tint}`} />
    <Icon className={`relative ${chipSizes[size].glyph}`} />
  </span>;
}
export const KindIcon = ({ kind, ...props }: ChipProps & { kind: StoreKind }) => <IconChip look={kindLook[kind]} {...props} />;
export const FilesIcon = (props: ChipProps) => <IconChip look={filesLook} {...props} />;

// A sidebar row: icon aligned with the title, a subtitle, and a centered count or status on the right.
export function SidebarRow({ icon, title, subtitle, trailing, selected, tooltip, onSelect }: { icon: ReactNode; title: string; subtitle: string; trailing: ReactNode; selected: boolean; tooltip: string; onSelect: () => void }) {
  return <button type="button" data-selected={selected} onClick={onSelect} title={tooltip}
    className="my-0.5 flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-muted data-[selected=true]:bg-muted">
    {icon}
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{title}</span><span className="block truncate text-[11px] text-muted-foreground tabular-nums">{subtitle}</span></span>
    <span className="flex self-center text-muted-foreground tabular-nums">{trailing}</span>
  </button>;
}

export function ConfirmButton({ children, title, description, action, disabled, onConfirm, className, variant = "ghost", size = "xs" }: { children: ReactNode; title: string; description: string; action: string; disabled?: boolean; onConfirm: () => void; className?: string; variant?: "ghost" | "outline"; size?: "xs" | "sm" }) {
  return <Popover>
    <PopoverTrigger asChild><Button variant={variant} size={size} aria-label={title} title={title} disabled={disabled} className={className}>{children}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(300px,calc(100vw-24px))] p-3 text-xs">
      <p className="mb-1 font-medium">{title}?</p>
      <p className="mb-3 text-muted-foreground">{description}</p>
      <div className="flex justify-end gap-2">
        <PopoverClose asChild><Button variant="ghost" size="xs">Cancel</Button></PopoverClose>
        <PopoverClose asChild><Button variant="destructive" size="xs" onClick={onConfirm}>{action}</Button></PopoverClose>
      </div>
    </PopoverContent>
  </Popover>;
}

export function StorageEmpty({ title, description }: { title: string; description: string }) {
  return <Empty className="min-h-0 flex-1 border-0">
    <EmptyHeader>
      <EmptyMedia variant="icon"><DatabaseIcon /></EmptyMedia>
      <EmptyTitle className="text-sm">{title}</EmptyTitle>
      <EmptyDescription className="text-xs">{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>;
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query) : -1;
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="rounded-sm bg-yellow-300/70 px-px text-foreground">{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}
