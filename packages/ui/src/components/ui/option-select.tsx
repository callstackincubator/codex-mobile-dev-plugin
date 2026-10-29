import type { ComponentProps, ReactNode } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./base-select";

export type SelectOption<T extends string> = { value: T; label: string; id?: string };

/**
 * Chooses one of `items`. The trigger shows the selected label unless `children`
 * replaces it, and `renderItem` replaces an item's label in the list.
 */
export function OptionSelect<T extends string, I extends SelectOption<T> = SelectOption<T>>({ items, value, onChange, disabled, id, title, size, className, "aria-label": ariaLabel, side, align = "start", contentClassName, itemClassName, renderItem, children }: {
  items: readonly I[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
  title?: string;
  size?: ComponentProps<typeof SelectTrigger>["size"];
  /** Classes for the trigger. */
  className?: string;
  "aria-label"?: string;
  side?: ComponentProps<typeof SelectContent>["side"];
  align?: ComponentProps<typeof SelectContent>["align"];
  contentClassName?: string;
  itemClassName?: string;
  renderItem?: (item: I) => ReactNode;
  children?: ReactNode;
}) {
  return <Select items={items} value={value} disabled={disabled} onValueChange={next => { if (next !== null) onChange(next); }}>
    <SelectTrigger id={id} title={title} size={size} className={className} aria-label={ariaLabel}>{children ?? <SelectValue />}</SelectTrigger>
    <SelectContent side={side} align={align} alignItemWithTrigger={false} className={contentClassName}><SelectGroup>
      {items.map(item => <SelectItem key={item.value} {...(item.id === undefined ? {} : { id: item.id })} value={item.value} className={itemClassName}>{renderItem ? renderItem(item) : item.label}</SelectItem>)}
    </SelectGroup></SelectContent>
  </Select>;
}
